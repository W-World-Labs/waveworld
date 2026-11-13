/**
 * A-agent: createSolverRunnerRegistry + @w-sim/solvers-path-experiment dispatch.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLammpsData } from '../../../../src/lib/sim/lammps-data.ts';
import { validateJobSpec } from '../../../host/src/lib/tasks/validate-spec.ts';
import { validateJobResult } from '../../../host/src/lib/tasks/validate-result.ts';
import test from 'node:test';
import { runGuardedClaimLoopOnce } from './guarded-claim.ts';
import { computeModule, createModuleJobSpec, readModuleResult, MODULE_JOB_KIND, type ModuleComputeInput } from '../../../../src/lib/sim/module-compute.ts';
import { opticsPreset } from '../../../../src/lib/lab/optics-lab.ts';
import { fanGeometry, fanSpec, thermalSpec, thermalContactsSpec } from '../../../../scripts/ci/lbm-fixture.ts';
import { macSpec, macGeometry } from '../../../../scripts/ci/mac-fixture.ts';
import { encodeMacFlowSnapshot } from '../../src/lib/cfd/mac-flow-snapshot.ts';
import { encodeModelGeometry } from '../../src/lib/models/geometry-contract.ts';
import type { LbmDisplaySnapshot } from '@w-sim/solvers-lbm/d3q19';
import {
  createMemoryJobHost,
  isSolverRunnerRegistry,
  resolveJobRunner,
  runClaimLoopOnce,
} from '@w-sim/runtime';
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts';
import {
  buildSmokeJobSpec,
  PATH_EXPERIMENT_KIND,
  SOLVER_PACKAGE_META,
} from '@w-sim/solvers-path-experiment';
import { SOLVER_PACKAGE_META as LBM_SOLVER_PACKAGE_META } from '@w-sim/solvers-lbm';
import { THERMAL_LAB_KIT, buildBuildingEnvelopeJobSpec } from '@w-sim/solvers-thermal';
import { EM_FDTD_LAB_KIT } from '@w-sim/solvers-em-fdtd';
import { ACOUSTICS_LAB_KIT } from '@w-sim/solvers-acoustics';
import { MD_LAB_KIT, buildLjClusterJobSpec } from '@w-sim/solvers-md';
import { STRUCTURAL_LAB_KIT, buildContinuousBridgeGirderJobSpec } from '@w-sim/solvers-structural';
import {
  createAgentSolverRegistry,
  createDualPathPathExperimentRunner,
  createLbmJobRunner,
  createPathExperimentRunner,
  listAgentSolverKinds,
  prefersProductPathRunner,
} from './runners.ts';
import {
  PHOTOSENSITIZATION_RK4_MODEL,
  type PathExperimentJobSpecLike,
} from './path-experiment-runner.ts';

for (const mode of ['fan', 'thermal fan', 'thermal contacts'] as const) for (const cancel of [false, true]) {
  test(`CPU LBM uses the actual Rust ${mode} kernel and ${cancel ? 'cancels before upload' : 'saves the real field'}`, async () => {
    const thermal = mode !== 'fan';
    const spec = mode === 'thermal contacts' ? thermalContactsSpec() : thermal ? thermalSpec() : fanSpec(), controller = new AbortController();
    if (mode === 'thermal contacts') spec.parameters.fan = thermalSpec().parameters.fan;
    let snapshot: LbmDisplaySnapshot | undefined;
    const registry = createAgentSolverRegistry({ agentId: 'cpu-lbm',
      loadArtifact: async id => { assert.equal(id, spec.model!.artifactId); return encodeModelGeometry(fanGeometry); },
      saveFlowSnapshot: async value => {
        assert.ok('display' in value);
        snapshot = value;
        return { artifactId: 'flow', kind: 'lbm-display', contentType: 'application/vnd.waveworld.lbm-display-v1', bytes: 32 + value.nx * value.ny * value.nz * (value.displayStride + 1) * 4 };
      },
    });
    const resolved = registry.resolve(spec);
    assert.ok(resolved.ok);
    const execution = resolved.runner.run(spec, progress => { if (cancel && progress.step > 0) controller.abort(); }, controller.signal);
    if (cancel) {
      await assert.rejects(execution, { name: 'AbortError' });
      assert.equal(snapshot === undefined, true, 'cancelled final-only jobs must not upload a field');
    } else {
      const result = await execution;
      assert.equal(result.derived?.engine, 'rust-wasm');
      assert.equal(result.derived?.precision, 'mixed');
      assert.equal(result.backend?.agentId, 'cpu-lbm');
      assert.equal(snapshot?.step, 3);
      assert.ok(snapshot?.display.some((value, i) => i % (thermal ? 3 : 2) === 0 && value > 0));
      assert.equal(result.artifacts?.length, 1);
      validateJobResult(result);
    }
  });
}

for (const cancel of [false, true]) test(`resident MAC streams SI fields and ${cancel ? 'rejects cancellation during upload' : 'retains every frame'}`, async () => {
  const spec = macSpec(undefined, true), controller = new AbortController(), saved: number[] = [];
  const registry = createAgentSolverRegistry({ agentId: 'cpu-mac',
    loadArtifact: async id => { assert.equal(id, spec.model!.artifactId); return encodeModelGeometry(macGeometry); },
    saveFlowSnapshot: async value => {
      assert.ok('fields' in value);
      saved.push(value.step);
      if (cancel) controller.abort();
      return { artifactId: `mac-${value.step}`, kind: 'mac-flow-field', contentType: 'application/vnd.waveworld.mac-field-v1',
        bytes: encodeMacFlowSnapshot(value).byteLength, step: value.step };
    },
  });
  const resolved = registry.resolve(spec); assert.ok(resolved.ok);
  const promise = resolved.runner.run(spec, undefined, controller.signal);
  if (cancel) { await assert.rejects(promise, { name: 'AbortError' }); assert.deepEqual(saved, [1]); }
  else {
    const result = await promise;
    assert.deepEqual(saved, [1, 2, 3]); assert.deepEqual(result.artifacts?.map(ref => ref.step), saved);
    assert.equal(result.derived?.precision, 'float64'); assert.equal(result.backend?.agentId, 'cpu-mac');
    assert.equal(result.mac?.fans.length, 2); assert.equal(result.summary.cd, undefined);
    validateJobResult(result);
  }
});

for (const input of [
  { module: 'ripple', scene: { damping: 0.997, steps: 3, seeds: [{ x: 90, y: 90, radius: 2, amount: 6 }] } },
  { module: 'convection', scene: { buoyancy: 0.07, steps: 2, initialDrop: true, seeds: [{ x: 55, y: 65, hot: false }] } },
  { module: 'particles', scene: parseLammpsData(readFileSync(new URL('../../../../public/datasets/lammps-lj-2d.data', import.meta.url), 'utf8')) },
  { module: 'fluid', scene: { viscosity: 0.00005, diffusion: 0.00001, rotation: 0.02, decay: 0.995, steps: 3, seeds: [{ x: 1, y: 1, radius: 2, density: 40, vx: 0.5, vy: -0.2 }], inlet: { speed: 0.3, density: 2, spacing: 10, width: 2 }, obstacle: Array.from({ length: 10000 }, (_, i) => [5030, 5031, 5130].includes(i) ? 1 : 0) } },
  { module: 'display', scene: { mode: 'LED', bandgap: 2 } },
  { module: 'display', scene: { mode: 'OLED', channels: [1, 0.6, 0.2] } },
  { module: 'display', scene: { mode: 'LCD', rotationDeg: 45 } },
  { module: 'particles', scene: {
    species: [{ name: 'User alpha', count: 2, charge: 0.3, sigma: 0.6, epsilon: 1 }, { name: 'User beta', count: 1, charge: -0.6, sigma: 1.1, epsilon: 0.5 }],
    positions: [1, 1, 2.2, 1, 6, 6], boxL: 10, temperature: 0.4, thermostat: false,
    epsR: 12, lambdaD: 3, kCoulomb: 1, seed: 11, steps: 5, dim: 2,
  } },
  { module: 'ising', scene: { size: 16, temperatures: [0.8, 3.6], seed: 7, hot: true, burnIn: 1, samples: 2 } },
  { module: 'vibration', scene: { mass: 1, stiffness: 100, damping: 1, driveFrequency: 1.5, steps: 5 } },
  { module: 'md', scene: { N: 64, temperature: 0.4, thermostat: true, barostat: false, targetP: 0.5, tauP: 0.5, steps: 5, seed: 7 } },
  { module: 'md', scene: { N: 64, temperature: 0.4, thermostat: true, barostat: true, targetP: 0.5, tauP: 0.5, steps: 5, seed: 7 } },
  { module: 'sim', scene: { r: 0.25, steps: 3, seeds: [{ x: 0, y: 0, radius: 2, amount: 100 }] } },
  { module: 'heaterfc', scene: { kappa: 0.5, steps: 3 } },
  { module: 'ecg', scene: { hr: 75, samples: 16 } },
  { module: 'ecg', scene: { recording: { name: 'sample', sampleRate: 360, unit: 'mV', channels: [{ name: 'MLII', values: [-0.145, -0.14, 0, 1] }] }, channel: 0 } },
  { module: 'eeg', scene: { state: 1, noise: 0.4, seed: 7, samples: 16 } },
  { module: 'emg', scene: { agonist: 0.5, antag: 0.1, seed: 11, samples: 16 } },
  { module: 'neuron', scene: { current: 0.5, steps: 8, pulses: [0] } },
  { module: 'ultrasound', scene: { atten: 0.02, gain: 1 } },
  { module: 'biopipeline', scene: { source: 'ECG', seed: 7 } },
  { module: 'rlc', scene: { zeta: 0, drive: 'energy', steps: 4 } },
  { module: 'mutual', scene: { k: 0.99, n: 0.3, mode: 'step', steps: 4 } },
  { module: 'transient', scene: { mode: 'rc-charge', v0: 5, r: 1000, c: 1e-4, l: 0.5 } },
  { module: 'faraday', scene: { omega: 4 * Math.PI, B: 0.3, N: 200, A: 0.01, vBar: 0, bMot: 0.5, lBar: 0.2 } },
  { module: 'smith', scene: { resistance: 0, reactance: 0, thetaDeg: 90 } },
  { module: 'localization', scene: { target: { x: 60, y: 60 }, noise: 25, seed: 7, bandwidth: 30 } },
  { module: 'tdoa', scene: { source: { x: 0, y: 380 }, noise: 0, seed: 11 } },
  { module: 'stm', scene: { mode: 'current', tipHeight: 0.28, setCurrent: 0.02 } },
  { module: 'afm', scene: { base: 2.1, k: 6 } },
  { module: 'phasedarray', params: { n: 4, dOverLambda: 1, steerDeg: 30 } },
  { module: 'nljd', kind: 'corrosion' },
  { module: 'radar', scene: { mode: 'pulse', steps: 3, probes: [{ x: 24, y: 100 }, null, null, null] } },
  { module: 'emwave3d', params: { waveNumber: 0.7, amplitude: 2.2, time: 1 } },
  { module: 'antennapattern', params: { type: 'directional', ptDbm: 20, gtDbi: 6, grDbi: 6, frequencyHz: 2.4e9, distM: 100 } },
  { module: 'antenna3d', params: { ptDbm: 20, frequencyHz: 2.4e9, distM: 8, elevationDeg: 90, polarizationDeg: 90 } },
  { module: 'laser', pump: 1200, steps: 4 },
  { module: 'fdtd', scene: { preset: 'interface', boundary: 'mur', shape: 'line', time: 'pulse', omega: 0.3, steps: 3, sources: [{ i: 30, j: 100 }] } },
  { module: 'optics-lab', components: opticsPreset('mirror-bounce') },
  { module: 'electromagnetic', params: { frequencyHz: 2.4e9, refractiveIndex: 1.5, ePeak: 2 }, timeSeconds: 1e-11, xs: [0, 0.1, 0.2] },
  { module: 'sound', params: { frequencyHz: 1000, rho: 1.2, c: 343, pPeak: 2 }, timeSeconds: 0.0001, xs: [0, 0.1, 0.2] },
] satisfies ModuleComputeInput[]) {
  test(`${input.module}: browser function and agent agree after JSON transport`, async () => {
    const spec = JSON.parse(JSON.stringify(createModuleJobSpec(input)));
    validateJobSpec(spec);
    assert.throws(() => validateJobSpec({ ...spec, run: { maxSteps: spec.run.maxSteps + 1 } }));
    assert.throws(() => validateJobSpec({ ...spec, model: { source: 'inline', inline: { module: 'missing' } } }));
    assert.throws(() => validateJobSpec({ ...spec, requirements: { backends: ['webgpu-dawn'] } }), /supports only the cpu or native-cuda backends/);
    assert.throws(() => validateJobSpec({ ...spec, requirements: { precision: spec.requirements.precision === 'mixed' ? 'float64' : 'mixed' } }), /precision/);
    const registry = createAgentSolverRegistry({ agentId: 'module-smoke' });
    const resolved = registry.resolve(spec);
    assert.ok(resolved.ok);
    assert.deepEqual(resolved.descriptor.precision, ['float64', 'mixed']);
    await assert.rejects(resolved.runner.run(spec, undefined, AbortSignal.abort()), { name: 'AbortError' });
    const { host, completed, failed } = createMemoryJobHost([{ jobId: input.module, spec }]);
    assert.equal(await runClaimLoopOnce(host, 'module-smoke', registry), 'completed', failed.get(input.module));
    const result = JSON.parse(JSON.stringify(completed.get(input.module)));
    validateJobResult(result);
    assert.equal(result.derived?.precision, spec.requirements.precision);
    if (['rlc', 'mutual', 'neuron', 'vibration', 'optics-lab'].includes(input.module)) assert.equal(result.derived?.engine, 'rust-wasm');
    assert.deepEqual(readModuleResult(result, input), await computeModule(input));
    assert.throws(() => readModuleResult({ ...result, moduleResult: undefined }, input));
    assert.throws(() => readModuleResult({ ...result, moduleResult: { module: input.module } }, input));
    assert.ok(listAgentSolverKinds({ agentId: 'module-smoke' }).includes(MODULE_JOB_KIND));
  });
}

for (const outcome of ['completed', 'cancelled', 'lease_lost'] as const) {
  test(`module progress renews ownership and handles ${outcome} between actual solver chunks`, async (t) => {
    let now = 0;
    t.mock.method(performance, 'now', () => now += 1001);
    const input: ModuleComputeInput = { module: 'ising', scene: { size: 16, temperatures: [2], seed: 7, hot: true, burnIn: 0, samples: 17 } };
    const { host, completed, failed, cancelled, requestCancel } = createMemoryJobHost([{ jobId: 'chunked', spec: createModuleJobSpec(input) }]);
    const ticks: number[] = [];
    let renewals = 0;
    const registry = createAgentSolverRegistry({ agentId: 'chunk-agent' });
    let cancelRequested = false;
    const status = await runGuardedClaimLoopOnce({
      ...host,
      async progress(jobId, p) {
        ticks.push(p.step);
        await host.progress(jobId, p);
      },
      async renewLease() {
        renewals++;
        return outcome === 'lease_lost' && ticks.at(-1)! >= 8 ? null : new Date(Date.now() + 60_000).toISOString();
      },
    }, 'chunk-agent', registry, {
      isCancelRequested: () => {
        if (outcome !== 'cancelled' || ticks.at(-1)! < 8) return false;
        if (!cancelRequested) {
          cancelRequested = true;
          requestCancel('chunked');
        }
        return true;
      },
    });
    assert.equal(status, outcome);
    assert.deepEqual(ticks, outcome === 'completed' ? [0, 8, 16, 17] : [0, 8]);
    assert.equal(renewals, ticks.length + (outcome === 'completed' ? 1 : 0));
    assert.equal(completed.size, outcome === 'completed' ? 1 : 0);
    assert.equal(failed.size, 0);
    assert.equal(cancelled.size, outcome === 'cancelled' ? 1 : 0);
    if (outcome === 'lease_lost') assert.equal(failed.has('chunked'), false, 'confirmed lease loss must not send stale fail');
    if (outcome === 'completed') assert.deepEqual(readModuleResult(completed.get('chunked')!, input), await computeModule(input));
  });
}

test('optics sub-batches preserve one snapshot step and throttle lease updates', async (t) => {
  t.mock.method(performance, 'now', () => 100);
  const components = Array.from({ length: 32 }, (_, i) => ({ id: `source-${i}`, kind: 'laser' as const, x: 100, y: 100, rot: 0, length: 40 }));
  const spec = createModuleJobSpec({ module: 'optics-lab', components });
  const resolved = createAgentSolverRegistry({ agentId: 'optics-throttle' }).resolve(spec);
  assert.ok(resolved.ok);
  const ticks: number[] = [];
  await resolved.runner.run(spec, p => { ticks.push(p.step); });
  assert.deepEqual(ticks, [0, 1]);
});

test('module progress throttles short jobs to start and validated finish', async (t) => {
  t.mock.method(performance, 'now', () => 100);
  const input: ModuleComputeInput = { module: 'ising', scene: { size: 16, temperatures: [2], seed: 7, hot: true, burnIn: 0, samples: 17 } };
  const resolved = createAgentSolverRegistry({ agentId: 'throttle-agent' }).resolve(createModuleJobSpec(input));
  assert.ok(resolved.ok);
  const ticks: number[] = [];
  await resolved.runner.run(createModuleJobSpec(input), p => { ticks.push(p.step); });
  assert.deepEqual(ticks, [0, 17]);
});

for (const family of [THERMAL_LAB_KIT, EM_FDTD_LAB_KIT, ACOUSTICS_LAB_KIT, MD_LAB_KIT, STRUCTURAL_LAB_KIT]) {
  for (const mode of family.modes) {
    test(`CPU module smoke: ${mode.kind} dispatches and settles a small fixture`, async () => {
      const registry = createAgentSolverRegistry({ agentId: 'cpu-smoke' });
      const spec = mode.defaultFixture();
      validateJobSpec(spec);
      const nativeOnly = mode.hostCapability.backends.length > 0 &&
        mode.hostCapability.backends.every(backend => backend === 'cuda' || backend === 'native-cuda');
      if (mode.hostCapability.stub === true || nativeOnly) {
        // Native-only and stub/shell modes have no CPU runner. Their honest
        // outcome is unavailable without a matching CUDA binary, or execution
        // by a CUDA backend when the binary declares the required capability.
        // stub/shell 模式按设计只存在于 w-sim-cuda 二进制（incompleteReason：
        // "must not fake one"）。诚实结局只有两种：无二进制时 resolve 失败或
        // 运行期 fail-closed；有二进制时只能以 cuda 系后端结算——出现 cpu
        // 结果即为伪造。
        const resolvedStub = registry.resolve(spec);
        if (!resolvedStub.ok) {
          assert.match(resolvedStub.message, /no runner|registered/i);
          return;
        }
        const { host: stubHost, completed: stubCompleted, failed: stubFailed } = createMemoryJobHost([{ jobId: mode.kind, spec }]);
        const status = await runClaimLoopOnce(stubHost, 'cpu-smoke', registry);
        if (status === 'completed') {
          assert.match(stubCompleted.get(mode.kind)?.backend?.id ?? '', /cuda/, 'stub modes must never settle on a cpu backend');
        } else {
          assert.equal(status, 'failed');
          assert.match(stubFailed.get(mode.kind) ?? '', /native-cuda|w-sim-cuda|cuda/i, 'stub failure must be an honest capability error');
        }
        return;
      }
      const resolved = registry.resolve(spec);
      assert.ok(resolved.ok, !resolved.ok ? resolved.message : '');
      assert.deepEqual(resolved.descriptor.precision, ['float64']);
      const canceled = AbortSignal.abort();
      await assert.rejects(resolved.runner.run(spec, undefined, canceled), { name: 'AbortError' });
      const { host, completed, failed } = createMemoryJobHost([{ jobId: mode.kind, spec }]);
      assert.equal(await runClaimLoopOnce(host, 'cpu-smoke', registry), 'completed', failed.get(mode.kind));
      assert.equal(failed.size, 0);
      const result = completed.get(mode.kind);
      assert.ok(result);
      validateJobResult(result);
      assert.match(result.backend?.id ?? '', /^cpu(?:-|$)/);
      assert.equal(result.backend?.agentId, 'cpu-smoke');
      assert.ok(Number.isFinite(result.summary.wallTimeMs));
      assert.ok(result.summary.steps > 0);
    });
  }
}

for (const [label, spec, check] of [
  ['bridge girder', buildContinuousBridgeGirderJobSpec(), (r: JobResultV1) => {
    const reactions = String(r.derived?.reactionCsv ?? '').split(',').map(Number);
    assert.ok(Math.abs(reactions[1]! - 109375) < 1, `abutment reaction ${reactions[1]}`);
    assert.ok(Math.abs(reactions[13]! - 481250) < 1, `pier reaction ${reactions[13]}`);
  }],
  ['LJ13 cluster', buildLjClusterJobSpec(), (r: JobResultV1) => {
    assert.ok(Math.abs(Number(r.summary.potential) + 41.3088) < 0.001, `potential ${r.summary.potential}`);
    assert.ok(Number(r.summary.netForceResidual) < 1e-8, `net force ${r.summary.netForceResidual}`);
  }],
  ['building envelope', buildBuildingEnvelopeJobSpec(), (r: JobResultV1) => {
    assert.ok(Math.abs(Number(r.summary.tMax) - 12.3104) < 0.01, `interior surface ${r.summary.tMax}`);
    assert.ok(Math.abs(Number(r.summary.tMin) - -7.4257) < 0.01, `exterior surface ${r.summary.tMin}`);
  }],
] as const) {
  test(`domain example e2e: ${label} resolves, claims, runs, and validates`, async () => {
    validateJobSpec(spec);
    const registry = createAgentSolverRegistry({ agentId: 'cpu-domain' });
    const resolved = registry.resolve(spec);
    assert.ok(resolved.ok, !resolved.ok ? resolved.message : '');
    const { host, completed, failed } = createMemoryJobHost([{ jobId: label, spec }]);
    assert.equal(await runClaimLoopOnce(host, 'cpu-domain', registry), 'completed', failed.get(label));
    const result = completed.get(label);
    assert.ok(result);
    validateJobResult(result);
    assert.equal(result.backend?.agentId, 'cpu-domain');
    check(result);
  });
}

function productPathSpec(): PathExperimentJobSpecLike {
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

test('createAgentSolverRegistry registers @w-sim/solvers-path-experiment', () => {
  const reg = createAgentSolverRegistry({ agentId: 'agent-reg' });
  assert.equal(isSolverRunnerRegistry(reg), true);
  const entry = reg.get(SOLVER_PACKAGE_META.id);
  assert.ok(entry);
  assert.equal(entry.packageName, '@w-sim/solvers-path-experiment');
  assert.deepEqual([...entry.kinds], [PATH_EXPERIMENT_KIND]);
  const intro = reg.introspect();
  assert.ok(intro.coveredBuiltinKinds.includes(PATH_EXPERIMENT_KIND));
});

test('registry dispatches package smoke path-experiment via runClaimLoopOnce', async () => {
  const smoke = buildSmokeJobSpec({ maxSteps: 5 }) as JobSpecV1;
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'pkg-path-1', spec: smoke },
  ]);
  const reg = createAgentSolverRegistry({ agentId: 'agent-pkg' });

  const status = await runClaimLoopOnce(host, 'agent-pkg', reg);
  assert.equal(status, 'completed');
  assert.equal(failed.size, 0);
  const result = completed.get('pkg-path-1');
  assert.ok(result);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.summary.steps, 5);
  assert.equal(result.backend?.agentId, 'agent-pkg');
  assert.ok(
    result.summary.solverPackage === '@w-sim/solvers-path-experiment' ||
      result.backend?.id === 'cpu',
  );
});

test('dual-path prefers product runner for photosensitization-rk4', async () => {
  const product = productPathSpec() as JobSpecV1;
  assert.equal(prefersProductPathRunner(product), true);
  assert.equal(prefersProductPathRunner(buildSmokeJobSpec()), false);

  const { host, completed } = createMemoryJobHost([
    { jobId: 'product-path-1', spec: product },
  ]);
  const reg = createAgentSolverRegistry({ agentId: 'agent-dual' });
  const status = await runClaimLoopOnce(host, 'agent-dual', reg);
  assert.equal(status, 'completed');
  const result = completed.get('product-path-1');
  assert.ok(result);
  assert.equal(result.backend?.id, 'cpu-path-experiment');
  assert.equal(result.backend?.agentId, 'agent-dual');
  assert.ok(
    result.experiment &&
      Number(
        (result.experiment as { outputs: Record<string, { value: number }> }).outputs
          .finalSingletO2.value,
      ) > 0,
  );
});

test('createPathExperimentRunner is dual-path (alias of package-preferred adapter)', async () => {
  const runner = createPathExperimentRunner({ agentId: 'alias' });
  const dual = createDualPathPathExperimentRunner({ agentId: 'alias' });
  const smoke = buildSmokeJobSpec({ maxSteps: 3 }) as JobSpecV1;
  assert.equal(runner.canRun(smoke), true);
  assert.equal(dual.canRun(smoke), true);
  const result = await runner.run(smoke);
  assert.equal(result.summary.steps, 3);
  assert.equal(result.backend?.agentId, 'alias');
});

/**
 * #7 / A-agent residual: multi-kind registry smoke.
 * createAgentSolverRegistry must advertise both path-experiment and lbm-d3q19,
 * dispatch path jobs, and fail unknown kinds without cross-claim.
 */
