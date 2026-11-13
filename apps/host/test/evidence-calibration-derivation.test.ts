import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PathExperimentAnalysisV1, PathEvidenceSource } from '@/types/task.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const db = path.join(root, 'data', 'tasks-test-evidence-derivation.db');
const artifacts = path.join(root, 'data', 'artifacts-test-evidence-derivation');

before(() => {
  process.env.TASK_DB_PATH = db;
  process.env.ARTIFACT_ROOT = artifacts;
  process.env.ARTIFACT_MAX_BYTES = String(1024 * 1024);
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(db + suffix); } catch { /* absent */ } }
  fs.rmSync(artifacts, { recursive: true, force: true });
  fs.mkdirSync(artifacts, { recursive: true });
});

function spec(observations: { time: number[]; T1?: number[]; singletO2?: number[] }, evidence: { id: string; sha256: string }) {
  return {
    schemaVersion: 1 as const, kind: 'path-experiment' as const, name: 'evidence calibration', parameters: {},
    run: { maxSteps: 10 }, outputs: { forces: false, history: true, fields: [] }, requirements: { backends: ['cpu' as const] },
    experiment: {
      experimentId: 'calibration-e2e', title: 'Calibration evidence derivation',
      materials: [{ id: 'sensitizer', name: 'Sensitizer', role: 'sensitizer', source: { kind: 'assumption' as const } }],
      steps: [{ id: 'excitation', label: 'Excitation', mechanism: 'photoexcitation', inputs: [], outputs: [], hypothesis: { status: 'candidate' as const, description: 'calibration candidate', sources: [{ kind: 'assumption' as const }] } }],
      parameters: {},
      model: { id: 'photosensitization-rk4', version: '1.0.0' },
      analysis: { calibration: {
        observations,
        evidence: { kind: 'measured' as const, evidenceId: evidence.id, sha256: evidence.sha256, locator: 'columns=time,T1|singletO2', transform: 'CSV numeric parse v1' },
        fitParameters: { k_exc: { min: 0.1, max: 2 } },
      } as NonNullable<PathExperimentAnalysisV1['calibration']> & { evidence: PathEvidenceSource } },
      provenance: { createdAt: '2026-08-02T00:00:00.000Z', software: { name: 'test', version: '1' } },
    },
  };
}

