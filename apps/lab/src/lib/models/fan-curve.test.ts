import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { MacFanComponent } from '@w-sim/contracts';
import { createWindTunnelModel, useProjectStore } from '../stores/project-store';
import { useSimulationStore } from '../stores/simulation-store';
import { downloadMacFanCurveCsv, formatMacFanCurveCsv, importMacFanCurveCsv, MAX_FAN_CURVE_CSV_BYTES, parseMacFanCurveCsv } from './fan-curve';

// Actual locally researched CSV layout and digitized values. This is an import
// fixture, not a product fan preset or a claimed match for the Olympus chassis.
const digitized = `flowM3PerMin,pressureMmH2O,flowM3PerSecond,pressurePa,method
0,87.88,0.0,861.8084019999999,datasheet endpoint
0.075,77,0.00125,755.11205,manual figure estimate
0.15,66,0.0025,647.2389,manual figure estimate
0.225,56,0.0037500000000000003,549.1723999999999,manual figure estimate
0.3,46,0.005,451.10589999999996,manual figure estimate
0.375,43.5,0.00625,426.589275,manual figure estimate
0.45,43.5,0.007500000000000001,426.589275,manual figure estimate
0.525,42.5,0.00875,416.782625,manual figure estimate
0.6,36,0.01,353.0394,manual figure estimate
0.675,27,0.011250000000000001,264.77955,manual figure estimate
0.75,15,0.0125,147.09975,manual figure estimate
0.828,0,0.0138,0.0,datasheet endpoint
`;
const csv = 'flowM3PerSecond,pressurePa\n0,45\n0.02,0\n';
const fan = (): MacFanComponent => ({ name: 'User fan', center: [.2, .5, .5], axis: '-x', radiusM: .02, rpmRatio: .6,
  curve: [{ flowM3s: 0, pressurePa: 20 }, { flowM3s: .01, pressurePa: 0 }] });

function setup(t: TestContext) {
  const project = useProjectStore.getState(), simulation = useSimulationStore.getState();
  t.after(() => { useProjectStore.setState(project, true); useSimulationStore.setState(simulation, true); });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('CSV import must not access HTTP'); });
  const first = fan(), second = { ...fan(), name: 'Other fan' };
  useSimulationStore.setState({ parameters: { ...simulation.parameters, flowMethod: 'mac', macFans: [first, second] },
    state: { ...simulation.state, isRunning: false } });
  useProjectStore.setState({ activeModel: createWindTunnelModel({
    id: 'model', name: 'Model', format: 'glb', fileSize: 0, uploadDate: new Date(), vertexCount: 3, faceCount: 1,
    boundingBox: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1], center: [.5, .5, .5] },
    isWatertight: false, hasNormals: true, hasUVs: false, manifoldEdges: 0, nonManifoldEdges: 0,
  }) });
  return { first, second };
}

test('actual digitized CSV uses its explicit SI columns and round-trips without scaling RPM or estimating points', () => {
  const curve = parseMacFanCurveCsv(digitized);
  assert.equal(curve.length, 12);
  assert.deepEqual(curve[0], { flowM3s: 0, pressurePa: 861.8084019999999 });
  assert.deepEqual(curve[6], { flowM3s: .007500000000000001, pressurePa: 426.589275 });
  assert.deepEqual(curve.at(-1), { flowM3s: .0138, pressurePa: 0 });
  assert.deepEqual(parseMacFanCurveCsv(formatMacFanCurveCsv(curve)), curve);
  assert.deepEqual(parseMacFanCurveCsv('\uFEFF"pressurePa","flowM3s","method"\r\n45,0,"source, estimate"\r\n0,2e-2,"a ""quoted"" note"\r\n'), parseMacFanCurveCsv(csv));
  // Explicitly ignored source columns are never used as alternative units.
  assert.deepEqual(parseMacFanCurveCsv('flowM3PerMin,pressureMmH2O,flowM3s,pressurePa\n999,999,0,45\n999,999,.02,0'), parseMacFanCurveCsv(csv));
});