test('multi-kind registry smoke: path+lbm registered; path completes; unknown fails', async () => {
  const reg = createAgentSolverRegistry({ agentId: 'agent-multi' });
  assert.equal(isSolverRunnerRegistry(reg), true);

  const pathEntry = reg.get(SOLVER_PACKAGE_META.id);
  const lbmEntry = reg.get(LBM_SOLVER_PACKAGE_META.id);
  assert.ok(pathEntry);
  assert.ok(lbmEntry);
  assert.deepEqual([...pathEntry.kinds], [PATH_EXPERIMENT_KIND]);
  assert.deepEqual([...lbmEntry.kinds], ['lbm-d3q19']);

  const intro = reg.introspect();
  assert.ok(intro.coveredBuiltinKinds.includes(PATH_EXPERIMENT_KIND));
  assert.ok(intro.coveredBuiltinKinds.includes('lbm-d3q19'));

  const runners = reg.asJobRunners();
  assert.ok(runners.length >= 2);
  const lbmSpec: JobSpecV1 = {
    schemaVersion: 1,
    kind: 'lbm-d3q19',
    parameters: { inletVelocity: 1, gridPreset: 'fast' },
    run: { maxSteps: 5 },
    outputs: { forces: true },
  };
  assert.ok(runners.some((r) => r.canRun(lbmSpec)), 'lbm runner advertised via multi-kind registry');
  assert.ok(
    runners.some((r) => r.canRun(buildSmokeJobSpec({ maxSteps: 2 }) as JobSpecV1)),
    'path runner advertised via multi-kind registry',
  );

  const smoke = buildSmokeJobSpec({ maxSteps: 4 }) as JobSpecV1;
  const unknown: JobSpecV1 = {
    schemaVersion: 1,
    kind: 'export-report',
    parameters: {},
    run: { maxSteps: 1 },
    outputs: {},
  };
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'mk-path', spec: smoke },
    { jobId: 'mk-unknown', spec: unknown },
  ]);

  const s1 = await runClaimLoopOnce(host, 'agent-multi', reg);
  assert.equal(s1, 'completed');
  assert.ok(completed.get('mk-path'));
  assert.equal(completed.get('mk-path')?.summary.steps, 4);
  assert.equal(failed.size, 0);

  const s2 = await runClaimLoopOnce(host, 'agent-multi', reg);
  assert.equal(s2, 'failed');
  assert.match(failed.get('mk-unknown') ?? '', /no runner/i);
  assert.equal(completed.has('mk-unknown'), false);
});

