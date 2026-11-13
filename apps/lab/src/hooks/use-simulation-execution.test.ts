import assert from 'node:assert/strict';
import test from 'node:test';
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts';
import type { MacFlowSnapshot } from '@/lib/cfd/mac-flow-snapshot';
import { encodeMacFlowSnapshot, MAC_FLOW_SEQUENCE_KIND, MAC_FLOW_SEQUENCE_CONTENT_TYPE } from '@/lib/cfd/mac-flow-snapshot';
import { MODEL_GEOMETRY_CONTENT_TYPE } from '@/lib/models/geometry-contract';
import { createHookHarness } from './test-hook-harness';
import { useSimulationExecution } from './use-simulation-execution';
import { useSimulationStore } from '@/lib/stores/simulation-store';
import { useProjectStore, createWindTunnelModel } from '@/lib/stores/project-store';
import type { ModelGeometry, ModelMetadata } from '@/types/model';

type WorkerMessage = { spec: JobSpecV1; geometry?: ModelGeometry; agentId: string };
type Reply = { type: 'frame'; flow: ArrayBuffer } | { type: 'result'; result: JobResultV1 } | { type: 'error'; error: string };

class StubWorker {
  static instances: StubWorker[] = [];
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<Reply>) => void) | null = null;
  message!: WorkerMessage;
  terminated = false;
  constructor(_url: URL, _options?: WorkerOptions) { StubWorker.instances.push(this); }
  postMessage(message: WorkerMessage) { this.message = message; }
  terminate() { this.terminated = true; }
  emit(data: Reply) { this.onmessage?.({ data } as MessageEvent<Reply>); }
}

const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const metadata: ModelMetadata = {
    id: 'synthetic-wing', name: 'Synthetic wing', format: 'stl', fileSize: 36, uploadDate: new Date(0),
    vertexCount: 3, faceCount: 1,
    boundingBox: { min: [0, 0, 0], max: [1, 0.2, 0.2], center: [0.5, 0.1, 0.1], size: [1, 0.2, 0.2] },
    isWatertight: true, hasNormals: true, hasUVs: false, manifoldEdges: 0, nonManifoldEdges: 0,
  };
  const geometry: ModelGeometry = {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0.2, 0.2]),
    normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]),
  };
  const model = createWindTunnelModel(metadata);
  useProjectStore.setState({ activeModel: model, uploadedModels: [{ metadata, geometry }] });
  useSimulationStore.setState({
    computeTarget: 'browser', computeBackend: 'cpu',
    parameters: {
      ...useSimulationStore.getState().parameters,
      flowMethod: 'mac', macGrid: [16, 16, 16], macCharacteristicCells: 8,
      dtSeconds: 0.001, durationSeconds: 10, fieldFps: 0.3, fieldStride: 1,
      thermalEnabled: false,
    },
  });
  useSimulationStore.getState().clearResults();
  useSimulationStore.getState().stopSimulation();
  StubWorker.instances = [];
  const oldWorker = globalThis.Worker;
  const oldGpu = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: StubWorker });
  if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  const harness = createHookHarness(() => useSimulationExecution());
  const cleanup = () => {
    harness.unmount();
    useSimulationStore.getState().stopSimulation();
    useSimulationStore.getState().clearResults();
    useProjectStore.setState({ activeModel: null, uploadedModels: [] });
    Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: oldWorker });
    if (oldGpu) Object.defineProperty(globalThis, 'navigator', oldGpu);
    else Reflect.deleteProperty(globalThis, 'navigator');
  };
  return { harness, cleanup };
}

function makeMacFrame(step: number): ArrayBuffer {
  const frame: MacFlowSnapshot = {
    nx: 3, ny: 3, nz: 3, step, displayStride: 4,
    fields: new Float32Array(3 * 3 * 3 * 4), flags: new Uint32Array(3 * 3 * 3),
  };
  return encodeMacFlowSnapshot(frame);
}

function makeResult(worker: StubWorker, steps = worker.message.spec.run.maxSteps): JobResultV1 {
  return {
    schemaVersion: 1,
    summary: { steps, wallTimeMs: 1 },
    derived: { 'mac-3d-v1': 1 },
  } as JobResultV1;
}

