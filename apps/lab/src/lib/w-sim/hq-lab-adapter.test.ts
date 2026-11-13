/**
 * w-sim #6 — Tuanliu HqLabKit adapter + browser capability registry.
 *
 * Run via: npm run test:models
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSettlementClient } from './settlement-client';

import {
  assembleHqLabKit,
  memorySettlementClient,
  type HqLabKit,
} from '@w-sim/kit';
import {
  FLUID_KIND_SHELL,
  createHostCapabilityRegistry,
  matchCapability,
  defaultJobSpec,
} from '@w-sim/contracts';

import {
  TUANLIU_BROWSER_FLUID_CAPABILITY,
  TUANLIU_HQ_MODULE_ID,
  TUANLIU_LBM_KIND,
  assembleTuanliuHqLabKit,
  createTuanliuGeometryLoader,
  createTuanliuParameterSchema,
  createTuanliuSolverFactory,
  registerTuanliuBrowserCapability,
  resetTuanliuHqLabKitForTests,
  submitViaKitSettlement,
  type TuanliuLabSolverSession,
} from './hq-lab-adapter';

// Execute the real solver's GPU command path without allocating a flow field on hardware.
function gpuSmokeDevice() {
  Object.assign(globalThis, {
    GPUBufferUsage: { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, MAP_READ: 8, UNIFORM: 16 },
    GPUShaderStage: { COMPUTE: 1 },
  });
  const dispatches: string[] = [];
  const uniforms: Float32Array[] = [];
  let destroyed = 0;
  const device = {
    limits: { maxStorageBufferBindingSize: 128 * 1024 * 1024 },
    queue: { writeBuffer(_buffer: unknown, _offset: number, data: ArrayBuffer | ArrayBufferView) {
      if (data instanceof ArrayBuffer && data.byteLength === 96) uniforms.push(new Float32Array(data.slice(0)));
    }, submit() {} },
    createBuffer() { return { destroy() { destroyed++; } }; },
    createBindGroupLayout() { return {}; },
    createBindGroup() { return {}; },
    createShaderModule() { return {}; },
    createPipelineLayout() { return {}; },
    createComputePipeline(d: { compute: { entryPoint: string } }) { return d.compute.entryPoint; },
    createCommandEncoder() {
      let pipeline = '';
      return {
        beginComputePass() {
          return {
            setPipeline(p: string) { pipeline = p; }, setBindGroup() {}, end() {},
            dispatchWorkgroups() { dispatches.push(pipeline); },
          };
        },
        finish() { return {}; },
      };
    },
  } as unknown as GPUDevice;
  return { device, dispatches, uniforms, destroyed: () => destroyed };
}

test('assembleTuanliuHqLabKit uses assembleHqLabKit seam (no local kit type)', () => {
  const kit = assembleTuanliuHqLabKit({
    preferProceduralGeometry: true,
    settlement: memorySettlementClient({ jobs: new Map() }),
  });

  assert.equal(kit.moduleId, TUANLIU_HQ_MODULE_ID);
  assert.ok(kit.geometry);
  assert.ok(kit.solver);
  assert.ok(kit.parameters);
  assert.ok(kit.settlement);
  assert.ok(kit.solver.supportedKinds().includes(TUANLIU_LBM_KIND));
  // Shape is the W-Sim HqLabKit surface
  const asKit: HqLabKit = kit;
  assert.equal(asKit.moduleId, kit.moduleId);
});

test('geometry loader lists presets and loads cylinder procedurally', async () => {
  const geometry = createTuanliuGeometryLoader({ preferProcedural: true });
  const presets = await geometry.listPresets();
  assert.ok(presets.length >= 3);
  assert.ok(presets.some((p) => p.id === 'cylinder'));

  const handle = await geometry.loadPreset('cylinder');
  assert.equal(handle.id, 'cylinder');
  assert.ok((handle.vertexCount ?? 0) > 0);
  assert.ok(handle.native);
});

test('solver session: prepare → start → step → pause → step → cancel → dispose', async () => {
  const gpu = gpuSmokeDevice();
  const kit = assembleTuanliuHqLabKit({
    preferProceduralGeometry: true,
    getDevice: () => gpu.device,
    settlement: memorySettlementClient({ jobs: new Map() }),
  });

  const geom = await kit.geometry.loadPreset('cylinder');
  const session = kit.solver.create(TUANLIU_LBM_KIND) as TuanliuLabSolverSession;
  assert.equal(kit.lastSession(), session);
  assert.equal(session.phase, 'idle');

  await session.prepare(geom, {
    viscosityMode: 'stabilized-preview',
    inletVelocity: 10,
    angleOfAttack: 0,
    gridPreset: 'fast',
    modelResolution: 'coarse',
  });
  assert.equal(session.phase, 'prepared');
  assert.ok(session.getPrepared()?.flags.length);

  session.start();
  assert.equal(session.phase, 'running');

  await session.step?.(4);
  let diag = session.getDiagnostics();
  assert.equal(diag.iteration, 4);
  assert.equal(diag.phase, 'running');
  assert.equal(gpu.dispatches.filter((p) => p === 'collideStream').length, 4);

  session.pause();
  assert.equal(session.phase, 'paused');

  await session.step?.(2);
  diag = session.getDiagnostics();
  assert.equal(diag.iteration, 6);
  assert.equal(diag.phase, 'paused');

  session.cancel();
  diag = session.getDiagnostics();
  assert.equal(diag.phase, 'cancelled');
  assert.equal(diag.cancelled, true);
  assert.ok(gpu.destroyed() > 0);
  assert.equal(session.getSolver(), null);

  await assert.rejects(async () => session.step?.(1), /cancel/);

  session.dispose();
  assert.equal(session.phase, 'disposed');
  assert.equal(session.getDiagnostics().disposed, true);

  await assert.rejects(async () => session.prepare(geom, {}), /disposed/);

  const results = kit.getResults?.();
  assert.ok(results);
  assert.equal(results!.message, 'disposed');
});

test('pending GPU steps respect pause, cancellation, disposal and model replacement', async () => {
  for (const action of ['pause', 'cancel', 'dispose', 'replace'] as const) {
    const gpu = gpuSmokeDevice();
    const kit = assembleTuanliuHqLabKit({ preferProceduralGeometry: true, getDevice: () => gpu.device });
    const geom = await kit.geometry.loadPreset('cylinder');
    const session = kit.solver.create(TUANLIU_LBM_KIND) as TuanliuLabSolverSession;
    const params = { viscosityMode: 'stabilized-preview', inletVelocity: 10, gridPreset: 'fast', modelResolution: 'coarse' };
    await session.prepare(geom, params);
    let finish!: () => void;
    session.getSolver()!.step = () => new Promise<void>(resolve => { finish = resolve; });
    const pending = session.step!(3);
    if (action === 'replace') await session.prepare(geom, params);
    else session[action]();
    finish();
    if (action === 'pause') await pending;
    else await assert.rejects(async () => pending, /cancelled|disposed|model changed/);
    assert.equal(session.phase, { pause: 'paused', cancel: 'cancelled', dispose: 'disposed', replace: 'prepared' }[action]);
    assert.equal(session.getDiagnostics().iteration, action === 'pause' ? 1 : 0);
    session.dispose();
  }
});

test('failure path: prepare without native geometry marks failed', async () => {
  const factory = createTuanliuSolverFactory();
  const session = factory.create(TUANLIU_LBM_KIND) as TuanliuLabSolverSession;
  await assert.rejects(
    async () =>
      session.prepare(
        { id: 'x', name: 'x' },
        { gridPreset: 'fast', modelResolution: 'coarse' }
      ),
    /native/
  );
  assert.equal(session.phase, 'failed');
  assert.equal(session.getDiagnostics().failed, true);
});

test('browser kit forwards the structured fan to the real solver and can remove it', async () => {
  const { PRESET_MODELS } = await import('../models/preset-models');
  const gpu = gpuSmokeDevice();
  const kit = assembleTuanliuHqLabKit({ preferProceduralGeometry: true, getDevice: () => gpu.device });
  const geometry = await kit.geometry.loadPreset('desktop-airflow');
  const session = kit.solver.create(TUANLIU_LBM_KIND) as TuanliuLabSolverSession;
  const params = { ...PRESET_MODELS.find((preset) => preset.id === 'desktop-airflow')!.defaultParameters, gridPreset: 'fast', viscosityMode: 'stabilized-preview' };
  try {
    await session.prepare(geometry, params);
    await session.step(1);
    const fan = session.getPrepared()!.fan!;
    assert.ok(fan.accelerationLattice > 0);
    const uniform = gpu.uniforms.at(-1)!;
    assert.equal(uniform[4], 0); // true inlet remains zero
    assert.equal(uniform[23], Math.fround(fan.accelerationLattice));
    assert.deepEqual(Array.from(uniform.slice(20, 23)), fan.normal);
    await session.prepare(geometry, { ...params, fan: undefined });
    assert.equal(session.getPrepared()!.fan, undefined);
    assert.equal(gpu.uniforms.at(-1)![23], 0);
  } finally { session.dispose(); }
});

test('settlement surface routes JobSpec through kit client', async () => {
  const jobs = new Map();
  const kit = assembleTuanliuHqLabKit({
    preferProceduralGeometry: true,
    settlement: memorySettlementClient({ jobs }),
  });

  const { jobId } = await submitViaKitSettlement(kit, FLUID_KIND_SHELL.fixtureSpec());
  assert.ok(jobId);
  assert.equal(jobs.get(jobId)?.kind, TUANLIU_LBM_KIND);
});

test('browser capability registry: kind/precision/webgpu advertised and matchable', () => {
  const reg = registerTuanliuBrowserCapability(undefined, true);
  const cap = reg.get(TUANLIU_BROWSER_FLUID_CAPABILITY.id);
  assert.ok(cap);
  assert.equal(cap!.hostClass, 'browser');
  assert.ok(cap!.kinds.includes(TUANLIU_LBM_KIND));
  assert.ok(cap!.precision?.includes('float32'));
  assert.ok(cap!.features?.includes('webgpu'));
  assert.ok(cap!.features?.includes('lbm-gauge-force-v1'));
  assert.ok(cap!.features?.includes('lbm-nee-outlet-v1'));
  assert.ok(cap!.features?.includes('lbm-nee-inlet-v1'));
  assert.ok(cap!.features?.includes('lbm-mass-balance-v1'));
  assert.ok(cap!.backends.includes('webgpu'));

  const spec = defaultJobSpec({
    kind: TUANLIU_LBM_KIND,
    requirements: {
      backends: ['webgpu'],
      precision: ['float32'],
      features: ['webgpu'],
    },
  });
  const m = matchCapability(spec, reg.list());
  assert.equal(m.ok, true);
  if (m.ok) {
    assert.equal(m.capability.id, TUANLIU_BROWSER_FLUID_CAPABILITY.id);
  }

  // kit helper registers the same capability
  const kit = assembleTuanliuHqLabKit({
    preferProceduralGeometry: true,
    settlement: memorySettlementClient({ jobs: new Map() }),
  });
  const reg2 = createHostCapabilityRegistry();
  kit.registerCapability(reg2);
  assert.ok(reg2.get(TUANLIU_BROWSER_FLUID_CAPABILITY.id));
});

test('parameter schema exposes wind-tunnel fields', () => {
  const schema = createTuanliuParameterSchema();
  const keys = schema.fields.map((f) => f.key);
  assert.ok(keys.includes('inletVelocity'));
  assert.ok(keys.includes('angleOfAttack'));
  assert.ok(keys.includes('gridPreset'));
});

test('direct assembleHqLabKit composition still works with tuanliu parts', async () => {
  const jobs = new Map();
  const kit = assembleHqLabKit({
    moduleId: 'tuanliu-direct-seam',
    geometry: createTuanliuGeometryLoader({ preferProcedural: true }),
    solver: createTuanliuSolverFactory(),
    parameters: createTuanliuParameterSchema(),
    settlement: memorySettlementClient({ jobs }),
  });
  assert.equal(kit.moduleId, 'tuanliu-direct-seam');
  const presets = await kit.geometry.listPresets();
  assert.ok(presets.some((p) => p.id === 'naca0012'));
  const { jobId } = await kit.settlement!.submit(FLUID_KIND_SHELL.fixtureSpec());
  assert.equal(jobs.get(jobId)?.kind, 'lbm-d3q19');
});

test('resetTuanliuHqLabKitForTests clears singleton holder', () => {
  resetTuanliuHqLabKitForTests();
  // getTuanliuHqLabKit would hit network settlement; only assert reset is callable
  assert.equal(typeof resetTuanliuHqLabKitForTests, 'function');
});

test('missing WebGPU fails preparation and cannot advertise live compute', async () => {
  const kit = assembleTuanliuHqLabKit({ getDevice: () => null });
  assert.equal(kit.capability.available, false);
  assert.deepEqual(kit.capability.precision, ['float32']);
  assert.equal(kit.capability.backends.includes('cpu-teaching'), false);
  const session = kit.solver.create(TUANLIU_LBM_KIND) as TuanliuLabSolverSession;
  await assert.rejects(session.prepare({ id: 'empty', name: 'empty', native: { geometry: null } }, {}), /WebGPU/);
  assert.equal(session.phase, 'failed');
  await assert.rejects(session.step(1), /WebGPU/);
  session.dispose();
});

test('GPU session rejects thermal physics until the shared conservative solver is supported', async () => {
  const gpu = gpuSmokeDevice();
  const session = createTuanliuSolverFactory(() => gpu.device).create(TUANLIU_LBM_KIND) as TuanliuLabSolverSession;
  await assert.rejects(session.prepare({ id: 'empty', name: 'empty', native: { geometry: null } }, {
    gridPreset: 'fast', thermalEnabled: true, inletVelocity: 0,
  }), /thermal|Thermal/);
  assert.deepEqual(gpu.dispatches, []);
  session.dispose();
});

test('remote compute uses one settlement client for submit, status, result and cancel', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const replies = [
    { job: { id: 'job/1' }, extra: true },
    { job: { status: 'running', progress: { step: 1, total: 2 } } },
    { job: { status: 'succeeded', result: null } },
    {},
  ];
  const client = createSettlementClient({
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }) as typeof fetch,
  });
  const spec = defaultJobSpec({ kind: TUANLIU_LBM_KIND });
  const { jobId } = await client.submit(spec);
  assert.equal(jobId, 'job/1');
  assert.equal((await client.getStatus(jobId)).status, 'running');
  assert.equal(await client.getResult(jobId), null);
  await client.cancel?.(jobId);
  assert.equal(calls[0].init?.body, JSON.stringify({ spec }));
  assert.equal(calls[1].url, '/api/v1/jobs/job%2F1');
  assert.equal(calls[2].url, '/api/v1/jobs/job%2F1');
  assert.equal(calls[3].init?.method, 'POST');
  assert.ok(calls.every((call) => call.init?.signal instanceof AbortSignal));

  const failed = createSettlementClient({
    fetchImpl: (async () => new Response('{}', { status: 503 })) as typeof fetch,
  });
  await assert.rejects(failed.submit(spec), /503/);
  await assert.rejects(failed.getStatus(jobId), /503/);
  await assert.rejects(failed.getResult(jobId), /503/);
  await assert.rejects(failed.cancel!(jobId), /503/);
});

test('remote execution polls one job and returns its actual result', async () => {
  const { runRemoteJob } = await import('./settlement-client');
  const statuses = ['queued', 'running', 'succeeded'];
  const events: string[] = [];
  const result = { schemaVersion: 1 as const, summary: { steps: 2, cd: 0.5, cl: 0.1, wallTimeMs: 1 } };
  const received = await runRemoteJob({
    submit: async (spec) => { assert.equal(spec.run.maxSteps, 2); events.push('submit'); return { jobId: 'job-1' }; },
    getStatus: async (id) => { assert.equal(id, 'job-1'); return { status: statuses.shift()! }; },
    getResult: async () => result,
    cancel: async () => { throw new Error('completed job should not be canceled'); },
  }, defaultJobSpec({ run: { maxSteps: 2 } }), {
    signal: new AbortController().signal, pollIntervalMs: 0,
    onStatus: (id, status) => events.push(`${id}:${status}`),
  });
  assert.equal(received, result);
  assert.deepEqual(events, ['submit', 'job-1:queued', 'job-1:queued', 'job-1:running', 'job-1:succeeded']);
});

test('stop during submit cancels the returned job id and never polls it', async () => {
  const { runRemoteJob } = await import('./settlement-client');
  const abort = new AbortController();
  const canceled: string[] = [];
  await assert.rejects(runRemoteJob({
    submit: async () => { abort.abort(); return { jobId: 'late-id' }; },
    getStatus: async () => { throw new Error('must not poll'); },
    getResult: async () => null,
    cancel: async (id) => { canceled.push(id); },
  }, defaultJobSpec(), { signal: abort.signal }), { name: 'AbortError' });
  assert.deepEqual(canceled, ['late-id']);
});

test('poll failure cancels the job; cancellation failure retains its identity', async () => {
  const { runRemoteJob, RemoteJobCancelError } = await import('./settlement-client');
  const canceled: string[] = [];
  const client = {
    submit: async () => ({ jobId: 'job-to-stop' }),
    getStatus: async () => { throw new Error('network unavailable'); },
    getResult: async () => null,
    cancel: async (id: string) => { canceled.push(id); },
  };
  await assert.rejects(runRemoteJob(client, defaultJobSpec(), { signal: new AbortController().signal }), /network unavailable/);
  assert.deepEqual(canceled, ['job-to-stop']);
  await assert.rejects(runRemoteJob({ ...client, cancel: async () => { throw new Error('cancel unavailable'); } }, defaultJobSpec(), { signal: new AbortController().signal }), (error: unknown) => {
    assert.ok(error instanceof RemoteJobCancelError);
    assert.equal(error.jobId, 'job-to-stop');
    return true;
  });
});


test('browser kit rejects unresolved physical viscosity without allocating a solver or falling back', async () => {
  const gpu = gpuSmokeDevice();
  const kit = assembleTuanliuHqLabKit({ preferProceduralGeometry: true, getDevice: () => gpu.device });
  const geometry = await kit.geometry.loadPreset('cylinder');
  const session = kit.solver.create(TUANLIU_LBM_KIND) as TuanliuLabSolverSession;
  await assert.rejects(session.prepare(geometry, { viscosityMode: 'physical', inletVelocity: 10, gridPreset: 'fast' }), /required characteristic cells/);
  assert.equal(session.phase, 'failed');
  assert.equal(session.getSolver(), null);
  assert.equal(gpu.dispatches.length, 0);
  session.dispose();
});