/**
 * #7 / A-agent residual: multi-kind resolveJobRunner assertion (no live Host).
 * Registry must resolve path + lbm runners and refuse unknown kinds at the
 * resolve seam (stricter than canRun-only advertise checks).
 */
test('multi-kind residual: resolveJobRunner path+lbm ok; unknown not ok', () => {
  const reg = createAgentSolverRegistry({ agentId: 'agent-resolve' });
  const pathSpec = buildSmokeJobSpec({ maxSteps: 2 }) as JobSpecV1;
  const lbmSpec: JobSpecV1 = {
    schemaVersion: 1,
    kind: 'lbm-d3q19',
    parameters: { inletVelocity: 1, gridPreset: 'fast' },
    run: { maxSteps: 3 },
    outputs: { forces: true },
  };
  const unknown: JobSpecV1 = {
    schemaVersion: 1,
    kind: 'export-report',
    parameters: {},
    run: { maxSteps: 1 },
    outputs: {},
  };

  const pathResolved = resolveJobRunner(reg, pathSpec);
  assert.equal(pathResolved.ok, true);
  if (pathResolved.ok) {
    assert.equal(pathResolved.runner.canRun(pathSpec), true);
    assert.equal(pathResolved.runner.canRun(lbmSpec), false);
  }

  const lbmResolved = resolveJobRunner(reg, lbmSpec);
  assert.equal(lbmResolved.ok, true);
  if (lbmResolved.ok) {
    assert.equal(lbmResolved.runner.canRun(lbmSpec), true);
    assert.equal(lbmResolved.runner.canRun(pathSpec), false);
  }

  const unknownResolved = resolveJobRunner(reg, unknown);
  assert.equal(unknownResolved.ok, false);
  if (!unknownResolved.ok) {
    assert.match(unknownResolved.message, /no runner/i);
  }
});

