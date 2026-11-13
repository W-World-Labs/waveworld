#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA256 = /^[a-f0-9]{64}$/;
const CASE_SCHEMA = 'waveworld.golden-case-manifest/v1';
const PREREG_SCHEMA = 'waveworld.golden-case-preregistration/v1';
const EXPECTED_HEADER = 'pulse_width_us,intensity_au';

function fail(message) {
  throw new Error(`golden-case: ${message}`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readRegularFile(caseRoot, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    fail(`invalid relative path: ${String(relativePath)}`);
  }
  const resolved = path.resolve(caseRoot, relativePath);
  const prefix = `${path.resolve(caseRoot)}${path.sep}`;
  if (!resolved.startsWith(prefix)) fail(`path escapes case root: ${relativePath}`);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch { fail(`missing file: ${relativePath}`); }
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`not a regular file: ${relativePath}`);
  return fs.readFileSync(resolved);
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail(`${label} is not valid JSON`); }
}

export function parseMeasuredCsv(bytes, expectedRows) {
  const text = bytes.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(bytes) !== 0) fail('measurement CSV must be UTF-8');
  if (text.includes('\r')) fail('measurement CSV must use canonical LF line endings');
  const lines = text.trimEnd().split('\n');
  if (lines[0] !== EXPECTED_HEADER) fail(`measurement CSV header must be ${EXPECTED_HEADER}`);
  if (lines.length - 1 !== expectedRows) fail(`measurement CSV row count is ${lines.length - 1}; expected ${expectedRows}`);
  const rows = lines.slice(1).map((line, index) => {
    const columns = line.split(',');
    if (columns.length !== 2) fail(`measurement CSV row ${index + 2} must have two columns`);
    const pulseWidthUs = Number(columns[0]);
    const intensityAu = Number(columns[1]);
    if (!(pulseWidthUs > 0) || !Number.isFinite(intensityAu) || intensityAu < 0) {
      fail(`measurement CSV row ${index + 2} has invalid numeric data`);
    }
    return { pulseWidthUs, intensityAu };
  });
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].pulseWidthUs <= rows[index - 1].pulseWidthUs) fail('pulse widths must be strictly increasing');
  }
  if (rows[0].intensityAu === rows.at(-1).intensityAu) fail('normalization denominator is zero');
  return rows;
}

export function transformMeasurements(rows) {
  if (!Array.isArray(rows) || rows.length < 2) fail('normalization needs at least two measurements');
  const first = rows[0];
  const last = rows.at(-1);
  const denominator = first.intensityAu - last.intensityAu;
  if (!Number.isFinite(denominator) || denominator === 0) fail('normalization denominator is zero');
  return rows.map(({ pulseWidthUs, intensityAu }) => ({
    time: Math.log(pulseWidthUs / first.pulseWidthUs),
    singletO2: (first.intensityAu - intensityAu) / denominator,
  }));
}

export function verifyGoldenCase(caseRoot) {
  const rootStat = fs.lstatSync(caseRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail('case root must be a real directory');
  const manifestBytes = readRegularFile(caseRoot, 'manifest.json');
  const manifest = parseJson(manifestBytes, 'manifest');
  if (manifest.schema !== CASE_SCHEMA) fail('unsupported manifest schema');
  if (manifest.version !== 1 || typeof manifest.caseId !== 'string' || !manifest.caseId) fail('invalid case identity');
  if (manifest.license?.id !== 'CC-BY-4.0' || manifest.citation?.doi !== '10.5281/zenodo.7469900') fail('license or citation identity changed');
  if (!SHA256.test(manifest.upstream?.archiveSha256 ?? '')) fail('invalid upstream archive digest');
  if (!Array.isArray(manifest.files) || manifest.files.length !== 2) fail('case requires exactly two paired measurement files');

  const preregBytes = readRegularFile(caseRoot, manifest.preregistration?.path);
  if (sha256(preregBytes) !== manifest.preregistration?.sha256) fail('preregistration digest mismatch');
  const preregistration = parseJson(preregBytes, 'preregistration');
  if (preregistration.schema !== PREREG_SCHEMA || preregistration.caseId !== manifest.caseId) fail('preregistration identity mismatch');
  if (preregistration.registeredBeforeFormalRun !== true) fail('preregistration must precede the formal run');
  if (!Array.isArray(preregistration.models) || preregistration.models.length < 2) fail('at least two models must be preregistered');
  const thresholds = preregistration.thresholds ?? {};
  for (const key of ['normalizedRmseMax', 'oxygenSensitiveParameterRelativeDifferenceMin', 'repeatRuns', 'repeatAbsoluteTolerance', 'repeatRelativeTolerance', 'cpuGpuAbsoluteTolerance', 'cpuGpuRelativeTolerance', 'uqCoverageProbability', 'uqSamples', 'randomSeed']) {
    if (!Number.isFinite(thresholds[key])) fail(`missing numeric threshold: ${key}`);
  }

  const seen = new Set();
  const datasets = manifest.files.map((entry) => {
    if (seen.has(entry.path)) fail(`duplicate data path: ${entry.path}`);
    seen.add(entry.path);
    if (!SHA256.test(entry.sha256 ?? '') || !SHA256.test(entry.sourceSha256 ?? '')) fail(`invalid digest for ${entry.path}`);
    if (entry.columns?.pulse_width_us !== 'microsecond' || entry.columns?.intensity_au !== 'arbitrary unit') fail(`unit contract changed for ${entry.path}`);
    const bytes = readRegularFile(caseRoot, entry.path);
    if (sha256(bytes) !== entry.sha256) fail(`snapshot digest mismatch: ${entry.path}`);
    const rows = parseMeasuredCsv(bytes, entry.rows);
    const transformed = transformMeasurements(rows);
    return {
      path: entry.path,
      condition: entry.condition,
      sha256: entry.sha256,
      sourceSha256: entry.sourceSha256,
      rows: rows.length,
      transformed,
      transformedSha256: sha256(Buffer.from(JSON.stringify(transformed))),
    };
  });

  return {
    ok: true,
    schema: manifest.schema,
    caseId: manifest.caseId,
    version: manifest.version,
    manifestSha256: sha256(manifestBytes),
    preregistrationSha256: sha256(preregBytes),
    upstreamArchiveSha256: manifest.upstream.archiveSha256,
    datasets,
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? 'verify';
  if (command !== 'verify') {
    process.stderr.write('usage: node scripts/research/golden-case.mjs verify [case-directory]\n');
    process.exit(2);
  }
  const caseRoot = path.resolve(process.argv[3] ?? 'research/golden-case');
  try {
    process.stdout.write(`${JSON.stringify(verifyGoldenCase(caseRoot))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
