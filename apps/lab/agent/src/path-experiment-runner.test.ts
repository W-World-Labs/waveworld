import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  PHOTOSENSITIZATION_RK4_MODEL,
  PHOTOSENSITIZATION_STEADY_STATE_MODEL,
  PathModelRegistry,
  createDefaultPathModelRegistry,
  runPathExperiment,
  type PathExperimentJobSpecLike,
} from './path-experiment-runner.ts';
import { processJob } from './claim-loop.ts';
import { resolveAgentBuildProvenance } from './build-provenance.ts';
import type { TaskApiClient } from './client.ts';
import type { JobRecord, JobResultV1 } from '../../src/types/task.ts';

test('builtin path progress failures settle the runner without crashing the worker', () => {
  for (const model of [PHOTOSENSITIZATION_RK4_MODEL, PHOTOSENSITIZATION_STEADY_STATE_MODEL]) {
    const job = spec();
    job.experiment!.model = model;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import { createDualPathPathExperimentRunner } from ${JSON.stringify(new URL('./runners.ts', import.meta.url).href)};
      const runner = createDualPathPathExperimentRunner({ agentId: 'progress-failure' });
      try {
        await runner.run(${JSON.stringify(job)}, async () => {
          await new Promise(resolve => setImmediate(resolve));
          throw new Error('heartbeat failed: 500 host unavailable');
        });
        console.log('unexpected-complete');
      } catch (error) {
        console.log('settled-failed:' + error.message);
      }
    `], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /settled-failed:heartbeat failed: 500 host unavailable/);
    assert.doesNotMatch(child.stdout, /unexpected-complete/);
  }
});

test('builtin path adapters wait for progress acknowledgements and observe cancellation during them', async () => {
  for (const model of [PHOTOSENSITIZATION_RK4_MODEL, PHOTOSENSITIZATION_STEADY_STATE_MODEL]) {
    const job = spec();
    job.experiment!.model = model;
    job.run = { maxSteps: 4, forceSampleEvery: 1 };
    let pending = 0;
    let acknowledged = 0;
    const result = await runPathExperiment({
      spec: job,
      agentId: 'progress-order',
      onProgress: async () => {
        assert.equal(pending++, 0, 'progress acknowledgements must not overlap');
        await new Promise<void>((resolve) => setImmediate(resolve));
        pending--;
        acknowledged++;
      },
    });
    assert.equal(pending, 0);
    assert.equal(acknowledged, result.summary.steps);

    const cancel = new AbortController();
    await assert.rejects(runPathExperiment({
      spec: job,
      agentId: 'progress-cancel',
      signal: cancel.signal,
      onProgress: async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        cancel.abort();
      },
    }), { name: 'AbortError' });
  }
});

function spec(overrides: Record<string, unknown> = {}): PathExperimentJobSpecLike {
  return {
    schemaVersion: 1,
    kind: 'path-experiment',
    parameters: {
      k_exc: 0.35, k_f: 2, k_isc: 3, k_T: 0.2, k_q: 1.5, k_d: 5,
      k_I: 0.3, O2: 1, substrate: 1, cTot: 1, dt: 0.01,
      ...overrides,
    },
    run: { maxSteps: 200, forceSampleEvery: 20 },
    experiment: {
      experimentId: 'ir-ultrasound-ros',
      title: 'Ir ultrasound triplet to ROS',
      model: PHOTOSENSITIZATION_RK4_MODEL,
      materials: [{
        id: 'ir-complex-candidate', name: 'Ir(III) candidate', role: 'sonosensitizer',
        source: { kind: 'assumption' },
      }],
      steps: [{
        id: 'ultrasound-triplet', label: 'ultrasound to triplet', mechanism: 'sonoluminescence',
        inputs: ['ultrasound', 'Ir-S0'], outputs: ['Ir-T1'],
        hypothesis: { status: 'candidate', description: 'sonoluminescence sensitization', sources: [{ kind: 'literature' }] },
      }],
      parameters: {},
      provenance: { createdAt: '2026-08-02T00:00:00.000Z', software: { name: 'WaveWorld', version: '1' } },
    },
  };
}

test('runs an Ir ultrasound triplet-to-ROS path through unified result', async () => {
  const result = await runPathExperiment({ spec: spec(), agentId: 'agent-1', now: () => 100 });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.summary.steps, 200);
  assert.equal(result.backend.id, 'cpu-path-experiment');
  assert.equal(result.experiment.modelVersion, '1.0.0');
  assert.ok(Number(result.experiment.outputs.finalT1.value) > 0);
  assert.ok(Number(result.experiment.outputs.finalSingletO2.value) > 0);
  assert.equal((result.experiment.outputs.time.value as number[]).length, 11);
  assert.equal(result.experiment.experimentId, 'ir-ultrasound-ros');
});

test('binds executable source and dependency lock digests into the result', async () => {
  const build = resolveAgentBuildProvenance();
  assert.match(build.modelImplementationSha256, /^[a-f0-9]{64}$/);
  assert.match(build.dependencyLockSha256, /^[a-f0-9]{64}$/);
  assert.ok(build.agentBuildId);
  const result = await runPathExperiment({ spec: spec(), agentId: 'digest-agent', buildProvenance: build, now: () => 1 });
  assert.deepEqual(result.backend.provenance, build);
  assert.equal(result.experiment.provenance.modelImplementationSha256, build.modelImplementationSha256);
  assert.equal(result.experiment.provenance.dependencyLockSha256, build.dependencyLockSha256);
  assert.equal(result.experiment.provenance.agentBuildId, build.agentBuildId);
});

test('parameters dynamically alter the path instead of selecting a hard-coded experiment', async () => {
  const lowO2 = await runPathExperiment({ spec: spec({ O2: 0.05 }), agentId: 'agent-1' });
  const highO2 = await runPathExperiment({ spec: spec({ O2: 2 }), agentId: 'agent-1' });
  assert.ok(Number(highO2.experiment.outputs.typeIIFraction.value) > Number(lowO2.experiment.outputs.typeIIFraction.value));
  assert.ok(Number(highO2.experiment.outputs.singletO2GenerationRate.value) > Number(lowO2.experiment.outputs.singletO2GenerationRate.value));
});

test('dynamically selects the analytic steady-state plugin and reports one solve step', async () => {
  const rkSpec = spec();
  rkSpec.run = { maxSteps: 4000, forceSampleEvery: 4000 };
  const rk = await runPathExperiment({ spec: rkSpec, agentId: 'cpu-rk4' });

  const steadySpec = spec();
  steadySpec.experiment!.model = PHOTOSENSITIZATION_STEADY_STATE_MODEL;
  let progress: { step: number; total: number } | undefined;
  const analytic = await runPathExperiment({
    spec: steadySpec,
    agentId: 'cpu-analytic',
    onProgress: ({ step, total }) => { progress = { step, total }; },
  });

  assert.equal(analytic.summary.steps, 1, 'closed-form solve is one execution step');
  assert.deepEqual(progress, { step: 1, total: 1 });
  assert.equal(analytic.experiment.modelVersion, PHOTOSENSITIZATION_STEADY_STATE_MODEL.version);
  assert.match(analytic.experiment.provenance.engineVersion, /photosensitization-steady-state@1\.0\.0/);
  assert.ok(!('time' in analytic.experiment.outputs), 'analytic plugin does not emit an RK4 trajectory');
  assert.ok(Math.abs(
    Number(analytic.experiment.outputs.steadyT1.value) - Number(rk.experiment.outputs.steadyT1.value),
  ) < 1e-12);
  const branchSum = ['typeIFraction', 'typeIIFraction', 'deactivationFraction']
    .reduce((sum, key) => sum + Number(analytic.experiment.outputs[key].value), 0);
  assert.ok(Math.abs(branchSum - 1) < 1e-12);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runPathExperiment({ spec: steadySpec, agentId: 'cancelled', signal: controller.signal }), { name: 'AbortError' });
});

test('default capabilities expose both executable model manifests', () => {
  const manifests = createDefaultPathModelRegistry().manifests();
  assert.deepEqual(manifests.map(({ id, version }) => `${id}@${version}`), [
    'photosensitization-rk4@1.0.0',
    'photosensitization-steady-state@1.0.0',
  ]);
  for (const manifest of manifests) {
    assert.deepEqual(manifest.backends, ['cpu']);
    assert.ok(Object.keys(manifest.parameters).length >= 10);
    assert.ok(Object.keys(manifest.outputs).length >= 5);
  }
});

test('registry accepts an independent future path model', async () => {
  const registry = new PathModelRegistry().register({
    manifest: {
      id: 'future-model', version: '2.1', backends: ['cpu'],
      parameters: { alpha: { type: 'number' } },
      outputs: { score: { type: 'number' } },
    },
    run: ({ maxSteps }) => ({ steps: maxSteps, metrics: { score: 7 } }),
  });
  const custom = spec();
  custom.experiment!.model = { id: 'future-model', version: '2.1' };
  custom.experiment!.parameters = { alpha: { value: 4, source: { kind: 'assumption' } } };
  const result = await runPathExperiment({ spec: custom, agentId: 'agent-2', registry });
  assert.equal(result.experiment.outputs.score.value, 7);
});

test('registry exposes validated manifests for pre-claim capability advertisement', () => {
  const manifests = new PathModelRegistry().register({
    manifest: {
      id: 'declared', version: '1', backends: ['cpu'],
      parameters: { alpha: { type: 'number', required: true, min: 0 } },
      outputs: { score: { type: 'number' } },
    },
    run: () => ({ steps: 1, metrics: { score: 1 } }),
  }).manifests();
  assert.deepEqual(manifests[0], {
    id: 'declared', version: '1', backends: ['cpu'],
    parameters: { alpha: { type: 'number', required: true, min: 0 } },
    outputs: { score: { type: 'number' } },
  });
  assert.throws(() => new PathModelRegistry().register({
    manifest: { id: 'bad', version: '1', backends: [], parameters: {}, outputs: {} },
    run: () => ({ steps: 1, metrics: {} }),
  }), /must declare a backend/);
});

test('supports cancellation and rejects unsupported model versions', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runPathExperiment({ spec: spec(), agentId: 'agent-1', signal: controller.signal }), { name: 'AbortError' });
  const unknown = spec();
  unknown.experiment!.model = { id: 'missing', version: '1' };
  await assert.rejects(runPathExperiment({ spec: unknown, agentId: 'agent-1' }), /unsupported path model/);
});

test('calibrates bounded photosensitization parameters against deterministic observations', async () => {
  const truth = spec({ k_exc: 0.6, k_q: 1.8 });
  truth.run = { maxSteps: 300, forceSampleEvery: 30 };
  const generated = await runPathExperiment({ spec: truth, agentId: 'synthetic' });
  const observations = {
    time: generated.experiment.outputs.time.value as number[],
    T1: generated.experiment.outputs.T1.value as number[],
    singletO2: generated.experiment.outputs.singletO2.value as number[],
  };
  const fitting = spec({ k_exc: 0.25, k_q: 0.8 });
  fitting.run = { maxSteps: 300, forceSampleEvery: 30 };
  fitting.experiment!.analysis = {
    calibration: {
      observations,
      fitParameters: {
        k_exc: { min: 0.2, max: 0.8, gridPoints: 13 },
        k_q: { min: 0.5, max: 2.5, gridPoints: 11 },
      },
      rounds: 3,
    },
  };
  const result = await runPathExperiment({ spec: fitting, agentId: 'calibrator' });
  const fittedExc = Number(result.experiment.outputs['fitted.k_exc'].value);
  const fittedQ = Number(result.experiment.outputs['fitted.k_q'].value);
  assert.ok(Math.abs(fittedExc - 0.6) < 0.08, `fitted k_exc=${fittedExc}`);
  assert.ok(Math.abs(fittedQ - 1.8) < 0.25, `fitted k_q=${fittedQ}`);
  assert.ok(Number(result.experiment.outputs['calibration.rmse'].value) < 0.003);
});

test('seeded ensemble is reproducible and produces ordered quantiles', async () => {
  const uqSpec = spec();
  uqSpec.experiment!.analysis = {
    uncertainty: {
      seed: 20260802,
      samples: 80,
      parameters: {
        k_exc: { kind: 'uniform', min: 0.25, max: 0.45 },
        k_q: { kind: 'normal', sigma: 0.15, min: 0 },
      },
    },
  };
  const a = await runPathExperiment({ spec: uqSpec, agentId: 'uq' });
  const b = await runPathExperiment({ spec: uqSpec, agentId: 'uq' });
  const read = (result: typeof a, key: string) => Number(result.experiment.outputs[key].value);
  for (const metric of ['finalT1', 'finalSingletO2']) {
    const keys = [`uq.${metric}.p10`, `uq.${metric}.p50`, `uq.${metric}.p90`];
    assert.deepEqual(keys.map((key) => read(a, key)), keys.map((key) => read(b, key)));
    assert.ok(read(a, keys[0]!) <= read(a, keys[1]!));
    assert.ok(read(a, keys[1]!) <= read(a, keys[2]!));
  }
  assert.equal(read(a, 'uq.seed'), 20260802);
  assert.equal(read(a, 'uq.samples'), 80);
});

test('claimed path-experiment is dispatched and completed without CFD model loading', async () => {
  let completed: JobResultV1 | undefined;
  const client = {
    heartbeat: async () => ({ job: {} }),
    complete: async (_jobId: string, result: JobResultV1) => {
      completed = result;
      return { jobId: 'job-path-1', status: 'succeeded', result };
    },
  } as unknown as TaskApiClient;
  const job = {
    id: 'job-path-1', attempt: 0, name: 'Ir ROS', status: 'leased', spec: spec(),
  } as unknown as JobRecord;
  await processJob(client, job, 'agent-path');
  assert.equal(completed?.experiment?.experimentId, 'ir-ultrasound-ros');
  assert.ok(Number(completed?.experiment?.outputs.finalSingletO2.value) > 0);
  assert.equal(completed?.backend.agentId, 'agent-path');
});
