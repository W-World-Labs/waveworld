/**
 * #36 agent-jobrunner-w-sim: JobRunner + runClaimLoopOnce seam without live Host HTTP / WebGPU.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMemoryJobHost,
  runClaimLoopOnce,
  type JobHostClient,
  type JobRunner,
} from '@w-sim/runtime';
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts';
import {
  createAgentSolverRegistry,
  createPathExperimentRunner,
  createLbmJobRunner,
} from './runners.ts';
import { createJobHostFromTaskApi } from './host-client.ts';
import {
  PHOTOSENSITIZATION_RK4_MODEL,
  type PathExperimentJobSpecLike,
} from './path-experiment-runner.ts';
import type { TaskApiClient } from './client.ts';
import { runClaimLoop } from './claim-loop.ts';

test('default claim loop binds input mesh downloads to the claimed job', async () => {
  const downloads: string[][] = [];
  const failures: string[] = [];
  const client = {
    claim: async () => ({
      id: 'mesh-job-1',
      attempt: 0,
      spec: {
        schemaVersion: 1, kind: 'lbm-d3q19',
        model: { source: 'artifact', artifactId: 'mesh-input-1' },
        parameters: { gridPreset: 'fast', inletVelocity: 10 },
        run: { maxSteps: 1, forceSampleEvery: 1 },
        outputs: { forces: true },
      },
    }),
    heartbeat: async () => ({ job: { leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() } }),
    downloadModel: async (artifactId: string, jobId: string) => {
      downloads.push([artifactId, jobId]);
      // Exercise the real dispatch and loader without starting a GPU solver.
      throw new Error('fixture mesh unavailable');
    },
    fail: async (_jobId: string, error: string) => {
      failures.push(error);
      return { status: 'failed', jobId: 'mesh-job-1', error };
    },
    complete: async () => { assert.fail('a missing mesh must never complete'); },
  } as unknown as TaskApiClient;
  await runClaimLoop({ client, agentId: 'mesh-agent', once: true });
  assert.deepEqual(downloads, [['mesh-input-1', 'mesh-job-1']]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /model load failed: fixture mesh unavailable/);
});

function pathSpec(): PathExperimentJobSpecLike {
  return {
    schemaVersion: 1,
    kind: 'path-experiment',
    parameters: {
      k_exc: 0.35,
      k_f: 2,
      k_isc: 3,
      k_T: 0.2,
      k_q: 1.5,
      k_d: 5,
      k_I: 0.3,
      O2: 1,
      substrate: 1,
      cTot: 1,
      dt: 0.01,
    },
    run: { maxSteps: 100, forceSampleEvery: 20 },
    experiment: {
      experimentId: 'ir-ultrasound-ros',
      title: 'Ir ultrasound triplet to ROS',
      model: PHOTOSENSITIZATION_RK4_MODEL,
      materials: [
        {
          id: 'ir-complex-candidate',
          name: 'Ir(III) candidate',
          role: 'sonosensitizer',
          source: { kind: 'assumption' },
        },
      ],
      steps: [
        {
          id: 'ultrasound-triplet',
          label: 'ultrasound to triplet',
          mechanism: 'sonoluminescence',
          inputs: ['ultrasound', 'Ir-S0'],
          outputs: ['Ir-T1'],
          hypothesis: {
            status: 'candidate',
            description: 'sonoluminescence sensitization',
            sources: [{ kind: 'literature' }],
          },
        },
      ],
      parameters: {},
      provenance: {
        createdAt: '2026-08-02T00:00:00.000Z',
        software: { name: 'WaveWorld', version: '1' },
      },
    },
  };
}

test('path JobRunner completes via runClaimLoopOnce on createMemoryJobHost (no HTTP)', async () => {
  const spec = pathSpec() as JobSpecV1;
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'path-job-1', spec },
  ]);
  const runners = [createPathExperimentRunner({ agentId: 'agent-seam' })];

  const status = await runClaimLoopOnce(host, 'agent-seam', runners);

  assert.equal(status, 'completed');
  assert.equal(failed.size, 0);
  const result = completed.get('path-job-1');
  assert.ok(result);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.summary.steps, 100);
  assert.equal(result.backend?.agentId, 'agent-seam');
  assert.ok(
    result.experiment &&
      Number((result.experiment as { outputs: Record<string, { value: number }> }).outputs.finalSingletO2.value) > 0,
  );
});

test('path-experiment via createAgentSolverRegistry + runClaimLoopOnce (product model)', async () => {
  const spec = pathSpec() as JobSpecV1;
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'path-reg-1', spec },
  ]);
  const registry = createAgentSolverRegistry({ agentId: 'agent-reg-seam' });
  const status = await runClaimLoopOnce(host, 'agent-reg-seam', registry);
  assert.equal(status, 'completed');
  assert.equal(failed.size, 0);
  const result = completed.get('path-reg-1');
  assert.ok(result);
  assert.equal(result.backend?.id, 'cpu-path-experiment');
  assert.ok(
    Number((result.experiment as { outputs: Record<string, { value: number }> }).outputs.finalSingletO2.value) > 0,
  );
});

test('lbm kind JobRunner completes via runClaimLoopOnce with fake host (no WebGPU)', async () => {
  const lbmSpec: JobSpecV1 = {
    schemaVersion: 1,
    kind: 'lbm-d3q19',
    parameters: { inletVelocity: 1, gridPreset: 'fast' },
    run: { maxSteps: 10 },
    outputs: { forces: true },
  };

  const fakeLbm: JobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    run: async (spec, onProgress) => {
      await onProgress?.({ step: 0, total: spec.run.maxSteps, message: 'fake-lbm' });
      await onProgress?.({ step: spec.run.maxSteps, total: spec.run.maxSteps, cd: 1.1, cl: 0 });
      return {
        schemaVersion: 1,
        summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 1.1, cl: 0 },
        backend: { id: 'cpu', agentId: 'agent-lbm' },
      };
    },
  };

  // Real LBM runner is registered for canRun, but fake wins first when it matches.
  const realLbm = createLbmJobRunner({ agentId: 'agent-lbm' });
  assert.equal(realLbm.canRun(lbmSpec), true);

  const { host, completed } = createMemoryJobHost([{ jobId: 'lbm-1', spec: lbmSpec }]);
  const status = await runClaimLoopOnce(host, 'agent-lbm', [fakeLbm]);
  assert.equal(status, 'completed');
  assert.equal(completed.get('lbm-1')?.summary.cd, 1.1);
});

test('createJobHostFromTaskApi maps claim/complete/fail onto TaskApiClient', async () => {
  const lbmSpec: JobSpecV1 = {
    schemaVersion: 1,
    kind: 'lbm-d3q19',
    parameters: {},
    run: { maxSteps: 5 },
    outputs: { forces: true },
  };

  let claimed = false;
  let completed: JobResultV1 | undefined;
  let failed: string | undefined;
  const progress: Array<{ step: number }> = [];

  const client = {
    claim: async () => {
      if (claimed) return null;
      claimed = true;
      return {
        id: 'http-job-1',
        attempt: 0,
        leaseExpiresAt: null,
        spec: lbmSpec,
      };
    },
    heartbeat: async (_id: string, p?: { step?: number }) => {
      if (p?.step != null) progress.push({ step: p.step });
      return { job: {} };
    },
    complete: async (_id: string, result: JobResultV1) => {
      completed = result;
      return { status: 'succeeded', jobId: 'http-job-1', result };
    },
    fail: async (_id: string, error: string) => {
      failed = error;
      return { status: 'failed', jobId: 'http-job-1', error };
    },
  } as unknown as TaskApiClient;

  const host: JobHostClient = createJobHostFromTaskApi(client);
  const runner: JobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    run: async (spec, onProgress) => {
      await onProgress?.({ step: 1, total: spec.run.maxSteps });
      return {
        schemaVersion: 1,
        summary: { steps: spec.run.maxSteps, wallTimeMs: 2, cd: 0.9 },
        backend: { id: 'cpu', agentId: 'a' },
      };
    },
  };

  assert.equal(await runClaimLoopOnce(host, 'a', [runner]), 'completed');
  assert.equal(completed?.summary.cd, 0.9);
  assert.equal(failed, undefined);
  assert.ok(progress.some((p) => p.step === 1));

  assert.equal(await runClaimLoopOnce(host, 'a', [runner]), 'idle');
});

test('runClaimLoopOnce fails when no runner matches kind', async () => {
  const { host, failed } = createMemoryJobHost([
    {
      jobId: 'unknown-1',
      spec: {
        schemaVersion: 1,
        kind: 'export-report',
        parameters: {},
        run: { maxSteps: 1 },
        outputs: {},
      },
    },
  ]);
  const status = await runClaimLoopOnce(host, 'a', [
    createPathExperimentRunner({ agentId: 'a' }),
  ]);
  assert.equal(status, 'failed');
  assert.match(failed.get('unknown-1') ?? '', /no runner/);
});