/**
 * wave67 coverage audit guard: export-report is a builtin kind admitted by
 * Host (validateJobSpec) but intentionally unclaimed by this agent — the
 * engine-plane @w-sim/solvers-export-report package owns the runner and Host
 * settles externally-claimed report jobs. Keeps listAgentSolverKinds honest.
 */
test('export-report is host-admitted but intentionally unclaimed by the agent', () => {
  const spec: JobSpecV1 = {
    schemaVersion: 1,
    kind: 'export-report',
    name: 'audit-guard',
    parameters: {},
    run: { maxSteps: 1 },
    outputs: {},
  };
  validateJobSpec(spec);
  const reg = createAgentSolverRegistry({ agentId: 'agent-export-guard' });
  assert.equal(reg.resolve(spec).ok, false);
  assert.equal(
    listAgentSolverKinds({ agentId: 'agent-export-guard' }).includes('export-report'),
    false,
  );
});

/**
 * #7 / A-agent residual unit matrix after 788a583: prefersProductPathRunner
 * boolean table + dual-path canRun kinds. Does not close #7.
 */
test('unit residual post-788: prefersProductPathRunner matrix cells', () => {
  // Non path-experiment kinds never prefer product.
  const lbm: JobSpecV1 = {
    schemaVersion: 1,
    kind: 'lbm-d3q19',
    parameters: {},
    run: { maxSteps: 1 },
    outputs: { forces: true },
  };
  assert.equal(prefersProductPathRunner(lbm), false);

  // Path without model id/version → package preferred (false).
  const barePath: JobSpecV1 = {
    schemaVersion: 1,
    kind: 'path-experiment',
    parameters: {},
    run: { maxSteps: 1 },
    outputs: {},
  };
  assert.equal(prefersProductPathRunner(barePath), false);

  // Package smoke fixture → package preferred.
  assert.equal(prefersProductPathRunner(buildSmokeJobSpec({ maxSteps: 2 }) as JobSpecV1), false);

  // Built-in product photosensitization-rk4 → true.
  const product = productPathSpec() as JobSpecV1;
  assert.equal(prefersProductPathRunner(product), true);

  // Built-in product photosensitization-steady-state id → true even without registry hit.
  const steady: JobSpecV1 = {
    ...product,
    experiment: {
      ...product.experiment!,
      model: { id: 'photosensitization-steady-state', version: '1.0.0' },
    },
  };
  assert.equal(prefersProductPathRunner(steady), true);

  // Unknown model id/version → registry.resolve throws → false (package path).
  const unknownModel: JobSpecV1 = {
    ...product,
    experiment: {
      ...product.experiment!,
      model: { id: 'not-a-real-path-model', version: '0.0.0' },
    },
  };
  assert.equal(prefersProductPathRunner(unknownModel), false);
});

