import { stationaryMassReport } from './lbm-result-fixture';
import { LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE } from '@w-sim/contracts';
import assert from 'node:assert/strict';
import { prepareProductLbmLattice } from '@w-sim/solvers-lbm/d3q19';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeModelGeometry, decodeModelGeometry, MODEL_GEOMETRY_CONTENT_TYPE, MODEL_GEOMETRY_ARTIFACT_KIND } from '../../lab/src/lib/models/geometry-contract.ts';
import { TaskApiClient } from '../../lab/agent/src/client.ts';
import { loadModelGeometry } from '../../lab/agent/src/load-model.ts';
import { encodeFlowSnapshot, decodeFlowSnapshot, flowSpeedReference, FLOW_SNAPSHOT_KIND, FLOW_SNAPSHOT_CONTENT_TYPE } from '../../lab/src/lib/cfd/flow-snapshot.ts';
import { createSettlementClient } from '../../lab/src/lib/w-sim/settlement-client.ts';
import { lbmGeometry } from '../../../scripts/ci/lbm-fixture';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'waveworld-mesh-'));
before(() => {
  process.env.TASK_DB_PATH = path.join(temp, 'tasks.db');
  process.env.ARTIFACT_ROOT = path.join(temp, 'artifacts');
  Object.assign(process.env, { NODE_ENV: 'production' });
});
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const geometry = {
  vertices: new Float32Array([0, 0, 0, 1.25, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
};
const snapshot = {
  nx: 2, ny: 2, nz: 2, step: 1, displayStride: 2 as const, uLattice: 0.0625,
  display: Float32Array.from({ length: 16 }, (_, i) => i / 32),
  flags: new Uint32Array([0, 0, 0, 1, 0, 0, 0, 0]),
};

test('flow transport preserves all field cells and rejects invalid dimensions and payloads', () => {
  const bytes = encodeFlowSnapshot(snapshot);
  assert.deepEqual(decodeFlowSnapshot(bytes), snapshot);
  assert.throws(() => decodeFlowSnapshot(bytes.slice(0, -4)), /不完整/);
  const invalid = bytes.slice(0);
  new DataView(invalid).setUint32(4, 0xffffffff, true);
  assert.throws(() => decodeFlowSnapshot(invalid), /限制/);
  new DataView(bytes).setFloat32(32, Infinity, true);
  assert.throws(() => decodeFlowSnapshot(bytes), /非有限值/);
});

test('thermal flow preserves region material IDs and rejects unknown or nonthermal material flags', () => {
  const thermal = { ...snapshot, uLattice: 0, displayStride: 3 as const, display: new Float32Array(24), flags: new Uint32Array([0, 2, 3, 4, 5, 6, 19, 20]) };
  thermal.display[0] = 0.125;
  thermal.display[3] = 999; // A solid cell must not set the velocity color reference.
  assert.equal(flowSpeedReference(thermal), 0.125);
  assert.equal(flowSpeedReference({ ...thermal, uLattice: 0.0625 }), 0.0625);
  const bytes = encodeFlowSnapshot(thermal);
  assert.deepEqual(decodeFlowSnapshot(bytes), thermal);
  new DataView(bytes).setUint32(bytes.byteLength - 4, 21, true);
  assert.throws(() => decodeFlowSnapshot(bytes), /未知材料/);
  assert.throws(() => encodeFlowSnapshot({ ...snapshot, flags: thermal.flags }), /未知材料/);
});

test('mesh transport is lossless and rejects truncated, non-finite and invalid-index data', () => {
  const bytes = encodeModelGeometry(geometry);
  assert.deepEqual(decodeModelGeometry(bytes), geometry);
  assert.throws(() => decodeModelGeometry(bytes.slice(0, -1)), /不完整/);
  const nonFinite = bytes.slice(0);
  new DataView(nonFinite).setFloat32(20, NaN, true);
  assert.throws(() => decodeModelGeometry(nonFinite), /非有限值/);
  const badIndex = bytes.slice(0);
  new DataView(badIndex).setUint32(badIndex.byteLength - 4, 99, true);
  assert.throws(() => decodeModelGeometry(badIndex), /索引越界/);
});

test('Host admits the owner mesh and only the leasing agent downloads that job input', async () => {
  const geometry = lbmGeometry;
  const { devLogin } = await import('../src/lib/user-auth.ts');
  const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
  const { claimJob, completeJob } = await import('../src/lib/tasks/service.ts');
  const { defaultJobSpec } = await import('../src/types/task.ts');
  const upload = await import('../src/app/api/v1/artifacts/route.ts');
  const download = await import('../src/app/api/v1/artifacts/[id]/route.ts');
  const jobs = await import('../src/app/api/v1/jobs/route.ts');
  const alice = await devLogin({ name: 'mesh-alice', workspaceId: 'mesh-tests' });
  const bob = await devLogin({ name: 'mesh-bob', workspaceId: 'mesh-tests' });
  const bytes = encodeModelGeometry(geometry);
  const uploaded = await upload.POST(new Request('http://host.test/api/v1/artifacts', {
    method: 'POST', body: bytes,
    headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': MODEL_GEOMETRY_CONTENT_TYPE, 'X-Artifact-Kind': MODEL_GEOMETRY_ARTIFACT_KIND },
  }));
  const wrongType = await upload.POST(new Request('http://host.test/api/v1/artifacts', {
    method: 'POST', body: bytes,
    headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/vnd.waveworld.mesh-v1', 'X-Artifact-Kind': MODEL_GEOMETRY_ARTIFACT_KIND },
  }));
  assert.equal(wrongType.status, 400, 'header version and content type must match');
  const legacyBytes = new Uint8Array(bytes.byteLength - 4);
  legacyBytes.set(new Uint8Array(bytes, 0, 16)); legacyBytes.set(new Uint8Array(bytes, 20), 16);
  new DataView(legacyBytes.buffer).setUint32(0, 0x314d4757, true);
  const legacy = await upload.POST(new Request('http://host.test/api/v1/artifacts', {
    method: 'POST', body: legacyBytes,
    headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/vnd.waveworld.mesh-v1', 'X-Artifact-Kind': MODEL_GEOMETRY_ARTIFACT_KIND },
  }));
  assert.equal(legacy.status, 201, 'existing WGM1 clients remain accepted');
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const { artifact } = await uploaded.json();
  const spec = defaultJobSpec({ parameters: { viscosityMode: 'stabilized-preview' }, model: { source: 'artifact', artifactId: artifact.id, referenceLength: 4.5 }, run: { maxSteps: 1, warmupSteps: 0 }, outputs: { fields: ['velocity', 'vorticity'] } });
  const submit = (token: string) => jobs.POST(new Request('http://host.test/api/v1/jobs', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ spec }),
  }));
  assert.equal((await submit(bob.token)).status, 403);
  const submitted = await submit(alice.token);
  assert.equal(submitted.status, 201, await submitted.clone().text());
  const { job } = await submitted.json();
  const { agent, token } = await registerAgent({ name: 'mesh-agent', capabilities: { kinds: ['lbm-d3q19'], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE], backends: ['webgpu'] } });
  const stranger = await registerAgent({ name: 'mesh-stranger', capabilities: { kinds: ['lbm-d3q19'], features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE], backends: ['webgpu'] } });
  assert.equal(claimJob({ agentId: agent.id, capabilities: agent.capabilities })?.id, job.id);
  const get = (token: string, jobId?: string) => download.GET(new Request(`http://host.test/api/v1/artifacts/${artifact.id}${jobId ? `?jobId=${jobId}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  }), { params: Promise.resolve({ id: artifact.id }) });
  assert.equal((await get(token)).status, 403);
  assert.equal((await get(stranger.token, job.id)).status, 403);
  assert.equal((await get(token, crypto.randomUUID())).status, 403);
  const heartbeat = await import('../src/app/api/v1/jobs/[id]/heartbeat/route');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).endsWith('/heartbeat')
    ? heartbeat.POST(new Request(url, init), { params: Promise.resolve({ id: job.id }) })
    : init?.method === 'POST'
    ? upload.POST(new Request(url, init))
    : download.GET(new Request(url, init), { params: Promise.resolve({ id: new URL(String(url)).pathname.split('/').at(-1)! }) });
  try {
    const client = new TaskApiClient('http://host.test', token);
    const loaded = await loadModelGeometry(spec.model!, { loadArtifact: (id, signal) => client.downloadModel(id, job.id, signal) });
    assert.deepEqual(loaded, geometry);
    await assert.rejects(loadModelGeometry(spec.model!, { signal: AbortSignal.abort(), loadArtifact: () => { throw new Error('must not fetch'); } }), { name: 'AbortError' });
    const result = { schemaVersion: 1 as const, summary: { steps: 1, wallTimeMs: 1, cd: 0, cl: 0, dragN: 0, liftN: 0 },
      history: { step: [1], cd: [0], cl: [0], dragN: [0], liftN: [0] },
      lbmMassBalance: stationaryMassReport(), derived: { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...prepareProductLbmLattice(spec, loaded).units }, backend: { id: 'webgpu', agentId: agent.id } };
    assert.throws(() => completeJob({ jobId: job.id, agentId: agent.id, result }), /display artifact/);
    const flow = await client.uploadFlowSnapshot(job.id, snapshot);
    assert.equal(flow.kind, FLOW_SNAPSHOT_KIND);
    assert.equal(flow.contentType, FLOW_SNAPSHOT_CONTENT_TYPE);
    completeJob({ jobId: job.id, agentId: agent.id, result: { ...result, artifacts: [flow] } });
    const browserClient = createSettlementClient({ baseUrl: 'http://host.test', fetchImpl: (url, init) => fetch(url, {
      ...init, headers: { ...init?.headers, Authorization: `Bearer ${alice.token}` },
    }) });
    assert.deepEqual(await browserClient.downloadFlowSnapshot(flow, new AbortController().signal), snapshot);
    const denied = await download.GET(new Request(`http://host.test/api/v1/artifacts/${flow.artifactId}`, {
      headers: { Authorization: `Bearer ${bob.token}` },
    }), { params: Promise.resolve({ id: flow.artifactId }) });
    assert.equal(denied.status, 403);
    await assert.rejects(client.downloadModel(artifact.id, job.id), /403/);
    await assert.rejects(client.uploadFlowSnapshot(job.id, snapshot), /403|409/);
  } finally { globalThis.fetch = originalFetch; }
});


