import { stationaryMassReport } from './lbm-result-fixture';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE } from '@w-sim/contracts';
import { prepareProductLbmLattice } from '@w-sim/solvers-lbm/d3q19';
import { createModuleJobSpec, computeModule } from '../../../src/lib/sim/module-compute';
import { lbmSpec, lbmGeometry, thermalSpec } from '../../../scripts/ci/lbm-fixture';
import { macSpec, macGeometry } from '../../../scripts/ci/mac-fixture';
import { prepareMacInput, runMacWasm } from '@w-sim/solvers-lbm/mac3d';
import { encodeMacFlowSnapshot, MAC_FLOW_SNAPSHOT_KIND, MAC_FLOW_SNAPSHOT_CONTENT_TYPE } from '../../lab/src/lib/cfd/mac-flow-snapshot';
import { encodeModelGeometry } from '../../lab/src/lib/models/geometry-contract';
import { encodeFlowSnapshot, FLOW_SNAPSHOT_KIND, FLOW_SNAPSHOT_CONTENT_TYPE } from '../../lab/src/lib/cfd/flow-snapshot';

const directory = mkdtempSync(path.join(tmpdir(), 'waveworld-browser-agent-'));
process.env.TASK_DB_PATH = path.join(directory, 'tasks.db');
process.env.ARTIFACT_ROOT = path.join(directory, 'artifacts');
process.env.W_COMPUTE_ENABLED = '1'; // No credentials: browser jobs must never allocate.
let service: typeof import('../src/lib/tasks/service');
let db: typeof import('../src/lib/tasks/db');
let submit: typeof import('../src/app/api/v1/jobs/route').POST;
let heartbeat: typeof import('../src/app/api/v1/jobs/[id]/heartbeat/route').POST;
let complete: typeof import('../src/app/api/v1/jobs/[id]/complete/route').POST;
let fail: typeof import('../src/app/api/v1/jobs/[id]/fail/route').POST;
const input = { module: 'sim' as const, scene: { r: 0.2, steps: 2, seeds: [{ x: 0, y: 0, radius: 2, amount: 80 }] } };
const request = (body: unknown, owner = 'alice', agent = '') => new Request('http://waveworld.test/api/v1/jobs', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(owner ? { 'x-user-id': owner } : {}), 'x-browser-agent': agent }, body: JSON.stringify(body),
});
before(async () => {
  service = await import('../src/lib/tasks/service'); db = await import('../src/lib/tasks/db');
  submit = (await import('../src/app/api/v1/jobs/route')).POST;
  heartbeat = (await import('../src/app/api/v1/jobs/[id]/heartbeat/route')).POST;
  complete = (await import('../src/app/api/v1/jobs/[id]/complete/route')).POST;
  fail = (await import('../src/app/api/v1/jobs/[id]/fail/route')).POST;
});
beforeEach(() => { db.getSqlite().exec('DELETE FROM job_attempt_outcomes; DELETE FROM compute_runs; DELETE FROM jobs'); });
after(() => rmSync(directory, { recursive: true, force: true }));

async function create() {
  const response = await submit(request({ spec: createModuleJobSpec(input), execution: 'browser' }));
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).job as NonNullable<ReturnType<typeof service.getJob>>;
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });

test('browser submission atomically claims its own task, uses no registration key or instance, and settles normally', async () => {
  const job = await create();
  assert.equal(job.status, 'leased'); assert.equal(job.createdBy, 'alice');
  assert.match(job.agentId!, /^browser-/); assert.equal(job.compute, undefined);
  assert.equal(service.claimJob({ agentId: 'server', jobId: job.id, capabilities: { kinds: ['waveworld-module'], backends: ['cpu'] } }), null);
  assert.equal((await heartbeat(request({ progress: { step: 0, total: 2 } }, 'alice', job.agentId!), context(job.id))).status, 200);
  const result = { schemaVersion: 1, summary: { steps: 2, wallTimeMs: 1 }, backend: { id: 'cpu' },
    derived: { engine: 'rust-wasm', precision: 'mixed' }, moduleResult: await computeModule(input) };
  for (let retry = 0; retry < 2; retry++) assert.equal((await complete(request({ result }, 'alice', job.agentId!), context(job.id))).status, 200);
  assert.equal(service.getJob(job.id)?.result?.derived?.engine, 'rust-wasm');
});

