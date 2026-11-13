#!/usr/bin/env node
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const hash = (data) => createHash('sha256').update(data).digest('hex');
const fail = (message) => { throw new Error(`golden-publication: ${message}`); };
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail(`${label} is not valid JSON`); }
}

function parseCalibrationCsv(bytes) {
  const rows = bytes.toString('utf8').split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (rows[0]?.toLowerCase() !== 'time,singleto2') fail('embedded calibration CSV has unsupported columns');
  const time = []; const singletO2 = [];
  for (const [index, row] of rows.slice(1).entries()) {
    const cells = row.split(',');
    const t = Number(cells[0]); const value = Number(cells[1]);
    if (cells.length !== 2 || !Number.isFinite(t) || t < 0 || !Number.isFinite(value)) fail(`invalid calibration CSV row ${index + 2}`);
    time.push(t); singletO2.push(value);
  }
  return { time, singletO2 };
}

function rmse(observed, predicted) {
  if (!Array.isArray(observed) || !Array.isArray(predicted) || observed.length !== predicted.length || observed.length === 0) fail('RMSE arrays are missing or misaligned');
  let sum = 0;
  for (let index = 0; index < observed.length; index++) {
    if (!Number.isFinite(observed[index]) || !Number.isFinite(predicted[index])) fail('RMSE arrays contain non-finite values');
    const delta = predicted[index] - observed[index]; sum += delta * delta;
  }
  return Math.sqrt(sum / observed.length);
}

