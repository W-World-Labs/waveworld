import assert from 'node:assert/strict';
import test from 'node:test';
import { WasmMac } from '@w-sim/solvers-lbm/mac3d';
import { inspectMacGrid } from '../../../../../src/lib/sim/mac-inspection';
import { macGeometry, macSpec } from '../../../../../scripts/ci/mac-fixture';
import { lbmGeometry, thermalContactsSpec } from '../../../../../scripts/ci/lbm-fixture';

test('grid inspection reports the actual quantized fan disk without stepping or sampling flow', t => {
  t.mock.method(WasmMac.prototype, 'step', () => { throw new Error('Inspection must not advance time'); });
  t.mock.method(WasmMac.prototype, 'sample', () => { throw new Error('Inspection must not create a flow result'); });
  const spec = macSpec(), geometryBefore = structuredClone(macGeometry), specBefore = structuredClone(spec);
  const report = inspectMacGrid(spec, macGeometry);
  assert.deepEqual(macGeometry, geometryBefore);
  assert.deepEqual(spec, specBefore);
  assert.equal(report.solidCells, 30);
  assert.equal(report.fluidCells, 942);
  assert.equal(report.fans.length, 2);
  assert.equal(report.fans[0].faceCount, 5);
  assert.equal(report.fans[0].areaM2, 5 * .01 ** 2);
  assert.ok(Math.abs(report.fans[0].areaErrorRatio - (5 / (Math.PI * 1.1 ** 2) - 1)) < 1e-14);
  assert.equal('flowM3s' in report.fans[0], false, 'an at-rest admission readout is not a fan operating point');
  spec.parameters.fans![0].center[0] = .3725;
  const shifted = inspectMacGrid(spec, macGeometry).fans[0];
  assert.equal(shifted.plane, 3);
  assert.ok(Math.abs(shifted.normalOffsetMeters + .0049) < 1e-14);
  spec.parameters.fans![0].center[0] = .375;
  assert.equal(inspectMacGrid(spec, macGeometry).fans[0].plane, 4, 'half-cell crossing moves the actual disk');
});

test('material volumes and configured contact area include default solids and explicit zero resistance', () => {
  const spec = macSpec(undefined, true);
  spec.parameters.fans = [];
  spec.parameters.thermalRegions = thermalContactsSpec().parameters.thermalRegions;
  spec.parameters.thermalContacts = [{ first: 2, second: 1, resistanceM2KW: 0 }];
  spec.parameters.totalPowerW = 0;
  const report = inspectMacGrid(spec, lbmGeometry);
  // This voxelized cube spans five x planes with a 3-by-5 yz section. One
  // surface plane's centers lie outside the normalized region boxes and stay default.
  assert.deepEqual(report.materials.map(m => m.cells), [15, 15, 45]);
  assert.equal(report.materials.reduce((sum, m) => sum + m.cells, 0), report.solidCells);
  assert.deepEqual(report.materials.map(m => m.totalPowerW), [0, 7, 0]);
  assert.ok(Math.abs(report.materials[1].volumeM3 - 15e-6) < 1e-18);
  assert.equal(report.contacts[0].faces, 15);
  assert.equal(report.contacts[0].areaM2, 15 * .01 ** 2);
  assert.equal(report.contacts[0].resistanceM2KW, 0);
  spec.parameters.thermalContacts = [];
  assert.deepEqual(inspectMacGrid(spec, lbmGeometry).contacts, [], 'only configured thermal-resistance interfaces are listed');
});

test('fixed-temperature solids remain distinct from powered material regions', () => {
  const spec = macSpec();
  spec.parameters.fans = [];
  Object.assign(spec.parameters, { thermalEnabled: true, thermalMode: 'fixed-temperature', heatSourceTemp: 60, ambientTemp: 25 });
  spec.requirements.thermal = true;
  const report = inspectMacGrid(spec, lbmGeometry);
  assert.deepEqual(report.fixedTemperature, { cells: 75, temperatureC: 60 });
  assert.deepEqual(report.materials, []);
  assert.deepEqual(report.contacts, []);
});

test('the same solver admission rejects a fan inside solid, an unresolved region, and a nonadjacent contact', () => {
  assert.throws(() => inspectMacGrid(macSpec(), lbmGeometry), /fan placement/);
  const spec = macSpec(undefined, true);
  spec.parameters.fans = [];
  const material = thermalContactsSpec().parameters.thermalRegions![0];
  spec.parameters.thermalRegions = [{ ...material, bounds: { min: [0, 0, 0], max: [.001, .001, .001] } }];
  assert.throws(() => inspectMacGrid(spec, lbmGeometry), /at least one solid cell/);
  spec.parameters.thermalRegions = [
    { ...material, name: 'left', bounds: { min: [0, 0, 0], max: [.25, 1, 1] } },
    { ...material, name: 'right', bounds: { min: [.75, 0, 0], max: [1, 1, 1] } },
  ];
  spec.parameters.thermalContacts = [{ first: 1, second: 2, resistanceM2KW: 0 }];
  assert.throws(() => inspectMacGrid(spec, lbmGeometry), /shared solid voxel face/);
});