test('unit residual post-788: dual-path canRun both path-experiment kind aliases', () => {
  const dual = createDualPathPathExperimentRunner({ agentId: 'agent-can' });
  const smoke = buildSmokeJobSpec({ maxSteps: 2 }) as JobSpecV1;
  assert.equal(dual.canRun(smoke), true);
  assert.equal(dual.canRun({ ...smoke, kind: PATH_EXPERIMENT_KIND }), true);
  assert.equal(
    dual.canRun({
      schemaVersion: 1,
      kind: 'lbm-d3q19',
      parameters: {},
      run: { maxSteps: 1 },
      outputs: {},
    }),
    false,
  );
});

test('unit residual post-788: resolveJobRunner asJobRunners parity with registry', () => {
  const reg = createAgentSolverRegistry({ agentId: 'agent-parity' });
  const list = reg.asJobRunners();
  const pathSpec = buildSmokeJobSpec({ maxSteps: 2 }) as JobSpecV1;
  const lbmSpec: JobSpecV1 = {
    schemaVersion: 1,
    kind: 'lbm-d3q19',
    parameters: {},
    run: { maxSteps: 2 },
    outputs: { forces: true },
  };
  // List resolve and registry resolve must agree on canRun coverage.
  const fromList = resolveJobRunner(list, pathSpec);
  const fromReg = resolveJobRunner(reg, pathSpec);
  assert.equal(fromList.ok, true);
  assert.equal(fromReg.ok, true);
  const lbmList = resolveJobRunner(list, lbmSpec);
  const lbmReg = resolveJobRunner(reg, lbmSpec);
  assert.equal(lbmList.ok, true);
  assert.equal(lbmReg.ok, true);
  assert.equal(resolveJobRunner(list, {
    schemaVersion: 1,
    kind: 'export-report',
    parameters: {},
    run: { maxSteps: 1 },
    outputs: {},
  } as JobSpecV1).ok, false);
});

