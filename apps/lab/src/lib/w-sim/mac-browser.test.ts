import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { MAC_3D_FEATURE, type JobResultV1, type MacJobSpecV1 } from '@w-sim/contracts';
import { runBrowserCompute, runBrowserJob, inspectBrowserMacGrid } from '../../../../../src/lib/sim/browser-agent';
import { createSettlementClient } from './settlement-client';
import { encodeMacFlowSnapshot, MAC_FLOW_SNAPSHOT_KIND, MAC_FLOW_SNAPSHOT_CONTENT_TYPE } from '../cfd/mac-flow-snapshot';

const spec: MacJobSpecV1 = {
  schemaVersion: 1, kind: 'mac-3d', model: { source: 'inline', inline: {}, referenceLength: 0.03 },
  parameters: { grid: [3, 3, 3], characteristicCells: 3, dtSeconds: 0.0001, fluidDensity: 1.225, fluidViscosity: 1.81e-5, openFaces: 3 },
  run: { maxSteps: 3 }, outputs: { fields: ['velocity', 'pressure'], fieldFrames: 3, forces: false },
  requirements: { backends: ['cpu'], precision: 'float64', features: [MAC_3D_FEATURE] },
};
const result: JobResultV1 = { schemaVersion: 1, summary: { steps: 3, wallTimeMs: 1 }, derived: { [MAC_3D_FEATURE]: 1, dt: 0.0001 } };
const geometry = { vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) };
const frame = (step: number) => encodeMacFlowSnapshot({ nx: 3, ny: 3, nz: 3, step, displayStride: 4,
  fields: new Float32Array(27 * 4), flags: new Uint32Array(27) });

test('local flow can finish after 120 seconds and can still be cancelled without HTTP', async t => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Local computation must not call HTTP'); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const workers: WorkerStub[] = [];
  let terminated = 0, settled = false;
  class WorkerStub {
    onmessage?: (event: { data: unknown }) => void;
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { terminated++; }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: WorkerStub });
  try {
    const run = runBrowserCompute(spec, { signal: new AbortController().signal, geometry });
    void run.then(() => { settled = true; }, () => { settled = true; });
    t.mock.timers.tick(120001);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    assert.equal(settled, false);
    assert.equal(terminated, 0);
    for (const step of [1, 2, 3]) workers[0].onmessage?.({ data: { type: 'frame', flow: frame(step) } });
    workers[0].onmessage?.({ data: { type: 'result', result } });
    assert.equal((await run).flows.length, 3);
    const abort = new AbortController();
    const cancelled = runBrowserCompute(spec, { signal: abort.signal, geometry });
    t.mock.timers.tick(120001);
    abort.abort(new Error('Stopped by user'));
    await assert.rejects(cancelled, /Stopped by user/);
    assert.equal(terminated, 2);
  } finally {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});

test('grid inspection uses the existing isolated Worker and releases it on completion, cancellation and timeout', async t => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Inspection must not call HTTP'); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let mode = 'inspection', workers = 0, terminated = 0;
  const inspection = { cellCount: 27, solidCells: 1, fluidCells: 26, dxMeters: .01, fans: [], materials: [], contacts: [], fixedTemperature: null };
  class WorkerStub {
    onmessage?: (event: { data: unknown }) => void;
    constructor() { workers++; }
    postMessage(input: { action?: string; geometry: typeof geometry }) {
      assert.equal(input.action, 'inspect-mac');
      assert.equal(input.geometry, geometry);
      if (mode !== 'pending') queueMicrotask(() => this.onmessage?.({ data: { type: mode, inspection, result } }));
    }
    terminate() { terminated++; }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: WorkerStub });
  try {
    assert.deepEqual(await inspectBrowserMacGrid(spec, geometry, new AbortController().signal), inspection);
    mode = 'result';
    await assert.rejects(inspectBrowserMacGrid(spec, geometry, new AbortController().signal), /求解流程/);
    mode = 'pending';
    const abort = new AbortController();
    const cancelled = inspectBrowserMacGrid(spec, geometry, abort.signal);
    abort.abort(new Error('Changed model'));
    await assert.rejects(cancelled, /Changed model/);
    const timedOut = inspectBrowserMacGrid(spec, geometry, new AbortController().signal);
    t.mock.timers.tick(120000);
    await assert.rejects(timedOut, /120 秒/);
    await assert.rejects(inspectBrowserMacGrid(spec, geometry, abort.signal), /Changed model/);
    assert.equal(workers, 4);
    assert.equal(terminated, 4);
  } finally {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});

