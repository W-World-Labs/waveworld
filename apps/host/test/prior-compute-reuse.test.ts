import { stationaryMassReport } from './lbm-result-fixture';
import { LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE } from '@w-sim/contracts';
/**
 * Prior-compute load + equivalent-spec reuse (compute cloud slice).
 * Drives real task service + artifacts — no mock of the unit under test.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareProductLbmLattice } from '@w-sim/solvers-lbm/d3q19';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');
const testDb = path.join(waveRoot, 'data', 'tasks-test-prior-compute.db');
const testArtifactRoot = path.join(waveRoot, 'data', 'artifacts-prior-compute-test');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  process.env.ARTIFACT_ROOT = testArtifactRoot;
  process.env.TASK_LEASE_SECONDS = '30';
  delete process.env.AGENT_WORKSPACE;
  for (const p of [testDb, testDb + '-wal', testDb + '-shm']) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ok */
    }
  }
  fs.rmSync(testArtifactRoot, { recursive: true, force: true });
  fs.mkdirSync(testArtifactRoot, { recursive: true });
});

describe('prior compute load + fingerprint reuse', { concurrency: false }, () => {
  it('complete → loadSucceededJobResult by job id returns same KPI summary', async () => {
    const {
      createJob,
      claimJob,
      completeJob,
      loadSucceededJobResult,
      getJob,
    } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const { fingerprintJobSpec } = await import('@/lib/tasks/job-fingerprint.ts');

    const spec = defaultJobSpec({ model: { source: 'preset', referenceLength: 1 },
      name: 'prior-load-kpi',
      run: { maxSteps: 12, forceSampleEvery: 4, warmupSteps: 0 },
      parameters: { inletVelocity: 1.5, gridPreset: 'fast', viscosityMode: 'stabilized-preview' },
    });
    const expectedFp = fingerprintJobSpec({ ...spec, requirements: {
      ...spec.requirements, features: [LBM_GAUGE_FORCE_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE],
    } });

    const job = createJob({ spec });
    assert.equal(job.status, 'queued');
    assert.equal(job.specFingerprint, expectedFp);

    const claimed = claimJob({
      agentId: 'agent-prior-1',
      capabilities: { backends: ['cpu'], kinds: ['lbm-d3q19'], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE] },
    });
    assert.ok(claimed);
    assert.equal(claimed!.id, job.id);

    const resultPayload = {
      schemaVersion: 1 as const,
      summary: { steps: 12, cd: 0.87, cl: 0.03, dragN: 1, liftN: 0, wallTimeMs: 42 },
      history: { step: [4, 8, 12], cd: [0.87, 0.87, 0.87], cl: [0.03, 0.03, 0.03], dragN: [1, 1, 1], liftN: [0, 0, 0] },
      lbmMassBalance: stationaryMassReport(), derived: { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...prepareProductLbmLattice(spec, null).units },
      backend: { id: 'cpu-teaching', agentId: 'agent-prior-1' },
    };
    const done = completeJob({
      jobId: job.id,
      agentId: 'agent-prior-1',
      result: resultPayload,
    });
    assert.equal(done!.status, 'succeeded');
    assert.equal(done!.result?.summary.cd, 0.87);

    const loaded = loadSucceededJobResult(job.id);
    assert.ok(loaded, 'loadSucceededJobResult must find succeeded job');
    assert.equal(loaded!.jobId, job.id);
    assert.equal(loaded!.status, 'succeeded');
    assert.equal(loaded!.result.summary.cd, 0.87);
    assert.equal(loaded!.result.summary.cl, 0.03);
    assert.equal(loaded!.result.summary.steps, 12);
    assert.equal(loaded!.specFingerprint, expectedFp);

    // getJob path also retains identity
    const again = getJob(job.id);
    assert.equal(again?.result?.summary.cd, loaded!.result.summary.cd);
  });

  it('artifact saved on job → loadArtifactData by id returns same bytes', async () => {
    const {
      createJob,
      claimJob,
      completeJob,
      loadSucceededJobResult,
      loadArtifactData,
    } = await import('@/lib/tasks/service.ts');
    const { saveArtifact } = await import('@/lib/tasks/artifacts.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');

    const job = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'prior-artifact', parameters: { inletVelocity: 0.001 }, run: { maxSteps: 5, forceSampleEvery: 5, warmupSteps: 0 } }),
    });
    claimJob({
      agentId: 'agent-art',
      capabilities: { backends: ['cpu'], kinds: ['lbm-d3q19'], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE] },
    });

    const payload = Buffer.from('KPI-FIELD-SLICE-v1:cd=1.11;cl=0.02', 'utf8');
    const art = saveArtifact({
      jobId: job.id,
      kind: 'log',
      contentType: 'text/plain',
      data: payload,
    });

    completeJob({
      jobId: job.id,
      agentId: 'agent-art',
      result: {
        schemaVersion: 1,
        summary: { steps: 5, cd: 1.11, cl: 0.02, dragN: 1, liftN: 0, wallTimeMs: 9 },
        history: { step: [5], cd: [1.11], cl: [0.02], dragN: [1], liftN: [0] },
        lbmMassBalance: stationaryMassReport(), derived: { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...prepareProductLbmLattice(job.spec, null).units },
        artifacts: [
          {
            kind: 'log',
            artifactId: art.id,
            contentType: 'text/plain',
            bytes: payload.byteLength,
          },
        ],
        backend: { id: 'cpu', agentId: 'agent-art' },
      },
    });

    const loadedJob = loadSucceededJobResult(job.id);
    assert.ok(loadedJob);
    assert.equal(loadedJob!.result.artifacts?.[0]?.artifactId, art.id);
    assert.ok(loadedJob!.artifactMetas.some((m) => m.id === art.id));

    const loadedArt = loadArtifactData(art.id);
    assert.ok(loadedArt);
    assert.equal(loadedArt!.artifactId, art.id);
    assert.equal(loadedArt!.jobId, job.id);
    assert.equal(loadedArt!.bytes, payload.byteLength);
    assert.deepEqual(loadedArt!.data, payload);
    assert.equal(loadedArt!.data.toString('utf8'), payload.toString('utf8'));
  });

  it('createOrReuseJob reuses succeeded fingerprint; different params miss', async () => {
    const {
      createJob,
      claimJob,
      completeJob,
      createOrReuseJob,
      findSucceededJobByFingerprint,
    } = await import('@/lib/tasks/service.ts');
    const { fingerprintJobSpec } = await import('@/lib/tasks/job-fingerprint.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');

    const baseSpec = defaultJobSpec({ model: { source: 'preset', referenceLength: 1 },
      name: 'reuse-base',
      parameters: { inletVelocity: 2.0, gridPreset: 'fast', angleOfAttack: 0, viscosityMode: 'stabilized-preview' },
      run: { maxSteps: 20, forceSampleEvery: 5, warmupSteps: 0 },
    });

    const job = createJob({ spec: baseSpec });
    claimJob({
      agentId: 'agent-reuse',
      capabilities: { backends: ['cpu'], kinds: ['lbm-d3q19'], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE] },
    });
    completeJob({
      jobId: job.id,
      agentId: 'agent-reuse',
      result: {
        schemaVersion: 1,
        summary: { steps: 20, cd: 0.55, cl: -0.01, dragN: 1, liftN: 0, wallTimeMs: 100 },
        history: { step: [5, 10, 15, 20], cd: [0.55, 0.55, 0.55, 0.55], cl: [-0.01, -0.01, -0.01, -0.01], dragN: [1, 1, 1, 1], liftN: [0, 0, 0, 0] },
        lbmMassBalance: stationaryMassReport(), derived: { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...prepareProductLbmLattice(baseSpec, null).units },
        backend: { id: 'cpu', agentId: 'agent-reuse' },
      },
    });

    const fp = fingerprintJobSpec(job.spec);
    const found = findSucceededJobByFingerprint(fp);
    assert.ok(found);
    assert.equal(found!.id, job.id);
    assert.equal(found!.result?.summary.cd, 0.55);

    // Same physical spec (name ignored) → reuse
    const samePhysics = defaultJobSpec({ model: { source: 'preset', referenceLength: 1 },
      name: 'different-cosmetic-name',
      parameters: { inletVelocity: 2.0, gridPreset: 'fast', angleOfAttack: 0, viscosityMode: 'stabilized-preview' },
      run: { maxSteps: 20, forceSampleEvery: 5, warmupSteps: 0 },
    });
    assert.equal(fingerprintJobSpec({ ...samePhysics, requirements: job.spec.requirements }), fp);

    const reused = createOrReuseJob({ spec: samePhysics, reuseSucceeded: true });
    assert.equal(reused.reused, true);
    assert.equal(reused.job.id, job.id);
    assert.equal(reused.job.status, 'succeeded');
    assert.equal(reused.job.result?.summary.cd, 0.55);

    // Different inlet → new queue
    const different = defaultJobSpec({ model: { source: 'preset', referenceLength: 1 },
      name: 'diff-vel',
      parameters: { inletVelocity: 3.0, gridPreset: 'fast', angleOfAttack: 0, viscosityMode: 'stabilized-preview' },
      run: { maxSteps: 20, forceSampleEvery: 5, warmupSteps: 0 },
    });
    assert.notEqual(fingerprintJobSpec({ ...different, requirements: job.spec.requirements }), fp);
    const fresh = createOrReuseJob({ spec: different, reuseSucceeded: true });
    assert.equal(fresh.reused, false);
    assert.equal(fresh.job.status, 'queued');
    assert.notEqual(fresh.job.id, job.id);

    // reuseSucceeded false always queues
    const forced = createOrReuseJob({ spec: samePhysics, reuseSucceeded: false });
    assert.equal(forced.reused, false);
    assert.equal(forced.job.status, 'queued');
  });

  it('fingerprint is stable and excludes cosmetic name', async () => {
    const { fingerprintJobSpec, canonicalizeJobSpecForFingerprint } = await import(
      '@/lib/tasks/job-fingerprint.ts'
    );
    const { defaultJobSpec } = await import('@/types/task.ts');

    const a = defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'A', parameters: { inletVelocity: 1 } });
    const b = defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'B', parameters: { inletVelocity: 1 } });
    assert.equal(fingerprintJobSpec(a), fingerprintJobSpec(b));
    assert.equal(fingerprintJobSpec(a).length, 64);
    const c = canonicalizeJobSpecForFingerprint(a);
    assert.equal(c.kind, 'lbm-d3q19');
    assert.ok(!('name' in c));
  });
});