describe('versioned calibration evidence derivation', { concurrency: false }, () => {
  it('rebuilds observations from immutable CSV and stamps derivation into the stored spec', async () => {
    const { importEvidence, validateJobEvidenceReferences } = await import('@/lib/tasks/evidence.ts');
    const { createJob } = await import('@/lib/tasks/service.ts');
    const csv = 'time,T1,singletO2\n0,0,0\n0.5,0.25,0.04\n';
    const evidence = importEvidence({ kind: 'measured', title: 'calibration.csv', format: 'csv', contentBase64: Buffer.from(csv).toString('base64') }, 'scientist-1');
    const submitted = spec({ time: [0, 0.5], T1: [0, 0.25], singletO2: [0, 0.04] }, evidence);

    validateJobEvidenceReferences(submitted, 'scientist-1');
    const derivation = submitted.experiment.analysis.calibration.evidenceDerivation;
    assert.equal(derivation?.extractor, 'waveworld.calibration-csv');
    assert.equal(derivation?.version, '1');
    assert.equal(derivation?.sourceSha256, evidence.sha256);
    assert.match(derivation?.observationsSha256 ?? '', /^[a-f0-9]{64}$/);
    assert.deepEqual(derivation?.columns, { time: 'time', T1: 'T1', singletO2: 'singletO2' });
    const stored = createJob({ spec: submitted });
    assert.deepEqual(stored.spec.experiment?.analysis?.calibration?.evidenceDerivation, derivation);
  });

  it('rejects observations that do not exactly match the evidence bytes', async () => {
    const { importEvidence, validateJobEvidenceReferences } = await import('@/lib/tasks/evidence.ts');
    const csv = 'time,T1\n0,0\n1,0.5\n';
    const evidence = importEvidence({ kind: 'measured', title: 'truth.csv', format: 'csv', contentBase64: Buffer.from(csv).toString('base64') }, 'scientist-1');
    assert.throws(() => validateJobEvidenceReferences(spec({ time: [0, 1], T1: [0, 999] }, evidence), 'scientist-1'), /do not match the evidence-derived observations/);
  });

  const incompleteCases: Array<[string, string, Parameters<typeof spec>[0]]> = [
    ['empty T1', 'time,T1\n0,1\n1,', { time: [0, 1], T1: [1, 0] }],
    ['empty time', 'time,T1\n0,1\n,2', { time: [0, 0], T1: [1, 2] }],
    ['whitespace oxygen', 'time,singletO2\n0,1\n1,  ', { time: [0, 1], singletO2: [1, 0] }],
    ['empty mixed observation', 'time,T1,singletO2\n0,1,2\n1,,3', { time: [0, 1], T1: [1, 0], singletO2: [2, 3] }],
    ['missing observation column', 'time,T1,singletO2\n0,1,2\n1,3', { time: [0, 1], T1: [1, 3], singletO2: [2, 0] }],
  ];
  for (const [name, csv, observations] of incompleteCases) {
    it(`rejects imported ${name} instead of certifying a fabricated zero`, async () => {
      const { importEvidence, validateJobEvidenceReferences } = await import('@/lib/tasks/evidence.ts');
      const { HttpError } = await import('@/lib/tasks/http.ts');
      const evidence = importEvidence({ kind: 'measured', title: 'incomplete.csv', format: 'csv', contentBase64: Buffer.from(csv).toString('base64') }, 'scientist-1');
      const submitted = spec(observations, evidence);
      assert.throws(() => validateJobEvidenceReferences(submitted, 'scientist-1'), (error) =>
        error instanceof HttpError && error.status === 400 && /invalid numeric data/.test(error.message));
      assert.equal(submitted.experiment.analysis.calibration.evidenceDerivation, undefined);
    });
  }

  it('preserves explicit zero and scientific notation in new evidence derivations', async () => {
    const { importEvidence, validateJobEvidenceReferences } = await import('@/lib/tasks/evidence.ts');
    const evidence = importEvidence({ kind: 'measured', title: 'zeros.csv', format: 'csv', contentBase64: Buffer.from('time,T1,singletO2\n 0 , 0 , 0 \n1e-3,2e-4,0\n').toString('base64') }, 'scientist-1');
    const submitted = spec({ time: [0, 0.001], T1: [0, 0.0002], singletO2: [0, 0] }, evidence);
    validateJobEvidenceReferences(submitted, 'scientist-1');
    assert.equal(submitted.experiment.analysis.calibration.evidenceDerivation?.version, '1');
  });

  it('keeps historical v1 extraction reproducible independently of new-job admission', async () => {
    const { extractCalibrationCsvV1 } = await import('@/lib/tasks/evidence.ts');
    assert.deepEqual(extractCalibrationCsvV1(Buffer.from('time,T1\n0,1\n1,')).observations,
      { time: [0, 1], T1: [1, 0] });
  });

  it('returns HTTP 400 without queueing a job that substitutes zero for an imported blank', async () => {
    const { devLogin } = await import('../src/lib/user-auth.ts');
    const { listJobs } = await import('@/lib/tasks/service.ts');
    const { POST: importRoute } = await import('../src/app/api/v1/evidence/import/route.ts');
    const { POST: submitRoute } = await import('../src/app/api/v1/jobs/route.ts');
    const user = await devLogin({ name: 'csv-admission-scientist', workspaceId: 'evidence-test' });
    const request = (url: string, body: unknown) => new Request(url, {
      method: 'POST', headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const imported = await importRoute(request('http://localhost/api/v1/evidence/import', {
      kind: 'measured', title: 'missing-measurement.csv', format: 'csv', contentBase64: Buffer.from('time,T1\n0,1\n1,').toString('base64'),
    }));
    assert.equal(imported.status, 201);
    const evidence = (await imported.json()).evidence as { id: string; sha256: string };
    const previousJobs = listJobs().map((job) => job.id);
    const response = await submitRoute(request('http://localhost/api/v1/jobs', {
      spec: spec({ time: [0, 1], T1: [1, 0] }, evidence),
    }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /invalid numeric data/);
    assert.deepEqual(listJobs().map((job) => job.id), previousJobs);
  });

  it('rejects an unrelated CSV and unsupported mapping instead of trusting browser claims', async () => {
    const { importEvidence, validateJobEvidenceReferences } = await import('@/lib/tasks/evidence.ts');
    const evidence = importEvidence({ kind: 'measured', title: 'unrelated.csv', format: 'csv', contentBase64: Buffer.from('wavelength,absorbance\n400,0.2\n').toString('base64') }, 'scientist-1');
    assert.throws(() => validateJobEvidenceReferences(spec({ time: [0], T1: [0] }, evidence), 'scientist-1'), /requires time and T1 or singletO2/);
    const wrongMapping = spec({ time: [0], T1: [0] }, evidence);
    wrongMapping.experiment.analysis.calibration.evidence.locator = 'columns=wavelength,absorbance';
    assert.throws(() => validateJobEvidenceReferences(wrongMapping, 'scientist-1'), /supported CSV v1 column mapping/);
  });
});