// Lifecycle test double only: physical stepping is verified in the shared Rust/WASM suite.
test('inspection and local execution explain solid-boundary code 11 while preserving unrelated errors', async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  let error = '', terminated = 0;
  class WorkerStub {
    onmessage?: (event: { data: unknown }) => void;
    postMessage() { queueMicrotask(() => this.onmessage?.({ data: { type: 'error', error } })); }
    terminate() { terminated++; }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: WorkerStub });
  const explanation = '模型为空或没有有效表面，或表面有开口、共享边异常、面方向不一致。请在建模软件中修复，或更换为闭合实体后重新检查；系统不会自动补洞或修改模型。（code 11）';
  try {
    for (const [raw, expected] of [
      ['Mesh solid boundary is empty, open, non-manifold at an edge or inconsistently oriented; supply closed solidTriangleCounts groups with every nonzero-area geometric edge paired in opposite directions. No welding or hole repair is performed (code 11)', explanation],
      ['Mesh voxelization failed: invalid coordinates, indices, solidTriangleCounts or grid (code 11)', explanation],
      ['Mesh voxelization failed: invalid coordinates, indices, solidTriangleCounts or grid (code 1)', null],
      ['Unrelated stage failed (code 11)', null],
    ] as const) {
      error = raw;
      await assert.rejects(inspectBrowserMacGrid(spec, geometry, new AbortController().signal), { message: expected ?? raw });
      await assert.rejects(runBrowserCompute(spec, { signal: new AbortController().signal, geometry }), { message: expected ?? raw });
    }
    assert.equal(terminated, 8);
  } finally {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});

test('anonymous MAC browser run requires no HTTP/GPU and rejects incomplete playback before terminating Worker', async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalFetch = globalThis.fetch;
  let omit = false, workers = 0, terminated = 0;
  class WorkerStub {
    onmessage?: (event: { data: unknown }) => void;
    postMessage(input: { spec: MacJobSpecV1 }) {
      assert.deepEqual(input.spec, spec);
      queueMicrotask(() => {
        for (const step of omit ? [3] : [1, 2, 3]) this.onmessage?.({ data: { type: 'frame', flow: frame(step) } });
        this.onmessage?.({ data: { type: 'result', result } });
      });
    }
    constructor() { workers++; }
    terminate() { terminated++; }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: WorkerStub });
  globalThis.fetch = async () => { throw new Error('Anonymous computation must not call HTTP'); };
  try {
    const computed = await runBrowserCompute(spec, { signal: new AbortController().signal, geometry });
    assert.equal(computed.flows.length, 3);
    assert.equal(computed.result, result);
    omit = true;
    await assert.rejects(runBrowserCompute(spec, { signal: new AbortController().signal, geometry }), /序列|采样/);
    await assert.rejects(runBrowserCompute(spec, { signal: new AbortController().signal }), /model/);
    assert.equal(workers, 2);
    assert.equal(terminated, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});

