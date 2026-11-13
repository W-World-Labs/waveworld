import assert from 'node:assert/strict';
import test from 'node:test';
import { MAC_3D_FEATURE, type MacJobSpecV1 } from '@w-sim/contracts';
import { createActiveFlowJobSpec, createActiveLbmJobSpec, createLbmPreviewPlacement } from './sim-session';
import { generatePresetModel } from './preset-models';
import { createWindTunnelModel } from '../stores/project-store';
import { useSimulationStore } from '../stores/simulation-store';

const loaded = generatePresetModel('cube');
const model = { ...createWindTunnelModel(loaded.metadata), referenceLength: 0.45 };
const parameters = { ...useSimulationStore.getState().parameters, flowMethod: 'mac' as const,
  macGrid: [48, 24, 24] as [number, number, number], macCharacteristicCells: 16,
  dtSeconds: 0.0001, durationSeconds: undefined, maxIterations: 3, fieldFrames: 3,
  inletVelocity: 20, angleOfAttack: 12, ground: { mode: 'moving' as const, clearanceM: 0.08 },
  macFans: [{ name: 'Synthetic fixture', center: [0.1, 0.5, 0.5] as [number, number, number], axis: 'x' as const,
    radiusM: 0.02, rpmRatio: 0.8, curve: [{ flowM3s: 0, pressurePa: 20 }, { flowM3s: 0.01, pressurePa: 0 }] }],
};

test('MAC workbench preserves SI input and excludes stale LBM boundaries and output claims', () => {
  const spec = createActiveFlowJobSpec(parameters, model) as MacJobSpecV1;
  assert.equal(spec.kind, 'mac-3d');
  assert.equal(spec.model?.referenceLength, 0.45);
  assert.equal(spec.parameters.dtSeconds, parameters.dtSeconds);
  assert.equal(spec.parameters.fluidViscosity, 1.81e-5);
  assert.deepEqual(spec.parameters.fans, parameters.macFans);
  assert.deepEqual(spec.run, { maxSteps: 3 });
  assert.deepEqual(spec.requirements, { backends: ['cpu'], precision: 'float64', features: [MAC_3D_FEATURE], thermal: undefined });
  assert.deepEqual(spec.outputs.fields, ['velocity', 'pressure']);
  assert.equal(spec.outputs.forces, false);
  for (const key of ['inletVelocity', 'angleOfAttack', 'ground', 'fan', 'smagorinskyCs', 'viscosityMode', 'ambientTemp', 'heatSourceTemp']) {
    assert.equal(key in spec.parameters, false, key);
  }
  const placement = createLbmPreviewPlacement(parameters, model, loaded.geometry);
  const unrotated = createLbmPreviewPlacement({ ...parameters, angleOfAttack: 0, ground: undefined }, model, loaded.geometry);
  assert.deepEqual(placement.transform.bounds, unrotated.transform.bounds);
  assert.equal(placement.dx, 0.45 / 16);
  assert.throws(() => createActiveFlowJobSpec(parameters, model, 'webgpu'), /CPU/);
});

test('MAC duration uses requested dt and thermal modes contain only their applicable fields', () => {
  const tenSeconds = createActiveFlowJobSpec({ ...parameters, durationSeconds: 10, maxIterations: 20 }, model);
  assert.equal(tenSeconds.run.maxSteps, 100000);
  assert.equal(tenSeconds.run.maxSteps * parameters.dtSeconds, 10);
  const timed = createActiveFlowJobSpec({ ...parameters, durationSeconds: 0.00025 }, model);
  assert.equal(timed.run.maxSteps, 3);
  assert.equal(timed.parameters.dtSeconds, 0.0001);
  for (const durationSeconds of [0, -1, NaN, Infinity, 1e12]) {
    assert.throws(() => createActiveFlowJobSpec({ ...parameters, durationSeconds }, model));
  }
  const thermal = { ...parameters, thermalEnabled: true };
  const fixed = createActiveFlowJobSpec(thermal, model);
  assert.equal(fixed.parameters.heatSourceTemp, 60);
  assert.equal('totalPowerW' in fixed.parameters, false);
  const power = createActiveFlowJobSpec({ ...thermal, thermalMode: 'solid-power' }, model);
  assert.equal(power.parameters.totalPowerW, 10);
  assert.equal('heatSourceTemp' in power.parameters, false);
  assert.deepEqual(power.outputs.fields, ['velocity', 'pressure', 'temperature']);
  assert.throws(() => createActiveFlowJobSpec({ ...parameters, macFans: [{ ...parameters.macFans[0], rpmRatio: 0 }] }, model));
});

test('selecting LBM retains its existing job and physical-boundary path', () => {
  const input = { ...parameters, flowMethod: 'lbm' as const };
  assert.deepEqual(createActiveFlowJobSpec(input, model), createActiveLbmJobSpec(input, model));
  const spec = createActiveFlowJobSpec(input, model);
  assert.equal(spec.parameters.inletVelocity, 20);
  assert.deepEqual(spec.parameters.ground, input.ground);
  assert.equal(spec.outputs.forces, true);
});

test('MAC results keep forces unavailable and playback physical time without weakening LBM validation', () => {
  const store = useSimulationStore.getState();
  store.applyJobResult({ schemaVersion: 1, summary: { steps: 3, wallTimeMs: 1, method: 'mac-3d' },
    derived: { [MAC_3D_FEATURE]: 1, dt: 0.0001, dx: 0.01, precision: 'float64' } });
  assert.equal(useSimulationStore.getState().state.currentTime, 3 * 0.0001);
  assert.equal(useSimulationStore.getState().results.forces.drag, null);
  assert.equal(useSimulationStore.getState().state.dragCoefficient, null);
  assert.equal(useSimulationStore.getState().derived?.['mac-3d-v1'], 1);
  assert.throws(() => store.applyJobResult({ schemaVersion: 1, summary: { steps: 3, wallTimeMs: 1 } }), /dragN/);
});