test('user sessions cannot settle another user, another tab, or a server Agent lease', async () => {
  const job = await create();
  for (const route of [heartbeat, complete, fail]) {
    assert.equal((await route(request({}, 'bob', job.agentId!), context(job.id))).status, 403);
    assert.equal((await route(request({}, 'alice', `browser-${crypto.randomUUID()}`), context(job.id))).status, 403);
    assert.equal((await route(request({}, '', job.agentId!), context(job.id))).status, 401);
  }
  db.getSqlite().prepare('UPDATE jobs SET agent_id = ? WHERE id = ?').run('server-agent', job.id);
  assert.equal((await heartbeat(request({}, 'alice', 'server-agent'), context(job.id))).status, 403);
});

test('cancelled and expired browser leases cannot heartbeat or submit stale results', async () => {
  for (const expire of [false, true]) {
    const job = await create();
    if (expire) db.getSqlite().prepare('UPDATE jobs SET lease_expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', job.id);
    else service.cancelJob(job.id);
    assert.equal((await heartbeat(request({}, 'alice', job.agentId!), context(job.id))).status, 403);
    assert.equal((await complete(request({}, 'alice', job.agentId!), context(job.id))).status, 403);
    assert.equal(service.getJob(job.id)?.status, expire ? 'queued' : 'cancelled');
  }
});

test('browser admission requires a user and an implemented Rust module', async () => {
  assert.equal((await submit(request({ spec: createModuleJobSpec(input), execution: 'browser' }, ''))).status, 401);
  const ising = createModuleJobSpec({ module: 'ising', scene: { size: 16, temperatures: [2], seed: 7, hot: true, burnIn: 0, samples: 1 } });
  assert.equal((await submit(request({ spec: ising, execution: 'browser' }))).status, 201);
  assert.equal(ising.requirements?.precision, 'float64');
  const unsupported = createModuleJobSpec({ module: 'heaterfc', scene: { kappa: 0.5, steps: 2 } });
  assert.equal((await submit(request({ spec: unsupported, execution: 'browser' }))).status, 400);
});

test('browser admission rejects native-only operations even when their module ID has a teaching runner', async () => {
  const nativeFdtd = createModuleJobSpec({
    module: 'fdtd' as const, backend: 'host' as const, operation: 'cst-time-domain-sparams' as const,
    sampleInterval: 0.25, frequency: 1, referenceImpedanceOhms: 50,
    incident: [0, 1, 0, -1], reflected: [0, 0.25, 0, -0.25], transmitted: [0, 0.75, 0, -0.75],
  });
  assert.equal(nativeFdtd.requirements?.backends?.includes('cuda'), true);
  assert.equal((await submit(request({ spec: nativeFdtd, execution: 'browser' }))).status, 400);
});

for (const backend of ['cpu', 'webgpu-browser'] as const) test(`${backend} browser flow uploads require the owning user, tab and active lease`, async () => {
  const { saveArtifact, readArtifactBytes } = await import('../src/lib/tasks/artifacts');
  const { POST: upload } = await import('../src/app/api/v1/artifacts/route');
  const model = saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
    ownerUserId: 'alice', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
  const spec = lbmSpec(model.id);
  if (backend === 'webgpu-browser') spec.requirements = { backends: [backend], precision: 'float32' };
  const response = await submit(request({ spec, execution: 'browser' }));
  assert.equal(response.status, 201, await response.clone().text());
  const job = (await response.json()).job;
  const bytes = encodeFlowSnapshot({ nx: 3, ny: 3, nz: 3, step: 3, displayStride: 2, uLattice: 0.06,
    display: new Float32Array(54), flags: new Uint32Array(27) });
  const send = (owner: string, agent: string) => upload(new Request('http://waveworld.test/api/v1/artifacts', {
    method: 'POST', headers: { 'content-type': FLOW_SNAPSHOT_CONTENT_TYPE, 'x-artifact-kind': FLOW_SNAPSHOT_KIND,
      'x-user-id': owner, 'x-browser-agent': agent, 'x-job-id': job.id }, body: bytes,
  }));
  assert.equal((await send('bob', job.agentId)).status, 403);
  assert.equal((await send('alice', `browser-${crypto.randomUUID()}`)).status, 403);
  assert.equal((await send('alice', '')).status, 403);
  const saved = await send('alice', job.agentId);
  assert.equal(saved.status, 201, await saved.clone().text());
  const field = readArtifactBytes((await saved.json()).artifact.id)!;
  assert.equal(field.meta.ownerUserId, 'alice'); assert.equal(field.meta.jobId, job.id);
  service.cancelJob(job.id);
  assert.equal((await send('alice', job.agentId)).status, 403);
});


