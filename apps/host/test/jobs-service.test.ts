import { stationaryMassReport, fixtureUnits } from './lbm-result-fixture';
/**
 * Drives the Host task service used by /api/v1.
 * Uses an isolated temp DB — set TASK_DB_PATH first (singleton DB).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, isFluidJobSpec, type JobSpecV1, type JobResultV1, type LbmFanComponent } from '@w-sim/contracts';
import { validateJobResult, ResultValidationError } from '@/lib/tasks/validate-result.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');
const testDb = path.join(waveRoot, 'data', 'tasks-test-phase1.db');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  // Prefer TASK_LEASE_SECONDS for lease TTL tests.
  process.env.TASK_LEASE_SECONDS = '30';
  delete process.env.AGENT_WORKSPACE;
  for (const p of [testDb, testDb + '-wal', testDb + '-shm']) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ok */
    }
  }
});

// Sequential: claim/requeue tests share one SQLite DB and would race under concurrency.
describe('host task service (canonical jobs domain)', { concurrency: false }, () => {
  it('module steps, sampled statistics, trajectories and ideal nulls survive Host settlement', async () => {
    const { createJob, claimJob, completeJob, getJob } = await import('@/lib/tasks/service.ts');
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { createModuleJobSpec, computeModule, MODULE_JOB_KIND } = await import('../../../src/lib/sim/module-compute.ts');
    const { parseLammpsData } = await import('../../../src/lib/sim/lammps-data.ts');
    const { agent } = await registerAgent({ name: 'module-agent', capabilities: { kinds: [MODULE_JOB_KIND], backends: ['cpu'] } });
    for (const input of [
      { module: 'particles' as const, scene: parseLammpsData(fs.readFileSync(path.join(waveRoot, 'public/datasets/lammps-lj-2d.data'), 'utf8')) },
      { module: 'ripple' as const, scene: { damping: 0.997, steps: 3, seeds: [{ x: 90, y: 90, radius: 2, amount: 6 }] } },
      { module: 'convection' as const, scene: { buoyancy: 0.07, steps: 2, initialDrop: true, seeds: [{ x: 55, y: 65, hot: false }] } },
      { module: 'fluid' as const, scene: { viscosity: 0.00005, diffusion: 0.00001, rotation: 0.02, decay: 0.995, steps: 3, seeds: [{ x: 1, y: 1, radius: 2, density: 40, vx: 0.5, vy: -0.2 }], inlet: { speed: 0.3, density: 2, spacing: 10, width: 2 }, obstacle: Array.from({ length: 10000 }, (_, i) => [5030, 5031, 5130].includes(i) ? 1 : 0) } },
      { module: 'display' as const, scene: { mode: 'LED' as const, bandgap: 2 } },
      { module: 'display' as const, scene: { mode: 'OLED' as const, channels: [1, 0.6, 0.2] as [number, number, number] } },
      { module: 'display' as const, scene: { mode: 'LCD' as const, rotationDeg: 45 } },
      { module: 'particles' as const, scene: {
    species: [{ name: 'User alpha', count: 2, charge: 0.3, sigma: 0.6, epsilon: 1 }, { name: 'User beta', count: 1, charge: -0.6, sigma: 1.1, epsilon: 0.5 }],
    positions: [1, 1, 2.2, 1, 6, 6], dim: 2 as const, boxL: 10, temperature: 0.4, thermostat: false,
    epsR: 12, lambdaD: 3, kCoulomb: 1, seed: 11, steps: 5,
  } },
      { module: 'ising' as const, scene: { size: 16, temperatures: [2], seed: 7, hot: false, burnIn: 0, samples: 1 } },
      { module: 'ising' as const, scene: { size: 16, temperatures: [0.8, 3.6], seed: 7, hot: true, burnIn: 1, samples: 2 } },
      { module: 'vibration' as const, scene: { mass: 1, stiffness: 100, damping: 1, driveFrequency: 1.5, steps: 5 } },
      { module: 'ecg' as const, scene: { recording: { name: 'sample', sampleRate: 360, unit: 'mV', channels: [{ name: 'MLII', values: [-0.145, -0.14, 0, 1] }] }, channel: 0 } },
      { module: 'neuron' as const, scene: { current: 0.5, steps: 8, pulses: [0] } },
      { module: 'laser' as const, pump: 1200, steps: 4 },
      { module: 'mutual' as const, scene: { k: 0.99, n: 0.3, mode: 'step' as const, steps: 4 } },
      { module: 'smith' as const, scene: { resistance: 0, reactance: 0, thetaDeg: 90 } },
      { module: 'localization' as const, scene: { target: { x: 60, y: 60 }, noise: 25, seed: 7, bandwidth: 30 } },
      { module: 'stm' as const, scene: { mode: 'current' as const, tipHeight: 0.28, setCurrent: 0.02 } },
      { module: 'radar' as const, scene: { mode: 'cw' as const, steps: 3, probes: [{ x: 24, y: 100 }, null, null, null] } },
      { module: 'antenna3d' as const, params: { frequencyHz: 2.4e9, ptDbm: 20, distM: 8, elevationDeg: 90, polarizationDeg: 90 } },
    ]) {
      const spec = createModuleJobSpec(input), job = createJob({ spec });
      assert.equal(claimJob({ agentId: agent.id, capabilities: agent.capabilities })?.id, job.id);
      const result = { schemaVersion: 1 as const, summary: { steps: spec.run.maxSteps, wallTimeMs: 1 }, backend: { id: 'cpu', agentId: agent.id }, moduleResult: await computeModule(input) };
      assert.equal(completeJob({ jobId: job.id, agentId: agent.id, result })?.status, 'succeeded');
      assert.deepEqual(getJob(job.id)?.result, result);
    }
  });
  it('completeJob renews the lease inside artifact validation and aborts when ownership is gone', async () => {
    // Validation loops renew the lease mid-walk (heavy trajectories otherwise
    // outlive the lease and livelock requeues). The clock stub opens the renew
    // throttle and cancels the job, so the renewal heartbeat must run inside
    // the loop — and its rejection must abort validation before settlement.
    const { createJob, claimJob, completeJob, getJob, cancelJob } = await import('@/lib/tasks/service.ts');
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { saveArtifact } = await import('@/lib/tasks/artifacts.ts');
    const { createModuleJobSpec, computeModule, MODULE_JOB_KIND } = await import('../../../src/lib/sim/module-compute.ts');
    const { agent } = await registerAgent({ name: 'module-lease-renew', capabilities: { kinds: [MODULE_JOB_KIND], backends: ['cpu'] } });
    const input = { module: 'ising' as const, scene: { size: 16, temperatures: [2], seed: 7, hot: false, burnIn: 0, samples: 1 } };
    const spec = createModuleJobSpec(input);
    const job = createJob({ spec, createdBy: 'alice' });
    assert.ok(claimJob({ jobId: job.id, agentId: agent.id, capabilities: agent.capabilities }));
    const refs = [0, 1].map((i) => {
      const saved = saveArtifact({
        jobId: job.id, ownerUserId: 'alice', kind: 'module-output',
        contentType: 'application/octet-stream', data: Buffer.from(`blob-${i}`),
      });
      return { artifactId: saved.id, kind: saved.kind, bytes: saved.bytes, contentType: saved.contentType };
    });
    const result = {
      schemaVersion: 1 as const,
      summary: { steps: spec.run.maxSteps, wallTimeMs: 1 },
      backend: { id: 'cpu', agentId: agent.id },
      moduleResult: await computeModule(input),
      artifacts: refs,
    };
    const realNow = Date.now;
    let calls = 0;
    Date.now = () => {
      calls += 1;
      if (calls === 1) return realNow(); // lastValidationRenew seed
      cancelJob(job.id); // ownership gone before the first renewal heartbeat
      return realNow() + 60_000; // open the renew throttle
    };
    try {
      assert.throws(
        () => completeJob({ jobId: job.id, agentId: agent.id, result }),
        /cancelled/,
      );
    } finally {
      Date.now = realNow;
    }
    assert.equal(getJob(job.id)?.status, 'cancelled');
  });
  it('FDTD settles its actual step count and field through the Host job service', async () => {
    const { createJob, claimJob, completeJob, getJob } = await import('@/lib/tasks/service.ts');
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { createModuleJobSpec, computeModule, MODULE_JOB_KIND } = await import('../../../src/lib/sim/module-compute.ts');
    const input = { module: 'fdtd' as const, scene: { preset: 'doubleslit' as const, boundary: 'mur' as const, shape: 'line' as const, time: 'cw' as const, omega: 0.3, steps: 2, sources: [{ i: 30, j: 100 }] } };
    const { agent } = await registerAgent({ name: 'fdtd-agent', capabilities: { kinds: [MODULE_JOB_KIND], backends: ['cpu'] } });
    const job = createJob({ spec: createModuleJobSpec(input) });
    assert.equal(claimJob({ agentId: agent.id, capabilities: agent.capabilities })?.id, job.id);
    const result = { schemaVersion: 1 as const, summary: { steps: 2, wallTimeMs: 1 }, backend: { id: 'cpu', agentId: agent.id }, moduleResult: await computeModule(input) };
    assert.throws(() => completeJob({ jobId: job.id, agentId: agent.id, result: { ...result, summary: { ...result.summary, steps: 1 } } }), /steps/);
    assert.equal(completeJob({ jobId: job.id, agentId: agent.id, result })?.status, 'succeeded');
    assert.deepEqual(getJob(job.id)?.result, result);
  });
  it('sw-* native modules queue, route to cuda agents and settle native envelopes', async () => {
    const { createJob, claimJob, completeJob, getJob } = await import('@/lib/tasks/service.ts');
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { createModuleJobSpec, MODULE_JOB_KIND } = await import('../../../src/lib/sim/module-compute.ts');
    const input = { module: 'sw-fds-solid-obstruction' as const, backend: 'cuda' as const, method: 'voxelize', params: { grid: [4, 4, 3] } };
    const { agent: cpuAgent } = await registerAgent({ name: 'sw-cpu-agent', capabilities: { kinds: [MODULE_JOB_KIND], backends: ['cpu'] } });
    const { agent: cudaAgent } = await registerAgent({ name: 'sw-cuda-agent', capabilities: { kinds: [MODULE_JOB_KIND], backends: ['cpu', 'cuda'] } });
    const job = createJob({ spec: createModuleJobSpec(input) });
    assert.equal(claimJob({ agentId: cpuAgent.id, capabilities: cpuAgent.capabilities }), null);
    assert.equal(claimJob({ agentId: cudaAgent.id, capabilities: cudaAgent.capabilities })?.id, job.id);
    const result = {
      schemaVersion: 1 as const,
      moduleResult: { ok: true, id: 'sw-fds-solid-obstruction', result: { blocked: 16, gas: 32 }, backend: { id: 'native-cuda-sw-fds-solid-obstruction', deviceName: 'NVIDIA GeForce RTX 5090' }, meta: {} },
      summary: { steps: 1, wallTimeMs: 12 },
      backend: { id: 'w-sim-cuda', deviceName: 'NVIDIA GeForce RTX 5090', agentId: cudaAgent.id },
      derived: { precision: 'float64', engine: 'rust' },
      artifacts: [],
    };
    assert.equal(completeJob({ jobId: job.id, agentId: cudaAgent.id, result })?.status, 'succeeded');
    assert.deepEqual(getJob(job.id)?.result, result);
  });
  it('managed-compute misconfiguration degrades to unreserved queueing instead of 500ing create', async () => {
    const { createJob, getJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const saved = { enabled: process.env.W_COMPUTE_ENABLED, url: process.env.W_COMPUTE_API_URL };
    process.env.W_COMPUTE_ENABLED = '1';
    delete process.env.W_COMPUTE_API_URL;
    try {
      // mac-3d is native-capable and cpu-eligible → the reservation path runs
      // getComputeConfig, which throws on the missing W_COMPUTE_API_URL. The job
      // must still queue (unreserved) rather than fail creation.
      const job = createJob({ spec: defaultJobSpec({ kind: 'mac-3d' }) });
      assert.equal(getJob(job.id)?.status, 'queued');
    } finally {
      if (saved.enabled === undefined) delete process.env.W_COMPUTE_ENABLED;
      else process.env.W_COMPUTE_ENABLED = saved.enabled;
      if (saved.url === undefined) delete process.env.W_COMPUTE_API_URL;
      else process.env.W_COMPUTE_API_URL = saved.url;
    }
  });
  it('module results reject artifact references not owned by the settling job', async () => {
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { saveArtifact } = await import('@/lib/tasks/artifacts.ts');
    const { createModuleJobSpec, computeModule, MODULE_JOB_KIND } = await import('../../../src/lib/sim/module-compute.ts');
    const input = { module: 'laser' as const, pump: 1200, steps: 4 };
    const { agent } = await registerAgent({ name: 'mod-artifact-agent', capabilities: { kinds: [MODULE_JOB_KIND], backends: ['cpu'] } });
    const spec = createModuleJobSpec(input);
    const job = createJob({ spec, createdBy: 'mod-owner' });
    assert.equal(claimJob({ agentId: agent.id, capabilities: agent.capabilities })?.id, job.id);
    // Artifact saved under a different jobId must not be attachable to this job's result.
    const foreign = saveArtifact({ jobId: 'some-other-job', ownerUserId: 'mod-owner', kind: 'blob', contentType: 'application/octet-stream', data: new Uint8Array([1, 2, 3]) });
    const result = {
      schemaVersion: 1 as const,
      summary: { steps: spec.run.maxSteps, wallTimeMs: 1 },
      backend: { id: 'cpu', agentId: agent.id },
      moduleResult: await computeModule(input),
      artifacts: [{ artifactId: foreign.id, kind: 'blob', contentType: 'application/octet-stream', bytes: 3 }],
    };
    assert.throws(() => completeJob({ jobId: job.id, agentId: agent.id, result }), /belong to this job/);
  });
  it('sw specs without a cuda-capable backend request fail at intake', async () => {
    const { validateJobSpec } = await import('@/lib/tasks/validate-spec.ts');
    const { createModuleJobSpec } = await import('../../../src/lib/sim/module-compute.ts');
    const input = { module: 'sw-gromacs-spc' as const, backend: 'cuda' as const, molecules: [{ o: [0, 0, 0], orientDeg: [0, 0, 0] }] };
    const spec = JSON.parse(JSON.stringify(createModuleJobSpec(input)));
    assert.doesNotThrow(() => validateJobSpec(spec));
    for (const backends of [['cpu'], ['cuda', 'cpu'], ['native-cuda'], []]) {
      const altered = structuredClone(spec); altered.requirements.backends = backends;
      assert.throws(() => validateJobSpec(altered), /native w-sim-cuda backend/);
    }
    const noBackend = structuredClone(spec); delete noBackend.model.inline.backend;
    assert.throws(() => validateJobSpec(noBackend), /backend/);
  });
  it('intake rejects unknown backend ids and claims native-cuda specs via the cuda umbrella', async () => {
    const { createJob, claimJob, agentMatchesJob } = await import('@/lib/tasks/service.ts');
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { validateJobSpec } = await import('@/lib/tasks/validate-spec.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const spec = defaultJobSpec();
    // Unknown backend ids can never be claimed — reject at intake, not zombie rows.
    for (const backends of [['quantum'], ['cuda', 'warp-drive'], [42], 'cuda']) {
      const bad = structuredClone(spec);
      (bad.requirements as { backends: unknown }).backends = backends;
      assert.throws(() => validateJobSpec(bad), /backend/);
    }
    for (const backends of [['cpu'], ['cuda'], ['native-cuda'], ['webgpu-dawn'], ['cpu-teaching'], ['cpu', 'cuda', 'native-cuda']]) {
      const ok = structuredClone(spec);
      (ok.requirements as { backends: unknown }).backends = backends;
      assert.doesNotThrow(() => validateJobSpec(ok));
    }
    // 'native-cuda' requirement ⇄ 'cuda' capability: the same physical backend.
    const features = [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE];
    const nativeSpec = structuredClone(spec);
    (nativeSpec.requirements as { backends: unknown }).backends = ['native-cuda'];
    assert.equal(agentMatchesJob({ backends: ['cuda'], features }, nativeSpec), true);
    assert.equal(agentMatchesJob({ backends: ['cpu'], features }, nativeSpec), false);
    const cudaSpec = structuredClone(spec);
    (cudaSpec.requirements as { backends: unknown }).backends = ['cuda'];
    assert.equal(agentMatchesJob({ backends: ['native-cuda'], features }, cudaSpec), true);
    // End-to-end: a ['native-cuda'] spec is claimable by a cuda-capable agent.
    const { agent } = await registerAgent({ name: 'native-cuda-agent', capabilities: { kinds: ['lbm-d3q19'], backends: ['cuda'], features } });
    const job = createJob({ spec: nativeSpec });
    assert.equal(claimJob({ agentId: agent.id, capabilities: agent.capabilities })?.id, job.id);
  });
  it('LBM fan configuration validates before queuing and changes the job fingerprint', async () => {
    const { validateJobSpec } = await import('@/lib/tasks/validate-spec.ts');
    const { fingerprintJobSpec } = await import('@/lib/tasks/job-fingerprint.ts');
    const { agentMatchesJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const fan: LbmFanComponent = { center: [0.15, 0.5, 0.5], axis: 'x', radiusM: 0.06, pressureRisePa: 20 };
    const spec = defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, parameters: { gridPreset: 'fast', inletVelocity: 0, fan } });
    assert.ok(isFluidJobSpec(spec));
    assert.doesNotThrow(() => validateJobSpec(spec));
    const capability = { features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE], backends: ['webgpu-dawn' as const] };
    assert.equal(agentMatchesJob(capability, spec), false);
    assert.equal(agentMatchesJob({ ...capability, fan: false }, spec), false);
    assert.equal(agentMatchesJob({ ...capability, fan: true }, spec), true);
    assert.equal(agentMatchesJob(capability, defaultJobSpec()), true);
    const changed = { ...spec, parameters: { ...spec.parameters, fan: { ...fan, pressureRisePa: 30 } } };
    assert.notEqual(fingerprintJobSpec(spec), fingerprintJobSpec(changed));
    for (const invalid of [null, {}, { ...fan, center: [0, 2, 0] }, { ...fan, axis: 'w' }, { ...fan, radiusM: 0 }, { ...fan, pressureRisePa: Infinity }]) {
      const invalidSpec = { ...spec, parameters: { ...spec.parameters, fan: invalid } } as unknown as JobSpecV1;
      assert.throws(() => validateJobSpec(invalidSpec), /fan/);
    }
  });
  it('ground jobs require capable agents and matching saved ground diagnostics', async () => {
    const { createJob, claimJob, completeJob, getJob, agentMatchesJob } = await import('@/lib/tasks/service.ts');
    const { fingerprintJobSpec } = await import('@/lib/tasks/job-fingerprint.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const { validateJobSpec } = await import('@/lib/tasks/validate-spec.ts');
    const agentId = 'agent-ground-contract';
    const legacy = { kinds: ['lbm-d3q19' as const], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE], backends: ['cpu' as const] };
    const capabilities = { ...legacy, features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, 'lbm-ground-v1'] };
    for (const mode of ['stationary', 'moving'] as const) {
      const spec = defaultJobSpec({ model: { source: 'preset', referenceLength: 0.1 }, parameters: { gridPreset: 'fast', inletVelocity: 0.1, ground: { mode, clearanceM: 0.02 } },
        run: { maxSteps: 1, warmupSteps: 0 }, requirements: { backends: ['cpu'] } });
      assert.ok(isFluidJobSpec(spec));
      assert.doesNotThrow(() => validateJobSpec(spec));
      assert.equal(agentMatchesJob(legacy, spec), false);
      assert.equal(agentMatchesJob(capabilities, spec), true);
      assert.notEqual(fingerprintJobSpec(spec), fingerprintJobSpec({ ...spec, parameters: { ...spec.parameters, ground: { mode, clearanceM: 0.03 } } }));
      for (const ground of [null, {}, { mode: 'slip', clearanceM: 0 }, { mode, clearanceM: -1 }, { mode, clearanceM: '0.02' }]) {
        assert.throws(() => validateJobSpec({ ...spec, parameters: { ...spec.parameters, ground } } as unknown as JobSpecV1), /ground/);
      }
      const job = createJob({ spec });
      assert.equal(claimJob({ jobId: job.id, agentId, capabilities: legacy }), null);
      assert.equal(claimJob({ jobId: job.id, agentId, capabilities })?.id, job.id);
      const derived: NonNullable<JobResultV1['derived']> = { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...fixtureUnits(job.spec), viscosityMode: 'physical', requestedViscosityM2s: 1.48e-5, simulatedViscosityM2s: 1.48e-5,
        'lbm-ground-v1': 1, groundMode: mode, groundClearanceM: 0.02, groundVelocityMps: mode === 'moving' ? 0.1 : 0 };
      const result: JobResultV1 = { schemaVersion: 1, backend: { id: 'cpu' }, summary: { steps: 1, wallTimeMs: 1, cd: 0, cl: 0, dragN: 0, liftN: 0 },
        history: { step: [1], cd: [0], cl: [0], dragN: [0], liftN: [0] }, lbmMassBalance: stationaryMassReport(), derived };
      for (const change of [{ 'lbm-ground-v1': undefined }, { groundMode: undefined }, { groundMode: mode === 'moving' ? 'stationary' : 'moving' },
        { groundClearanceM: undefined }, { groundClearanceM: '0.02' }, { groundClearanceM: 0.03 }, { groundVelocityMps: undefined }, { groundVelocityMps: 1 }]) {
        assert.throws(() => completeJob({ jobId: job.id, agentId, result: { ...result, derived: { ...derived, ...change } as JobResultV1['derived'] } }), /ground|features/);
        assert.equal(getJob(job.id)?.status, 'leased');
      }
      assert.equal(completeJob({ jobId: job.id, agentId, result })?.status, 'succeeded');
      assert.deepEqual(getJob(job.id)?.result?.derived, derived);
    }
  });

  it('model dimensions validate before queuing and explicit reference area survives settlement', async () => {
    const { lbmSpec, lbmGeometry } = await import('../../../scripts/ci/lbm-fixture.ts');
    const { runLbmWasm, prepareLbmInput } = await import('../../../src/lib/sim/lbm-compute.ts');
    const { createJob, claimJob, completeJob, getJob } = await import('@/lib/tasks/service.ts');
    const { validateJobSpec } = await import('@/lib/tasks/validate-spec.ts');
    const spec = lbmSpec(); spec.outputs.fields = []; spec.model!.referenceArea = 0.0025;
    const prepared = prepareLbmInput(spec, lbmGeometry);
    for (const key of ['referenceLength', 'referenceArea']) {
      for (const value of [0, -1, null, '0.1', Infinity]) {
        assert.throws(() => validateJobSpec({ ...spec, model: { ...spec.model, [key]: value } } as unknown as JobSpecV1), /finite and positive/);
      }
    }
    const job = createJob({ spec }), agentId = 'model-units-agent';
    assert.equal(claimJob({ jobId: job.id, agentId, capabilities: { kinds: ['lbm-d3q19'], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE], backends: ['cpu'] } })?.id, job.id);
    const { result } = await runLbmWasm(spec, prepared);
    for (const referenceArea of [undefined, spec.model!.referenceArea! * 2]) {
      assert.throws(() => completeJob({ jobId: job.id, agentId, result: { ...result, derived: { ...result.derived, referenceArea } } }), /reference area/);
    }
    assert.equal(completeJob({ jobId: job.id, agentId, result })?.status, 'succeeded');
    assert.equal(getJob(job.id)?.result?.derived?.referenceArea, spec.model!.referenceArea);
  });

  it('product LBM preserves physical and preview viscosity diagnostics and rejects incompatible results before settlement', async () => {
    const { createJob, claimJob, completeJob, getJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const agentId = 'agent-viscosity-contract';
    const capabilities = { kinds: ['lbm-d3q19' as const], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE], backends: ['cpu' as const] };
    for (const mode of [undefined, 'physical', 'stabilized-preview'] as const) {
      const job = createJob({ spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 },
        parameters: { gridPreset: 'fast', inletVelocity: 0.1, fluidDensity: 2, fluidViscosity: 0.002,
          ...(mode ? { viscosityMode: mode } : {}) },
        run: { maxSteps: 1, forceSampleEvery: 1, warmupSteps: 0 },
        requirements: { backends: ['cpu'] },
      }) });
      assert.equal(claimJob({ jobId: job.id, agentId, capabilities })?.id, job.id);
      const requested = 0.001;
      const derived = { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...fixtureUnits(job.spec), viscosityMode: mode ?? 'physical', requestedViscosityM2s: requested,
        simulatedViscosityM2s: mode === 'stabilized-preview' ? 0.002 : requested };
      const result: JobResultV1 = { schemaVersion: 1, backend: { id: 'cpu', agentId },
        summary: { steps: 1, wallTimeMs: 1, cd: 0.4, cl: -0.1, dragN: 1, liftN: -0.25 },
        history: { step: [1], cd: [0.4], cl: [-0.1], dragN: [1], liftN: [-0.25] }, lbmMassBalance: stationaryMassReport(), derived };
      const invalidDerived: unknown[] = [
        { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...fixtureUnits(job.spec) },
        { ...derived, viscosityMode: derived.viscosityMode === 'physical' ? 'stabilized-preview' : 'physical' },
        { ...derived, viscosityMode: 'unknown' },
        { ...derived, requestedViscosityM2s: requested * 2 },
        { ...derived, simulatedViscosityM2s: requested / 2 },
      ];
      for (const key of ['requestedViscosityM2s', 'simulatedViscosityM2s'] as const) {
        for (const value of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, String(derived[key])]) {
          invalidDerived.push({ ...derived, [key]: value });
        }
      }
      if (mode !== 'stabilized-preview') invalidDerived.push({ ...derived, simulatedViscosityM2s: requested * 2 });
      for (const invalid of invalidDerived) {
        assert.throws(() => completeJob({ jobId: job.id, agentId, result: { ...result, derived: invalid } as JobResultV1 }), /viscosity/);
        assert.equal(getJob(job.id)?.status, 'leased');
        assert.equal(getJob(job.id)?.result, null);
      }
      for (const key of ['cd', 'cl'] as const) {
        assert.throws(() => completeJob({ jobId: job.id, agentId, result: { ...result, summary: { ...result.summary, [key]: undefined } } }), /coefficients/);
        assert.equal(getJob(job.id)?.status, 'leased');
      }
      assert.equal(completeJob({ jobId: job.id, agentId, result })?.status, 'succeeded');
      assert.deepEqual(getJob(job.id)?.result?.derived, derived);
      assert.deepEqual(getJob(job.id)?.result?.summary, result.summary);
      assert.equal(completeJob({ jobId: job.id, agentId, result })?.status, 'succeeded');
    }
  });

  it('product LBM reports default air viscosity when dynamic viscosity is omitted', async () => {
    const { createJob, claimJob, completeJob, getJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const agentId = 'agent-default-viscosity';
    const job = createJob({ spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, parameters: { gridPreset: 'fast', inletVelocity: 0.001 },
      run: { maxSteps: 1, forceSampleEvery: 1, warmupSteps: 0 }, requirements: { backends: ['cpu'] } }) });
    assert.equal(claimJob({ jobId: job.id, agentId, capabilities: { kinds: ['lbm-d3q19'], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE], backends: ['cpu'] } })?.id, job.id);
    const result: JobResultV1 = { schemaVersion: 1, backend: { id: 'cpu', agentId },
      summary: { steps: 1, wallTimeMs: 1, cd: 0, cl: 0, dragN: 0, liftN: 0 },
      history: { step: [1], cd: [0], cl: [0], dragN: [0], liftN: [0] },
      lbmMassBalance: stationaryMassReport(), derived: { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...fixtureUnits(job.spec), viscosityMode: 'physical', requestedViscosityM2s: 1.48e-5, simulatedViscosityM2s: 1.48e-5 } };
    assert.equal(completeJob({ jobId: job.id, agentId, result })?.status, 'succeeded');
    assert.deepEqual(getJob(job.id)?.result, result);
  });

  it('zero-inlet product LBM saves Newton forces and rejects invented zero coefficients in summary or history', async () => {
    const { createJob, claimJob, completeJob, getJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const agentId = 'agent-zero-inlet-force';
    for (const viscosityMode of ['physical', 'stabilized-preview'] as const) {
      const job = createJob({ spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, parameters: {
        gridPreset: 'fast', inletVelocity: 0, viscosityMode, fluidDensity: 2, fluidViscosity: 0.002,
      }, run: { maxSteps: 1, forceSampleEvery: 1, warmupSteps: 0 }, requirements: { backends: ['cpu'] } }) });
      assert.equal(claimJob({ jobId: job.id, agentId, capabilities: { kinds: ['lbm-d3q19'], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE], backends: ['cpu'] } })?.id, job.id);
      const result: JobResultV1 = { schemaVersion: 1, backend: { id: 'cpu', agentId },
        summary: { steps: 1, wallTimeMs: 1, dragN: 0.5, liftN: -0.25, sideN: 0.125 },
        history: { step: [1], dragN: [0.5], liftN: [-0.25], sideN: [0.125] },
        lbmMassBalance: stationaryMassReport(), derived: { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...fixtureUnits(job.spec), viscosityMode, requestedViscosityM2s: 0.001, simulatedViscosityM2s: 0.001 } };
      for (const key of ['cd', 'cl'] as const) {
        for (const invalid of [
          { ...result, summary: { ...result.summary, [key]: 0 } },
          { ...result, history: { ...result.history!, [key]: [0] } },
        ]) {
          assert.throws(() => completeJob({ jobId: job.id, agentId, result: invalid }), /zero inlet reference velocity/);
          assert.equal(getJob(job.id)?.status, 'leased');
          assert.equal(getJob(job.id)?.result, null);
        }
      }
      assert.equal(completeJob({ jobId: job.id, agentId, result })?.status, 'succeeded');
      const saved = getJob(job.id)?.result;
      assert.deepEqual(saved, result);
      assert.equal(saved?.summary.cd, undefined);
      assert.equal(saved?.summary.cl, undefined);
      assert.equal(saved?.history?.cd, undefined);
      assert.equal(saved?.history?.cl, undefined);
      assert.equal(saved?.summary.dragN, 0.5);
      assert.deepEqual(saved?.history?.liftN, [-0.25]);
    }
  });

  it('module snapshots settle intact and changed inline inputs/results have distinct fingerprints', async () => {
    const { createJob, claimJob, completeJob, getJob } = await import('@/lib/tasks/service.ts');
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { validateJobSpec } = await import('@/lib/tasks/validate-spec.ts');
    const { fingerprintJobSpec, fingerprintJobResult } = await import('@/lib/tasks/job-fingerprint.ts');
    const { MODULE_JOB_KIND, createModuleJobSpec, computeModule, readModuleResult } = await import('../../../src/lib/sim/module-compute.ts');
    const { opticsPreset } = await import('../../../src/lib/lab/optics-lab.ts');
    const input = { module: 'optics-lab' as const, components: opticsPreset('mirror-bounce') };
    const spec = createModuleJobSpec(input);
    validateJobSpec(spec);
    const changed = createModuleJobSpec({ ...input, components: input.components.map(c => ({ ...c, x: c.x + 1 })) });
    assert.notEqual(fingerprintJobSpec(spec), fingerprintJobSpec(changed));
    const { agent } = await registerAgent({ name: 'module-agent', capabilities: { kinds: [MODULE_JOB_KIND], backends: ['cpu'] } });
    const job = createJob({ spec });
    assert.equal(claimJob({ agentId: agent.id, capabilities: agent.capabilities })?.id, job.id);
    const result = { schemaVersion: 1 as const, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu', agentId: agent.id }, moduleResult: await computeModule(input) };
    const missingModuleResult = { ...result, moduleResult: undefined };
    assert.throws(() => completeJob({ jobId: job.id, agentId: agent.id, result: missingModuleResult }), /module value must be an object/);
    assert.equal(completeJob({ jobId: job.id, agentId: agent.id, result })?.status, 'succeeded');
    const stored = getJob(job.id)?.result;
    assert.ok(stored);
    assert.deepEqual(readModuleResult(stored, input), result.moduleResult);
    const other = { ...result, moduleResult: await computeModule({ ...input, components: [] }) };
    assert.notEqual(fingerprintJobResult(result), fingerprintJobResult(other));
    assert.throws(() => completeJob({ jobId: job.id, agentId: agent.id, result: other }), /settlement|already|different/i);
  });
  it('LBM without a product grid still settles without product viscosity diagnostics', async () => {
    const { createJob, claimJob, completeJob, getJob } = await import(
      '@/lib/tasks/service.ts'
    );
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');

    const { agent, token } = await registerAgent({
      name: 'phase1-test-agent',
      capabilities: {
        backends: ['webgpu', 'webgpu-dawn'],
        maxGrid: 'fine',
        thermal: true,
        kinds: ['lbm-d3q19'], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE],
      },
    });
    assert.ok(token.length > 10);
    assert.ok(agent.id);

    const job = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 },
        name: 'phase1-unit-demo',
        parameters: { gridPreset: undefined, inletVelocity: 0.001 },
        run: { maxSteps: 10, forceSampleEvery: 5, warmupSteps: 0 },
      }),
    });
    assert.equal(job.status, 'queued');
    assert.ok(isFluidJobSpec(job.spec));
    assert.equal(job.spec.parameters.gridPreset, undefined);

    const claimed = claimJob({
      agentId: agent.id,
      capabilities: agent.capabilities,
    });
    assert.ok(claimed);
    assert.equal(claimed!.id, job.id);
    assert.equal(claimed!.status, 'leased');
    assert.ok(claimed!.leaseExpiresAt);

    const done = completeJob({
      jobId: job.id,
      agentId: agent.id,
      result: {
        schemaVersion: 1,
        summary: { steps: 10, cd: 1.2, cl: 0, dragN: 1, liftN: 0, wallTimeMs: 1 },
        history: { step: [5, 10], cd: [1.2, 1.2], cl: [0, 0], dragN: [1, 1], liftN: [0, 0] },
        backend: { id: 'cpu', agentId: agent.id },
        lbmMassBalance: stationaryMassReport(), derived: { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...fixtureUnits(job.spec) },
      },
    });
    assert.ok(done);
    assert.equal(done!.status, 'succeeded');

    const fetched = getJob(job.id);
    assert.equal(fetched?.status, 'succeeded');
    assert.equal(fetched?.result?.summary.steps, 10);
    assert.deepEqual(fetched?.result?.derived, { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...fixtureUnits(job.spec) });
  });

  it('complete is settlement-idempotent: same result ok, different result 409', async () => {
    const { createJob, claimJob, completeJob, getJob } = await import(
      '@/lib/tasks/service.ts'
    );
    const { HttpError } = await import('@/lib/tasks/http.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const { settlementKeyForResult } = await import('@/lib/tasks/job-fingerprint.ts');
    const { applySettlement } = await import('@/types/task.ts');

    const agentId = 'agent-settle-idem';
    const job = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 },
        name: 'settle-idempotent',
        parameters: { inletVelocity: 0.001 },
        run: { maxSteps: 8, forceSampleEvery: 4, warmupSteps: 0 },
      }),
    });
    const caps = {
      backends: ['webgpu' as const],
      kinds: ['lbm-d3q19' as const], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE],
    };
    const claimed = claimJob({ agentId, capabilities: caps });
    assert.ok(claimed);
    assert.equal(claimed!.id, job.id);

    const result = {
      schemaVersion: 1 as const,
      summary: { steps: 8, cd: 1.05, cl: 0.01, dragN: 1, liftN: 0, wallTimeMs: 42 },
      history: { step: [4, 8], cd: [1.05, 1.05], cl: [0.01, 0.01], dragN: [1, 1], liftN: [0, 0] },
      lbmMassBalance: stationaryMassReport(), derived: { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...fixtureUnits(job.spec), viscosityMode: 'physical' as const, requestedViscosityM2s: 1.48e-5, simulatedViscosityM2s: 1.48e-5 },
      backend: { id: 'webgpu', agentId },
    };

    // 1) First complete succeeds and settles
    const first = completeJob({ jobId: job.id, agentId, result });
    assert.ok(first);
    assert.equal(first!.status, 'succeeded');
    assert.equal(first!.result?.summary.cd, 1.05);
    const finishedAt = first!.finishedAt;
    assert.ok(finishedAt);

    // Mirror contracts: same settlement key is duplicate-ok
    const key = settlementKeyForResult(job.id, first!.result!);
    const retrySettle = applySettlement(
      {
        jobId: job.id,
        executionStatus: 'succeeded',
        settlement: 'settled',
        settlementKey: key,
      },
      { key, executionStatus: 'succeeded' },
    );
    assert.equal(retrySettle.ok, true);
    if (retrySettle.ok) assert.equal(retrySettle.duplicate, true);

    // 2) Second complete with same result is idempotent no-op (returns succeeded)
    const second = completeJob({ jobId: job.id, agentId, result });
    assert.ok(second);
    assert.equal(second!.status, 'succeeded');
    assert.equal(second!.result?.summary.cd, 1.05);
    assert.equal(second!.result?.summary.steps, 8);
    // Stored row not rewritten as a new finish event
    assert.equal(second!.finishedAt, finishedAt);
    assert.equal(getJob(job.id)?.status, 'succeeded');

    // 3) Different result after success is rejected (double_settlement)
    let thrown: unknown;
    try {
      completeJob({
        jobId: job.id,
        agentId,
        result: {
          ...result,
          summary: { ...result.summary, cd: 9.99 },
        },
      });
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof HttpError);
    assert.equal((thrown as InstanceType<typeof HttpError>).status, 409);
    assert.match((thrown as Error).message, /settled|settlement|different/i);

    // Original result remains authoritative
    const after = getJob(job.id);
    assert.equal(after?.status, 'succeeded');
    assert.equal(after?.result?.summary.cd, 1.05);
  });

  it('accepts generic solver history and rejects malformed thermal series', async () => {
    const { validateJobResult } = await import('@/lib/tasks/validate-result.ts');
    const result = {
      schemaVersion: 1,
      summary: { steps: 3, wallTimeMs: 1 },
      backend: { id: 'cpu-thermal' },
      history: { step: [0, 1, 2], tjC: [25, 27, 29] },
    };
    assert.doesNotThrow(() => validateJobResult(result));
    assert.throws(() => validateJobResult({ ...result, history: { step: [0, 1], tjC: [25] } }), /matching step length/);
    assert.throws(() => validateJobResult({ ...result, history: { step: [0], tjC: [NaN] } }), /history.tjC/);
  });

  it('rejects a result envelope that carries an error message', async () => {
    const { validateJobResult } = await import('@/lib/tasks/validate-result.ts');
    const result = {
      schemaVersion: 1,
      summary: { steps: 3, wallTimeMs: 1 },
      backend: { id: 'cpu-thermal' },
    };
    // A failure-flagged envelope must not settle as succeeded even when the
    // summary is otherwise well-formed (readModuleResult parity).
    assert.throws(
      () => validateJobResult({ ...result, error: 'solver diverged' }),
      /error message/,
    );
    // Absent or empty error is not a failure declaration.
    assert.doesNotThrow(() => validateJobResult(result));
    assert.doesNotThrow(() => validateJobResult({ ...result, error: '' }));
  });

  it('rejects a stale complete on a failed job before running validation', async () => {
    const { createJob, claimJob, completeJob, failJob, getJob } = await import(
      '@/lib/tasks/service.ts'
    );
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { createModuleJobSpec, MODULE_JOB_KIND } = await import(
      '../../../src/lib/sim/module-compute.ts'
    );
    const { agent } = await registerAgent({
      name: 'stale-agent',
      capabilities: { kinds: [MODULE_JOB_KIND], backends: ['cpu'] },
    });
    const job = createJob({
      spec: createModuleJobSpec({ module: 'display', scene: { mode: 'LED', bandgap: 2 } }),
    });
    assert.equal(claimJob({ agentId: agent.id, capabilities: agent.capabilities })?.id, job.id);
    // Terminal failure retains agentId (provenance). The stale agent's late
    // complete must return null before any validation/decode work — a
    // malformed payload would throw ResultValidationError if it ran.
    failJob({ jobId: job.id, agentId: agent.id, error: 'solver blew up', retryable: false });
    assert.equal(getJob(job.id)?.status, 'failed');
    assert.equal(
      completeJob({ jobId: job.id, agentId: agent.id, result: { schemaVersion: 0 } as never }),
      null,
    );
    assert.equal(getJob(job.id)?.status, 'failed');
  });

  it('complete rejects non-finite Cd/Cl (NaN) and keeps job non-succeeded', async () => {
    const { createJob, claimJob, completeJob, getJob } = await import(
      '@/lib/tasks/service.ts'
    );
    const { HttpError } = await import('@/lib/tasks/http.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');

    // Unit: pure schema check
    assert.throws(
      () =>
        validateJobResult({
          schemaVersion: 1,
          summary: { steps: 5, cd: Number.NaN, cl: 0.1, wallTimeMs: 10 },
          backend: { id: 'test', agentId: 'a1' },
        }),
      ResultValidationError
    );
    assert.throws(
      () =>
        validateJobResult({
          schemaVersion: 1,
          summary: { steps: 5, cd: 1.0, cl: Number.POSITIVE_INFINITY, wallTimeMs: 10 },
          backend: { id: 'test', agentId: 'a1' },
        }),
      /result\.summary\.cl/
    );
    // Valid payload passes
    validateJobResult({
      schemaVersion: 1,
      summary: { steps: 5, cd: 1.15, cl: 0.02, wallTimeMs: 10 },
      backend: { id: 'test', agentId: 'a1' },
    });

    const job = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'nan-cd-reject' }),
    });
    const caps = {
      backends: ['webgpu' as const],
      kinds: ['lbm-d3q19' as const], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE],
    };
    const claimed = claimJob({ agentId: 'agent-nan', capabilities: caps });
    assert.ok(claimed);
    assert.equal(claimed!.id, job.id);

    let thrown: unknown;
    try {
      completeJob({
        jobId: job.id,
        agentId: 'agent-nan',
        result: {
          schemaVersion: 1,
          summary: { steps: 10, cd: Number.NaN, cl: 0.5, wallTimeMs: 1 },
          backend: { id: 'test', agentId: 'agent-nan' },
        },
      });
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof HttpError);
    assert.equal((thrown as InstanceType<typeof HttpError>).status, 400);
    assert.match((thrown as Error).message, /cd|finite|NaN/i);

    const after = getJob(job.id);
    assert.ok(after);
    assert.notEqual(after!.status, 'succeeded');
    assert.equal(after!.status, 'leased');
  });

  it('two sequential claims get different jobs (multi-agent fair claim)', async () => {
    const { createJob, claimJob, getLeaseSeconds } = await import(
      '@/lib/tasks/service.ts'
    );
    const { defaultJobSpec } = await import('@/types/task.ts');

    assert.equal(getLeaseSeconds(), 30);

    const a = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'multi-a' }),
      priority: 1,
    });
    const b = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'multi-b' }),
      priority: 1,
    });
    // Higher priority first
    const c = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'multi-c-high' }),
      priority: 10,
    });

    const agent1 = 'agent-claim-1';
    const agent2 = 'agent-claim-2';
    const caps = {
      backends: ['webgpu' as const],
      maxGrid: 'fine' as const,
      kinds: ['lbm-d3q19' as const], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE],
    };

    const first = claimJob({ agentId: agent1, capabilities: caps });
    const second = claimJob({ agentId: agent2, capabilities: caps });
    const third = claimJob({ agentId: agent1, capabilities: caps });

    assert.ok(first);
    assert.ok(second);
    assert.ok(third);
    assert.notEqual(first!.id, second!.id);
    assert.notEqual(first!.id, third!.id);
    assert.notEqual(second!.id, third!.id);

    // Fair-ish: highest priority first, then oldest created_at
    assert.equal(first!.id, c.id);
    // a created before b at same priority
    assert.equal(second!.id, a.id);
    assert.equal(third!.id, b.id);

    assert.equal(first!.agentId, agent1);
    assert.equal(second!.agentId, agent2);
  });

  it('requeueExpiredLeases increments attempt and surfaces last_error', async () => {
    const {
      createJob,
      claimJob,
      requeueExpiredLeases,
      getJob,
      LEASE_EXPIRED_REQUEUE_ERROR,
      LEASE_EXPIRED_MAX_ATTEMPTS_ERROR,
    } = await import('@/lib/tasks/service.ts');
    const { getSqlite } = await import('@/lib/tasks/db.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');

    const job = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'lease-expire-requeue' }),
      maxAttempts: 3,
    });
    const caps = {
      backends: ['webgpu' as const],
      kinds: ['lbm-d3q19' as const], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE],
    };
    const claimed = claimJob({ agentId: 'agent-expire', capabilities: caps });
    assert.ok(claimed);
    assert.equal(claimed!.id, job.id);
    assert.equal(claimed!.attempt, 0);

    // Force lease into the past
    const past = new Date(Date.now() - 120_000).toISOString();
    getSqlite()
      .prepare(`UPDATE jobs SET lease_expires_at = ? WHERE id = ?`)
      .run(past, job.id);

    const n = requeueExpiredLeases();
    assert.ok(n >= 1);

    const after = getJob(job.id);
    assert.equal(after?.status, 'queued');
    assert.equal(after?.attempt, 1);
    assert.equal(after?.error, LEASE_EXPIRED_REQUEUE_ERROR);
    assert.equal(after?.agentId, null);
    assert.equal(after?.leaseExpiresAt, null);

    // Burn remaining attempts until max → failed
    for (let i = 0; i < 5; i++) {
      const c = claimJob({ agentId: 'agent-expire', capabilities: caps });
      if (!c || c.id !== job.id) break;
      getSqlite()
        .prepare(`UPDATE jobs SET lease_expires_at = ? WHERE id = ?`)
        .run(past, job.id);
      requeueExpiredLeases();
    }
    const terminal = getJob(job.id);
    assert.equal(terminal?.status, 'failed');
    assert.ok(
      terminal?.error === LEASE_EXPIRED_MAX_ATTEMPTS_ERROR ||
        terminal?.error === LEASE_EXPIRED_REQUEUE_ERROR ||
        (terminal?.error?.includes('lease expired') ?? false)
    );
  });

  it('cancelled jobs are not claimable; heartbeat returns clear error', async () => {
    const {
      createJob,
      claimJob,
      cancelJob,
      heartbeatJob,
      getJob,
    } = await import('@/lib/tasks/service.ts');
    const { HttpError } = await import('@/lib/tasks/http.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');

    const queued = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'cancel-before-claim' }),
    });
    cancelJob(queued.id);
    assert.equal(getJob(queued.id)?.status, 'cancelled');

    const caps = {
      backends: ['webgpu' as const],
      kinds: ['lbm-d3q19' as const], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE],
    };
    // Must not claim cancelled job (including targeted claim)
    const miss = claimJob({
      agentId: 'agent-cancel',
      capabilities: caps,
      jobId: queued.id,
    });
    assert.equal(miss, null);

    // Claim then cancel → heartbeat clear error
    const live = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'cancel-after-claim' }),
    });
    const claimed = claimJob({ agentId: 'agent-cancel', capabilities: caps });
    assert.ok(claimed);
    assert.equal(claimed!.id, live.id);

    cancelJob(live.id);
    assert.equal(getJob(live.id)?.status, 'cancelled');

    // Still not re-claimable
    assert.equal(
      claimJob({ agentId: 'other', capabilities: caps, jobId: live.id }),
      null
    );

    let thrown: unknown;
    try {
      heartbeatJob({ jobId: live.id, agentId: 'agent-cancel' });
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof HttpError);
    assert.equal((thrown as InstanceType<typeof HttpError>).status, 409);
    assert.match((thrown as Error).message, /cancelled/i);
  });

  it('heartbeat throttles no-op renewals on a fresh lease; changes still write', async () => {
    const { createJob, claimJob, heartbeatJob, getJob } = await import('@/lib/tasks/service.ts');
    const { getSqlite } = await import('@/lib/tasks/db.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const caps = {
      backends: ['webgpu' as const],
      kinds: ['lbm-d3q19' as const],
      features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE],
    };
    const sentinel = '2000-01-01T00:00:00.000Z';
    const job = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'hb-throttle' }),
    });
    const claimed = claimJob({ agentId: 'agent-hb', capabilities: caps, jobId: job.id });
    assert.equal(claimed!.id, job.id);

    // First heartbeat transitions leased→running — always writes.
    const first = heartbeatJob({ jobId: job.id, agentId: 'agent-hb' });
    assert.equal(first.status, 'running');

    // Fresh lease + no progress payload → throttled: a sentinel updated_at
    // planted by SQL must survive untouched (proves no UPDATE ran).
    getSqlite().prepare('UPDATE jobs SET updated_at = ? WHERE id = ?').run(sentinel, job.id);
    const skipped = heartbeatJob({ jobId: job.id, agentId: 'agent-hb' });
    assert.equal(skipped.leaseExpiresAt, first.leaseExpiresAt);
    assert.equal(getJob(job.id)!.updatedAt, sentinel);

    // A progress-bearing beat with a new step must write through.
    heartbeatJob({ jobId: job.id, agentId: 'agent-hb', progress: { step: 5 } });
    assert.notEqual(getJob(job.id)!.updatedAt, sentinel);
    assert.equal(getJob(job.id)!.progress?.step, 5);

    // The identical progress payload again → throttled.
    getSqlite().prepare('UPDATE jobs SET updated_at = ? WHERE id = ?').run(sentinel, job.id);
    heartbeatJob({ jobId: job.id, agentId: 'agent-hb', progress: { step: 5 } });
    assert.equal(getJob(job.id)!.updatedAt, sentinel);

    // Near-expiry lease → renewal must write; the throttle may never starve
    // a real renewal.
    getSqlite()
      .prepare('UPDATE jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date(Date.now() + 1000).toISOString(), sentinel, job.id);
    const renewed = heartbeatJob({ jobId: job.id, agentId: 'agent-hb' });
    assert.notEqual(getJob(job.id)!.updatedAt, sentinel);
    assert.ok(Date.parse(renewed.leaseExpiresAt!) > Date.now() + 1000);
  });

  it('AGENT_WORKSPACE filter scopes claim; unset stays global', async () => {
    const { createJob, claimJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');

    const wsA = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'ws-a', workspaceId: 'tenant-a' }),
    });
    const wsB = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'ws-b', workspaceId: 'tenant-b' }),
    });
    const caps = {
      backends: ['webgpu' as const],
      kinds: ['lbm-d3q19' as const], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE],
    };

    process.env.AGENT_WORKSPACE = 'tenant-b';
    try {
      const claimed = claimJob({ agentId: 'agent-ws', capabilities: caps });
      assert.ok(claimed);
      assert.equal(claimed!.id, wsB.id);
      assert.equal(claimed!.spec.workspaceId, 'tenant-b');

      // Explicit override can still pick tenant-a
      const other = claimJob({
        agentId: 'agent-ws',
        capabilities: caps,
        workspaceId: 'tenant-a',
      });
      assert.ok(other);
      assert.equal(other!.id, wsA.id);
    } finally {
      delete process.env.AGENT_WORKSPACE;
    }
  });

  it('getJobStats reports queue counters and leaseSeconds', async () => {
    const { getJobStats, createJob, claimJob, cancelJob } = await import(
      '@/lib/tasks/service.ts'
    );
    const { defaultJobSpec } = await import('@/types/task.ts');

    const before = getJobStats();
    assert.equal(before.leaseSeconds, 30);
    assert.ok(before.total >= 0);

    const j = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: 'stats-job' }),
    });
    const mid = getJobStats();
    assert.ok(mid.queued >= 1);

    claimJob({
      agentId: 'agent-stats',
      capabilities: {
        backends: ['webgpu'],
        kinds: ['lbm-d3q19'], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE],
      },
      jobId: j.id,
    });
    const leased = getJobStats();
    assert.ok(leased.leased + leased.running >= 1);

    cancelJob(j.id);
    const after = getJobStats();
    assert.ok(after.cancelled >= 1);
  });

  it('oldest queued preferred at equal priority (fair-ish order)', async () => {
    const { createJob, claimJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');

    // Unique names so we only care about these ids via targeted order
    const older = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: `fair-old-${Date.now()}` }),
      priority: 0,
    });
    // tiny delay so created_at differs if clock resolution is coarse
    await new Promise((r) => setTimeout(r, 5));
    const newer = createJob({
      spec: defaultJobSpec({ model: { source: 'preset', referenceLength: 1 }, name: `fair-new-${Date.now()}` }),
      priority: 0,
    });

    const caps = {
      backends: ['webgpu' as const],
      kinds: ['lbm-d3q19' as const], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE],
    };

    // Drain any other leftover queued jobs first that might be older
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const c = claimJob({ agentId: `drain-${i}`, capabilities: caps });
      if (!c) break;
      seen.add(c.id);
      if (c.id === older.id || c.id === newer.id) {
        // Once we hit one of our pair, verify order
        if (c.id === older.id) {
          const next = claimJob({ agentId: 'drain-next', capabilities: caps });
          // next may be newer or unrelated leftover; if it's newer, order is fair
          if (next?.id === newer.id) {
            assert.ok(true);
            return;
          }
          // older was claimed first among our pair — good enough
          assert.ok(seen.has(older.id));
          return;
        }
        if (c.id === newer.id && !seen.has(older.id)) {
          assert.fail('newer job claimed before older at same priority');
        }
      }
    }
  });

  it('path-experiment complete settles once (S20 product residual / A-host)', async () => {
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const { settlementKeyForResult } = await import('@/lib/tasks/job-fingerprint.ts');
    const { applySettlement } = await import('@/types/task.ts');

    const agentId = 'agent-path-settle';
    const job = createJob({
      spec: defaultJobSpec({
        kind: 'path-experiment',
        name: 'path-settle-idempotent',
        experiment: {
          experimentId: 'host-path-settle-v1',
          title: 'Host path settlement smoke',
          materials: [],
          steps: [],
          parameters: {},
          model: { id: 'path-replay', version: '1.0.0' },
          provenance: {
            createdAt: '1970-01-01T00:00:00.000Z',
            software: { name: 'host-test', version: '0.0.0' },
          },
        },
        run: { maxSteps: 4, forceSampleEvery: 1, warmupSteps: 0 },
        requirements: { backends: ['cpu'] },
      }),
    });
    const claimed = claimJob({
      agentId,
      capabilities: {
        backends: ['cpu' as const],
        kinds: ['path-experiment' as const],
        pathModels: [
          {
            id: 'path-replay',
            version: '1.0.0',
            backends: ['cpu'],
          },
        ],
      },
    });
    assert.ok(claimed, 'expected path-experiment job to be claimable with pathModels bag');
    assert.equal(claimed!.id, job.id);

    const result = {
      schemaVersion: 1 as const,
      summary: {
        steps: 4,
        wallTimeMs: 12,
        pathScore: 0.42,
        solverPackage: '@w-sim/solvers-path-experiment',
      },
      backend: { id: 'cpu-path-experiment', agentId },
      experiment: {
        experimentId: 'host-path-settle-v1',
        modelVersion: '1.0.0',
        outputs: { pathScore: { value: 0.42 } },
        provenance: { computedAt: '2026-08-02T01:00:00.000Z', engineVersion: '1.0.0' },
      },
    };
    const first = completeJob({ jobId: job.id, agentId, result });
    assert.ok(first);
    assert.equal(first!.status, 'succeeded');

    const key = settlementKeyForResult(job.id, first!.result!);
    const dup = applySettlement(
      {
        jobId: job.id,
        executionStatus: 'succeeded',
        settlement: 'settled',
        settlementKey: key,
      },
      { key, executionStatus: 'succeeded' },
    );
    assert.equal(dup.ok, true);
    if (dup.ok) assert.equal(dup.duplicate, true);

    const second = completeJob({ jobId: job.id, agentId, result });
    assert.ok(second);
    assert.equal(second!.status, 'succeeded');
  });

  it('md-batch complete settles once (multi-kind residual)', async () => {
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const { settlementKeyForResult } = await import('@/lib/tasks/job-fingerprint.ts');
    const { applySettlement } = await import('@/types/task.ts');

    const agentId = 'agent-md-settle';
    const job = createJob({
      spec: defaultJobSpec({
        kind: 'md-batch',
        name: 'md-settle-idempotent',
        parameters: { epsilon: 1, sigma: 1, r: 1.122462048309373 },
        run: { maxSteps: 1, forceSampleEvery: 1, warmupSteps: 0 },
        requirements: { backends: ['cpu'] },
      }),
    });
    const claimed = claimJob({
      agentId,
      capabilities: { backends: ['cpu' as const], kinds: ['md-batch' as const] },
    });
    assert.ok(claimed, 'md-batch should be claimable');
    assert.equal(claimed!.id, job.id);
    const result = {
      schemaVersion: 1 as const,
      summary: { steps: 1, wallTimeMs: 3, potential: -1, solverPackage: '@w-sim/solvers-md' },
      backend: { id: 'cpu-md-lj', agentId },
    };
    const first = completeJob({ jobId: job.id, agentId, result });
    assert.ok(first);
    assert.equal(first!.status, 'succeeded');
    const key = settlementKeyForResult(job.id, first!.result!);
    const dup = applySettlement(
      { jobId: job.id, executionStatus: 'succeeded', settlement: 'settled', settlementKey: key },
      { key, executionStatus: 'succeeded' },
    );
    assert.equal(dup.ok, true);
    if (dup.ok) assert.equal(dup.duplicate, true);
    const second = completeJob({ jobId: job.id, agentId, result });
    assert.ok(second);
    assert.equal(second!.status, 'succeeded');
  });


  it('thermal-3d-convection complete settles once (multi-kind residual)', async () => {
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const { settlementKeyForResult } = await import('@/lib/tasks/job-fingerprint.ts');
    const { applySettlement } = await import('@/types/task.ts');

    const agentId = 'agent-thermal-conv-settle';
    const job = createJob({
      spec: defaultJobSpec({
        kind: 'thermal-3d-convection',
        name: 'thermal-conv-settle',
        parameters: { pe: 2, lengthM: 1, tLeft: 0, tRight: 100, nSamples: 17, thermalEnabled: true },
        run: { maxSteps: 1, forceSampleEvery: 1, warmupSteps: 0 },
        requirements: { backends: ['cpu'], thermal: true },
      }),
    });
    const claimed = claimJob({
      agentId,
      capabilities: {
        backends: ['cpu' as const],
        kinds: ['thermal-3d-convection' as const],
        thermal: true,
      },
    });
    assert.ok(claimed, 'thermal-3d-convection should be claimable');
    const result = {
      schemaVersion: 1 as const,
      summary: {
        steps: 1,
        wallTimeMs: 4,
        pe: 2,
        tMin: 0,
        tMax: 100,
        solverPackage: '@w-sim/solvers-thermal',
      },
      backend: { id: 'cpu-thermal-convection', agentId },
    };
    const first = completeJob({ jobId: job.id, agentId, result });
    assert.ok(first);
    assert.equal(first!.status, 'succeeded');
    const key = settlementKeyForResult(job.id, first!.result!);
    const dup = applySettlement(
      { jobId: job.id, executionStatus: 'succeeded', settlement: 'settled', settlementKey: key },
      { key, executionStatus: 'succeeded' },
    );
    assert.equal(dup.ok, true);
    if (dup.ok) assert.equal(dup.duplicate, true);
  });

  it('structural-static complete settles once (A-host multi-kind residual / S26)', async () => {
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const { settlementKeyForResult } = await import('@/lib/tasks/job-fingerprint.ts');
    const { applySettlement } = await import('@/types/task.ts');

    const agentId = 'agent-structural-settle';
    const job = createJob({
      spec: defaultJobSpec({
        kind: 'structural-static',
        name: 'structural-static-settle',
        parameters: {
          elementType: 'bar',
          lengthM: 1,
          nElements: 4,
          area: 0.01,
          loadN: 1000,
          youngsModulusPa: 2.1e11,
        },
        run: { maxSteps: 1, forceSampleEvery: 1, warmupSteps: 0 },
        requirements: { backends: ['cpu'] },
      }),
    });
    const claimed = claimJob({
      agentId,
      capabilities: {
        backends: ['cpu' as const],
        kinds: ['structural-static' as const],
      },
    });
    assert.ok(claimed, 'structural-static should be claimable');
    const result = {
      schemaVersion: 1 as const,
      summary: {
        steps: 1,
        wallTimeMs: 5,
        tipDisplacementM: 4.76e-7,
        maxStressPa: 1e5,
        solverPackage: '@w-sim/solvers-structural',
      },
      backend: { id: 'cpu-structural', agentId },
    };
    const first = completeJob({ jobId: job.id, agentId, result });
    assert.ok(first);
    assert.equal(first!.status, 'succeeded');
    const key = settlementKeyForResult(job.id, first!.result!);
    const dup = applySettlement(
      { jobId: job.id, executionStatus: 'succeeded', settlement: 'settled', settlementKey: key },
      { key, executionStatus: 'succeeded' },
    );
    assert.equal(dup.ok, true);
    if (dup.ok) assert.equal(dup.duplicate, true);
  });

  it('acoustics-3d complete settles once (A-host multi-kind residual)', async () => {
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const { settlementKeyForResult } = await import('@/lib/tasks/job-fingerprint.ts');
    const { applySettlement } = await import('@/types/task.ts');

    const agentId = 'agent-acoustics-settle';
    const job = createJob({
      spec: defaultJobSpec({
        kind: 'acoustics-3d',
        name: 'acoustics-settle',
        parameters: { frequencyHz: 1000, wavelengthM: 0.343 },
        run: { maxSteps: 1, forceSampleEvery: 1, warmupSteps: 0 },
        requirements: { backends: ['cpu'] },
      }),
    });
    const claimed = claimJob({
      agentId,
      capabilities: {
        backends: ['cpu' as const],
        kinds: ['acoustics-3d' as const],
      },
    });
    assert.ok(claimed, 'acoustics-3d should be claimable');
    const result = {
      schemaVersion: 1 as const,
      summary: {
        steps: 1,
        wallTimeMs: 2,
        c0: 343,
        solverPackage: '@w-sim/solvers-acoustics',
      },
      backend: { id: 'cpu-acoustics', agentId },
    };
    const first = completeJob({ jobId: job.id, agentId, result });
    assert.ok(first);
    assert.equal(first!.status, 'succeeded');
    const key = settlementKeyForResult(job.id, first!.result!);
    const dup = applySettlement(
      { jobId: job.id, executionStatus: 'succeeded', settlement: 'settled', settlementKey: key },
      { key, executionStatus: 'succeeded' },
    );
    assert.equal(dup.ok, true);
    if (dup.ok) assert.equal(dup.duplicate, true);
  });

  it('electro-thermal-igbt complete settles once (A-host multi-kind residual / S24c)', async () => {
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const { settlementKeyForResult } = await import('@/lib/tasks/job-fingerprint.ts');
    const { applySettlement } = await import('@/types/task.ts');

    const agentId = 'agent-thermal-igbt-settle';
    const job = createJob({
      spec: defaultJobSpec({
        kind: 'electro-thermal-igbt',
        name: 'thermal-igbt-rthja-settle',
        parameters: {
          powerW: 50,
          ambientTemp: 25,
          rthJa: 1.2,
          nSamples: 9,
          thermalEnabled: true,
        },
        run: { maxSteps: 1, forceSampleEvery: 1, warmupSteps: 0 },
        requirements: { backends: ['cpu'], thermal: true },
      }),
    });
    const claimed = claimJob({
      agentId,
      capabilities: {
        backends: ['cpu' as const],
        kinds: ['electro-thermal-igbt' as const],
        thermal: true,
      },
    });
    assert.ok(claimed, 'electro-thermal-igbt should be claimable');
    const result = {
      schemaVersion: 1 as const,
      summary: {
        steps: 1,
        wallTimeMs: 3,
        tjSteadyC: 85,
        tjMaxC: 85,
        rthJa: 1.2,
        powerW: 50,
        solverPackage: '@w-sim/solvers-thermal',
      },
      backend: { id: 'cpu-thermal-igbt', agentId },
    };
    const first = completeJob({ jobId: job.id, agentId, result });
    assert.ok(first);
    assert.equal(first!.status, 'succeeded');
    const key = settlementKeyForResult(job.id, first!.result!);
    const dup = applySettlement(
      { jobId: job.id, executionStatus: 'succeeded', settlement: 'settled', settlementKey: key },
      { key, executionStatus: 'succeeded' },
    );
    assert.equal(dup.ok, true);
    if (dup.ok) assert.equal(dup.duplicate, true);
  });

  it('em-fdtd-3d complete settles once (A-host multi-kind residual / S27)', async () => {
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const { settlementKeyForResult } = await import('@/lib/tasks/job-fingerprint.ts');
    const { applySettlement } = await import('@/types/task.ts');

    const agentId = 'agent-em-fdtd-settle';
    const job = createJob({
      spec: defaultJobSpec({
        kind: 'em-fdtd-3d',
        name: 'em-fdtd-vacuum-settle',
        parameters: { c0: 299792458, mu0: 1.25663706212e-6, eps0: 8.8541878128e-12 },
        run: { maxSteps: 1, forceSampleEvery: 1, warmupSteps: 0 },
        requirements: { backends: ['cpu'] },
      }),
    });
    const claimed = claimJob({
      agentId,
      capabilities: {
        backends: ['cpu' as const],
        kinds: ['em-fdtd-3d' as const],
      },
    });
    assert.ok(claimed, 'em-fdtd-3d should be claimable');
    const result = {
      schemaVersion: 1 as const,
      summary: {
        steps: 1,
        wallTimeMs: 2,
        c0: 299792458,
        z0: 376.730313461,
        solverPackage: '@w-sim/solvers-em-fdtd',
      },
      backend: { id: 'cpu-em-fdtd', agentId },
    };
    const first = completeJob({ jobId: job.id, agentId, result });
    assert.ok(first);
    assert.equal(first!.status, 'succeeded');
    const key = settlementKeyForResult(job.id, first!.result!);
    const dup = applySettlement(
      { jobId: job.id, executionStatus: 'succeeded', settlement: 'settled', settlementKey: key },
      { key, executionStatus: 'succeeded' },
    );
    assert.equal(dup.ok, true);
    if (dup.ok) assert.equal(dup.duplicate, true);
  });

  it('export-report complete settles once (A-host multi-kind residual / S20-export)', async () => {
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const { settlementKeyForResult } = await import('@/lib/tasks/job-fingerprint.ts');
    const { applySettlement } = await import('@/types/task.ts');

    const agentId = 'agent-export-report-settle';
    const job = createJob({
      spec: defaultJobSpec({
        kind: 'export-report',
        name: 'export-report-settle',
        parameters: {
          sourceJobId: 'job-source-smoke',
          format: 'json',
        },
        run: { maxSteps: 1, forceSampleEvery: 1, warmupSteps: 0 },
        requirements: { backends: ['cpu'] },
      }),
    });
    const claimed = claimJob({
      agentId,
      capabilities: {
        backends: ['cpu' as const],
        kinds: ['export-report' as const],
      },
    });
    assert.ok(claimed, 'export-report should be claimable');
    const result = {
      schemaVersion: 1 as const,
      summary: {
        steps: 1,
        wallTimeMs: 1,
        partCount: 2,
        solverPackage: '@w-sim/solvers-export-report',
      },
      backend: { id: 'cpu-export-report', agentId },
    };
    const first = completeJob({ jobId: job.id, agentId, result });
    assert.ok(first);
    assert.equal(first!.status, 'succeeded');
    const key = settlementKeyForResult(job.id, first!.result!);
    const dup = applySettlement(
      { jobId: job.id, executionStatus: 'succeeded', settlement: 'settled', settlementKey: key },
      { key, executionStatus: 'succeeded' },
    );
    assert.equal(dup.ok, true);
    if (dup.ok) assert.equal(dup.duplicate, true);
  });

  it('thermal-3d-steady complete settles once (A-host multi-kind residual / S24)', async () => {
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const { settlementKeyForResult } = await import('@/lib/tasks/job-fingerprint.ts');
    const { applySettlement } = await import('@/types/task.ts');

    const agentId = 'agent-thermal-steady-settle';
    const job = createJob({
      spec: defaultJobSpec({
        kind: 'thermal-3d-steady',
        name: 'thermal-steady-settle',
        parameters: {
          nx: 17,
          tLeft: 0,
          tRight: 100,
          lengthX: 1,
          conductivity: 1,
        },
        run: { maxSteps: 1, forceSampleEvery: 1, warmupSteps: 0 },
        requirements: { backends: ['cpu'] },
      }),
    });
    const claimed = claimJob({
      agentId,
      capabilities: {
        backends: ['cpu' as const],
        kinds: ['thermal-3d-steady' as const],
      },
    });
    assert.ok(claimed, 'thermal-3d-steady should be claimable');
    const result = {
      schemaVersion: 1 as const,
      summary: {
        steps: 1,
        wallTimeMs: 4,
        analyticalMaxAbsError: 1e-12,
        maxTemperatureC: 100,
        solverPackage: '@w-sim/solvers-thermal',
      },
      backend: { id: 'cpu-thermal-steady', agentId },
    };
    const first = completeJob({ jobId: job.id, agentId, result });
    assert.ok(first);
    assert.equal(first!.status, 'succeeded');
    const key = settlementKeyForResult(job.id, first!.result!);
    const dup = applySettlement(
      { jobId: job.id, executionStatus: 'succeeded', settlement: 'settled', settlementKey: key },
      { key, executionStatus: 'succeeded' },
    );
    assert.equal(dup.ok, true);
    if (dup.ok) assert.equal(dup.duplicate, true);
  });

  it('fdtd-batch complete settles once (A-host multi-kind residual / S27)', async () => {
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');
    const { settlementKeyForResult } = await import('@/lib/tasks/job-fingerprint.ts');
    const { applySettlement } = await import('@/types/task.ts');

    const agentId = 'agent-fdtd-batch-settle';
    const job = createJob({
      spec: defaultJobSpec({
        kind: 'fdtd-batch',
        name: 'fdtd-batch-vacuum-settle',
        parameters: { muR: 1, epsR: 1 },
        run: { maxSteps: 1, forceSampleEvery: 1, warmupSteps: 0 },
        requirements: { backends: ['cpu'] },
      }),
    });
    const claimed = claimJob({
      agentId,
      capabilities: {
        backends: ['cpu' as const],
        kinds: ['fdtd-batch' as const],
      },
    });
    assert.ok(claimed, 'fdtd-batch should be claimable');
    const result = {
      schemaVersion: 1 as const,
      summary: {
        steps: 1,
        wallTimeMs: 2,
        cMps: 299792458,
        zOhm: 376.730313461,
        solverPackage: '@w-sim/solvers-em-fdtd',
      },
      backend: { id: 'cpu-fdtd-batch', agentId },
    };
    const first = completeJob({ jobId: job.id, agentId, result });
    assert.ok(first);
    assert.equal(first!.status, 'succeeded');
    const key = settlementKeyForResult(job.id, first!.result!);
    const dup = applySettlement(
      { jobId: job.id, executionStatus: 'succeeded', settlement: 'settled', settlementKey: key },
      { key, executionStatus: 'succeeded' },
    );
    assert.equal(dup.ok, true);
    if (dup.ok) assert.equal(dup.duplicate, true);
  });

  it('readJson enforces the caller byte cap on request bodies', async () => {
    const { readJson, HttpError } = await import('@/lib/tasks/http.ts');
    const small = new Request('http://h.test/jobs', { method: 'POST', body: JSON.stringify({ spec: 1 }) });
    assert.deepEqual(await readJson(small, 1024), { spec: 1 });
    const big = new Request('http://h.test/jobs', { method: 'POST', body: 'x'.repeat(4096) });
    await assert.rejects(
      () => readJson(big, 1024),
      (err: unknown) => err instanceof HttpError && (err as { status: number }).status === 413,
    );
    // Uncapped callers keep the legacy behavior.
    const open = new Request('http://h.test/jobs', { method: 'POST', body: 'x'.repeat(4096) });
    await assert.rejects(() => readJson(open), /Invalid JSON body/);
  });

  it('resultBackendAllowed mirrors the agent ANY-OF alias families', async () => {
    const { resultBackendAllowed } = await import('@/lib/tasks/validate-result.ts');
    // Empty requirement: anything goes.
    assert.equal(resultBackendAllowed('whatever', []), true);
    // Literal match.
    assert.equal(resultBackendAllowed('cpu', ['cpu']), true);
    assert.equal(resultBackendAllowed('webgpu-dawn', ['webgpu-dawn']), true);
    // cuda-family results satisfy cuda|native-cuda|webgpu ('webgpu' = any GPU).
    for (const id of ['cuda', 'w-sim-cuda', 'native-cuda', 'native-cuda-sw-fds']) {
      assert.equal(resultBackendAllowed(id, ['cuda']), true, id);
      assert.equal(resultBackendAllowed(id, ['native-cuda']), true, id);
      assert.equal(resultBackendAllowed(id, ['webgpu']), true, id);
      assert.equal(resultBackendAllowed(id, ['cpu']), false, id);
    }
    // host-family results satisfy 'cpu' only.
    for (const id of ['cpu', 'cpu-teaching', 'w-sim-cuda-host', 'host-f64']) {
      assert.equal(resultBackendAllowed(id, ['cpu']), true, id);
      assert.equal(resultBackendAllowed(id, ['cuda']), false, id);
    }
    // webgpu-* results satisfy only the umbrella 'webgpu', not specific tokens.
    assert.equal(resultBackendAllowed('webgpu-dawn', ['webgpu']), true);
    assert.equal(resultBackendAllowed('webgpu-dawn', ['webgpu-browser']), false);
    // Missing id never satisfies a non-empty requirement; unknown ids are literal-only.
    assert.equal(resultBackendAllowed(undefined, ['cpu']), false);
    assert.equal(resultBackendAllowed('quantum', ['cpu', 'cuda']), false);
    assert.equal(resultBackendAllowed('quantum', ['quantum']), true);
  });

});