test('published MAC browser run streams frames before complete, uploads one sequence, and returns Host result', async t => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalFetch = globalThis.fetch;
  const workers: WorkerStub[] = [];
  const uploaded: number[][] = [];
  const events: string[] = [];
  const hostResult: JobResultV1 = {
    ...result,
    summary: { ...result.summary, wallTimeMs: 9876 },
  };
  const publishedSpec: MacJobSpecV1 = {
    ...spec,
    model: { source: 'artifact', artifactId: 'synthetic-model', referenceLength: 0.03 },
  };
  class WorkerStub {
    onmessage?: (event: { data: unknown }) => void;
    constructor() { workers.push(this); }
    postMessage(input: { spec: MacJobSpecV1 }) {
      assert.deepEqual(input.spec, publishedSpec);
      queueMicrotask(() => {
        for (const step of [1, 2, 3]) this.onmessage?.({ data: { type: 'frame', flow: frame(step) } });
        this.onmessage?.({ data: { type: 'result', result } });
      });
    }
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: WorkerStub });
  globalThis.fetch = async () => { throw new Error('Published browser test must not call HTTP'); };
  const client = {
    submitBrowser: async (submitted: MacJobSpecV1) => {
      assert.deepEqual(submitted, publishedSpec);
      events.push('submit');
      return { id: 'synthetic-job', agentId: 'synthetic-agent', attempt: 0 };
    },
    updateBrowser: async (_id: string, _agent: string, action: string, body?: { result?: JobResultV1 }) => {
      events.push(action);
      if (action === 'heartbeat') return { status: 'running' };
      assert.equal(action, 'complete');
      assert.ok(body?.result);
      assert.equal(body.result.artifacts?.length, 1);
      return { jobId: 'synthetic-job', status: 'succeeded', result: hostResult };
    },
    uploadBrowserFlowSequence: async (_id: string, _agent: string, frames: Array<{ step: number }>) => {
      uploaded.push(frames.map(item => item.step));
      return { id: 'synthetic-flow-sequence', kind: 'mac-flow-seq', bytes: 1 };
    },
    cancel: async () => { throw new Error('successful task must not be cancelled'); },
  } as unknown as Parameters<typeof runBrowserJob>[0];
  try {
    const returned = await runBrowserJob(client, publishedSpec, {
      signal: new AbortController().signal,
      geometry,
      onFrame: bytes => events.push(`frame-${new DataView(bytes).getUint32(16, true)}`),
    });
    assert.equal(workers.length, 1);
    assert.equal(returned, hostResult, 'return the Host stored result, not the Worker proposal');
    assert.deepEqual(uploaded, [[1, 2, 3]], 'all MAC frames are sent in one sequence upload');
    assert.deepEqual(events, ['submit', 'heartbeat', 'frame-1', 'frame-2', 'frame-3', 'complete']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});

test('published MAC browser run never sends fail after an ambiguous complete acknowledgement', async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalFetch = globalThis.fetch;
  const publishedSpec: MacJobSpecV1 = {
    ...spec,
    model: { source: 'artifact', artifactId: 'synthetic-model', referenceLength: 0.03 },
  };
  const completeAcks: Array<unknown | Error> = [
    new Error('response timed out after Host commit'),
    { jobId: 'synthetic-job', status: 'succeeded' },
    { jobId: 'other-job', status: 'succeeded', result },
    { jobId: 'synthetic-job', status: 'running' },
    { jobId: 'synthetic-job', status: 'failed', error: 'Host rejected completion' },
    { jobId: 'synthetic-job', status: 'cancelled' },
    { jobId: 'synthetic-job', status: 'queued' },
  ];
  let ackIndex = 0;
  class WorkerStub {
    onmessage?: (event: { data: unknown }) => void;
    postMessage() {
      queueMicrotask(() => {
        for (const step of [1, 2, 3]) this.onmessage?.({ data: { type: 'frame', flow: frame(step) } });
        this.onmessage?.({ data: { type: 'result', result } });
      });
    }
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: WorkerStub });
  globalThis.fetch = async () => { throw new Error('Synthetic published test must not call HTTP'); };
  try {
    for (const ack of completeAcks) {
      const calls: string[] = [];
      const client = {
        submitBrowser: async () => ({ id: 'synthetic-job', agentId: 'synthetic-agent', attempt: 0 }),
        updateBrowser: async (_id: string, _agent: string, action: string) => {
          calls.push(action);
          if (action === 'heartbeat') return { status: 'running' };
          if (action === 'complete') {
            const next = completeAcks[ackIndex++];
            if (next instanceof Error) throw next;
            return next;
          }
          return { jobId: 'synthetic-job', status: 'failed', error: 'unexpected second terminal write' };
        },
        uploadBrowserFlowSequence: async () => ({ id: 'synthetic-sequence', kind: 'mac-flow-seq', bytes: 1 }),
        cancel: async () => {},
        getStatus: async () => ({ status: 'succeeded' }),
      } as unknown as Parameters<typeof runBrowserJob>[0];
      await assert.rejects(runBrowserJob(client, publishedSpec, {
        signal: new AbortController().signal,
        geometry,
      }));
      assert.deepEqual(calls, ['heartbeat', 'complete'], 'complete ambiguity must be reconciled without a contradictory fail');
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});

