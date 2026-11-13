import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LBM_PRESSURE_FIELD_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE } from '@w-sim/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WComputeClient, getComputeConfig, type ComputeAllocation, type ComputeInstance } from '../src/lib/tasks/w-compute-client';
import { createModuleJobSpec, computeModule, readModuleResult } from '../../../src/lib/sim/module-compute';
import { lbmGeometry, lbmSpec, fanSpec } from '../../../scripts/ci/lbm-fixture';
import { macGeometry, macSpec } from '../../../scripts/ci/mac-fixture';
import { prepareMacInput, runMacWasm } from '@w-sim/solvers-lbm/mac3d';
import { encodeMacFlowSnapshot, MAC_FLOW_SNAPSHOT_KIND, MAC_FLOW_SNAPSHOT_CONTENT_TYPE } from '../../lab/src/lib/cfd/mac-flow-snapshot';
import { encodeFlowSnapshot, FLOW_SNAPSHOT_KIND, FLOW_SNAPSHOT_CONTENT_TYPE, FLOW_SNAPSHOT_V2_CONTENT_TYPE } from '../../lab/src/lib/cfd/flow-snapshot';
import { prepareLbmInput, runLbmWasm } from '../../../src/lib/sim/lbm-compute';
import { encodeModelGeometry } from '../../lab/src/lib/models/geometry-contract';
import { particleScene } from '../../../scripts/ci/particle-fixture';
import { prepareParticleInput } from '../../../src/lib/sim/particles';
import { prepareMdInput } from '../../../src/lib/sim/md';
import { prepareFdtdInput } from '../../../src/lib/sim/fdtd';

const directory = mkdtempSync(path.join(tmpdir(), 'waveworld-compute-test-'));
process.env.TASK_DB_PATH = path.join(directory, 'tasks.db');
process.env.ARTIFACT_ROOT = path.join(directory, 'artifacts');
Object.assign(process.env, { W_COMPUTE_ENABLED: '1', W_COMPUTE_API_URL: 'https://compute.example.test', W_COMPUTE_TOKEN: 'test-only-token', W_COMPUTE_CLUSTER_ID: 'cluster', W_COMPUTE_TEMPLATE_ID: 'native' });
const config = getComputeConfig()!;
const input = { module: 'sim' as const, scene: { r: 0.2, steps: 2, seeds: [{ x: 0, y: 0, radius: 2, amount: 80 }] } };
let service: typeof import('../src/lib/tasks/service');
let db: typeof import('../src/lib/tasks/db');
let reconcile: typeof import('../src/lib/tasks/w-compute').reconcileComputeJobs;
let finalizeOrphans: typeof import('../src/lib/tasks/w-compute').finalizeOrphanedComputeRuns;
let result: Awaited<ReturnType<typeof computeModule>>;
before(async () => {
  service = await import('../src/lib/tasks/service'); db = await import('../src/lib/tasks/db');
  ({ reconcileComputeJobs: reconcile, finalizeOrphanedComputeRuns: finalizeOrphans } = await import('../src/lib/tasks/w-compute'));
  result = await computeModule(input);
});
after(() => rmSync(directory, { recursive: true, force: true }));
beforeEach(() => { db.getSqlite().exec('DELETE FROM job_attempt_outcomes; DELETE FROM compute_runs; DELETE FROM jobs'); });