/**
 * #7 / A-agent residual unit matrix after e63a87c: descriptor meta + dual-path
 * package agentId stamp + prefersProduct custom registry. Does not close #7.
 */
test('unit residual post-e63: pathExperimentSolverDescriptor + lbmSolverDescriptor meta', async () => {
  const { pathExperimentSolverDescriptor, lbmSolverDescriptor } = await import('./runners.ts');
  const pathDesc = pathExperimentSolverDescriptor({ agentId: 'agent-desc' });
  assert.equal(pathDesc.id, SOLVER_PACKAGE_META.id);
  assert.deepEqual([...pathDesc.kinds], [PATH_EXPERIMENT_KIND]);
  assert.equal(pathDesc.packageName, '@w-sim/solvers-path-experiment');
  assert.ok(pathDesc.createRunner);
  const pathRunner = pathDesc.createRunner!();
  assert.equal(pathRunner.canRun(buildSmokeJobSpec({ maxSteps: 1 }) as JobSpecV1), true);

  const lbmDesc = lbmSolverDescriptor({ agentId: 'agent-desc' });
  assert.equal(lbmDesc.id, LBM_SOLVER_PACKAGE_META.id);
  assert.deepEqual([...lbmDesc.kinds], ['lbm-d3q19']);
  assert.equal(lbmDesc.packageName, '@w-sim/solvers-lbm');
  const lbmRunner = lbmDesc.createRunner!();
  assert.equal(
    lbmRunner.canRun({
      schemaVersion: 1,
      kind: 'lbm-d3q19',
      parameters: {},
      run: { maxSteps: 1 },
      outputs: {},
    }),
    true,
  );
  assert.equal(lbmRunner.canRun(buildSmokeJobSpec({ maxSteps: 1 }) as JobSpecV1), false);
});