test('resident frame uploads renew each lease and stop before transfer on expiry or cancellation', async () => {
  const { TaskApiClient } = await import('../../lab/agent/src/client');
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let now = 0, expires = 60000, denied = false;
  let abortOnRenew: AbortController | undefined;
  globalThis.fetch = async (url, init) => {
    assert.ok(init?.signal, 'both heartbeat and transfer require a bounded signal');
    if (String(url).endsWith('/heartbeat')) {
      calls.push('renew');
      if (denied || now >= expires) return Response.json({ error: 'lease expired' }, { status: 409 });
      expires = now + 60000;
      abortOnRenew?.abort();
      return Response.json({ job: { leaseExpiresAt: new Date(expires).toISOString() } });
    }
    calls.push('upload');
    now += 29000;
    return Response.json({ artifact: { id: `flow-${now}`, kind: FLOW_SNAPSHOT_KIND, contentType: FLOW_SNAPSHOT_CONTENT_TYPE, bytes: 128 } });
  };
  try {
    const client = new TaskApiClient('https://host.test', 'test-token');
    for (let step = 1; step <= 3; step++) assert.equal((await client.uploadFlowSnapshot('job', { ...snapshot, step })).step, step);
    assert.deepEqual(calls, ['renew', 'upload', 'renew', 'upload', 'renew', 'upload']);
    assert.ok(now > 60000, 'the sequence outlasts the initial lease');
    denied = true;
    await assert.rejects(client.uploadFlowSnapshot('job', snapshot), /409/);
    assert.equal(calls.at(-1), 'renew');
    denied = false; abortOnRenew = new AbortController();
    await assert.rejects(client.uploadFlowSnapshot('job', snapshot, abortOnRenew.signal), { name: 'AbortError' });
    assert.equal(calls.at(-1), 'renew', 'cancellation while renewing prevents the subsequent upload');
    const count = calls.length;
    await assert.rejects(client.uploadFlowSnapshot('job', snapshot, AbortSignal.abort()), { name: 'AbortError' });
    assert.equal(calls.length, count, 'an already cancelled transfer performs no request');
  } finally { globalThis.fetch = originalFetch; }
});