test('CSV and export share contract admission: no guessed units, reordering, clipping, extrapolation or pressure smoothing', () => {
  for (const bad of [
    'flow,pressure\n0,20\n1,0', 'flowM3PerMin,pressureMmH2O\n0,20\n1,0',
    'flowM3s,flowM3PerSecond,pressurePa\n0,0,20\n1,1,0', 'flowM3s,pressurePa,pressurePa\n0,20,20\n1,0,0',
    'flowM3s,pressurePa\n0,20', 'flowM3s,pressurePa\n0,20\n.02,0\n.01,3',
    'flowM3s,pressurePa\n0,20\n0,0', 'flowM3s,pressurePa\n.01,20\n.02,0',
    'flowM3s,pressurePa\n0,20\n.01,-2', 'flowM3s,pressurePa\n0,20\n-1,0',
    'flowM3s,pressurePa\n0,20\n.01,1e999', 'flowM3s,pressurePa\n0,20\n.01,NaN',
    'flowM3s,pressurePa\n0,20\n,0', 'flowM3s,pressurePa\n0,20\n0x10,0',
    'flowM3s,pressurePa\n0,20\n.01,0,extra', 'flowM3s,pressurePa\n0,20\n".01,0',
  ]) assert.throws(() => parseMacFanCurveCsv(bad), /CSV|曲线/, bad);
  const maximum = Array.from({ length: 256 }, (_, flowM3s) => ({ flowM3s, pressurePa: flowM3s % 3 }));
  assert.deepEqual(parseMacFanCurveCsv(formatMacFanCurveCsv(maximum)), maximum, 'pressure need not decrease monotonically');
  assert.throws(() => formatMacFanCurveCsv([...maximum, { flowM3s: 256, pressurePa: 0 }]), /256/);
  assert.throws(() => parseMacFanCurveCsv(`flowM3s,pressurePa\n${Array.from({ length: 257 }, (_, i) => `${i},0`).join('\n')}`), /256/);
  assert.throws(() => formatMacFanCurveCsv([{ flowM3s: 0, pressurePa: 1 }, { flowM3s: 0, pressurePa: 0 }]));
  assert.throws(() => parseMacFanCurveCsv(' '.repeat(MAX_FAN_CURVE_CSV_BYTES + 1)), /64 KiB/);
  assert.throws(() => parseMacFanCurveCsv(`flowM3s,pressurePa\n0,20\n${' '.repeat(60_000)}"`), /格式无效/);
});

test('successful local import replaces only the selected curve through updateParameters; invalid input keeps all state', async t => {
  const { first, second } = setup(t), before = useSimulationStore.getState();
  const update = t.mock.method(before, 'updateParameters', before.updateParameters);
  await assert.rejects(importMacFanCurveCsv(new File(['bad'], 'bad.csv'), first, new AbortController().signal));
  assert.equal(useSimulationStore.getState().parameters, before.parameters);
  assert.equal(useSimulationStore.getState().results, before.results);
  assert.equal(update.mock.callCount(), 0);
  const updated = await importMacFanCurveCsv(new File([csv], 'curve.csv'), first, new AbortController().signal);
  assert.equal(update.mock.callCount(), 1);
  assert.deepEqual(updated, { ...first, curve: [{ flowM3s: 0, pressurePa: 45 }, { flowM3s: .02, pressurePa: 0 }] });
  assert.equal(useSimulationStore.getState().parameters.macFans![0], updated);
  assert.equal(useSimulationStore.getState().parameters.macFans![1], second);
  assert.deepEqual(first.curve, [{ flowM3s: 0, pressurePa: 20 }, { flowM3s: .01, pressurePa: 0 }]);
  assert.deepEqual({ ...useSimulationStore.getState().parameters, macFans: before.parameters.macFans }, before.parameters);
});