test('unit residual post-e63: dual-path package run stamps agentId', async () => {
  const dual = createDualPathPathExperimentRunner({ agentId: 'agent-dual-stamp' });
  const smoke = buildSmokeJobSpec({ maxSteps: 2 }) as JobSpecV1;
  assert.equal(prefersProductPathRunner(smoke), false);
  const result = await dual.run(smoke);
  assert.equal(result.backend?.agentId, 'agent-dual-stamp');
  assert.equal(result.summary.steps, 2);
});

test('unit residual post-e63: prefersProductPathRunner custom registry resolve → true', () => {
  const custom = {
    resolve(id: string, version: string) {
      if (id === 'plugin-model' && version === '1.0.0') return { id, version };
      throw new Error(`unknown ${id}@${version}`);
    },
  };
  const product = productPathSpec() as JobSpecV1;
  const pluginSpec: JobSpecV1 = {
    ...product,
    experiment: {
      ...product.experiment!,
      model: { id: 'plugin-model', version: '1.0.0' },
    },
  };
  assert.equal(prefersProductPathRunner(pluginSpec, custom as never), true);
  // Same model without custom registry → default registry miss → false.
  assert.equal(prefersProductPathRunner(pluginSpec), false);
});

test('unit residual post-e63: registry introspect covers path + lbm builtins', () => {
  const reg = createAgentSolverRegistry({ agentId: 'agent-intro' });
  const intro = reg.introspect();
  assert.ok(intro.coveredBuiltinKinds.includes(PATH_EXPERIMENT_KIND));
  assert.ok(intro.coveredBuiltinKinds.includes('lbm-d3q19'));
  assert.ok(reg.get(LBM_SOLVER_PACKAGE_META.id));
  assert.ok(reg.get(SOLVER_PACKAGE_META.id));
});

/**
 * #7 / A-agent residual after registry-error-paths: listAgentSolverKinds stability
 * + LBM JobRunner signal-aware (run.length ≥ 3) pre-abort honesty.
 * Does not close #7 / #50 full product AC.
 */
