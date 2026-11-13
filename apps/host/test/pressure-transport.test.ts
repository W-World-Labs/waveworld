import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { TaskApiClient } from '../../lab/agent/src/client';
import { createSettlementClient } from '../../lab/src/lib/w-sim/settlement-client';
import { encodeFlowSnapshot, FLOW_SNAPSHOT_KIND, FLOW_SNAPSHOT_CONTENT_TYPE, FLOW_SNAPSHOT_V2_CONTENT_TYPE } from '../../lab/src/lib/cfd/flow-snapshot';

test('resident and browser transport preserve WVF1/WVF2 MIME, bytes, saved step and download hash', async t => {
  const signal = new AbortController().signal;
  for (const pressure of [false, true]) {
    const snapshot = { nx: 2, ny: 1, nz: 1, step: 3, displayStride: pressure ? 3 as const : 2 as const,
      ...(pressure ? { hasPressure: true as const } : {}), uLattice: 0.0625,
      display: new Float32Array(pressure ? [1, 2, -0.25, 0, 0, 0] : [1, 2, 0, 0]), flags: new Uint32Array([0, 1]) };
    const bytes = encodeFlowSnapshot(snapshot), contentType = pressure ? FLOW_SNAPSHOT_V2_CONTENT_TYPE : FLOW_SNAPSHOT_CONTENT_TYPE;
    const hash = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
    let heartbeats = 0, posts = 0, responseType = contentType, responseHash = hash;
    const fetcher: typeof fetch = async (url, init) => {
      assert.ok(init?.signal);
      if (String(url).endsWith('/heartbeat')) { heartbeats++; return Response.json({ job: { status: 'running' } }); }
      if (init?.method === 'POST') {
        posts++;
        const headers = new Headers(init.headers);
        assert.equal(headers.get('content-type'), contentType);
        assert.equal(headers.get('x-artifact-kind'), FLOW_SNAPSHOT_KIND);
        assert.deepEqual(new Uint8Array(init.body as ArrayBuffer), new Uint8Array(bytes));
        return Response.json({ artifact: { id: 'field', bytes: bytes.byteLength, kind: FLOW_SNAPSHOT_KIND, contentType } });
      }
      return new Response(bytes, { headers: { 'content-type': responseType, 'x-artifact-sha256': responseHash } });
    };
    t.mock.method(globalThis, 'fetch', fetcher);
    const resident = new TaskApiClient('https://host.test', 'test-only-token');
    const nativeRef = await resident.uploadFlowSnapshot('job', snapshot, signal);
    assert.equal(heartbeats, 1);
    const browser = createSettlementClient({ baseUrl: 'https://host.test', fetchImpl: fetcher });
    const ref = await browser.uploadBrowserFlow('job', 'browser-agent', bytes, signal);
    assert.deepEqual(ref, nativeRef);
    assert.equal(posts, 2);
    assert.deepEqual(await browser.downloadFlowSnapshot(ref, signal), snapshot);
    await assert.rejects(browser.downloadFlowSnapshot({ ...ref, step: 1 }, signal), /时刻/);
    responseHash = 'invalid';
    await assert.rejects(browser.downloadFlowSnapshot(ref, signal), /校验/);
    responseHash = hash;
    responseType = pressure ? FLOW_SNAPSHOT_CONTENT_TYPE : FLOW_SNAPSHOT_V2_CONTENT_TYPE;
    await assert.rejects(browser.downloadFlowSnapshot(ref, signal), /类型/);
    await assert.rejects(browser.downloadFlowSnapshot({ ...ref, contentType: responseType }, signal), /格式版本/);
    t.mock.restoreAll();
  }
});