export function verifyGoldenPublication(input) {
  const bytes = typeof input === 'string' ? Buffer.from(input) : Buffer.from(input);
  const bundle = parseJson(bytes, 'bundle');
  if (bundle?.manifest?.schema !== 'waveworld.publication-bundle/v1' || !Array.isArray(bundle.entries)) fail('unsupported publication bundle schema');
  if (hash(JSON.stringify(canonical(bundle.manifest))) !== bundle.manifestSha256) fail('manifest digest mismatch');
  const expected = new Map(bundle.manifest.entries.map((entry) => [entry.path, entry]));
  if (expected.size !== bundle.manifest.entries.length || expected.size !== bundle.entries.length) fail('entry set is not one-to-one');
  const decoded = new Map();
  for (const entry of bundle.entries) {
    if (typeof entry.path !== 'string' || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) fail(`unsafe entry path: ${String(entry.path)}`);
    const metadata = expected.get(entry.path);
    const content = Buffer.from(entry.contentBase64, 'base64');
    if (!metadata || metadata.sha256 !== entry.sha256 || metadata.bytes !== entry.bytes || metadata.contentType !== entry.contentType) fail(`entry metadata mismatch: ${entry.path}`);
    if (content.byteLength !== entry.bytes || hash(content) !== entry.sha256) fail(`entry digest mismatch: ${entry.path}`);
    if (decoded.has(entry.path)) fail(`duplicate entry: ${entry.path}`);
    decoded.set(entry.path, content);
  }

  const jsonArtifacts = [...decoded.entries()].filter(([entryPath]) => entryPath.includes('/artifacts/')).map(([entryPath, content]) => ({ entryPath, content, value: parseJson(content, entryPath) }));
  const preregistrations = jsonArtifacts.filter(({ value }) => value?.schema === 'waveworld.golden-case-preregistration/v1');
  const decisions = jsonArtifacts.filter(({ value }) => value?.schema === 'waveworld.golden-case-decision/v1');
  if (preregistrations.length !== 1 || decisions.length !== 1) fail('bundle must contain exactly one preregistration and one decision artifact');
  const preregistration = preregistrations[0].value;
  const decisionArtifact = decisions[0].value;
  const preregistrationSha256 = hash(preregistrations[0].content);
  if (decisionArtifact.caseId !== preregistration.caseId || decisionArtifact.preregistrationSha256 !== preregistrationSha256) fail('decision is not bound to the embedded preregistration');

  const evidenceById = new Map(bundle.manifest.evidence.map((item) => [item.evidenceId, item]));
  const fittedKq = [];
  const recalculatedRmse = [];
  for (const job of bundle.manifest.jobs) {
    const spec = parseJson(decoded.get(job.specPath) ?? fail(`missing spec ${job.specPath}`), job.specPath);
    const result = parseJson(decoded.get(job.resultPath) ?? fail(`missing result ${job.resultPath}`), job.resultPath);
    if (spec.experiment?.model?.id !== 'photosensitization-rk4') continue;
    const calibration = spec.experiment.analysis?.calibration;
    const source = calibration?.evidence;
    if (!source?.evidenceId || !source.sha256) fail(`RK4 job ${job.id} lacks immutable calibration evidence`);
    const evidence = evidenceById.get(source.evidenceId);
    if (!evidence || evidence.disposition !== 'embedded' || evidence.sha256 !== source.sha256 || !evidence.entryPath) fail(`RK4 job ${job.id} evidence is not embedded and bound`);
    const evidenceBytes = decoded.get(evidence.entryPath);
    if (!evidenceBytes || hash(evidenceBytes) !== source.sha256) fail(`RK4 job ${job.id} evidence digest mismatch`);
    const extracted = parseCalibrationCsv(evidenceBytes);
    if (JSON.stringify(canonical(extracted)) !== JSON.stringify(canonical(calibration.observations))) fail(`RK4 job ${job.id} observations do not match embedded evidence`);
    const predicted = result.experiment?.outputs?.['calibration.predictedSingletO2']?.value;
    const computed = rmse(extracted.singletO2, predicted);
    const reported = result.experiment?.outputs?.['calibration.rmse']?.value;
    if (!Number.isFinite(reported) || Math.abs(computed - reported) > 1e-12) fail(`RK4 job ${job.id} calibration RMSE mismatch`);
    const kq = result.experiment?.outputs?.['fitted.k_q']?.value;
    if (!Number.isFinite(kq)) fail(`RK4 job ${job.id} fitted.k_q missing`);
    recalculatedRmse.push(computed); fittedKq.push(kq);
  }
  if (recalculatedRmse.length !== 2) fail('golden publication requires exactly two RK4 condition runs');
  const normalizedRmseMax = Math.max(...recalculatedRmse);
  const relativeDifference = Math.abs(fittedKq[0] - fittedKq[1]) / Math.max(Math.abs(fittedKq[0]), Math.abs(fittedKq[1]), Number.EPSILON);
  const fitPass = normalizedRmseMax <= preregistration.thresholds.normalizedRmseMax;
  const parameterDifferencePass = relativeDifference >= preregistration.thresholds.oxygenSensitiveParameterRelativeDifferenceMin;
  const status = fitPass && parameterDifferencePass ? 'pass' : !fitPass ? 'fail' : 'uncertain';
  const recalculated = { status, rk4FitsPass: fitPass, normalizedRmseMax, oxygenSensitiveParameterRelativeDifference: relativeDifference, parameterDifferencePass };
  for (const [key, value] of Object.entries(recalculated)) {
    if (typeof value === 'number') {
      if (!Number.isFinite(decisionArtifact.decision?.[key]) || Math.abs(value - decisionArtifact.decision[key]) > 1e-12) fail(`decision field mismatch: ${key}`);
    } else if (decisionArtifact.decision?.[key] !== value) fail(`decision field mismatch: ${key}`);
  }
  return {
    ok: true,
    publicId: bundle.manifest.publication.publicId,
    version: bundle.manifest.publication.version,
    bundleSha256: hash(bytes),
    manifestSha256: bundle.manifestSha256,
    preregistrationSha256,
    recalculated,
  };
}

if (process.argv[1] && process.argv[1].endsWith('verify-golden-publication.mjs')) {
  const file = process.argv[2];
  if (!file) fail('usage: node scripts/research/verify-golden-publication.mjs <bundle.wwpub.json>');
  process.stdout.write(`${JSON.stringify(verifyGoldenPublication(fs.readFileSync(file)))}\n`);
}