async function beginSyntheticRun(harness: ReturnType<typeof createHookHarness<ReturnType<typeof useSimulationExecution>>>) {
  const run = harness.result.start();
  await tick();
  const worker = StubWorker.instances.at(-1)!;
  assert.ok(worker, `browser compute should use the stub Worker (status=${harness.result.status}, error=${harness.result.error})`);
  worker.emit({ type: 'frame', flow: makeMacFrame(1) });
  await tick();
  return { run, worker };
}

test('shows a valid intermediate MAC frame before completion without promoting job results', async t => {
  const { harness, cleanup } = fixture(); t.after(cleanup);
  const { worker } = await beginSyntheticRun(harness);
  const store = useSimulationStore.getState();
  assert.equal(store.results.flowSnapshot?.step, 1);
  assert.ok(store.results.flowSnapshot!.step < worker.message.spec.run.maxSteps);
  assert.equal(store.results.job, null);
  assert.deepEqual(store.results.flowFrames, []);
  assert.equal(store.results.forces.drag, null);
  assert.equal(store.results.forces.lift, null);
  assert.equal(store.state.dragCoefficient, null);
  assert.equal(store.state.liftCoefficient, null);
});

test('promotes valid synthetic MAC frames and result only after Worker completion', async t => {
  const { harness, cleanup } = fixture(); t.after(cleanup);
  const { run, worker } = await beginSyntheticRun(harness);
  worker.emit({ type: 'frame', flow: makeMacFrame(5000) });
  worker.emit({ type: 'frame', flow: makeMacFrame(10000) });
  worker.emit({ type: 'result', result: makeResult(worker) });
  await run;
  const store = useSimulationStore.getState();
  assert.equal(harness.result.status, 'succeeded');
  assert.equal(store.results.job?.result.summary.steps, worker.message.spec.run.maxSteps);
  assert.equal(store.results.flowSnapshot?.step, worker.message.spec.run.maxSteps);
  assert.equal(store.results.flowFrames.length, 3);
  assert.equal(store.results.forces.drag, null);
  assert.equal(store.results.forces.lift, null);
});

test('publication preflight failure preserves the completed local result', async t => {
  for (const failure of ['401', '503', 'network', 'cancel', 'unmount'] as const) await t.test(failure, async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = async (input, init) => {
      requests.push(String(input));
      assert.match(String(input), /\/api\/v1\/me$/);
      if (failure === 'network') throw new TypeError('synthetic network failure');
      if (failure === 'cancel' || failure === 'unmount') return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
      });
      return new Response('', { status: Number(failure) });
    };
    const { harness, cleanup } = fixture();
    try {
      const { run, worker } = await beginSyntheticRun(harness);
      worker.emit({ type: 'frame', flow: makeMacFrame(5000) });
      worker.emit({ type: 'frame', flow: makeMacFrame(10000) });
      worker.emit({ type: 'result', result: makeResult(worker) });
      await run;
      assert.equal(harness.result.status, 'succeeded');
      const before = useSimulationStore.getState();
      const publication = harness.result.start(true);
      if (failure === 'cancel') await harness.result.stop();
      if (failure === 'unmount') harness.unmount();
      await publication;
      const after = useSimulationStore.getState();
      assert.equal(requests.length, 1, 'authentication must precede upload or job creation');
      assert.equal(StubWorker.instances.length, 1, 'publication must not start another local solve');
      if (failure !== 'unmount') assert.equal(harness.result.status, failure === 'cancel' ? 'canceled' : 'failed');
      assert.equal(harness.result.loginRequired, failure === '401');
      assert.strictEqual(after.results, before.results, 'keep frames, fields and completed job together');
      assert.strictEqual(after.derived, before.derived);
      assert.deepEqual(after.state, before.state, 'keep completed progress and force history');
    } finally { cleanup(); globalThis.fetch = originalFetch; }
  });
});