test('residual post-registry-error: listAgentSolverKinds stable sorted multi-kind', (t) => {
  const previousCudaPath = process.env.W_SIM_CUDA_PATH;
  // The executable itself cannot be a directory: this path cannot probe a GPU.
  process.env.W_SIM_CUDA_PATH = `${process.execPath}/unavailable-cuda`;
  t.after(() => {
    if (previousCudaPath === undefined) delete process.env.W_SIM_CUDA_PATH;
    else process.env.W_SIM_CUDA_PATH = previousCudaPath;
  });
  const a = listAgentSolverKinds({ agentId: 'agent-kinds-a' });
  const b = listAgentSolverKinds({ agentId: 'agent-kinds-b' });
  // Stable across instances and agentIds (kinds are registry-owned, not per-agent).
  assert.deepEqual([...a], [...b]);
  // W-Sim v0.1.1 metadata advertises implemented CPU kinds; native-only kinds
  // require a successful feature probe and must not leak into this list.
  assert.deepEqual([...a], ['lbm-d3q19', 'mac-3d', PATH_EXPERIMENT_KIND, 'thermal-3d-steady', 'thermal-3d-convection', 'electro-thermal-igbt', 'em-fdtd-3d', 'fdtd-batch', 'acoustics-3d', 'md-batch', 'structural-static', MODULE_JOB_KIND].sort());
  // Sorted unique; no duplicates.
  assert.equal(new Set(a).size, a.length);
  assert.ok(a.includes(PATH_EXPERIMENT_KIND));
  assert.ok(a.includes('lbm-d3q19'));

  // Matches registry.list() kind set (honesty: helper does not invent kinds).
  const reg = createAgentSolverRegistry({ agentId: 'agent-kinds-list' });
  const fromList = new Set<string>();
  for (const d of reg.list()) {
    for (const k of d.kinds) fromList.add(k);
  }
  assert.deepEqual([...a], [...fromList].sort());
  // list() entry id order is stable (registration order: path then lbm).
  assert.deepEqual(
    reg.list().slice(0, 2).map((d) => d.id),
    [SOLVER_PACKAGE_META.id, 'solvers-lbm'],
  );
});

test('LBM smoke mode runs through @w-sim/solvers-lbm (compute owner)', async () => {
  const lbm = createLbmJobRunner({ agentId: 'agent-lbm-smoke' });
  const result = await lbm.run({
    schemaVersion: 1,
    kind: 'lbm-d3q19',
    parameters: { mode: 'd3q19-periodic', n: 6, tau: 0.8, steps: 12 },
    run: { maxSteps: 12 },
    outputs: { forces: false, history: false },
  });
  assert.equal(result.summary.solverPackage, '@w-sim/solvers-lbm');
  assert.equal(result.backend?.agentId, 'agent-lbm-smoke');
  assert.ok(Number(result.summary.steps) > 0);
});

test('residual post-registry-error: LBM JobRunner is interruptible; pre-abort refuses run', async () => {
  const lbm = createLbmJobRunner({ agentId: 'agent-lbm-sig' });
  // 3-arg run is required for guarded claim to pass AbortSignal.
  assert.ok(lbm.run.length >= 3, `expected interruptible LBM run, got length=${lbm.run.length}`);
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () =>
      lbm.run(
        {
          schemaVersion: 1,
          kind: 'lbm-d3q19',
          parameters: {},
          run: { maxSteps: 2 },
          outputs: { forces: true },
        },
        undefined,
        ac.signal,
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'AbortError');
      assert.match(err.message, /lbm job aborted/i);
      return true;
    },
  );
});


test('resident CPU agent uploads every real flow frame once and preserves step metadata', async () => {
  const spec = fanSpec(); spec.outputs.fieldFrames = 3;
  const snapshots: LbmDisplaySnapshot[] = [];
  const registry = createAgentSolverRegistry({ agentId: 'replay-cpu',
    loadArtifact: async () => encodeModelGeometry(fanGeometry),
    saveFlowSnapshot: async snapshot => {
      snapshots.push(snapshot);
      return { artifactId: `flow-${snapshot.step}`, kind: 'lbm-display', contentType: 'application/vnd.waveworld.lbm-display-v1',
        bytes: 32 + snapshot.flags.length * (snapshot.displayStride + 1) * 4 };
    },
  });
  const resolved = registry.resolve(spec); assert.ok(resolved.ok);
  const result = await resolved.runner.run(spec);
  assert.deepEqual(snapshots.map(snapshot => snapshot.step), [1, 2, 3]);
  assert.deepEqual(result.artifacts?.map(ref => ref.step), [1, 2, 3]);
  assert.equal(result.derived?.['lbm-field-history-v1'], 1);
  assert.notDeepEqual(snapshots[0].display, snapshots[2].display);
});

test('lbm descriptor declares cuda only when the probe actually succeeds', async (t) => {
  const { lbmSolverDescriptor } = await import('./runners.ts');
  const { invalidateNativeCudaProbeCache } = await import('./backends/native-cuda.ts');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w-sim-cuda-gate-'));
  const bin = path.join(dir, 'w-sim-cuda');
  const prev = process.env.W_SIM_CUDA_PATH;
  process.env.W_SIM_CUDA_PATH = bin;
  t.after(() => {
    if (prev === undefined) delete process.env.W_SIM_CUDA_PATH;
    else process.env.W_SIM_CUDA_PATH = prev;
    invalidateNativeCudaProbeCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  fs.writeFileSync(bin, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  invalidateNativeCudaProbeCache();
  const dead = lbmSolverDescriptor({ agentId: 'dead-probe' });
  assert.ok(!dead.backends.includes('cuda'), `probe-dead binary must not declare cuda: ${dead.backends}`);
  assert.ok(!dead.backends.includes('native-cuda'));

  fs.writeFileSync(bin, '#!/bin/sh\necho "w-sim-cuda 0.0.0 device: fake-gpu"\n', { mode: 0o755 });
  invalidateNativeCudaProbeCache();
  const live = lbmSolverDescriptor({ agentId: 'live-probe' });
  assert.ok(live.backends.includes('cuda'), `probe-ok binary must declare cuda: ${live.backends}`);
  assert.ok(live.backends.includes('native-cuda'));
});