function fake() {
  const instances = new Map<string, ComputeInstance>(), files = new Map<string, Uint8Array>();
  let creates = 0, stops = 0, uploads = 0, requests = 0, loseCreate = false, rejectPrice = false, expensive = false, stopOffline = false;
  let onUpload: (() => void) | undefined;
  let onDownload: ((name: string) => void) | undefined;
  const fetcher: typeof fetch = async (url, init) => {
    requests++;
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-only-token');
    const route = new URL(String(url)).pathname, body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    if (route.endsWith('/billing/quote')) return Response.json({ pricing_version: 'v1', enabled: expensive, currency: 'CNY', compute_hour: { amount_micros: expensive ? '100' : '0' }, storage_gib_hour_micros: 0, futureField: true });
    if (route === '/api/clusters/cluster/instances' && init?.method === 'POST') {
      creates++;
      if (rejectPrice) return Response.json({ error: 'price_changed' }, { status: 409 });
      const key = new Headers(init.headers).get('Idempotency-Key')!;
      assert.equal(body.pricing_version, 'v1');
      if (!instances.has(key)) instances.set(key, { id: key, cluster_id: 'cluster', name: body.name, template_id: body.template_id, state: 'running', desired: 'running', exit_code: null, generation: 1, observed_generation: 1, reserved: true });
      if (loseCreate) { loseCreate = false; throw new Error('lost response'); }
      return Response.json(instances.get(key));
    }
    if (route === '/api/clusters/cluster/instances') return Response.json([...instances.values()]);
    const id = route.split('/')[3], instance = instances.get(id);
    if (!instance) return Response.json({ error: 'not_found' }, { status: 404 });
    if (route.endsWith('/actions')) {
      stops++;
      assert.ok(service.getJob(id)?.status !== 'running', 'persist settlement before stopping');
      if (stopOffline) return Response.json({ error: 'node_offline' }, { status: 503 });
      instance.desired = 'stopped'; instance.generation++;
      return Response.json(instance);
    }
    if (route.includes('/files/')) {
      if (init?.method === 'PUT') {
        uploads++; onUpload?.();
        if (!route.endsWith('/job.json')) return Response.json({ name: 'flags.bin', size_bytes: (init.body as Uint8Array).length });
        const inputFile = JSON.parse(new TextDecoder().decode(init.body as Uint8Array));
        assert.equal(inputFile.jobId, id);
        if (inputFile.lbm || inputFile.mac) assert.equal(inputFile.inputs[0].name, 'flags.bin'); else assert.deepEqual(inputFile.inputs, []);
        files.set(id, new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, jobId: id, status: 'succeeded', files: [], result: { schemaVersion: 1, moduleResult: result, summary: { steps: 2, wallTimeMs: 1 }, backend: { id: 'cpu' }, derived: { precision: 'mixed', engine: 'rust-native' } } })));
        return Response.json({ name: 'job.json', size_bytes: 1 });
      }
      onDownload?.(route.split('/').at(-1)!);
      const data = files.get(`${id}/${route.split('/').at(-1)}`) ?? (route.endsWith('/result.json') ? files.get(id) : undefined);
      return data ? new Response(data.slice().buffer as ArrayBuffer) : Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (instance?.desired === 'stopped' && !stopOffline) { instance.state = 'stopped'; instance.reserved = false; instance.observed_generation = instance.generation; }
    return Response.json(instance);
  };
  return {
    client: () => new WComputeClient(config.origin, config.token, config.clusterId, fetcher), instances, files,
    get creates() { return creates; }, get stops() { return stops; }, get uploads() { return uploads; }, get requests() { return requests; },
    set loseCreate(value: boolean) { loseCreate = value; }, set rejectPrice(value: boolean) { rejectPrice = value; },
    set expensive(value: boolean) { expensive = value; }, set stopOffline(value: boolean) { stopOffline = value; },
    set onUpload(value: () => void) { onUpload = value; },
    set onDownload(value: (name: string) => void) { onDownload = value; },
  };
}
async function tick(remote: ReturnType<typeof fake>, concurrent = false) {
  db.getSqlite().exec('UPDATE compute_runs SET lock_until_ms = 0');
  // Fresh clients emulate process restarts; all ownership is in SQLite.
  const first = reconcile(config, remote.client());
  if (concurrent) await Promise.all([first, reconcile(config, remote.client())]); else await first;
}
function create() { return service.createJob({ spec: createModuleJobSpec(input), createdBy: 'owner' }); }