test('thermal browser settlement requires saved physical units and a finite energy account', async () => {
  const { saveArtifact } = await import('../src/lib/tasks/artifacts');
  const model = saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
    ownerUserId: 'alice', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
  const spec = thermalSpec(model.id); spec.outputs.fields = [];
  delete spec.parameters.fan; // This solid block exercises thermal settlement, without a fan embedded in its solid cells.
  const response = await submit(request({ spec, execution: 'browser' }));
  assert.equal(response.status, 201, await response.clone().text());
  const job = (await response.json()).job;
  const prepared = prepareProductLbmLattice(spec, lbmGeometry);
  const result = { schemaVersion: 1, summary: { steps: 3, wallTimeMs: 1, dragN: 0, liftN: 0 }, backend: { id: 'cpu' },
    history: { step: [1, 2, 3], dragN: [0, 0, 0], liftN: [0, 0, 0] },
    thermal: { mode: 'fixed-temperature', thermalEnergyJ: 0.003, sourceEnergyJ: 0, boundaryEnergyJ: 0.003,
      energyResidualJ: 0, maxAbsEnergyResidualJ: 0, solidMaxC: 60, fluidMaxC: 25.01, thermalSubsteps: 1, solidVolumeM3: 0.000001 },
    lbmMassBalance: stationaryMassReport(), derived: { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...prepared.units, ambientC: prepared.thermal!.ambientC, temperatureScaleC: prepared.thermal!.temperatureScaleC,
      thermalDiffusivityPhysical: prepared.thermal!.thermalDiffusivityPhysical, precision: 'mixed' } };
  for (const derived of [undefined, { ...result.derived, temperatureScaleC: 40 }, { ...result.derived, precision: 'float32' }]) {
    const rejected = await complete(request({ result: { ...result, derived } }, 'alice', job.agentId), context(job.id));
    assert.equal(rejected.status, 400, await rejected.clone().text());
  }
  for (const thermal of [undefined, { ...result.thermal, mode: 'solid-power' },
    { ...result.thermal, energyResidualJ: null }, { ...result.thermal, thermalSubsteps: 0 }, { ...result.thermal, sourceEnergyJ: 0.1 }]) {
    const rejected = await complete(request({ result: { ...result, thermal } }, 'alice', job.agentId), context(job.id));
    assert.equal(rejected.status, 400, await rejected.clone().text());
  }
  const settled = await complete(request({ result }, 'alice', job.agentId), context(job.id));
  assert.equal(settled.status, 200, await settled.clone().text());
});

test('browser MAC uses the owned leased artifact API for all SI frames and requires login to publish', async () => {
  const { saveArtifact } = await import('../src/lib/tasks/artifacts');
  const upload = (await import('../src/app/api/v1/artifacts/route')).POST;
  const model = saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2', ownerUserId: 'alice', data: new Uint8Array(encodeModelGeometry(macGeometry)) });
  const spec = macSpec(model.id), prepared = prepareMacInput(spec, macGeometry);
  // Under the test operator policy, the owned model guard rejects the anonymous caller first.
  assert.equal((await submit(request({ spec, execution: 'browser' }, ''))).status, 403);
  const response = await submit(request({ spec, execution: 'browser' }));
  assert.equal(response.status, 201, await response.clone().text());
  const job = (await response.json()).job;
  assert.equal(service.getJob(job.id)?.compute, undefined);
  const { result, snapshots } = await runMacWasm({ spec, input: prepared.mac, flags: prepared.flags });
  const send = (bytes: ArrayBuffer, agent = job.agentId, owner = 'alice') => upload(new Request('http://waveworld.test/api/v1/artifacts', {
    method: 'POST', headers: { 'content-type': MAC_FLOW_SNAPSHOT_CONTENT_TYPE, 'x-artifact-kind': MAC_FLOW_SNAPSHOT_KIND,
      'x-user-id': owner, 'x-browser-agent': agent, 'x-job-id': job.id }, body: bytes,
  }));
  assert.equal((await send(encodeMacFlowSnapshot(snapshots[0]), job.agentId, 'bob')).status, 403);
  assert.equal((await send(encodeMacFlowSnapshot(snapshots[0]), 'browser-wrong')).status, 403);
  result.artifacts = [];
  for (const frame of snapshots) {
    const uploaded = await send(encodeMacFlowSnapshot(frame)); assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const { artifact } = await uploaded.json();
    result.artifacts.push({ artifactId: artifact.id, kind: artifact.kind, contentType: artifact.contentType, bytes: artifact.bytes, step: frame.step });
  }
  const settled = await complete(request({ result }, 'alice', job.agentId), context(job.id));
  assert.equal(settled.status, 200, await settled.clone().text());
  assert.deepEqual(service.getJob(job.id)?.result?.artifacts?.map(ref => ref.step), [1, 2, 3]);
  assert.equal((await send(encodeMacFlowSnapshot(snapshots[0]))).status, 403);
});