test('stale local reads reject promptly after model/method/fan changes or cancellation and release subscriptions', async t => {
  setup(t);
  let subscriptions = 0;
  const simulationSubscribe = useSimulationStore.subscribe, projectSubscribe = useProjectStore.subscribe;
  t.mock.method(useSimulationStore, 'subscribe', (listener: Parameters<typeof simulationSubscribe>[0]) => {
    subscriptions++; const stop = simulationSubscribe(listener); return () => { subscriptions--; stop(); };
  });
  t.mock.method(useProjectStore, 'subscribe', (listener: Parameters<typeof projectSubscribe>[0]) => {
    subscriptions++; const stop = projectSubscribe(listener); return () => { subscriptions--; stop(); };
  });
  const initial = useSimulationStore.getState(), model = useProjectStore.getState().activeModel;
  for (const change of ['model', 'method', 'delete', 'edit', 'cancel', 'running'] as const) {
    useSimulationStore.setState(initial, true); useProjectStore.setState({ activeModel: model });
    const first = initial.parameters.macFans![0];
    let finish!: (text: string) => void;
    const file = new File([csv], 'pending.csv');
    t.mock.method(file, 'text', () => new Promise<string>(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = importMacFanCurveCsv(file, first, controller.signal);
    assert.equal(subscriptions, 2);
    if (change === 'model') { useProjectStore.setState({ activeModel: null }); useProjectStore.setState({ activeModel: model }); }
    if (change === 'method') useSimulationStore.getState().updateParameters({ flowMethod: 'lbm' });
    if (change === 'delete') useSimulationStore.getState().updateParameters({ macFans: initial.parameters.macFans!.slice(1) });
    if (change === 'edit') useSimulationStore.getState().updateParameters({ macFans: [{ ...first, name: 'Edited' }] });
    if (change === 'cancel') controller.abort(new Error('Cancelled file selection'));
    if (change === 'running') useSimulationStore.getState().startSimulation();
    await assert.rejects(pending, /变化|Cancelled/);
    assert.equal(subscriptions, 0);
    const after = useSimulationStore.getState();
    finish(csv); await Promise.resolve();
    assert.equal(useSimulationStore.getState().parameters, after.parameters);
    assert.equal(useSimulationStore.getState().results, after.results);
  }
});

test('file admission rejects oversized, empty and non-CSV input before reading and honors an already cancelled selection', async t => {
  const { first } = setup(t);
  for (const file of [new File(['x'.repeat(MAX_FAN_CURVE_CSV_BYTES + 1)], 'large.csv'), new File([], 'empty.csv'), new File([csv], 'curve.txt')]) {
    const read = t.mock.method(file, 'text', async () => { throw new Error('Must not read rejected file'); });
    await assert.rejects(importMacFanCurveCsv(file, first, new AbortController().signal), /64 KiB/);
    assert.equal(read.mock.callCount(), 0);
  }
  const controller = new AbortController(); controller.abort(new Error('Cancelled before reading'));
  await assert.rejects(importMacFanCurveCsv(new File([csv], 'curve.csv'), first, controller.signal), /Cancelled before/);
});

test('export downloads only the unscaled valid curve and revokes its Blob URL after success or click failure', t => {
  setup(t);
  useSimulationStore.getState().updateParameters({ macGrid: [0, 0, 0] }); // Export is independent of unfinished model inputs.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const blobs: Blob[] = [], revoked: string[] = [];
  let removed = 0, clicks = 0, fail = false;
  const link = { href: '', download: '', click() { clicks++; if (fail) throw new Error('Download failed'); }, remove() { removed++; } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: (tag: string) => { assert.equal(tag, 'a'); return link; }, body: { appendChild: (value: unknown) => assert.equal(value, link) },
  } });
  t.mock.method(URL, 'createObjectURL', (blob: Parameters<typeof URL.createObjectURL>[0]) => { assert.ok(blob instanceof Blob); blobs.push(blob); return `blob:curve-${blobs.length}`; });
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); });
  try {
    downloadMacFanCurveCsv(fan());
    assert.equal(link.download, 'User fan-pq.csv');
    assert.equal(revoked.length, 0);
    t.mock.timers.tick(0);
    assert.deepEqual(revoked, ['blob:curve-1']);
    assert.equal(blobs[0].size, new TextEncoder().encode(formatMacFanCurveCsv(fan().curve)).length);
    fail = true;
    assert.throws(() => downloadMacFanCurveCsv(fan()), /Download failed/);
    t.mock.timers.tick(0);
    assert.deepEqual(revoked, ['blob:curve-1', 'blob:curve-2']);
    assert.equal(clicks, 2); assert.equal(removed, 2);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