describe('managed native W-Compute lifecycle', { concurrency: false }, () => {
  it('rejects invalid model geometry before any quote, allocation, upload or prepared artifact', async () => {
    const { saveArtifact, listArtifacts } = await import('../src/lib/tasks/artifacts');
    const cases = [
      { scale: [1, 10, 1], error: /outside the simulation domain/ },
      { scale: [0, 1, 1], error: /X.*span|streamwise|X.*extent/i },
      { scale: [1, 1, 0.00001], error: /nonzero solid voxel volume/i },
      { scale: null, error: /模型数据大小无效/ },
    ];
    for (const { scale, error } of cases) {
      const data = scale ? new Uint8Array(encodeModelGeometry({ ...lbmGeometry,
        vertices: lbmGeometry.vertices.map((value, index) => value * scale[index % 3]) })) : new Uint8Array(8);
      const model = saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2', ownerUserId: 'owner', data });
      const spec = lbmSpec(model.id); spec.parameters.angleOfAttack = 0;
      const job = service.createJob({ spec, createdBy: 'owner' }), remote = fake();
      await tick(remote);
      const failed = service.getJob(job.id)!;
      assert.equal(failed.status, 'failed'); assert.match(failed.error ?? '', error);
      assert.equal(failed.result, null); assert.equal(failed.attempt, job.attempt);
      assert.equal(remote.requests, 0); assert.deepEqual(listArtifacts(job.id), []);
      await tick(remote);
      assert.equal(service.getJob(job.id)?.compute?.phase, 'stopped');
      assert.equal(remote.requests, 0);
    }
  });
  it('persists the shared FDTD materials and source timeline before instance creation', async () => {
    const input = { module: 'fdtd' as const, scene: { preset: 'lens' as const, boundary: 'mur' as const,
      shape: 'line' as const, time: 'cw' as const, omega: 0.3, steps: 3, sources: [{ i: 109, j: 100 }] } };
    const job = service.createJob({ spec: createModuleJobSpec(input), createdBy: 'owner' });
    const remote = fake();
    assert.equal(job.compute?.phase, 'queued');
    await tick(remote);
    const row = db.getSqlite().prepare('SELECT input_json FROM compute_runs WHERE job_id = ?').get(job.id) as { input_json: string };
    const prepared = JSON.parse(row.input_json);
    assert.deepEqual(prepared.fdtd, prepareFdtdInput(input.scene));
    assert.deepEqual(prepared.inputs, []);
    assert.equal(remote.creates, 0); assert.equal(remote.uploads, 0);
    assert.equal(service.getJob(job.id)?.compute?.phase, 'ready');
  });
  it('does not reinterpret a native-only FDTD operation as a legacy scene for managed compute', async () => {
    const spec = createModuleJobSpec({
      module: 'fdtd' as const, backend: 'host' as const, operation: 'cst-time-domain-sparams' as const,
      sampleInterval: 0.25, frequency: 1, referenceImpedanceOhms: 50,
      incident: [0, 1, 0, -1], reflected: [0, 0.25, 0, -0.25], transmitted: [0, 0.75, 0, -0.75],
    });
    // Simulate a misrouted managed-compute reservation. The exact native
    // selector must be rejected before any legacy `input.scene` preparation.
    spec.requirements = { backends: ['cpu'] };
    const job = service.createJob({ spec, createdBy: 'owner' }), remote = fake();
    assert.equal(job.compute?.phase, 'queued');
    await tick(remote);
    const failed = service.getJob(job.id)!;
    assert.equal(failed.status, 'failed');
    assert.match(failed.error ?? '', /native algorithm operations must use the native W-Sim module backend/i);
    assert.equal(remote.requests, 0); assert.equal(remote.creates, 0);
  });
  it('persists MD initial arrays before allocation and preserves them across reconciliation', async () => {
    const input = { module: 'md' as const, scene: { N: 64, temperature: 0.4, thermostat: true, barostat: true, targetP: 0.5, tauP: 0.5, steps: 7, seed: 3 } };
    const job = service.createJob({ spec: createModuleJobSpec(input), createdBy: 'owner' });
    const remote = fake();
    assert.equal(job.compute?.phase, 'queued');
    await tick(remote);
    const row = () => (db.getSqlite().prepare('SELECT input_json FROM compute_runs WHERE job_id = ?').get(job.id) as { input_json: string }).input_json;
    const prepared = row();
    assert.deepEqual(JSON.parse(prepared).md, prepareMdInput(input.scene));
    assert.deepEqual(JSON.parse(prepared).inputs, []);
    assert.equal(remote.creates, 0); assert.equal(remote.uploads, 0);
    await tick(remote);
    assert.equal(row(), prepared);
    assert.equal(remote.creates, 1);
  });
  it('persists user particle properties and imported arrays before creating an instance', async () => {
    const scene = particleScene(), spec = createModuleJobSpec({ module: 'particles', scene });
    const job = service.createJob({ spec, createdBy: 'owner' });
    const remote = fake();
    await tick(remote);
    const row = db.getSqlite().prepare('SELECT input_json FROM compute_runs WHERE job_id = ?').get(job.id) as { input_json: string };
    const envelope = JSON.parse(row.input_json);
    assert.deepEqual(envelope.md, prepareParticleInput(scene));
    assert.deepEqual(envelope.md.particles.kind, scene.kind);
    assert.deepEqual(envelope.inputs, []);
    assert.equal(remote.creates, 0); assert.equal(remote.uploads, 0);
    assert.equal(service.getJob(job.id)?.compute?.phase, 'ready');
  });
  it('reports an unresolved fan before allocating an instance, without retrying a bad input', async () => {
    const { saveArtifact } = await import('../src/lib/tasks/artifacts');
    const model = saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
      ownerUserId: 'owner', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
    const job = service.createJob({ spec: fanSpec(model.id), createdBy: 'owner' });
    const remote = fake();
    await tick(remote);
    assert.equal(service.getJob(job.id)?.status, 'failed');
    assert.match(service.getJob(job.id)?.error ?? '', /no fluid cells/);
    assert.equal(remote.creates, 0); assert.equal(remote.uploads, 0);
    await tick(remote);
    assert.equal(service.getJob(job.id)?.compute?.phase, 'stopped');
  });
  it('collects a real bounded flow history, rejects malformed manifests and still stops the instance', async () => {
    const { saveArtifact, readArtifactBytes } = await import('../src/lib/tasks/artifacts');
    const spec = lbmSpec(); spec.outputs.fieldFrames = 3;
    const solved = await runLbmWasm(spec, prepareLbmInput(spec, lbmGeometry));
    const frames = solved.snapshots.map(snapshot => new Uint8Array(encodeFlowSnapshot(snapshot)));
    for (const mode of ['valid', 'legacy', 'old-inlet', 'missing-mass', 'old-mass', 'missing', 'reordered', 'wrong-step', 'missing-step', 'unsafe-name', 'wrong-grid', 'cancelled', 'expired'] as const) {
      const model = saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
        ownerUserId: 'owner', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
      const jobSpec = { ...spec, outputs: { ...spec.outputs, ...(mode === 'legacy' ? { fieldFrames: undefined } : {}) }, model: { ...spec.model!, artifactId: model.id } };
      const job = service.createJob({ spec: jobSpec, createdBy: 'owner' });
      const remote = fake();
      for (let i = 0; i < 3; i++) await tick(remote);
      assert.equal(service.getJob(job.id)?.compute?.phase, 'running');
      const manifest = frames.map((data, i) => ({ name: i === frames.length - 1 ? 'flow.bin' : `flow-${i + 1}.bin`,
        step: i + 1, bytes: data.length, kind: FLOW_SNAPSHOT_KIND, contentType: FLOW_SNAPSHOT_CONTENT_TYPE }));
      frames.forEach((data, i) => remote.files.set(`${job.id}/${manifest[i].name}`, data));
      if (mode === 'legacy') { manifest.splice(0, 2); delete (manifest[0] as { step?: number }).step; }
      if (mode === 'missing') manifest.shift();
      if (mode === 'reordered') manifest.reverse();
      if (mode === 'wrong-step') manifest[0].step = 3;
      if (mode === 'missing-step') delete (manifest[0] as { step?: number }).step;
      if (mode === 'unsafe-name') manifest[0].name = '../job.json';
      if (mode === 'wrong-grid') remote.files.set(`${job.id}/flow-1.bin`, new Uint8Array(encodeFlowSnapshot({ ...solved.snapshots[0], uLattice: 0.1 })));
      const remoteResult = { ...solved.result, derived: { ...solved.result.derived } };
      if (mode === 'old-inlet') delete remoteResult.derived[LBM_NEE_INLET_FEATURE];
      if (mode === 'missing-mass') delete remoteResult.lbmMassBalance;
      if (mode === 'old-mass') delete remoteResult.derived[LBM_MASS_BALANCE_FEATURE];
      remote.files.set(job.id, new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, jobId: job.id, status: 'succeeded',
        files: manifest, result: remoteResult })));
      const now = Date.now;
      if (mode === 'cancelled') remote.onDownload = name => { if (name === 'flow-2.bin') service.cancelJob(job.id); };
      if (mode === 'expired') {
        const deadline = (db.getSqlite().prepare('SELECT deadline_ms FROM compute_runs WHERE job_id = ?').get(job.id) as { deadline_ms: number }).deadline_ms;
        remote.onDownload = name => { if (name === 'flow-2.bin') Date.now = () => deadline + 1; };
      }
      try { await tick(remote); } finally { Date.now = now; }
      for (let i = 0; i < 5; i++) await tick(remote);
      const stored = service.getJob(job.id)!;
      assert.equal(stored.status, ['valid', 'legacy'].includes(mode) ? 'succeeded' : mode === 'cancelled' ? 'cancelled' : 'failed', mode);
      if (mode === 'old-inlet') assert.equal(stored.error, 'W-Compute connection or result validation failed');
      assert.equal(stored.compute?.phase, 'stopped', mode);
      assert.equal(remote.instances.get(job.id)?.reserved, false);
      if (mode === 'valid') {
        assert.ok(solved.result.lbmMassBalance!.initialMassKg > 0);
        assert.deepEqual(stored.result?.lbmMassBalance, solved.result.lbmMassBalance);
        assert.deepEqual(stored.result?.artifacts?.map(ref => ref.step), [1, 2, 3]);
        stored.result!.artifacts!.forEach((ref, i) => assert.deepEqual(readArtifactBytes(ref.artifactId)!.data, Buffer.from(frames[i])));
      } else if (mode === 'legacy') {
        assert.deepEqual(stored.result?.artifacts?.map(ref => ref.step), [3]);
      } else assert.equal(stored.result, null);
    }
  });
  it('collects pressure frames with WVF2 and stops after missing-channel, marker or MIME failures', async () => {
    const { saveArtifact, readArtifactBytes } = await import('../src/lib/tasks/artifacts');
    const spec = lbmSpec(); spec.outputs = { ...spec.outputs, fields: ['velocity', 'pressure'], fieldFrames: 3 };
    spec.requirements!.features!.push(LBM_PRESSURE_FIELD_FEATURE);
    const solved = await runLbmWasm(spec, prepareLbmInput(spec, lbmGeometry));
    const frames = solved.snapshots.map(frame => new Uint8Array(encodeFlowSnapshot(frame)));
    for (const mode of ['valid', 'wrong-mime', 'missing-channel', 'missing-marker'] as const) {
      const model = saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
        ownerUserId: 'owner', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
      const job = service.createJob({ spec: { ...spec, model: { ...spec.model!, artifactId: model.id } }, createdBy: 'owner' });
      const remote = fake();
      for (let i = 0; i < 3; i++) await tick(remote);
      assert.equal(service.getJob(job.id)?.compute?.phase, 'running');
      const manifest = frames.map((data, index) => ({ name: index === 2 ? 'flow.bin' : `flow-${index + 1}.bin`,
        step: index + 1, bytes: data.length, kind: FLOW_SNAPSHOT_KIND,
        contentType: mode === 'wrong-mime' ? FLOW_SNAPSHOT_CONTENT_TYPE : FLOW_SNAPSHOT_V2_CONTENT_TYPE }));
      frames.forEach((data, index) => remote.files.set(`${job.id}/${manifest[index].name}`, data));
      if (mode === 'missing-channel') {
        const old = encodeFlowSnapshot({ ...solved.snapshots[0], hasPressure: undefined, displayStride: 2,
          display: new Float32Array(solved.snapshots[0].flags.length * 2) });
        remote.files.set(`${job.id}/flow-1.bin`, new Uint8Array(old)); manifest[0].bytes = old.byteLength;
      }
      const result = structuredClone(solved.result);
      if (mode === 'missing-marker') delete result.derived![LBM_PRESSURE_FIELD_FEATURE];
      remote.files.set(job.id, new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, jobId: job.id, status: 'succeeded', files: manifest, result })));
      for (let i = 0; i < 6; i++) await tick(remote);
      const stored = service.getJob(job.id)!;
      assert.equal(stored.status, mode === 'valid' ? 'succeeded' : 'failed', mode);
      assert.equal(stored.compute?.phase, 'stopped', mode);
      assert.equal(remote.instances.get(job.id)?.reserved, false);
      if (mode === 'valid') {
        assert.equal(stored.result?.derived?.pressureScalePa, solved.result.derived?.pressureScalePa);
        assert.deepEqual(stored.result?.artifacts?.map(ref => ref.step), [1, 2, 3]);
        stored.result!.artifacts!.forEach((ref, index) => {
          assert.equal(ref.contentType, FLOW_SNAPSHOT_V2_CONTENT_TYPE);
          assert.deepEqual(readArtifactBytes(ref.artifactId)!.data, Buffer.from(frames[index]));
        });
      } else assert.equal(stored.result, null);
    }
  });
  it('collects MAC SI frames and stops after successful, corrupt, cancelled and expired transfers', async () => {
    const { saveArtifact, readArtifactBytes } = await import('../src/lib/tasks/artifacts');
    const spec = macSpec(undefined, true), prepared = prepareMacInput(spec, macGeometry);
    const solved = await runMacWasm({ spec, input: prepared.mac, flags: prepared.flags });
    const frames = solved.snapshots.map(frame => new Uint8Array(encodeMacFlowSnapshot(frame)));
    for (const mode of ['valid', 'missing-step', 'wrong-kind', 'cancelled', 'expired'] as const) {
      const model = saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
        ownerUserId: 'owner', data: new Uint8Array(encodeModelGeometry(macGeometry)) });
      const job = service.createJob({ spec: { ...spec, model: { ...spec.model!, artifactId: model.id } }, createdBy: 'owner' });
      const remote = fake();
      for (let i = 0; i < 3; i++) await tick(remote);
      assert.equal(service.getJob(job.id)?.compute?.phase, 'running');
      const manifest = frames.map((data, i) => ({ name: i === 2 ? 'flow.bin' : `flow-${i + 1}.bin`, step: i + 1,
        bytes: data.length, kind: MAC_FLOW_SNAPSHOT_KIND as string, contentType: MAC_FLOW_SNAPSHOT_CONTENT_TYPE }));
      frames.forEach((data, i) => remote.files.set(`${job.id}/${manifest[i].name}`, data));
      if (mode === 'missing-step') delete (manifest[0] as { step?: number }).step;
      if (mode === 'wrong-kind') manifest[0].kind = FLOW_SNAPSHOT_KIND;
      remote.files.set(job.id, new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, jobId: job.id,
        status: 'succeeded', files: manifest, result: solved.result })));
      const now = Date.now;
      if (mode === 'cancelled') remote.onDownload = name => { if (name === 'flow-2.bin') service.cancelJob(job.id); };
      if (mode === 'expired') {
        const deadline = (db.getSqlite().prepare('SELECT deadline_ms FROM compute_runs WHERE job_id = ?').get(job.id) as { deadline_ms: number }).deadline_ms;
        remote.onDownload = name => { if (name === 'flow-2.bin') Date.now = () => deadline + 1; };
      }
      try { await tick(remote); } finally { Date.now = now; }
      for (let i = 0; i < 5; i++) await tick(remote);
      const stored = service.getJob(job.id)!;
      assert.equal(stored.status, mode === 'valid' ? 'succeeded' : mode === 'cancelled' ? 'cancelled' : 'failed', mode);
      assert.equal(stored.compute?.phase, 'stopped', mode);
      assert.equal(remote.instances.get(job.id)?.reserved, false);
      if (mode === 'valid') stored.result!.artifacts!.forEach((ref, i) => assert.deepEqual(readArtifactBytes(ref.artifactId)!.data, Buffer.from(frames[i])));
      else assert.equal(stored.result, null);
    }
  });
  it('recovers a lost create response, excludes pull agents, persists results then confirms stop', async () => {
    const remote = fake(), job = create(); remote.loseCreate = true;
    const capabilities = { kinds: ['waveworld-module' as const], backends: ['cpu' as const] };
    assert.equal(service.claimJob({ agentId: 'other', capabilities, jobId: job.id }), null);
    assert.equal(service.claimJob({ agentId: 'other', capabilities }), null);
    for (let i = 0; i < 9; i++) await tick(remote, true);
    assert.equal(remote.creates, 2); assert.equal(remote.instances.size, 1); assert.equal(remote.uploads, 1);
    const stored = service.getJob(job.id)!;
    assert.equal(stored.status, 'succeeded'); assert.deepEqual(readModuleResult(stored.result!, input), result);
    assert.equal(stored.createdBy, 'owner'); assert.equal(stored.compute?.phase, 'stopped');
    assert.equal(remote.stops, 1); assert.equal(remote.instances.get(job.id)?.reserved, false);
  });
  it('cancellation during upload discards late results and keeps cleanup pending while offline', async () => {
    const remote = fake(), job = create();
    remote.onUpload = () => service.cancelJob(job.id);
    for (let i = 0; i < 3; i++) await tick(remote);
    remote.stopOffline = true;
    await tick(remote); await tick(remote);
    assert.equal(service.getJob(job.id)?.status, 'cancelled'); assert.equal(service.getJob(job.id)?.result, null);
    assert.equal(service.getJob(job.id)?.compute?.phase, 'stopping');
    assert.equal(remote.instances.get(job.id)?.reserved, true);
    remote.stopOffline = false;
    await tick(remote); await tick(remote);
    assert.equal(service.getJob(job.id)?.compute?.phase, 'stopped');
  });
  it('cancelled queued jobs allocate nothing; unsupported modules remain on their existing runner', async () => {
    const remote = fake(), job = create(); service.cancelJob(job.id);
    await tick(remote); assert.equal(remote.creates, 0); assert.equal(service.getJob(job.id)?.compute?.phase, 'stopped');
    const other = service.createJob({ spec: createModuleJobSpec({ module: 'display', scene: { mode: 'LED', bandgap: 2 } }) });
    assert.equal(other.compute, undefined);
    assert.ok(service.claimJob({ agentId: 'other', jobId: other.id, capabilities: { kinds: ['waveworld-module'], backends: ['cpu'] } }));
  });
  it('price ceilings and changed quotes fail without creating a billable instance', async () => {
    for (const reason of ['expensive', 'rejectPrice'] as const) {
      const remote = fake(), job = create(); remote[reason] = true;
      for (let i = 0; i < 4; i++) await tick(remote);
      assert.equal(service.getJob(job.id)?.status, 'failed'); assert.equal(service.getJob(job.id)?.compute?.phase, 'stopped');
      assert.equal(remote.instances.size, 0);
    }
  });
  it('bounds admission and prevents expired managed leases from requeueing duplicate work', async () => {
    const remote = fake(), first = create(), second = create(); await tick(remote);
    assert.equal(service.getJob(second.id)?.status, 'queued');
    db.getSqlite().prepare("UPDATE jobs SET lease_expires_at = '2000-01-01' WHERE id = ?").run(first.id);
    service.requeueExpiredLeases(); assert.notEqual(service.getJob(first.id)?.status, 'queued');
    for (let i = 0; i < 12; i++) await tick(remote);
    assert.equal(remote.instances.size, 2); assert.equal(service.getJob(second.id)?.compute?.phase, 'stopped');
  });
  it('enforces the durable deadline even when a native result never arrives', async () => {
    const remote = fake(), job = create(); for (let i = 0; i < 3; i++) await tick(remote);
    remote.files.clear(); db.getSqlite().prepare('UPDATE compute_runs SET deadline_ms = 0 WHERE job_id = ?').run(job.id);
    await tick(remote); await tick(remote);
    assert.equal(service.getJob(job.id)?.status, 'failed'); assert.equal(service.getJob(job.id)?.compute?.phase, 'stopped');
  });
  it('rechecks a result after observing exit instead of racing the final atomic rename', async () => {
    const remote = fake(), job = create(); for (let i = 0; i < 3; i++) await tick(remote);
    const bytes = remote.files.get(job.id)!; remote.files.delete(job.id);
    remote.instances.get(job.id)!.state = 'exited';
    await tick(remote);
    assert.equal(service.getJob(job.id)?.compute?.phase, 'collecting');
    remote.files.set(job.id, bytes);
    for (let i = 0; i < 3; i++) await tick(remote);
    assert.equal(service.getJob(job.id)?.status, 'succeeded'); assert.equal(service.getJob(job.id)?.compute?.phase, 'stopped');
  });
  it('never accepts another job result and still stops its own instance', async () => {
    const remote = fake(), job = create(); for (let i = 0; i < 3; i++) await tick(remote);
    const payload = JSON.parse(new TextDecoder().decode(remote.files.get(job.id))); payload.jobId = 'other';
    remote.files.set(job.id, new TextEncoder().encode(JSON.stringify(payload)));
    for (let i = 0; i < 5; i++) await tick(remote);
    assert.equal(service.getJob(job.id)?.status, 'failed'); assert.equal(service.getJob(job.id)?.result, null);
    assert.equal(service.getJob(job.id)?.compute?.phase, 'stopped');
  });
  it('terminates a stopping run honestly when its instance is already absent from the cluster', async () => {
    const remote = fake(), job = create();
    for (let i = 0; i < 3; i++) await tick(remote);
    assert.equal(service.getJob(job.id)?.compute?.phase, 'running');
    // The instance disappears out of band; the next reconciliation sees a
    // definitive 404 rather than an unreachable node.
    remote.instances.delete(job.id);
    service.cancelJob(job.id);
    await tick(remote);
    const stored = service.getJob(job.id)!;
    assert.equal(stored.status, 'cancelled');
    assert.equal(stored.compute?.phase, 'stopped');
    assert.match(stored.compute?.error ?? '', /absent.*not observed/i);
    // Terminal rows are no longer selected, so reconciliation makes no more RPCs.
    const requests = remote.requests;
    await tick(remote);
    assert.equal(remote.requests, requests);
  });
  it('finalizes disabled reservations honestly instead of queueing them forever', async () => {
    const remote = fake(), started = create(), job = create();
    for (let i = 0; i < 3; i++) await tick(remote);
    // maxConcurrent=1 admits only the older row; the reservation alone keeps
    // the queued job invisible to external pull agents.
    assert.equal(service.getJob(started.id)?.compute?.phase, 'running');
    assert.equal(service.getJob(job.id)?.status, 'queued');
    assert.equal(service.getJob(job.id)?.compute?.phase, 'queued');
    assert.equal(service.claimJob({ agentId: 'other', capabilities: { kinds: ['waveworld-module'], backends: ['cpu'] } }), null);
    const cancelled = create(); service.cancelJob(cancelled.id);
    // W-Compute disabled: no reconciler runs, so the pass finalizes only rows
    // that provably never allocated an instance.
    assert.equal(finalizeOrphans(), 2);
    const stored = service.getJob(job.id)!;
    assert.equal(stored.status, 'failed');
    assert.match(stored.error ?? '', /disabled before the managed run started/i);
    assert.equal(stored.compute?.phase, 'stopped');
    assert.match(stored.compute?.error ?? '', /disabled before an instance was allocated/i);
    const done = service.getJob(cancelled.id)!;
    assert.equal(done.status, 'cancelled');
    assert.equal(done.compute?.phase, 'stopped');
    // A run that may back a live instance keeps its phase so a re-enabled
    // reconciler resumes cleanup and settlement.
    const live = service.getJob(started.id)!;
    assert.equal(live.status, 'running');
    assert.equal(live.compute?.phase, 'running');
    for (let i = 0; i < 5; i++) await tick(remote);
    assert.equal(service.getJob(started.id)?.status, 'succeeded');
    assert.equal(service.getJob(started.id)?.compute?.phase, 'stopped');
    assert.equal(service.getJob(job.id)?.status, 'failed');
  });
  it('never reserves cuda-only jobs for the cpu-only managed worker', async () => {
    const swJob = service.createJob({ spec: createModuleJobSpec({ module: 'sw-fds-solid-obstruction' as const, backend: 'cuda' }), createdBy: 'owner' });
    assert.equal(db.getSqlite().prepare('SELECT job_id FROM compute_runs WHERE job_id = ?').get(swJob.id), undefined);
    assert.equal(service.getJob(swJob.id)?.status, 'queued');
    // The job stays visible to external agents carrying the cuda backend.
    const claimed = service.claimJob({ agentId: 'gpu-agent', capabilities: { kinds: ['waveworld-module'], backends: ['cuda'], features: ['waveworld-module'] } });
    assert.equal(claimed?.id, swJob.id);
  });
  it('releases a stale reservation instead of poisoning reconciliation', async () => {
    const remote = fake();
    // Simulate a pre-fix reservation for a job the managed worker can no longer
    // claim: a cuda-only sw-* job with a compute_runs row.
    const swJob = service.createJob({ spec: createModuleJobSpec({ module: 'sw-fds-solid-obstruction' as const, backend: 'cuda' }), createdBy: 'owner' });
    db.getSqlite().prepare(`INSERT INTO compute_runs (job_id, cluster_id, allocation, max_wall_time_ms, deadline_ms, updated_at)
      VALUES (?, 'cluster', '{}', 1000, ?, ?)`).run(swJob.id, Date.now() + 60000, new Date().toISOString());
    const healthy = create(); // normal cpu job reserved the usual way
    assert.ok(db.getSqlite().prepare('SELECT job_id FROM compute_runs WHERE job_id = ?').get(healthy.id));
    // Reconcile must not throw: the poisoned row is deleted, the healthy one proceeds.
    await tick(remote);
    assert.equal(db.getSqlite().prepare('SELECT job_id FROM compute_runs WHERE job_id = ?').get(swJob.id), undefined);
    assert.equal(service.getJob(swJob.id)?.status, 'queued');
    assert.notEqual(service.getJob(healthy.id)?.status, 'failed');
    // The released job is claimable by a cuda-capable external agent.
    const claimed = service.claimJob({ agentId: 'gpu-agent', capabilities: { kinds: ['waveworld-module'], backends: ['cuda'], features: ['waveworld-module'] } });
    assert.equal(claimed?.id, swJob.id);
  });

});