test('browser settlement client validates and normalizes Host terminal acknowledgements', async () => {
  const good = createSettlementClient({
    baseUrl: 'https://host.invalid',
    fetchImpl: async () => new Response(JSON.stringify({ job: {
      id: 'job-1', status: 'succeeded', result,
    } }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  assert.deepEqual(await good.updateBrowser('job-1', 'browser-agent', 'complete', { result, attempt: 0 }), {
    jobId: 'job-1', status: 'succeeded', result,
  });

  for (const job of [
    { id: 'different-job', status: 'succeeded', result },
    { id: 'job-1', status: 'succeeded' },
    { id: 'job-1', status: 'running' },
    { id: 'job-1', status: 'failed' },
  ]) {
    const invalid = createSettlementClient({
      baseUrl: 'https://host.invalid',
      fetchImpl: async () => new Response(JSON.stringify({ job }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    });
    await assert.rejects(invalid.updateBrowser('job-1', 'browser-agent', 'complete', { result, attempt: 0 }), /Host|Invalid/);
  }
});

test('browser settlement reconciles a lost terminal acknowledgement from the owner-visible job', async () => {
  const calls: string[] = [];
  const client = createSettlementClient({
    baseUrl: 'https://host.invalid',
    fetchImpl: async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (init?.method === 'POST') throw new TypeError('connection closed after write');
      return Response.json({ job: { id: 'job-1', attempt: 0, status: 'succeeded', result } });
    },
  });
  assert.deepEqual(await client.updateBrowser('job-1', 'browser-agent', 'complete', { result, attempt: 0 }), {
    jobId: 'job-1', status: 'succeeded', result,
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0]!, /\/complete$/);
  assert.match(calls[1]!, /\/jobs\/job-1$/);
});

test('published MAC browser run reports lost fail acknowledgement as unresolved', async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalFetch = globalThis.fetch;
  const publishedSpec: MacJobSpecV1 = {
    ...spec,
    model: { source: 'artifact', artifactId: 'synthetic-model', referenceLength: 0.03 },
  };
  class WorkerStub {
    onmessage?: (event: { data: unknown }) => void;
    postMessage() { queueMicrotask(() => this.onmessage?.({ data: { type: 'error', error: 'synthetic worker failure' } })); }
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: WorkerStub });
  globalThis.fetch = async () => { throw new Error('Synthetic published test must not call HTTP'); };
  const calls: string[] = [];
  const client = {
    submitBrowser: async () => ({ id: 'synthetic-job', agentId: 'synthetic-agent', attempt: 0 }),
    updateBrowser: async (_id: string, _agent: string, action: string) => {
      calls.push(action);
      if (action === 'heartbeat') return { status: 'running' };
      throw new Error('fail response lost');
    },
    cancel: async () => {},
    getStatus: async () => ({ status: 'failed' }),
  } as unknown as Parameters<typeof runBrowserJob>[0];
  try {
    await assert.rejects(runBrowserJob(client, publishedSpec, {
      signal: new AbortController().signal,
      geometry,
    }), /Host outcome could not be confirmed.*synthetic-job/);
    assert.deepEqual(calls, ['heartbeat', 'fail']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});

test('published MAC browser run treats Host completion as authoritative when Stop races the acknowledgement', async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalFetch = globalThis.fetch;
  const abort = new AbortController();
  const publishedSpec: MacJobSpecV1 = {
    ...spec,
    model: { source: 'artifact', artifactId: 'synthetic-model', referenceLength: 0.03 },
  };
  class WorkerStub {
    onmessage?: (event: { data: unknown }) => void;
    postMessage() {
      queueMicrotask(() => {
        for (const step of [1, 2, 3]) this.onmessage?.({ data: { type: 'frame', flow: frame(step) } });
        this.onmessage?.({ data: { type: 'result', result } });
      });
    }
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: WorkerStub });
  globalThis.fetch = async () => { throw new Error('Synthetic published test must not call HTTP'); };
  const calls: string[] = [];
  const client = {
    submitBrowser: async () => ({ id: 'synthetic-job', agentId: 'synthetic-agent', attempt: 0 }),
    updateBrowser: async (_id: string, _agent: string, action: string) => {
      calls.push(action);
      if (action === 'heartbeat') return { status: 'running' };
      if (action === 'complete') {
        abort.abort(new DOMException('Stopped while Host acknowledgement was in flight', 'AbortError'));
        return { jobId: 'synthetic-job', status: 'succeeded', result };
      }
      throw new Error('completed Host task must not be cancelled or failed');
    },
    uploadBrowserFlowSequence: async () => ({ id: 'synthetic-sequence', kind: 'mac-flow-seq', bytes: 1 }),
    cancel: async () => { calls.push('cancel'); },
  } as unknown as Parameters<typeof runBrowserJob>[0];
  try {
    const returned = await runBrowserJob(client, publishedSpec, { signal: abort.signal, geometry });
    assert.equal(returned, result);
    assert.deepEqual(calls, ['heartbeat', 'complete']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});

test('published MAC browser run reports the Host failure reason after a failed acknowledgement', async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalFetch = globalThis.fetch;
  const publishedSpec: MacJobSpecV1 = {
    ...spec,
    model: { source: 'artifact', artifactId: 'synthetic-model', referenceLength: 0.03 },
  };
  class WorkerStub {
    onmessage?: (event: { data: unknown }) => void;
    postMessage() { queueMicrotask(() => this.onmessage?.({ data: { type: 'error', error: 'Worker-side error' } })); }
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: WorkerStub });
  globalThis.fetch = async () => { throw new Error('Synthetic published test must not call HTTP'); };
  const client = {
    submitBrowser: async () => ({ id: 'synthetic-job', agentId: 'synthetic-agent', attempt: 0 }),
    updateBrowser: async (_id: string, _agent: string, action: string) => action === 'heartbeat'
      ? { status: 'running' }
      : { jobId: 'synthetic-job', status: 'failed', error: 'Host-side failure reason' },
    cancel: async () => {},
  } as unknown as Parameters<typeof runBrowserJob>[0];
  try {
    await assert.rejects(runBrowserJob(client, publishedSpec, {
      signal: new AbortController().signal,
      geometry,
    }), /Host-side failure reason/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});

test('MAC artifact transport keeps WVM1 MIME, hash and mandatory frame step', async () => {
  const bytes = frame(3), hash = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
  let downloaded = 0;
  const client = createSettlementClient({ baseUrl: 'https://example.invalid', fetchImpl: async (_url, init) => {
    assert.equal(init?.credentials, 'include');
    if (init?.method === 'POST') {
      const headers = new Headers(init.headers);
      assert.equal(headers.get('content-type'), MAC_FLOW_SNAPSHOT_CONTENT_TYPE);
      assert.equal(headers.get('x-artifact-kind'), MAC_FLOW_SNAPSHOT_KIND);
      assert.equal(init.body, bytes);
      return Response.json({ artifact: { id: 'mac-frame', bytes: bytes.byteLength, kind: MAC_FLOW_SNAPSHOT_KIND, contentType: MAC_FLOW_SNAPSHOT_CONTENT_TYPE } });
    }
    downloaded++;
    return new Response(bytes, { headers: { 'content-type': MAC_FLOW_SNAPSHOT_CONTENT_TYPE, 'x-artifact-sha256': hash } });
  } });
  const signal = new AbortController().signal;
  const ref = await client.uploadBrowserFlow('job', 'browser-agent', bytes, signal, MAC_FLOW_SNAPSHOT_KIND);
  assert.equal(ref.step, 3);
  const decoded = await client.downloadFlowSnapshot(ref, signal);
  assert.ok('fields' in decoded);
  assert.equal(decoded.step, 3);
  await assert.rejects(client.downloadFlowSnapshot({ ...ref, step: undefined }, signal), /信息无效/);
  assert.equal(downloaded, 1, 'missing MAC step is rejected before network');
  await assert.rejects(client.downloadFlowSnapshot({ ...ref, step: 2 }, signal), /时刻/);
  await assert.rejects(client.uploadBrowserFlow('job', 'browser-agent', bytes, signal), /流场|格式/);
});