test('an incomplete Worker result clears preview and cannot become a completed job', async t => {
  const { harness, cleanup } = fixture(); t.after(cleanup);
  const { run, worker } = await beginSyntheticRun(harness);
  assert.equal(useSimulationStore.getState().results.flowSnapshot?.step, 1);
  worker.emit({ type: 'result', result: makeResult(worker, worker.message.spec.run.maxSteps - 1) });
  await run;
  assert.equal(harness.result.status, 'failed');
  assert.equal(useSimulationStore.getState().results.flowSnapshot, null);
  assert.equal(useSimulationStore.getState().results.flowFrames.length, 0);
  assert.equal(useSimulationStore.getState().results.job, null);
  assert.equal(useSimulationStore.getState().state.dragCoefficient, null);
  assert.equal(useSimulationStore.getState().state.liftCoefficient, null);
});

test('bursty frames are throttled for preview while the final frame sequence is retained', async t => {
  const { harness, cleanup } = fixture(); t.after(cleanup);
  const oldNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  try {
    const { run, worker } = await beginSyntheticRun(harness);
    assert.equal(useSimulationStore.getState().results.flowSnapshot?.step, 1);
    now += 100;
    worker.emit({ type: 'frame', flow: makeMacFrame(5000) });
    assert.equal(useSimulationStore.getState().results.flowSnapshot?.step, 1, 'bursty frame should not trigger a second preview decode');
    now += 200;
    worker.emit({ type: 'frame', flow: makeMacFrame(10000) });
    assert.equal(useSimulationStore.getState().results.flowSnapshot?.step, 10000);
    worker.emit({ type: 'result', result: makeResult(worker) });
    await run;
    const results = useSimulationStore.getState().results;
    assert.equal(results.flowSnapshot?.step, 10000);
    assert.deepEqual(results.flowFrames.map(frame => frame.step), [1, 5000, 10000]);
    assert.equal(results.job?.result.summary.steps, worker.message.spec.run.maxSteps);
  } finally { Date.now = oldNow; }
});

test('cancellation and parameter/model changes prevent late Worker messages from republishing', async t => {
  for (const change of ['cancel', 'parameter', 'model'] as const) {
    const { harness, cleanup } = fixture();
    try {
      const { run, worker } = await beginSyntheticRun(harness);
      if (change === 'cancel') await harness.result.stop();
      if (change === 'parameter') useSimulationStore.getState().updateParameters({ inletVelocity: 12 });
      if (change === 'model') useProjectStore.getState().setActiveModel(createWindTunnelModel({
        ...useProjectStore.getState().activeModel!.sourceModel, id: 'replacement', name: 'Replacement',
      }));
      await run;
      assert.equal(worker.terminated, true);
      assert.equal(useSimulationStore.getState().results.flowSnapshot, null, change);
      assert.equal(useSimulationStore.getState().results.job, null, change);
      worker.emit({ type: 'frame', flow: makeMacFrame(worker.message.spec.run.maxSteps) });
      worker.emit({ type: 'result', result: makeResult(worker) });
      assert.equal(useSimulationStore.getState().results.flowSnapshot, null, change);
      assert.equal(useSimulationStore.getState().results.job, null, change);
    } finally { cleanup(); }
  }
});

test('Worker failure clears an intermediate preview and leaves no completed result', async t => {
  const { harness, cleanup } = fixture(); t.after(cleanup);
  const { run, worker } = await beginSyntheticRun(harness);
  worker.emit({ type: 'error', error: 'synthetic worker failure' });
  await run;
  assert.equal(harness.result.status, 'failed');
  assert.equal(harness.result.error, 'synthetic worker failure');
  assert.equal(useSimulationStore.getState().results.flowSnapshot, null);
  assert.equal(useSimulationStore.getState().results.job, null);
});

test('display-only parameter changes preserve the active preview', async t => {
  const { harness, cleanup } = fixture(); t.after(cleanup);
  const { run, worker } = await beginSyntheticRun(harness);
  worker.emit({ type: 'frame', flow: makeMacFrame(5000) });
  worker.emit({ type: 'frame', flow: makeMacFrame(10000) });
  useSimulationStore.getState().updateParameters({ renderQuality: 'fine' });
  await tick();
  assert.equal(worker.terminated, false);
  assert.equal(useSimulationStore.getState().results.flowSnapshot?.step, 1);
  worker.emit({ type: 'result', result: makeResult(worker) });
  await run;
  assert.equal(harness.result.status, 'succeeded');
});

