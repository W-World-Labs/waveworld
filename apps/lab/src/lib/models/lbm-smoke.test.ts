import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { readFile } from 'node:fs/promises';
import { prepareProductLbmLattice } from '@w-sim/solvers-lbm/d3q19';
import type { WindTunnelParameters } from '@/types/simulation';
import { lbmGeometry } from '../../../../../scripts/ci/lbm-fixture';

// Store lifecycle smoke runs in Node, without browser storage or a GPU.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
Object.defineProperty(globalThis, 'window', {
  configurable: true, value: { localStorage: globalThis.localStorage },
});
let useSimulationStore: typeof import('../stores/simulation-store')['useSimulationStore'];
let createLbmJobSpec: typeof import('./sim-session')['createLbmJobSpec'];
let LBM_FORCE_SAMPLE_EVERY: number;
let parameters: WindTunnelParameters;
before(async () => {
  ({ createLbmJobSpec, LBM_FORCE_SAMPLE_EVERY } = await import('./sim-session'));
  ({ useSimulationStore } = await import('../stores/simulation-store'));
  // Explicit tiny step budgets belong to smoke fixtures, never product presets.
  parameters = { ...useSimulationStore.getState().parameters, durationSeconds: undefined, gridPreset: 'fast' };
});

test('file-only presets report the original load error instead of generating a different vehicle', async () => {
  const { PRESET_MODELS, loadPresetModel, generatePresetModel } = await import('./preset-models');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 404 });
  try {
    for (const id of ['bicycle', 'toy-car', 'milk-truck', 'duck', 'rocket', 'ares-rocket', 'space-shuttle', 'airplane-x57']) {
      assert.throws(() => generatePresetModel(id), /仅支持原始文件/);
      await assert.rejects(loadPresetModel(PRESET_MODELS.find(p => p.id === id)!), /无法加载原始模型.*HTTP 404/);
    }
    const cube = await loadPresetModel(PRESET_MODELS.find(p => p.id === 'cube')!);
    assert.equal(cube.metadata.id, 'cube');
    assert.equal(cube.fromFile, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('the shipped building fits its preset, while oversized and degenerate placements fail without rewriting geometry', async () => {
  const { PRESET_MODELS, loadPresetModel, generatePresetModel } = await import('./preset-models');
  const { resetModelsManifestCacheForTests } = await import('./models-manifest');
  const { createLbmPreviewPlacement } = await import('./sim-session');
  const { createWindTunnelModel } = await import('../stores/project-store');
  const fetchBefore = globalThis.fetch;
  resetModelsManifestCacheForTests();
  globalThis.fetch = async (input) => {
    const file = String(input).split('/').at(-1);
    assert.ok(file === 'building.stl' || file === 'manifest.json');
    return new Response(await readFile(new URL(`../../../public/models/${file}`, import.meta.url)));
  };
  try {
    const preset = PRESET_MODELS.find(p => p.id === 'building')!;
    const loaded = await loadPresetModel(preset);
    assert.equal(loaded.fromFile, true);
    assert.equal(loaded.warning, undefined);
    const model = createWindTunnelModel(loaded.metadata), original = loaded.geometry.vertices.slice();
    const inputs = { ...parameters, ...preset.defaultParameters, ground: undefined };
    assert.throws(() => createLbmPreviewPlacement({ ...inputs, modelResolution: 'standard' }, model, loaded.geometry), /模型占域比例.*outside the simulation domain/);
    const fit = createLbmPreviewPlacement(inputs, model, loaded.geometry);
    assert.equal(inputs.modelResolution, 'coarse');
    assert.equal(fit.referenceLength, 0.8);
    assert.ok(fit.transform.bounds.min.every(v => v >= 0));
    assert.ok(fit.transform.bounds.max.every((v, i) => v <= [fit.grid.nx, fit.grid.ny, fit.grid.nz][i]));
    assert.deepEqual(loaded.geometry.vertices, original);
    const cube = generatePresetModel('cube');
    for (const axis of [1, 2]) {
      const vertices = cube.geometry.vertices.slice();
      for (let i = axis; i < vertices.length; i += 3) vertices[i] *= 10;
      assert.throws(() => createLbmPreviewPlacement(inputs, createWindTunnelModel(cube.metadata), { ...cube.geometry, vertices }), /模型占域比例.*outside the simulation domain/);
    }
    assert.throws(() => createLbmPreviewPlacement(inputs, model, { ...loaded.geometry, vertices: new Float32Array() }), /无法放置模型/);
  } finally { globalThis.fetch = fetchBefore; resetModelsManifestCacheForTests(); }
});

test('realtime and batch prepare the same lattice from the same physical parameters', () => {
  const inputs = { ...parameters, fluidViscosity: 3.62e-5, modelResolution: 'coarse' as const };
  const realtime = createLbmJobSpec(inputs);
  const batch = createLbmJobSpec(inputs, { source: 'preset', presetId: 'cylinder' }, 25);
  assert.deepEqual(realtime.parameters, batch.parameters);
  assert.equal(batch.run.maxSteps, 25);
  assert.equal(batch.run.forceSampleEvery, LBM_FORCE_SAMPLE_EVERY);
  assert.equal(batch.requirements?.precision, 'mixed');
  assert.deepEqual(batch.requirements?.backends, ['cpu']);
  const gpu = createLbmJobSpec(inputs, batch.model, 25, 'webgpu');
  assert.deepEqual(gpu.parameters, batch.parameters);
  assert.deepEqual(gpu.run, batch.run);
  assert.deepEqual(gpu.requirements?.backends, ['webgpu']);
  assert.equal(gpu.requirements?.precision, 'float32');
  assert.equal('renderQuality' in batch.parameters, false);

  // Empty-domain preparation exercises the real shared function without a long solve.
  const prepared = prepareProductLbmLattice(realtime, null);
  const other = prepareProductLbmLattice(batch, null);
  assert.deepEqual(prepared.units, other.units);
  assert.equal(prepared.flags.length, prepared.units.cellCount);
  assert.ok(Number.isFinite(prepared.units.dt) && prepared.units.dt > 0);
  const defaultViscosity = prepareProductLbmLattice(createLbmJobSpec(parameters), null);
  assert.ok(prepared.units.reynoldsPhysical < defaultViscosity.units.reynoldsPhysical);
});

test('thermal preparation returns a usable shared configuration', () => {
  const prepared = prepareProductLbmLattice(createLbmJobSpec({
    ...parameters, thermalEnabled: true, inletVelocity: 0,
  }, { source: 'preset', presetId: 'cube', referenceLength: 0.01 }), lbmGeometry);
  assert.ok(prepared.thermal);
  assert.ok(Number.isFinite(prepared.units.dt) && prepared.units.dt > 0);
  assert.ok(prepared.tau >= 0.505);
});

test('the heated block preset carries its real scale and power through the common job factory', async () => {
  const { PRESET_MODELS, loadPresetModel } = await import('./preset-models');
  const { createActiveLbmJobSpec } = await import('./sim-session');
  const { createWindTunnelModel } = await import('../stores/project-store');
  const preset = PRESET_MODELS.find((p) => p.id === 'heated-block')!;
  const model = await loadPresetModel(preset);
  const spec = createActiveLbmJobSpec({ ...parameters, ...preset.defaultParameters }, createWindTunnelModel(model.metadata));
  const prepared = prepareProductLbmLattice(spec, model.geometry);
  assert.equal(spec.model?.referenceLength, 0.01);
  assert.equal(preset.defaultParameters.maxIterations, undefined);
  assert.equal(prepared.thermal!.thermal.mode, 'solid-power');
  assert.equal(prepared.thermal!.thermal.totalPowerW, 10);
  assert.equal(prepared.units.dt, 0.0001);
  assert.ok(prepared.tau >= 0.505 && prepared.flags.includes(4));
});

test('the shipped heatsink prepares physical thermal input for browser and native execution', async () => {
  const { PRESET_MODELS } = await import('./preset-models');
  const { parseModelFile } = await import('./parser');
  const { createActiveLbmJobSpec } = await import('./sim-session');
  const { createWindTunnelModel } = await import('../stores/project-store');
  const { prepareLbmInput } = await import('../../../../../src/lib/sim/lbm-compute');
  const preset = PRESET_MODELS.find((p) => p.id === 'heatsink')!;
  const bytes = await readFile(new URL('../../../public/models/heatsink.stl', import.meta.url));
  const loaded = await parseModelFile(new File([bytes], 'heatsink.stl'));
  const model = createWindTunnelModel({ ...loaded.metadata, id: preset.id });
  const spec = createActiveLbmJobSpec({ ...parameters, ...preset.defaultParameters }, model);
  const browser = prepareProductLbmLattice(spec, loaded.geometry);
  const native = prepareLbmInput(JSON.parse(JSON.stringify(spec)), loaded.geometry);
  assert.equal(spec.run.maxSteps, parameters.maxIterations);
  assert.equal(preset.defaultParameters.maxIterations, undefined);
  assert.equal(spec.parameters.dtSeconds, undefined);
  assert.equal(browser.thermal!.thermal.mode, 'fixed-temperature');
  assert.equal(browser.thermal!.thermal.fixedSurfaceC, 60);
  assert.equal(browser.thermal!.ambientC, 25);
  assert.equal(browser.units.viscosityMode, 'physical');
  assert.ok(Math.abs(browser.units.simulatedViscosityM2s - parameters.fluidViscosity / parameters.fluidDensity) < 1e-18);
  assert.ok(browser.tau >= 0.505 && browser.units.uLattice < 0.2 && browser.solidCells > 0);
  assert.deepEqual(native.lbm.units, browser.units);
  assert.equal(native.lbm.thermal!.dtSeconds, browser.units.dt);
  assert.deepEqual(native.flags, browser.flags);
  // A requested physical duration changes the step budget, never density, viscosity or dt.
  assert.equal(useSimulationStore.getState().parameters.durationSeconds, 10);
  const timed = createActiveLbmJobSpec({ ...parameters, ...preset.defaultParameters, maxIterations: 20,
    durationSeconds: useSimulationStore.getState().parameters.durationSeconds }, model);
  assert.equal(timed.run.maxSteps, Math.ceil(10 / browser.units.dt));
  assert.equal(timed.run.maxSteps, 11208);
  assert.ok(timed.run.maxSteps * browser.units.dt >= 10 && (timed.run.maxSteps - 1) * browser.units.dt < 10);
  assert.deepEqual(timed.parameters, spec.parameters);
  assert.equal(timed.outputs.fieldFrames, 300);
  assert.deepEqual(timed.requirements?.features, ['lbm-gauge-force-v1', 'lbm-nee-outlet-v1', 'lbm-nee-inlet-v1', 'lbm-mass-balance-v1', 'lbm-pressure-field-v1', 'lbm-field-history-v1']);
  for (const durationSeconds of [0, -1, NaN, Infinity, 1e12]) {
    assert.throws(() => createActiveLbmJobSpec({ ...parameters, ...preset.defaultParameters, durationSeconds }, model), /时长/);
  }
});

test('workbench duration and playback clocks stay distinct on stored results', async () => {
  const { assertWorkbenchDurationSeconds, describeRunTimes, labExecutionHeadline } = await import('./run-times');
  assert.throws(() => assertWorkbenchDurationSeconds(9), /工作台仿真物理时长至少为 10 秒/);
  assert.equal(assertWorkbenchDurationSeconds(useSimulationStore.getState().parameters.durationSeconds ?? 10), 10);
  const previous = useSimulationStore.getState();
  try {
    useSimulationStore.getState().applyJobResult({
      schemaVersion: 1, summary: { steps: 20, wallTimeMs: 1, dragN: 1, liftN: 2 }, derived: { dt: 0.0008922597979972401 },
    });
    const store = useSimulationStore.getState();
    const times = describeRunTimes({
      dt: store.derived!.dt,
      targetSeconds: store.parameters.durationSeconds ?? 10,
      frameStep: 3,
      completedSteps: store.state.currentIteration,
      requestedSteps: 11208,
      status: 'idle',
    });
    assert.equal(store.state.currentTime, 20 * store.derived!.dt);
    assert.notEqual(times.framePhysicalSeconds, times.completedPhysicalSeconds);
    assert.equal(times.framePhysicalSeconds, 3 * store.derived!.dt);
    assert.equal(times.completedPhysicalSeconds, store.state.currentTime);
    assert.equal(times.markedComplete, false);
    assert.equal(times.shortResult, true);
    assert.match(labExecutionHeadline('idle', times), /已恢复短结果/);
  } finally { useSimulationStore.setState(previous); }
});

test('legacy short run preferences migrate to ten physical seconds without shortening longer targets', async () => {
  const previous = useSimulationStore.getState();
  try {
    for (const durationSeconds of [undefined, 0.001, 25]) {
      storage.set('wind-tunnel-simulation', JSON.stringify({ version: 2,
        state: { parameters: { ...previous.parameters, maxIterations: 20, durationSeconds } } }));
      await useSimulationStore.persist.rehydrate();
      assert.equal(useSimulationStore.getState().parameters.durationSeconds, durationSeconds === 25 ? 25 : 10);
    }
  } finally { useSimulationStore.setState(previous); }
});

test('desktop and laptop presets prepare the same fan and open air channel after mesh transport', async () => {
  const { PRESET_MODELS, loadPresetModel } = await import('./preset-models');
  const { encodeModelGeometry, decodeModelGeometry } = await import('./geometry-contract');
  const { createActiveLbmJobSpec } = await import('./sim-session');
  const { createWindTunnelModel } = await import('../stores/project-store');
  for (const id of ['desktop-airflow', 'laptop-airflow']) {
    const preset = PRESET_MODELS.find((item) => item.id === id)!;
    const loaded = await loadPresetModel(preset);
    assert.equal(loaded.fromFile, false);
    const inputs = { ...parameters, ...preset.defaultParameters };
    const spec = createActiveLbmJobSpec(inputs, createWindTunnelModel(loaded.metadata));
    assert.deepEqual(spec.requirements?.backends, ['cpu']);
    assert.equal(spec.requirements?.precision, 'mixed');
    const local = prepareProductLbmLattice(spec, loaded.geometry);
    const remote = prepareProductLbmLattice(
      JSON.parse(JSON.stringify(spec)), decodeModelGeometry(encodeModelGeometry(loaded.geometry)),
    );
    assert.deepEqual(remote.fan, local.fan);
    assert.deepEqual(remote.units, local.units);
    assert.deepEqual(remote.flags, local.flags);
    assert.equal(local.uInlet, 0);
    assert.ok(local.solidCells > 0);
    assert.ok(local.fan && local.fan.accelerationLattice > 0);
    // The fan center and its immediate downstream path must be air, not a sealed box.
    const [x, y, z] = local.fan.center.map(Math.round);
    for (let dx = 0; dx < 3; dx++) assert.equal(local.flags[x + dx + local.nx * (y + local.ny * z)], 0, id);
    const noFan = createLbmJobSpec({ ...inputs, fan: null });
    assert.equal('fan' in noFan.parameters, false);
  }
});

test('server structure keeps resolved through-flow and fin gaps in the file, fallback and transported mesh', async () => {
  const { PRESET_MODELS, loadPresetModel, generatePresetModel } = await import('./preset-models');
  const { resetModelsManifestCacheForTests } = await import('./models-manifest');
  const { encodeModelGeometry, decodeModelGeometry, inspectGeometryTopology } = await import('./geometry-contract');
  const { createActiveLbmJobSpec, createLbmPreviewPlacement } = await import('./sim-session');
  const { createWindTunnelModel } = await import('../stores/project-store');
  const { prepareLbmInput, runLbmWasm } = await import('../../../../../src/lib/sim/lbm-compute');
  const originalFetch = globalThis.fetch;
  resetModelsManifestCacheForTests();
  globalThis.fetch = async (input) => {
    const file = String(input).split('/').at(-1);
    assert.ok(file === 'server-chassis.stl' || file === 'manifest.json');
    return new Response(await readFile(new URL(`../../../public/models/${file}`, import.meta.url)));
  };
  try {
    const preset = PRESET_MODELS.find(item => item.id === 'server-chassis')!;
    const loaded = await loadPresetModel(preset), fallback = generatePresetModel(preset.id);
    assert.equal(loaded.fromFile, true);
    assert.equal(loaded.warning, undefined);
    assert.deepEqual(loaded.geometry.solidTriangleCounts, fallback.geometry.solidTriangleCounts);
    assert.equal(loaded.geometry.solidTriangleCounts!.length, 20);
    let offset = 0;
    for (const count of loaded.geometry.solidTriangleCounts!) {
      const solid = { ...loaded.geometry, indices: loaded.geometry.indices.slice(offset, offset + count * 3), solidTriangleCounts: undefined };
      assert.equal(inspectGeometryTopology(solid).isWatertight, true);
      offset += count * 3;
    }
    const inputs = { ...parameters, ...preset.defaultParameters, ground: undefined, maxIterations: 3 };
    const model = createWindTunnelModel(loaded.metadata), spec = createActiveLbmJobSpec(inputs, model);
    assert.equal(spec.parameters.thermalEnabled, false);
    assert.equal(spec.parameters.inletVelocity, 1);
    assert.equal(spec.parameters.viscosityMode, 'stabilized-preview');
    assert.equal(spec.parameters.fan, undefined);
    const prepared = prepareProductLbmLattice(spec, loaded.geometry);
    for (const geometry of [fallback.geometry, decodeModelGeometry(encodeModelGeometry(loaded.geometry))]) {
      assert.deepEqual(prepareProductLbmLattice(spec, geometry).flags, prepared.flags);
    }
    const { transform } = createLbmPreviewPlacement(inputs, model, loaded.geometry);
    const occupied = (x: number, y: number, z: number) => prepared.flags[x + prepared.nx * (y + prepared.ny * z)];
    // A complete center passage must remain open through both ends, not only beside the chassis.
    const start = transform.point([-0.23, 0.057, 0]).map(Math.floor);
    const end = transform.point([0.23, 0.057, 0]).map(Math.floor);
    for (let x = start[0]; x <= end[0]; x++) assert.equal(occupied(x, start[1], start[2]), 0, `center passage x=${x}`);
    // Each 24 mm fin gap retains at least two adjacent air cells at this actual fast grid placement.
    for (const centerZ of [-0.09, 0.09]) {
      for (const gapOffset of [-0.018, 0.018]) {
        const point = transform.point([0.04, 0.057, centerZ + gapOffset]);
        const z0 = transform.point([0.04, 0.057, centerZ + gapOffset - 0.012])[2];
        const z1 = transform.point([0.04, 0.057, centerZ + gapOffset + 0.012])[2];
        let clearCells = 0;
        for (let z = Math.ceil(z0 - 0.5); z + 0.5 < z1; z++) {
          assert.equal(occupied(Math.floor(point[0]), Math.floor(point[1]), z), 0, `fin gap z=${z}`);
          clearCells++;
        }
        assert.ok(clearCells >= 2, `fin gap only resolves ${clearCells} cells`);
      }
    }
    for (const point of [[0.04, 0.018, 0], [0.04, 0.03, -0.09], [0.04, 0.057, 0.09], [0.03, 0.036, -0.165], [0.17, 0.037, 0.14]]) {
      const [x, y, z] = transform.point(point).map(Math.floor);
      assert.ok(occupied(x, y, z), `component vanished at ${point}`);
    }
    const result = await runLbmWasm(spec, prepareLbmInput(spec, loaded.geometry));
    assert.equal(result.result.summary.steps, 3);
    assert.ok(result.snapshot!.display.every(Number.isFinite));
    assert.equal(result.result.thermal, undefined);
  } finally { globalThis.fetch = originalFetch; resetModelsManifestCacheForTests(); }
});

test('server thermal preset binds powered regions to real components and conserves energy', async () => {
  const { PRESET_MODELS, loadPresetModel } = await import('./preset-models');
  const { encodeModelGeometry, decodeModelGeometry } = await import('./geometry-contract');
  const { createActiveLbmJobSpec } = await import('./sim-session');
  const { createWindTunnelModel } = await import('../stores/project-store');
  const { prepareLbmInput, runLbmWasm } = await import('../../../../../src/lib/sim/lbm-compute');
  const { validateLbmThermalRegions, validateLbmThermalContacts } = await import('@w-sim/contracts');
  const preset = PRESET_MODELS.find(item => item.id === 'server-thermal')!;
  const loaded = await loadPresetModel(preset);
  // Procedural path only: the same 20-group chassis mesh as server-chassis.stl.
  assert.equal(loaded.fromFile, false);
  assert.equal(loaded.geometry.solidTriangleCounts!.length, 20);
  const inputs = { ...parameters, ...preset.defaultParameters, ground: undefined, maxIterations: 3 };
  const spec = createActiveLbmJobSpec(inputs, createWindTunnelModel(loaded.metadata));
  assert.equal(spec.model?.source, 'preset');
  assert.equal(spec.model?.presetId, 'server-thermal');
  const p = spec.parameters;
  assert.equal(p.thermalEnabled, true);
  assert.equal(p.thermalMode, 'solid-power');
  assert.equal(p.viscosityMode, 'physical');
  assert.equal(p.inletVelocity, 0);
  assert.equal(spec.requirements?.thermal, true);
  assert.ok(spec.outputs.fields!.includes('temperature'));
  const regions = p.thermalRegions!;
  assert.equal(regions.length, 7);
  assert.ok(validateLbmThermalRegions(regions).ok);
  assert.ok(validateLbmThermalContacts(p.thermalContacts ?? [], regions.length).ok);
  assert.ok(regions.some(region => region.totalPowerW > 0) && p.totalPowerW === 0);
  const prepared = prepareProductLbmLattice(spec, loaded.geometry);
  assert.ok(prepared.tau >= 0.505);
  assert.ok(prepared.units.uLattice < 0.2);
  assert.ok(prepared.fan && prepared.fan.accelerationLattice > 0);
  assert.equal(prepared.thermal!.thermal.materials!.length, regions.length);
  assert.equal(prepared.thermal!.thermal.contacts!.length, 2);
  // Default chassis material (flag 4) plus one flag per region (5..11) all resolve cells.
  for (let flag = 4; flag <= 4 + regions.length; flag++) {
    assert.ok(prepared.flags.includes(flag), `material flag ${flag} resolved no cells`);
  }
  // The transported mesh keeps the identical lattice/region assignment.
  assert.deepEqual(
    prepareProductLbmLattice(JSON.parse(JSON.stringify(spec)), decodeModelGeometry(encodeModelGeometry(loaded.geometry))).flags,
    prepared.flags,
  );
  const result = await runLbmWasm(spec, prepareLbmInput(spec, loaded.geometry));
  const thermal = result.result.thermal!;
  assert.equal(thermal.mode, 'solid-power');
  // 176 W region power over 3 steps must match the energy ledger exactly.
  const expectedSourceJ = 176 * prepared.units.dt * result.result.summary.steps;
  assert.ok(Math.abs(thermal.sourceEnergyJ - expectedSourceJ) <= expectedSourceJ * 1e-9, `sourceEnergyJ ${thermal.sourceEnergyJ} != ${expectedSourceJ}`);
  assert.ok(Math.abs(thermal.energyResidualJ) <= 1e-9 * thermal.sourceEnergyJ);
  assert.ok(Number.isFinite(thermal.solidMaxC) && thermal.solidMaxC >= 25);
  assert.ok(result.snapshot!.display.every(Number.isFinite));
});

test('device cooling presets bind powered regions, resolve fans and conserve energy', async () => {
  const { PRESET_MODELS, loadPresetModel } = await import('./preset-models');
  const { createActiveLbmJobSpec } = await import('./sim-session');
  const { createWindTunnelModel } = await import('../stores/project-store');
  const { prepareLbmInput, runLbmWasm } = await import('../../../../../src/lib/sim/lbm-compute');
  const { validateLbmThermalRegions } = await import('@w-sim/contracts');
  const expected: Record<string, { power: number; fan: boolean; regions: number }> = {
    'desktop-thermal': { power: 300, fan: true, regions: 3 },
    'laptop-thermal': { power: 17, fan: true, regions: 2 },
    'phone-thermal': { power: 6, fan: false, regions: 2 },
    'tablet-thermal': { power: 10, fan: false, regions: 2 },
  };
  for (const [id, want] of Object.entries(expected)) {
    const preset = PRESET_MODELS.find((item) => item.id === id)!;
    const loaded = await loadPresetModel(preset);
    assert.equal(loaded.fromFile, false, id);
    const inputs = { ...parameters, ...preset.defaultParameters, maxIterations: 3 };
    const spec = createActiveLbmJobSpec(inputs, createWindTunnelModel(loaded.metadata));
    const p = spec.parameters;
    assert.equal(p.thermalEnabled, true, id);
    assert.equal(p.thermalMode, 'solid-power', id);
    assert.equal(p.viscosityMode, 'physical', id);
    assert.equal(p.inletVelocity, 0, id);
    assert.equal(spec.requirements?.thermal, true, id);
    assert.ok(spec.outputs.fields!.includes('temperature'), id);
    const regions = p.thermalRegions!;
    assert.equal(regions.length, want.regions, id);
    assert.ok(validateLbmThermalRegions(regions).ok, id);
    const prepared = prepareProductLbmLattice(spec, loaded.geometry);
    assert.ok(prepared.tau >= 0.505, id);
    assert.ok(prepared.units.uLattice < 0.2, id);
    // 浮力恒由 Boussinesq 项提供：无风扇设备靠它驱动自然对流。
    assert.ok(prepared.thermal!.thermal.gravityPerKelvin > 0, id);
    assert.equal(prepared.thermal!.thermal.materials!.length, regions.length, id);
    for (let flag = 4; flag <= 4 + regions.length; flag++) {
      assert.ok(prepared.flags.includes(flag), `${id} material flag ${flag} resolved no cells`);
    }
    if (want.fan) assert.ok(prepared.fan && prepared.fan.accelerationLattice > 0, id);
    else assert.equal(prepared.fan, undefined, id);
    const result = await runLbmWasm(spec, prepareLbmInput(spec, loaded.geometry));
    const thermal = result.result.thermal!;
    assert.equal(thermal.mode, 'solid-power', id);
    const expectedSourceJ = want.power * prepared.units.dt * result.result.summary.steps;
    assert.ok(Math.abs(thermal.sourceEnergyJ - expectedSourceJ) <= expectedSourceJ * 1e-9,
      `${id} sourceEnergyJ ${thermal.sourceEnergyJ} != ${expectedSourceJ}`);
    assert.ok(Math.abs(thermal.energyResidualJ) <= 1e-9 * thermal.sourceEnergyJ, id);
    assert.ok(Number.isFinite(thermal.solidMaxC) && thermal.solidMaxC >= 25, id);
    assert.ok(result.snapshot!.display.every(Number.isFinite), id);
  }
});

test('start, pause, resume, clear results and reset preserve a usable session', () => {
  const store = useSimulationStore.getState;
  store().startSimulation();
  store().recordForces(1, 2, { drag: 3, lift: 4, side: 5, moment: null });
  store().setState({ currentIteration: 25, currentTime: 0.5, visualizationMode: 'vorticity' });
  store().pauseSimulation();
  assert.equal(store().state.isPaused, true);
  store().resumeSimulation();
  assert.equal(store().state.isPaused, false);
  store().clearResults();
  assert.equal(store().state.isRunning, true);
  assert.equal(store().state.visualizationMode, 'vorticity');
  assert.equal(store().state.currentIteration, 0);
  assert.equal(store().state.currentTime, 0);
  assert.deepEqual(store().state.cdHistory, []);
  assert.equal(store().results.forces.moment, null);
  store().stopSimulation();
  assert.equal(store().state.isRunning, false);
  const before = store().state.resetCount;
  store().resetSimulation();
  assert.equal(store().state.resetCount, before + 1);
});

test('both execution locations keep the active preset scale and results in one store', async () => {
  const { createActiveLbmJobSpec } = await import('./sim-session');
  const spec = createActiveLbmJobSpec({ ...parameters, maxIterations: 25 }, {
    id: 'car', name: 'car', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    isActive: true, tunnelPosition: [0, 0, 0], tunnelRotation: [0, 0, 0],
  });
  assert.equal(spec.run.maxSteps, 25);
  assert.equal(spec.model?.source, 'preset');
  assert.equal(spec.model?.referenceLength, 4.5);
  useSimulationStore.getState().setComputeTarget('backend');
  useSimulationStore.getState().applyJobResult({
    schemaVersion: 1, summary: { steps: 25, cd: 0.4, cl: 0.1, dragN: 12, liftN: 3, wallTimeMs: 1 },
    history: { step: [20, 25], cd: [0.5, 0.4], cl: [0.2, 0.1] }, derived: { dt: 0.002 },
  });
  const store = useSimulationStore.getState();
  assert.equal(store.computeTarget, 'backend');
  assert.equal(store.state.isRunning, false);
  assert.equal(store.state.currentTime, 0.05);
  assert.equal(store.results.forces.drag, 12);
  assert.equal(store.results.forces.side, null);
  assert.deepEqual(store.state.cdHistory, [0.5, 0.4]);
  assert.equal(store.results.velocityField, null);
  store.setComputeTarget('browser');
});


test('missing backend force results are rejected instead of displayed as zero', () => {
  assert.throws(() => useSimulationStore.getState().applyJobResult({
    schemaVersion: 1, summary: { steps: 25, wallTimeMs: 1 },
  }), /有效 dragN/);
});


test('field summaries retain signed temperatures and use saved units, including missing-data behavior', async () => {
  const { summarizeFlowSnapshot } = await import('../cfd/flow-snapshot');
  const snapshot = { nx: 3, ny: 1, nz: 1, step: 3, displayStride: 3 as const, uLattice: 0.06,
    flags: new Uint32Array([0, 0, 2]), display: new Float32Array([0.125, 0, -0.5, 0.25, 0, 1.5, 999, 0, 1]) };
  const units = { dx: 0.1, dt: 0.01, ambientC: 25, temperatureScaleC: 10 };
  assert.deepEqual(summarizeFlowSnapshot(snapshot, units), {
    maxSpeedMps: 2.5, pressurePa: null, fluidTemperatureC: { min: 20, max: 40 }, solidTemperatureC: { min: 35, max: 35 }, solidRegions: [],
  });
  assert.deepEqual(summarizeFlowSnapshot(snapshot, null), { maxSpeedMps: null, pressurePa: null, fluidTemperatureC: null, solidTemperatureC: null, solidRegions: [] });
  assert.equal(summarizeFlowSnapshot({ ...snapshot, flags: new Uint32Array([2, 2, 2]) }, units).maxSpeedMps, null);
  useSimulationStore.getState().applyJobResult({ schemaVersion: 1,
    summary: { steps: 3, wallTimeMs: 1, cd: 0, cl: 0, dragN: 1, liftN: 2, sideN: -3 },
  });
  assert.equal(useSimulationStore.getState().results.forces.side, -3);
});

test('saved field sequences reject missing or reordered physical samples and accept an early final step', async () => {
  const { assertFlowFrames, encodeFlowSnapshot, decodeFlowSnapshot } = await import('../cfd/flow-snapshot');
  const spec = createLbmJobSpec({ ...parameters, maxIterations: 6, fieldFrames: 3, fieldFps: undefined });
  spec.outputs.fields = ['velocity']; // Historical WVF1 objects predate pressure recording.
  const frames = [1, 3, 6].map(step => decodeFlowSnapshot(encodeFlowSnapshot({ nx: 2, ny: 1, nz: 1, step,
    displayStride: 2, uLattice: 0.0625, flags: new Uint32Array([0, 1]), display: new Float32Array([step / 32, 0, 0, 0]) })));
  assert.doesNotThrow(() => assertFlowFrames(frames, spec, 6));
  assert.throws(() => assertFlowFrames([frames[0], frames[2]], spec, 6), /缺帧/);
  assert.throws(() => assertFlowFrames([frames[1], frames[0], frames[2]], spec, 6), /时刻/);
  assert.throws(() => assertFlowFrames([frames[0], frames[1], { ...frames[2], flags: new Uint32Array([1, 0]) }], spec, 6), /模型/);
  assert.doesNotThrow(() => assertFlowFrames([frames[0], { ...frames[1], step: 2 }], spec, 2));
  assert.throws(() => assertFlowFrames(frames, spec, 7), /完成步数/);
});

test('WVF2 distinguishes cold pressure from old temperature and preserves WVF1 bytes', async () => {
  const { encodeFlowSnapshot, decodeFlowSnapshot, flowHasTemperature, flowPressureOffset, flowSnapshotContentType,
    FLOW_SNAPSHOT_CONTENT_TYPE, FLOW_SNAPSHOT_V2_CONTENT_TYPE, summarizeFlowSnapshot } = await import('../cfd/flow-snapshot');
  for (const thermal of [false, true]) {
    const old = { nx: 2, ny: 1, nz: 1, step: 3, displayStride: thermal ? 3 as const : 2 as const, uLattice: 0.0625,
      display: new Float32Array(thermal ? [1, 2, 3, 0, 0, 7] : [1, 2, 0, 0]), flags: new Uint32Array([0, thermal ? 5 : 1]) };
    const oldBytes = encodeFlowSnapshot(old);
    assert.equal(new DataView(oldBytes).getUint32(0, true), 0x31465657);
    assert.equal(new DataView(oldBytes).getUint32(28, true), 0);
    assert.deepEqual(encodeFlowSnapshot(decodeFlowSnapshot(oldBytes, FLOW_SNAPSHOT_CONTENT_TYPE)), oldBytes);
    assert.equal(flowPressureOffset(old), null);
    assert.equal(summarizeFlowSnapshot(old, { pressureScalePa: 100 }).pressurePa, null);
    const current = { ...old, hasPressure: true as const, displayStride: thermal ? 4 as const : 3 as const,
      display: new Float32Array(thermal ? [1, 2, 3, -0.25, 0, 0, 7, 99] : [1, 2, -0.25, 0, 0, 99]) };
    const bytes = encodeFlowSnapshot(current), header = new DataView(bytes);
    assert.equal(header.getUint32(0, true), 0x32465657);
    assert.equal(header.getUint32(28, true), thermal ? 3 : 2);
    const decoded = decodeFlowSnapshot(bytes, FLOW_SNAPSHOT_V2_CONTENT_TYPE);
    assert.deepEqual(decoded, current);
    assert.equal(flowHasTemperature(decoded), thermal);
    assert.equal(flowPressureOffset(decoded), thermal ? 3 : 2);
    assert.equal(flowSnapshotContentType(decoded), FLOW_SNAPSHOT_V2_CONTENT_TYPE);
    const summary = summarizeFlowSnapshot(decoded, { pressureScalePa: 100, ambientC: 20, temperatureScaleC: 2 });
    assert.deepEqual(summary.pressurePa, { min: -25, max: -25 }, 'solid pressure slots do not enter fluid ranges');
    assert.deepEqual(summary.fluidTemperatureC, thermal ? { min: 26, max: 26 } : null);
    for (const pressureScalePa of [undefined, 0, -1, NaN, Infinity]) {
      assert.equal(summarizeFlowSnapshot(decoded, { pressureScalePa }).pressurePa, null);
    }
    assert.throws(() => decodeFlowSnapshot(bytes, FLOW_SNAPSHOT_CONTENT_TYPE), /版本/);
    assert.throws(() => decodeFlowSnapshot(oldBytes, FLOW_SNAPSHOT_V2_CONTENT_TYPE), /版本/);
    for (const channels of [0, 1, 4, 6, 0xffffffff, thermal ? 2 : 3]) {
      const invalid = bytes.slice(0); new DataView(invalid).setUint32(28, channels, true);
      assert.throws(() => decodeFlowSnapshot(invalid), /通道/);
    }
    const invalid = bytes.slice(0); new DataView(invalid).setFloat32(32 + (thermal ? 3 : 2) * 4, NaN, true);
    assert.throws(() => decodeFlowSnapshot(invalid), /非有限/);
    assert.throws(() => decodeFlowSnapshot(bytes.slice(0, -4)), /不完整/);
  }
});

test('pressure replay requires recorded units and channels, including cloned IndexedDB objects', async () => {
  const { assertFlowFrames, encodeFlowSnapshot } = await import('../cfd/flow-snapshot');
  const spec = createLbmJobSpec({ ...parameters, maxIterations: 3, fieldFrames: 3, fieldFps: undefined });
  spec.outputs.fields = ['velocity', 'pressure'];
  const derived = { 'lbm-pressure-field-v1': 1, pressureScalePa: 100 };
  const frames = [1, 2, 3].map(step => ({ nx: 2, ny: 1, nz: 1, step, displayStride: 3 as const,
    hasPressure: true as const, uLattice: 0.0625, flags: new Uint32Array([0, 1]), display: new Float32Array([1, 0, step / 32, 0, 0, 0]) }));
  assert.doesNotThrow(() => assertFlowFrames(structuredClone(frames), spec, 3, derived));
  for (const invalid of [undefined, {}, { ...derived, pressureScalePa: 0 }, { ...derived, pressureScalePa: Infinity }, { pressureScalePa: 100 }]) {
    assert.throws(() => assertFlowFrames(frames, spec, 3, invalid), /单位|标记/);
  }
  assert.throws(() => assertFlowFrames([frames[0], { ...frames[1], hasPressure: undefined }, frames[2]], spec, 3, derived), /不一致/);
  assert.throws(() => assertFlowFrames(frames, { ...spec, outputs: { ...spec.outputs, fields: ['velocity'] } }, 3, derived), /压力通道/);
  assert.throws(() => assertFlowFrames(frames, { ...spec, parameters: { ...spec.parameters, thermalEnabled: true } }, 3, derived), /温度通道/);
  const legacy = frames.map(frame => ({ ...frame, hasPressure: undefined, displayStride: 2 as const,
    display: new Float32Array([1, 0, 0, 0]) }));
  assert.doesNotThrow(() => assertFlowFrames(structuredClone(legacy), { ...spec, outputs: { ...spec.outputs, fields: ['velocity'] } }, 3));
  assert.throws(() => assertFlowFrames(legacy, spec, 3, derived), /压力通道/);
  // 2^21 cold cells with pressure need 32 MiB plus the 32-byte header.
  assert.throws(() => encodeFlowSnapshot({ ...frames[0], nx: 128, ny: 128, nz: 128 }), /大小限制/);
});

test('the two-material preset keeps its regions through the job factory and reports temperatures from saved cells', async () => {
  const { PRESET_MODELS, loadPresetModel } = await import('./preset-models');
  const { createActiveLbmJobSpec } = await import('./sim-session');
  const { createWindTunnelModel } = await import('../stores/project-store');
  const { summarizeFlowSnapshot } = await import('../cfd/flow-snapshot');
  const preset = PRESET_MODELS.find((p) => p.id === 'thermal-assembly')!;
  const model = await loadPresetModel(preset);
  const spec = createActiveLbmJobSpec({ ...parameters, ...preset.defaultParameters }, createWindTunnelModel(model.metadata));
  const prepared = prepareProductLbmLattice(spec, model.geometry);
  assert.deepEqual(spec.parameters.thermalRegions, preset.defaultParameters.thermalRegions);
  assert.ok(prepared.flags.includes(5) && prepared.flags.includes(6));
  assert.equal(prepared.thermal!.thermal.totalPowerW, 0);
  const snapshot = { nx: 4, ny: 1, nz: 1, step: 3, displayStride: 3 as const, uLattice: 0.06,
    flags: new Uint32Array([0, 5, 6, 5]), display: new Float32Array([0, 0, 1, 0, 0, 2, 0, 0, -0.5, 0, 0, 3]) };
  const summary = summarizeFlowSnapshot(snapshot, { dx: 0.5, dt: 0.1, ambientC: 20, temperatureScaleC: 2 });
  assert.deepEqual(summary.solidRegions, [
    { flag: 5, cells: 2, volumeM3: 0.25, temperatureC: { min: 24, max: 26 } },
    { flag: 6, cells: 1, volumeM3: 0.125, temperatureC: { min: 19, max: 19 } },
  ]);
  assert.ok(summarizeFlowSnapshot(snapshot, null).solidRegions.every(r => r.temperatureC === null && r.volumeM3 === null));
});


test('Lab explicitly distinguishes flow demonstration from physical viscosity without silently downgrading', () => {
  assert.equal(parameters.viscosityMode, 'stabilized-preview');
  assert.equal(createLbmJobSpec(parameters).parameters.viscosityMode, 'stabilized-preview');
  const physical = createLbmJobSpec({ ...parameters, viscosityMode: 'physical' });
  assert.equal(physical.parameters.viscosityMode, 'physical');
  assert.throws(() => prepareProductLbmLattice(physical, null), /Re|grid|格/);
  assert.equal(createLbmJobSpec({ ...parameters, thermalEnabled: true }).parameters.viscosityMode, 'physical');
});

test('ground inputs preserve old placement and preview the same rotated model, fan and material coordinates', async () => {
  const { createLbmPreviewPlacement, createActiveLbmJobSpec } = await import('./sim-session');
  const { generatePresetModel } = await import('./preset-models');
  const { createWindTunnelModel } = await import('../stores/project-store');
  const { geometry, metadata } = generatePresetModel('car');
  const model = createWindTunnelModel(metadata);
  const inputs = { ...parameters, viscosityMode: 'physical' as const, angleOfAttack: 12, ground: undefined };
  const old = createLbmPreviewPlacement(inputs, model, geometry);
  assert.equal('ground' in createActiveLbmJobSpec(inputs, model).parameters, false);
  const sourceCenter = old.transform.min.map((min, axis) => (min + old.transform.max[axis]) / 2);
  assert.deepEqual(old.transform.point(sourceCenter), [old.grid.nx / 3, old.grid.ny / 2, old.grid.nz / 2]);
  for (const mode of ['stationary', 'moving'] as const) {
    const ground = { mode, clearanceM: 0.08 };
    const next = { ...inputs, ground };
    assert.deepEqual(createActiveLbmJobSpec(next, model).parameters.ground, ground);
    assert.deepEqual(createActiveLbmJobSpec(next, model, 'webgpu').parameters.ground, ground);
    // This deliberately unresolvable physical case must remain previewable without solving it.
    const placement = createLbmPreviewPlacement(next, model, geometry);
    let minY = Infinity;
    for (let i = 0; i < geometry.vertices.length; i += 3) {
      minY = Math.min(minY, placement.transform.point(Array.from(geometry.vertices.slice(i, i + 3)))[1]);
    }
    assert.ok(Math.abs(minY * placement.dx - ground.clearanceM) < 1e-12);
    assert.equal(minY, placement.transform.bounds.min[1]);
    const center = [0.15, 0.65, 0.5];
    const point = placement.transform.point(center.map((value, axis) => placement.transform.min[axis] + value * (placement.transform.max[axis] - placement.transform.min[axis])));
    const inverse = placement.transform.normalizedFromLattice();
    for (let axis = 0; axis < 3; axis++) {
      const offset = axis * 4;
      const normalized = point.reduce((sum, value, i) => sum + value * inverse[offset + i], inverse[offset + 3]);
      assert.ok(Math.abs(normalized - center[axis]) < 1e-12, 'attached component and material coordinates must agree');
    }
  }
});

test('ground results retain saved boundary and force convention independently of current inputs', () => {
  const store = useSimulationStore.getState;
  store().updateParameters({ ground: { mode: 'stationary', clearanceM: 0.9 }, inletVelocity: 2 });
  store().applyJobResult({ schemaVersion: 1,
    summary: { steps: 3, wallTimeMs: 1, dragN: 1, liftN: 2 },
    derived: { 'lbm-ground-v1': 1, 'lbm-gauge-force-v1': 1, groundMode: 'moving', groundClearanceM: 0.08, groundVelocityMps: 10 },
  });
  assert.equal(store().derived?.['lbm-ground-v1'], 1);
  assert.equal(store().derived?.['lbm-gauge-force-v1'], 1);
  assert.equal(store().derived?.groundMode, 'moving');
  assert.equal(store().derived?.groundClearanceM, 0.08);
  assert.equal(store().derived?.groundVelocityMps, 10);
  store().applyJobResult({ schemaVersion: 1, summary: { steps: 3, wallTimeMs: 1, dragN: 1, liftN: 2 }, derived: { dt: 0.01 } });
  assert.equal(store().derived?.groundMode, undefined);
  assert.equal(store().derived?.['lbm-gauge-force-v1'], undefined, 'old saved results must not acquire the current force convention');
  store().updateParameters({ ground: undefined });
});

test('rehydrating an existing project does not enable a road ground', async () => {
  useSimulationStore.setState({ parameters: { ...parameters, ground: undefined } });
  const oldParameters = { ...parameters };
  delete oldParameters.ground;
  storage.set('wind-tunnel-simulation', JSON.stringify({ version: 2, state: { parameters: oldParameters } }));
  await useSimulationStore.persist.rehydrate();
  assert.equal(useSimulationStore.getState().parameters.ground, undefined);
  assert.equal('ground' in createLbmJobSpec(useSimulationStore.getState().parameters).parameters, false);
});

test('uploaded millimetre geometry with an explicit physical length matches the metre-scale lattice', async () => {
  const { createActiveLbmJobSpec, createLbmPreviewPlacement } = await import('./sim-session');
  const { generatePresetModel } = await import('./preset-models');
  const { createWindTunnelModel } = await import('../stores/project-store');
  const { geometry, metadata } = generatePresetModel('car');
  const inputs = { ...parameters, angleOfAttack: 7, ground: { mode: 'stationary' as const, clearanceM: 0.08 } };
  const original = { ...createWindTunnelModel(metadata), referenceLength: 4.5, referenceArea: 2.2 };
  const millimetres = { ...geometry, vertices: Float32Array.from(geometry.vertices, value => value * 1000) };
  const imported = { ...original, id: 'imported', sourceModel: { ...metadata, id: 'imported' } };
  const metreSpec = createActiveLbmJobSpec(inputs, original), importedSpec = createActiveLbmJobSpec(inputs, imported);
  assert.equal(importedSpec.model?.referenceLength, 4.5);
  assert.equal(importedSpec.model?.referenceArea, 2.2);
  const metre = prepareProductLbmLattice(metreSpec, geometry), converted = prepareProductLbmLattice(importedSpec, millimetres);
  assert.deepEqual(converted.units, metre.units);
  assert.deepEqual(converted.flags, metre.flags);
  assert.equal(converted.referenceArea, 2.2);
  const preview = createLbmPreviewPlacement(inputs, imported, millimetres);
  assert.equal(preview.dx, converted.units.dx);
  assert.ok(Math.abs(preview.transform.bounds.min[1] * preview.dx - 0.08) < 1e-12);
  assert.ok(millimetres.vertices.some(value => Math.abs(value) > 1000), 'physical scaling must not rewrite the imported buffer');
});

test('model reference area supports explicit automatic mode and rejects invalid overrides', async () => {
  const { createActiveLbmJobSpec } = await import('./sim-session');
  const { generatePresetModel } = await import('./preset-models');
  const { createWindTunnelModel } = await import('../stores/project-store');
  const model = createWindTunnelModel(generatePresetModel('car').metadata);
  assert.equal(createActiveLbmJobSpec(parameters, model).model?.referenceArea, 2.5);
  const automatic = JSON.parse(JSON.stringify({ ...model, referenceLength: 4.5, referenceArea: null }));
  assert.equal(createActiveLbmJobSpec(parameters, automatic).model?.referenceArea, undefined);
  for (const referenceLength of [0, -1, Infinity, NaN]) assert.throws(() => createActiveLbmJobSpec(parameters, { ...model, referenceLength }), /长度/);
  for (const referenceArea of [0, -1, Infinity, NaN]) assert.throws(() => createActiveLbmJobSpec(parameters, { ...model, referenceArea }), /面积/);
});

test('zero-reference results retain forces without invented coefficients, and saved viscosity survives parameter edits', () => {
  const store = useSimulationStore.getState;
  store().applyJobResult({ schemaVersion: 1,
    summary: { steps: 3, wallTimeMs: 1, dragN: 1, liftN: -2, reynoldsPhysical: 0, reynoldsLattice: 0 },
    history: { step: [3], dragN: [1], liftN: [-2] },
    derived: { dt: 0.002, viscosityMode: 'physical', requestedViscosityM2s: 1.5e-5, simulatedViscosityM2s: 1.5e-5 },
  });
  assert.equal(store().state.dragCoefficient, null);
  assert.equal(store().state.liftCoefficient, null);
  assert.deepEqual(store().state.cdHistory, []);
  assert.deepEqual(store().state.clHistory, []);
  assert.equal(store().results.forces.drag, 1);
  assert.equal(store().results.forces.lift, -2);
  store().updateParameters({ inletVelocity: 99, fluidViscosity: 0.1, viscosityMode: 'stabilized-preview' });
  assert.equal(store().derived?.viscosityMode, 'physical');
  assert.equal(store().derived?.simulatedViscosityM2s, 1.5e-5);
  assert.equal(store().derived?.reynoldsPhysical, 0);
  store().recordForces(undefined, undefined, { drag: 3, lift: 4, side: null, moment: null });
  assert.equal(store().state.dragCoefficient, null);
  assert.deepEqual(store().state.cdHistory, []);
  assert.equal(store().results.forces.drag, 3);
  store().clearResults();
  assert.equal(store().results.forces.drag, null);
  assert.throws(() => store().applyJobResult({ schemaVersion: 1,
    summary: { steps: 3, wallTimeMs: 1, dragN: 1, liftN: 2, cd: Number.NaN },
  }), /无效 cd/);
  store().resetParameters();
});

test('stride-1 snapshots keep immutable per-step buffers while decimated frames shrink dims', async () => {
  const { prepareLbmInput, runLbmWasm } = await import('../../../../../src/lib/sim/lbm-compute');
  const full = createLbmJobSpec({ ...parameters, maxIterations: 4, fieldFrames: 3, fieldFps: undefined, fieldStride: 1 });
  const prepared = prepareLbmInput(full, lbmGeometry);
  const solved = await runLbmWasm(full, prepared);
  assert.equal(solved.snapshots.length, 3);
  const displays = solved.snapshots.map(frame => frame.display);
  for (let i = 1; i < displays.length; i++) {
    assert.notEqual(displays[i].buffer, displays[0].buffer, 'stride-1 frames must not alias the persistent WASM display buffer');
  }
  assert.deepEqual(solved.snapshots.map(frame => frame.step), [1, 2, 4]);
  const coarseSpec = createLbmJobSpec({ ...parameters, maxIterations: 4, fieldFrames: 3, fieldFps: undefined, fieldStride: 4 });
  const coarsePrepared = prepareLbmInput(coarseSpec, lbmGeometry);
  const coarse = await runLbmWasm(coarseSpec, coarsePrepared);
  assert.equal(coarse.snapshots[0].nx, Math.ceil(coarsePrepared.lbm.nx / 4));
  assert.equal(coarse.snapshots[0].flags.length, Math.ceil(coarsePrepared.lbm.nx / 4) * Math.ceil(coarsePrepared.lbm.ny / 4) * Math.ceil(coarsePrepared.lbm.nz / 4));
  assert.equal(coarse.snapshots[0].display.length, coarse.snapshots[0].flags.length * coarse.snapshots[0].displayStride);
});