test('unmount aborts the Worker and prevents late result publication', async t => {
  const { harness, cleanup } = fixture();
  const { run, worker } = await beginSyntheticRun(harness);
  harness.unmount();
  await run;
  assert.equal(worker.terminated, true);
  worker.emit({ type: 'result', result: makeResult(worker) });
  assert.equal(useSimulationStore.getState().results.job, null);
  assert.equal(useSimulationStore.getState().results.flowSnapshot, null);
  cleanup();
});

test('Host success wins a Stop racing its complete acknowledgement without loading stale frames', async () => {
  const originalFetch = globalThis.fetch;
  let completeStarted!: () => void;
  const completeStartedPromise = new Promise<void>(resolve => { completeStarted = resolve; });
  let releaseComplete!: () => void;
  const completeResponseGate = new Promise<void>(resolve => { releaseComplete = resolve; });
  let downloaded = 0;
  const json = (value: unknown) => new Response(JSON.stringify(value), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    if (url.endsWith('/api/v1/me')) return new Response(null, { status: 200 });
    if (url.endsWith('/api/v1/artifacts') && method === 'POST') {
      const contentType = new Headers(init?.headers).get('content-type');
      if (contentType === MODEL_GEOMETRY_CONTENT_TYPE) return json({ artifact: { id: 'synthetic-model-artifact' } });
      const bodyBytes = new Response(init?.body).arrayBuffer();
      const bytes = (await bodyBytes).byteLength;
      return json({ artifact: {
        id: 'synthetic-flow-sequence', bytes, kind: MAC_FLOW_SEQUENCE_KIND,
        contentType: MAC_FLOW_SEQUENCE_CONTENT_TYPE,
      } });
    }
    if (url.endsWith('/api/v1/jobs') && method === 'POST') {
      return json({ job: { id: 'synthetic-job', agentId: 'browser-synthetic', status: 'leased', attempt: 0 } });
    }
    if (url.endsWith('/synthetic-job/heartbeat')) {
      return json({ job: { id: 'synthetic-job', status: 'running' } });
    }
    if (url.endsWith('/synthetic-job/complete')) {
      const body = JSON.parse(String(init?.body)) as { result: JobResultV1 };
      completeStarted(); // Host has accepted the completion; response is held to reproduce the race.
      await completeResponseGate;
      return json({ job: { id: 'synthetic-job', status: 'succeeded', result: body.result } });
    }
    if (url.includes('/api/v1/artifacts/')) {
      downloaded++;
      throw new Error('Stop must prevent local result download');
    }
    throw new Error(`Unexpected synthetic request ${method} ${url}`);
  };
  const { harness, cleanup } = fixture();
  try {
    const starting = harness.result.start(true);
    for (let i = 0; i < 10 && StubWorker.instances.length === 0; i++) await tick();
    const worker = StubWorker.instances.at(-1)!;
    assert.ok(worker, 'published browser run should use the stub Worker');
    for (const step of [1, 5000, worker.message.spec.run.maxSteps]) worker.emit({ type: 'frame', flow: makeMacFrame(step) });
    worker.emit({ type: 'result', result: makeResult(worker) });
    await completeStartedPromise;

    const stopping = harness.result.stop();
    releaseComplete();
    await Promise.all([starting, stopping]);

    assert.equal(harness.result.status, 'host-completed-local-canceled');
    assert.match(harness.result.error ?? '', /Host.*完成.*停止读取结果/);
    assert.equal(downloaded, 0);
    assert.equal(useSimulationStore.getState().results.job, null);
    assert.equal(useSimulationStore.getState().results.flowSnapshot, null);
    worker.emit({ type: 'frame', flow: makeMacFrame(worker.message.spec.run.maxSteps) });
    assert.equal(useSimulationStore.getState().results.flowSnapshot, null);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});
