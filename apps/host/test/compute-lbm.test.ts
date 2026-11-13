import { stationaryMassReport, fixtureUnits } from './lbm-result-fixture';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LBM_PRESSURE_FIELD_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_FIELD_HISTORY_FEATURE, LBM_THERMAL_FEATURES } from '@w-sim/contracts';
import { lbmSpec, lbmGeometry, overlappingGeometry, solidPowerSpec, thermalRegionsSpec, thermalContactsSpec } from '../../../scripts/ci/lbm-fixture';
import type { JobResultV1, JobRequirements } from '@w-sim/contracts';
import { encodeModelGeometry } from '../../lab/src/lib/models/geometry-contract';
import { encodeFlowSnapshot, decodeFlowSnapshot, encodeFlowSequence, compressSequenceBlob, FLOW_SNAPSHOT_CONTENT_TYPE, FLOW_SNAPSHOT_V2_CONTENT_TYPE, FLOW_SEQUENCE_KIND, FLOW_SEQUENCE_CONTENT_TYPE } from '../../lab/src/lib/cfd/flow-snapshot';

const directory = mkdtempSync(path.join(tmpdir(), 'waveworld-lbm-transport-'));
process.env.TASK_DB_PATH = path.join(directory, 'tasks.db');
process.env.ARTIFACT_ROOT = path.join(directory, 'artifacts');
process.env.W_COMPUTE_ENABLED = '0';
let service: typeof import('../src/lib/tasks/service');
let artifacts: typeof import('../src/lib/tasks/artifacts');
let compute: typeof import('../src/lib/tasks/compute-lbm');
before(async () => {
  service = await import('../src/lib/tasks/service');
  artifacts = await import('../src/lib/tasks/artifacts');
  compute = await import('../src/lib/tasks/compute-lbm');
});
after(() => rmSync(directory, { recursive: true, force: true }));

test('pressure fields require capable execution, saved channels and input-bound Pa units without upgrading old jobs', async () => {
  const { runLbmWasm } = await import('../../../src/lib/sim/lbm-compute');
  const { fingerprintJobSpec } = await import('../src/lib/tasks/job-fingerprint');
  const model = artifacts.saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
    ownerUserId: 'alice', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
  const oldSpec = lbmSpec(model.id); oldSpec.outputs.fieldFrames = 3;
  const oldJob = service.createJob({ spec: oldSpec, createdBy: 'alice' });
  assert.equal(oldJob.spec.requirements?.features?.includes(LBM_PRESSURE_FIELD_FEATURE), false);
  const spec = { ...oldSpec, outputs: { ...oldSpec.outputs, fields: ['velocity', 'pressure'] } };
  const before = structuredClone(spec), job = service.createJob({ spec, createdBy: 'alice' });
  assert.deepEqual(spec, before, 'normalization never mutates the caller');
  assert.ok(job.spec.requirements?.features?.includes(LBM_PRESSURE_FIELD_FEATURE));
  assert.notEqual(job.specFingerprint, fingerprintJobSpec(spec));
  assert.notEqual(job.specFingerprint, oldJob.specFingerprint);
  const oldCaps = { backends: ['cpu' as const], features: [...oldSpec.requirements!.features!, LBM_FIELD_HISTORY_FEATURE] };
  assert.equal(service.claimJob({ jobId: job.id, agentId: 'pressure', capabilities: oldCaps }), null);
  const capabilities = { ...oldCaps, features: [...oldCaps.features, LBM_PRESSURE_FIELD_FEATURE] };
  assert.ok(service.claimJob({ jobId: job.id, agentId: 'pressure', capabilities }));
  const { lbm, mask } = compute.prepareComputeLbm(job);
  const solved = await runLbmWasm(job.spec, { lbm, flags: new Uint8Array(artifacts.readArtifactBytes(mask.id)!.data) });
  const result = solved.result;
  result.artifacts = solved.snapshots.map(frame => compute.storeComputeFlow(job, new Uint8Array(encodeFlowSnapshot(frame)), frame.step, lbm, mask.id));
  assert.deepEqual(result.artifacts.map(ref => ref.contentType), Array(3).fill(FLOW_SNAPSHOT_V2_CONTENT_TYPE));
  const settle = (candidate: JobResultV1) => service.completeJob({ jobId: job.id, agentId: 'pressure', result: candidate });
  for (const pressureScalePa of [undefined, 0, -1, Number(result.derived!.pressureScalePa) * 2]) {
    assert.throws(() => settle({ ...result, derived: { ...result.derived, pressureScalePa } }), /pressureScalePa/);
  }
  const missingMarker = structuredClone(result); delete missingMarker.derived![LBM_PRESSURE_FIELD_FEATURE];
  assert.throws(() => settle(missingMarker), /features/);
  const oldFrames = solved.snapshots.map(frame => ({ ...frame, hasPressure: undefined, displayStride: 2 as const,
    display: Float32Array.from(frame.display.filter((_, index) => index % frame.displayStride < 2)) }));
  assert.throws(() => compute.storeComputeFlow(job, new Uint8Array(encodeFlowSnapshot(oldFrames[0])), 1, lbm, mask.id), /Invalid native flow/);
  const saveRefs = (frames: typeof solved.snapshots, contentType: string) => frames.map(frame => {
    const saved = artifacts.saveArtifact({ jobId: job.id, ownerUserId: 'alice', kind: 'lbm-display', contentType,
      data: new Uint8Array(encodeFlowSnapshot(frame)) });
    return { artifactId: saved.id, bytes: saved.bytes, kind: saved.kind, contentType, step: frame.step };
  });
  assert.throws(() => settle({ ...result, artifacts: saveRefs(oldFrames, FLOW_SNAPSHOT_CONTENT_TYPE) }), /压力通道/);
  assert.throws(() => settle({ ...result, artifacts: saveRefs(solved.snapshots, FLOW_SNAPSHOT_CONTENT_TYPE) }), /格式版本/);
  assert.equal(service.getJob(job.id)?.status, 'leased');
  assert.equal(settle(result)?.status, 'succeeded');
  assert.equal(settle(result)?.status, 'succeeded');
  assert.throws(() => settle({ ...result, derived: { ...result.derived, pressureScalePa: Number(result.derived!.pressureScalePa) * 2 } }), { status: 409 });
  const saved = artifacts.readArtifactBytes(result.artifacts[0].artifactId)!;
  assert.equal(decodeFlowSnapshot(saved.data.buffer.slice(saved.data.byteOffset, saved.data.byteOffset + saved.data.byteLength) as ArrayBuffer, saved.meta.contentType).hasPressure, true);
  assert.ok(service.claimJob({ jobId: oldJob.id, agentId: 'legacy-pressure', capabilities: oldCaps }));
  const oldPrepared = compute.prepareComputeLbm(oldJob), oldResult = structuredClone(result);
  delete oldResult.derived![LBM_PRESSURE_FIELD_FEATURE]; delete oldResult.derived!.pressureScalePa;
  oldResult.artifacts = oldFrames.map(frame => compute.storeComputeFlow(oldJob, new Uint8Array(encodeFlowSnapshot(frame)), frame.step, oldPrepared.lbm, oldPrepared.mask.id));
  assert.equal(service.completeJob({ jobId: oldJob.id, agentId: 'legacy-pressure', result: oldResult })?.status, 'succeeded');
  assert.equal(service.createOrReuseJob({ spec: oldSpec, createdBy: 'alice', reuseSucceeded: true }).job.id, oldJob.id);
  assert.equal(service.createOrReuseJob({ spec, createdBy: 'alice', reuseSucceeded: true }).job.id, job.id, 'pressure requests reuse only pressure results');
});

test('artifact upload pairs WVF versions with their MIME under the existing active lease', async () => {
  const { registerAgent } = await import('../src/lib/tasks/auth-agent');
  const { POST } = await import('../src/app/api/v1/artifacts/route');
  const spec = lbmSpec(); spec.outputs.fields = ['pressure'];
  const capabilities = { backends: ['cpu' as const], features: [...spec.requirements!.features!, LBM_PRESSURE_FIELD_FEATURE] };
  const { agent, token } = await registerAgent({ name: 'pressure-upload', capabilities });
  const job = service.createJob({ spec, createdBy: 'alice' });
  assert.ok(service.claimJob({ jobId: job.id, agentId: agent.id, capabilities }));
  const frame = { nx: 2, ny: 1, nz: 1, step: 3, displayStride: 3 as const, hasPressure: true as const,
    uLattice: 0, display: new Float32Array([0, 0, -0.1, 0, 0, 0]), flags: new Uint32Array([0, 1]) };
  const data = encodeFlowSnapshot(frame);
  const upload = (contentType: string, body = data) => POST(new Request('https://host.test/api/v1/artifacts', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType, 'X-Artifact-Kind': 'lbm-display', 'X-Job-Id': job.id }, body,
  }));
  assert.equal((await upload(FLOW_SNAPSHOT_CONTENT_TYPE)).status, 400);
  const old = encodeFlowSnapshot({ ...frame, hasPressure: undefined });
  assert.equal((await upload(FLOW_SNAPSHOT_V2_CONTENT_TYPE, old)).status, 400);
  assert.equal((await upload(FLOW_SNAPSHOT_CONTENT_TYPE, old)).status, 201);
  assert.equal((await upload(FLOW_SNAPSHOT_V2_CONTENT_TYPE)).status, 201);
  service.cancelJob(job.id);
  assert.equal((await upload(FLOW_SNAPSHOT_V2_CONTENT_TYPE)).status, 403);
});

test('mass report units bind to explicit dimensions or owned geometry without trusting reported scales', async () => {
  const { prepareLbmInput } = await import('../../../src/lib/sim/lbm-compute');
  const model = artifacts.saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
    ownerUserId: 'alice', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
  const spec = lbmSpec(model.id); delete spec.model!.referenceLength;
  spec.outputs = { forces: false, history: false };
  const prepared = prepareLbmInput(spec, lbmGeometry);
  const capabilities = { backends: ['cpu' as const], features: spec.requirements!.features };
  // Synthetic report isolates admission. It does not certify these masses from a solver.
  const result: JobResultV1 = { schemaVersion: 1, summary: { steps: 3, wallTimeMs: 0, cd: 0, cl: 0 },
    backend: { id: 'cpu' }, lbmMassBalance: stationaryMassReport(), derived: { ...prepared.lbm.units,
      ...Object.fromEntries(capabilities.features!.map(feature => [feature, 1])) } };
  const job = service.createJob({ spec, createdBy: 'alice' });
  assert.ok(service.claimJob({ jobId: job.id, agentId: 'mass-unit', capabilities }));
  for (const key of ['dx', 'dt']) for (const value of [undefined, 0, -1, '1', Number(result.derived![key]) * 2]) {
    assert.throws(() => service.completeJob({ jobId: job.id, agentId: 'mass-unit', result: {
      ...result, derived: { ...result.derived, [key]: value },
    } }), /physical dx\/dt/);
    assert.equal(service.getJob(job.id)?.status, 'leased');
  }
  assert.throws(() => service.completeJob({ jobId: job.id, agentId: 'mass-unit', result: { ...result, lbmMassBalance: undefined } }), /mass-balance/);
  assert.equal(service.completeJob({ jobId: job.id, agentId: 'mass-unit', result })?.status, 'succeeded');
  for (const changedSpec of [
    { ...spec, model: { source: 'preset' as const, presetId: 'cylinder' } },
    { ...spec, model: { source: 'url' as const, url: 'https://model.example.test/cube.stl' } },
  ]) {
    const unscaled = service.createJob({ spec: changedSpec, createdBy: 'alice' });
    assert.ok(service.claimJob({ jobId: unscaled.id, agentId: 'mass-unit', capabilities }));
    assert.throws(() => service.completeJob({ jobId: unscaled.id, agentId: 'mass-unit', result }), /referenceLength or owned model geometry/);
    service.cancelJob(unscaled.id);
  }
  const outside = service.createJob({ spec, createdBy: 'bob' });
  assert.ok(service.claimJob({ jobId: outside.id, agentId: 'mass-unit', capabilities }));
  assert.throws(() => service.completeJob({ jobId: outside.id, agentId: 'mass-unit', result }), /geometry owned by this job/);
  service.cancelJob(outside.id);
});

test('thermal dispatch and settlement preserve the selected backend, precision and input energy', async () => {
  const { validateJobSpec } = await import('../src/lib/tasks/validate-spec');
  const spec = solidPowerSpec();
  spec.outputs.fields = [];
  spec.requirements = { backends: ['webgpu-dawn'], precision: 'float32', thermal: true };
  assert.doesNotThrow(() => validateJobSpec(spec));
  const caps = { backends: ['webgpu-dawn' as const], thermal: true, features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE] };
  assert.equal(service.agentMatchesJob(caps, spec), true);
  assert.equal(service.agentMatchesJob({ backends: ['webgpu-dawn'] }, spec), false);
  assert.equal(service.agentMatchesJob({ backends: ['cpu'], thermal: true }, spec), false);
  for (const requirements of [
    undefined, { backends: ['webgpu-dawn'], precision: 'float64' },
    { backends: ['webgpu-dawn'], precision: 'mixed' }, { backends: ['cpu'], precision: 'float32' },
  ] satisfies Array<JobRequirements | undefined>) {
    const invalid = { ...spec, requirements };
    assert.throws(() => validateJobSpec(invalid), /explicit CPU\/mixed or WebGPU\/float32/);
    assert.equal(service.agentMatchesJob(caps, invalid), false);
  }
  const job = service.createJob({ spec, createdBy: 'alice' });
  assert.equal(service.claimJob({ jobId: job.id, agentId: 'thermal-gpu', capabilities: caps })?.id, job.id);
  const source = Math.fround(0.001) * 3;
  const result: JobResultV1 = { schemaVersion: 1, summary: { steps: 3, wallTimeMs: 1, cd: 0, cl: 0, dragN: 0, liftN: 0 }, backend: { id: 'webgpu-dawn' },
    history: { step: [1, 2, 3], cd: [0, 0, 0], cl: [0, 0, 0], dragN: [0, 0, 0], liftN: [0, 0, 0] },
    lbmMassBalance: stationaryMassReport(), derived: { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, ...fixtureUnits(spec), viscosityMode: 'physical', requestedViscosityM2s: 1.5e-5 / 1.225, simulatedViscosityM2s: 1.5e-5 / 1.225,
      ambientC: 25, temperatureScaleC: 1, thermalDiffusivityPhysical: 0.026 / (1.225 * 1005), precision: 'float32' },
    thermal: { mode: 'solid-power', thermalEnergyJ: source, sourceEnergyJ: source, boundaryEnergyJ: 0,
      energyResidualJ: 0, maxAbsEnergyResidualJ: 0, solidMaxC: 25.001, fluidMaxC: 25,
      thermalSubsteps: 1, solidVolumeM3: 1e-6 } };
  for (const invalid of [
    { ...result, derived: { ...result.derived, precision: 'mixed' } },
    { ...result, summary: { ...result.summary, steps: 2 } },
    { ...result, thermal: { ...result.thermal!, sourceEnergyJ: 0.004 } },
  ]) assert.throws(() => service.completeJob({ jobId: job.id, agentId: 'thermal-gpu', result: invalid }), /Thermal|LBM early stopping/);
  // Backend-requirement dishonesty is its own dedicated gate (all kinds).
  assert.throws(
    () => service.completeJob({ jobId: job.id, agentId: 'thermal-gpu', result: { ...result, backend: { id: 'cpu' } } }),
    /spec\.requirements\.backends/,
  );
  assert.equal(service.completeJob({ jobId: job.id, agentId: 'thermal-gpu', result })?.status, 'succeeded');
  assert.equal(service.completeJob({ jobId: job.id, agentId: 'thermal-gpu', result })?.status, 'succeeded');
  const changedEnergy = { ...result, thermal: { ...result.thermal!, sourceEnergyJ: source + 1 } };
  const { fingerprintJobResult } = await import('../src/lib/tasks/job-fingerprint');
  assert.notEqual(fingerprintJobResult(result), fingerprintJobResult(changedEnergy));
  assert.throws(() => service.completeJob({ jobId: job.id, agentId: 'thermal-gpu', result: changedEnergy }), { status: 409 });
});

test('prepared mask is reusable and output must match the submitted grid, mask, units and actual steps', () => {
  const model = artifacts.saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
    ownerUserId: 'alice', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
  const job = service.createJob({ spec: lbmSpec(model.id), createdBy: 'alice' });
  const { lbm, mask } = compute.prepareComputeLbm(job);
  assert.equal(compute.prepareComputeLbm(job).mask.id, mask.id);
  const flags = new Uint32Array(artifacts.readArtifactBytes(mask.id)!.data);
  const snapshot = { nx: lbm.nx, ny: lbm.ny, nz: lbm.nz, step: 3, displayStride: 2 as const,
    uLattice: lbm.units.uLattice, display: new Float32Array(flags.length * 2), flags };
  const store = (data: ArrayBuffer, steps = 3) => compute.storeComputeFlow(job, new Uint8Array(data), steps, lbm, mask.id);
  const bytes = encodeFlowSnapshot(snapshot);
  assert.throws(() => store(bytes, 2), /Invalid native flow/);
  assert.throws(() => store(encodeFlowSnapshot({ ...snapshot, uLattice: 0.1 })), /Invalid native flow/);
  flags[0] = flags[0] ? 0 : 1;
  assert.throws(() => store(encodeFlowSnapshot(snapshot)), /Invalid native flow/);
  flags[0] = flags[0] ? 0 : 1;
  const result = store(bytes);
  assert.deepEqual(store(bytes), result);
  const saved = artifacts.readArtifactBytes(result.artifactId)!;
  assert.equal(saved.meta.ownerUserId, 'alice'); assert.equal(saved.meta.jobId, job.id);
  snapshot.display[0] = 0.5;
  assert.throws(() => store(encodeFlowSnapshot(snapshot)), /Conflicting native flow/);
  assert.throws(() => compute.prepareComputeLbm({ ...job, createdBy: 'bob' }), /outside this job scope/);
});

test('thermal settlement includes each region power and retains its material IDs in the stored flow', async () => {
  const { runLbmWasm } = await import('../../../src/lib/sim/lbm-compute');
  const model = artifacts.saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
    ownerUserId: 'alice', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
  const spec = thermalContactsSpec(model.id);
  const job = service.createJob({ spec, createdBy: 'alice' });
  const { lbm, mask } = compute.prepareComputeLbm(job);
  const flags = new Uint8Array(artifacts.readArtifactBytes(mask.id)!.data);
  assert.ok(flags.includes(5) && flags.includes(6));
  assert.equal(lbm.thermal!.materials!.length, 2);
  assert.deepEqual(lbm.thermal!.contacts, spec.parameters.thermalContacts);
  assert.equal(service.claimJob({ jobId: job.id, agentId: 'thermal-regions', capabilities: { backends: ['cpu'], thermal: true, features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, ...LBM_THERMAL_FEATURES] } })?.id, job.id);
  const { result, snapshot } = await runLbmWasm(spec, { lbm, flags });
  result.artifacts = [compute.storeComputeFlow(job, new Uint8Array(encodeFlowSnapshot(snapshot!)), 3, lbm, mask.id)];
  for (const feature of LBM_THERMAL_FEATURES) {
    const stale = structuredClone(result);
    delete stale.derived![feature];
    assert.throws(() => service.completeJob({ jobId: job.id, agentId: 'thermal-regions', result: stale }), /material\/contact features/);
  }
  assert.throws(() => service.completeJob({ jobId: job.id, agentId: 'thermal-regions', result: {
    ...result, thermal: { ...result.thermal!, sourceEnergyJ: 0 },
  } }), /source energy/);
  assert.equal(service.completeJob({ jobId: job.id, agentId: 'thermal-regions', result })?.status, 'succeeded');
  const saved = service.getJob(job.id)?.result;
  assert.equal(saved?.derived?.viscosityMode, 'physical');
  assert.equal(saved?.derived?.requestedViscosityM2s, 1.5e-5 / 1.225);
  assert.deepEqual(saved?.derived, result.derived);
  assert.ok(Math.abs(Number(saved?.derived?.simulatedViscosityM2s) / Number(saved?.derived?.requestedViscosityM2s) - 1) < 1e-12);
  assert.equal(saved?.summary.cd, undefined);
  assert.equal(saved?.summary.cl, undefined);
  assert.equal(saved?.history?.cd, undefined);
  assert.equal(saved?.history?.cl, undefined);
  assert.ok(Number.isFinite(saved?.summary.dragN));
  assert.deepEqual(saved?.history?.dragN, result.history?.dragN);
});

// Requirements must come from actual physics, including explicit ideal (zero-R) contacts.
test('only feature-capable Agents can claim materials/contact jobs even without client requirements', () => {
  const caps = { backends: ['cpu' as const], thermal: true, features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE] };
  assert.equal(service.agentMatchesJob(caps, solidPowerSpec()), true);
  assert.equal(service.agentMatchesJob(caps, thermalRegionsSpec()), false);
  for (const resistanceM2KW of [0, 0.001]) {
    const spec = thermalContactsSpec();
    spec.parameters.thermalContacts![0].resistanceM2KW = resistanceM2KW;
    assert.equal(service.agentMatchesJob({ ...caps, features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, 'lbm-thermal-regions-v1'] }, spec), false);
    assert.equal(service.agentMatchesJob({ ...caps, features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, ...LBM_THERMAL_FEATURES] }, spec), true);
    spec.requirements = { ...spec.requirements, features: ['unavailable-user-feature'] };
    assert.equal(service.agentMatchesJob({ ...caps, features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, ...LBM_THERMAL_FEATURES] }, spec), false);
  }
});


test('explicit overlapping solids survive browser transport and Host preparation byte-for-byte', async () => {
  const { prepareLbmInput, runLbmWasm } = await import('../../../src/lib/sim/lbm-compute');
  const { voxelizeModel } = await import('@w-sim/solvers-lbm/d3q19');
  const model = artifacts.saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
    ownerUserId: 'alice', data: new Uint8Array(encodeModelGeometry(overlappingGeometry)) });
  const spec = lbmSpec(model.id), job = service.createJob({ spec, createdBy: 'alice' });
  const local = prepareLbmInput(spec, overlappingGeometry), remote = compute.prepareComputeLbm(job);
  const remoteFlags = new Uint8Array(artifacts.readArtifactBytes(remote.mask.id)!.data);
  assert.deepEqual(remoteFlags, local.flags);
  assert.deepEqual(remote.lbm, local.lbm);
  const legacy = prepareLbmInput(spec, { ...overlappingGeometry, solidTriangleCounts: undefined });
  assert.ok(local.lbm.solidCells > legacy.lbm.solidCells, 'overlap must remain solid');
  const options = { nx: 18, ny: 16, nz: 14, characteristicCells: 12 };
  const union = voxelizeModel({ ...options, geometry: overlappingGeometry });
  const parity = voxelizeModel({ ...options, geometry: { ...overlappingGeometry, solidTriangleCounts: undefined } });
  assert.ok(union.flags.some((flag, i) => flag === 1 && parity.flags[i] === 0));
  const result = await runLbmWasm(spec, { lbm: remote.lbm, flags: remoteFlags });
  assert.equal(result.result.summary.steps, 3);
  assert.ok(Number.isFinite(result.result.summary.cd));
});


test('field history settlement requires capable execution, owned frames, exact steps and the submitted model', async () => {
  const { runLbmWasm } = await import('../../../src/lib/sim/lbm-compute');
  const model = artifacts.saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
    ownerUserId: 'alice', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
  const spec = lbmSpec(model.id); spec.outputs.fieldFrames = 3;
  const caps = { backends: ['cpu' as const] };
  assert.equal(service.agentMatchesJob(caps, spec), false);
  assert.equal(service.agentMatchesJob({ ...caps, features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_FIELD_HISTORY_FEATURE] }, spec), true);
  const job = service.createJob({ spec, createdBy: 'alice' });
  service.claimJob({ jobId: job.id, agentId: 'replay', capabilities: { ...caps, features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_FIELD_HISTORY_FEATURE] } });
  const { lbm, mask } = compute.prepareComputeLbm(job);
  const { result, snapshots } = await runLbmWasm(spec, { lbm, flags: new Uint8Array(artifacts.readArtifactBytes(mask.id)!.data) });
  result.artifacts = snapshots.map(snapshot => compute.storeComputeFlow(job, new Uint8Array(encodeFlowSnapshot(snapshot)), snapshot.step, lbm, mask.id));
  assert.deepEqual(result.artifacts.map(ref => ref.step), [1, 2, 3]);
  const settle = (value: JobResultV1) => service.completeJob({ jobId: job.id, agentId: 'replay', result: value });
  for (const refs of [result.artifacts.slice(1), [...result.artifacts].reverse(),
    result.artifacts.map(ref => ({ ...ref, step: undefined })), result.artifacts.map(ref => ({ ...ref, step: 3 })),
    [result.artifacts[0], result.artifacts[0], result.artifacts[2]], result.artifacts.map(ref => ({ ...ref, bytes: ref.bytes! + 1 }))]) {
    assert.throws(() => settle({ ...result, artifacts: refs }));
    assert.equal(service.getJob(job.id)?.status, 'leased');
  }
  for (const key of ['dt', 'dx']) {
    assert.throws(() => settle({ ...result, derived: { ...result.derived, [key]: Number(result.derived![key]) * 2 } }), /physical dx\/dt/);
  }
  const stale = structuredClone(result); delete stale.derived![LBM_FIELD_HISTORY_FEATURE];
  assert.throws(() => settle(stale), /features/);
  const wrongModel = snapshots.map(snapshot => ({ ...snapshot, flags: new Uint32Array(snapshot.flags.length) }));
  const wrongRefs = wrongModel.map(snapshot => {
    const saved = artifacts.saveArtifact({ jobId: job.id, ownerUserId: 'alice', kind: 'lbm-display',
      contentType: 'application/vnd.waveworld.lbm-display-v1', data: new Uint8Array(encodeFlowSnapshot(snapshot)) });
    return { ...result.artifacts![0], artifactId: saved.id, step: snapshot.step };
  });
  assert.throws(() => settle({ ...result, artifacts: wrongRefs }), /submitted model/);
  assert.equal(settle(result)?.status, 'succeeded');
  assert.equal(settle(result)?.status, 'succeeded', 'same immutable trajectory retry remains idempotent');
  for (const outcome of ['cancelled', 'expired'] as const) {
    const interrupted = service.createJob({ spec, createdBy: 'alice' });
    service.claimJob({ jobId: interrupted.id, agentId: 'replay', capabilities: { ...caps, features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_FIELD_HISTORY_FEATURE] } });
    const prepared = compute.prepareComputeLbm(interrupted), racing = structuredClone(result);
    racing.artifacts = snapshots.map(snapshot => compute.storeComputeFlow(interrupted, new Uint8Array(encodeFlowSnapshot(snapshot)),
      snapshot.step, prepared.lbm, prepared.mask.id));
    const { getSqlite } = await import('../src/lib/tasks/db');
    // Model a second Host changing authoritative state after completeJob's
    // initial read, while it validates the uploaded sequence.
    let changed = false;
    Object.defineProperty(racing.summary, 'wallTimeMs', { get() {
      if (!changed) {
        changed = true;
        if (outcome === 'cancelled') service.cancelJob(interrupted.id);
        else getSqlite().prepare('UPDATE jobs SET lease_expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', interrupted.id);
      }
      return 1;
    } });
    assert.equal(service.completeJob({ jobId: interrupted.id, agentId: 'replay', result: racing }), null);
    assert.equal(service.getJob(interrupted.id)?.status, outcome === 'cancelled' ? 'cancelled' : 'queued');
    assert.equal(service.getJob(interrupted.id)?.result, null);
  }
});


test('new LBM jobs normalize force and inlet/outlet conventions before reuse; legacy results stay immutable', async () => {
  const { runLbmWasm, prepareLbmInput } = await import('../../../src/lib/sim/lbm-compute');
  const { getSqlite } = await import('../src/lib/tasks/db');
  const { fingerprintJobSpec } = await import('../src/lib/tasks/job-fingerprint');
  const spec = lbmSpec(); spec.outputs.fields = [];
  const prepared = prepareLbmInput(spec, lbmGeometry);
  const legacySpec = { ...spec, requirements: { ...spec.requirements, features: undefined } };
  const inputBefore = structuredClone(legacySpec);
  const { result } = await runLbmWasm(spec, prepared);
  const rawResult = { ...result, backend: { ...result.backend, id: 'cpu', agentId: 'legacy-gauge-test' }, derived: { ...result.derived } };
  delete rawResult.derived[LBM_MASS_BALANCE_FEATURE];
  delete rawResult.lbmMassBalance;
  delete rawResult.derived[LBM_GAUGE_FORCE_FEATURE];
  delete rawResult.derived[LBM_NEE_INLET_FEATURE];
  delete rawResult.derived[LBM_NEE_OUTLET_FEATURE];
  // Reproduce a stored pre-feature row; production normalization never rewrites history.
  const historic = service.createJob({ spec: legacySpec });
  getSqlite().prepare('UPDATE jobs SET spec = ?, spec_fingerprint = ?, result = ?, status = ?, agent_id = ? WHERE id = ?')
    .run(JSON.stringify(legacySpec), fingerprintJobSpec(legacySpec), JSON.stringify(rawResult), 'succeeded', 'legacy-gauge-test', historic.id);
  const readHistoric = () => getSqlite().prepare('SELECT spec, spec_fingerprint, result FROM jobs WHERE id = ?').get(historic.id);
  const historicBefore = readHistoric();
  assert.equal(service.getJob(historic.id)?.result?.derived?.[LBM_GAUGE_FORCE_FEATURE], undefined);
  assert.equal(service.completeJob({ jobId: historic.id, agentId: 'legacy-gauge-test', result: rawResult })?.status, 'succeeded');
  assert.throws(() => service.completeJob({ jobId: historic.id, agentId: 'legacy-gauge-test', result }), /settlement|different/i);

  const oldOutletSpec = { ...spec, requirements: { ...spec.requirements, features: [LBM_GAUGE_FORCE_FEATURE] } };
  const oldOutletResult = { ...result, backend: { ...result.backend, id: 'cpu', agentId: 'old-outlet' }, derived: { ...result.derived } };
  delete oldOutletResult.derived[LBM_MASS_BALANCE_FEATURE];
  delete oldOutletResult.lbmMassBalance;
  delete oldOutletResult.derived[LBM_NEE_INLET_FEATURE];
  delete oldOutletResult.derived[LBM_NEE_OUTLET_FEATURE];
  const oldOutlet = service.createJob({ spec: oldOutletSpec });
  getSqlite().prepare('UPDATE jobs SET spec = ?, spec_fingerprint = ?, result = ?, status = ?, agent_id = ? WHERE id = ?')
    .run(JSON.stringify(oldOutletSpec), fingerprintJobSpec(oldOutletSpec), JSON.stringify(oldOutletResult), 'succeeded', 'old-outlet', oldOutlet.id);
  assert.equal(service.completeJob({ jobId: oldOutlet.id, agentId: 'old-outlet', result: oldOutletResult })?.status, 'succeeded');

  const oldInletSpec = { ...spec, requirements: { ...spec.requirements, features: [LBM_GAUGE_FORCE_FEATURE, LBM_NEE_OUTLET_FEATURE] } };
  const oldInletResult = { ...result, backend: { ...result.backend, id: 'cpu', agentId: 'old-inlet' }, derived: { ...result.derived } };
  delete oldInletResult.derived[LBM_MASS_BALANCE_FEATURE];
  delete oldInletResult.lbmMassBalance;
  delete oldInletResult.derived[LBM_NEE_INLET_FEATURE];
  const oldInlet = service.createJob({ spec: oldInletSpec });
  getSqlite().prepare('UPDATE jobs SET spec = ?, spec_fingerprint = ?, result = ?, status = ?, agent_id = ? WHERE id = ?')
    .run(JSON.stringify(oldInletSpec), fingerprintJobSpec(oldInletSpec), JSON.stringify(oldInletResult), 'succeeded', 'old-inlet', oldInlet.id);
  const readOldInlet = () => getSqlite().prepare('SELECT spec, spec_fingerprint, result FROM jobs WHERE id = ?').get(oldInlet.id);
  const oldInletBefore = readOldInlet();
  assert.equal(service.completeJob({ jobId: oldInlet.id, agentId: 'old-inlet', result: oldInletResult })?.status, 'succeeded');
  const refreshedInlet = service.createOrReuseJob({ spec: oldInletSpec, reuseSucceeded: true });
  assert.equal(refreshedInlet.reused, false, 'pre-inlet result must not satisfy a newly submitted equivalent job');
  assert.notEqual(refreshedInlet.job.id, oldInlet.id);
  assert.notEqual(refreshedInlet.job.specFingerprint, fingerprintJobSpec(oldInletSpec));
  service.cancelJob(refreshedInlet.job.id);
  const oldMassSpec = { ...spec, requirements: { ...spec.requirements,
    features: [LBM_GAUGE_FORCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE] } };
  const oldMassResult = { ...result, backend: { ...result.backend, id: 'cpu', agentId: 'old-mass' }, derived: { ...result.derived } };
  delete oldMassResult.derived[LBM_MASS_BALANCE_FEATURE];
  delete oldMassResult.lbmMassBalance;
  const oldMass = service.createJob({ spec: oldMassSpec });
  getSqlite().prepare('UPDATE jobs SET spec = ?, spec_fingerprint = ?, result = ?, status = ?, agent_id = ? WHERE id = ?')
    .run(JSON.stringify(oldMassSpec), fingerprintJobSpec(oldMassSpec), JSON.stringify(oldMassResult), 'succeeded', 'old-mass', oldMass.id);
  const readOldMass = () => getSqlite().prepare('SELECT spec, spec_fingerprint, result FROM jobs WHERE id = ?').get(oldMass.id);
  const oldMassBefore = readOldMass();
  assert.equal(service.completeJob({ jobId: oldMass.id, agentId: 'old-mass', result: oldMassResult })?.status, 'succeeded');
  const refreshedMass = service.createOrReuseJob({ spec: oldMassSpec, reuseSucceeded: true });
  assert.equal(refreshedMass.reused, false, 'a result without mass accounting must not satisfy a new request');
  assert.notEqual(refreshedMass.job.specFingerprint, fingerprintJobSpec(oldMassSpec));
  service.cancelJob(refreshedMass.job.id);
  const submitted = service.createOrReuseJob({ spec: oldOutletSpec, reuseSucceeded: true });
  assert.notEqual(submitted.job.id, oldOutlet.id);
  assert.deepEqual(service.getJob(oldOutlet.id)?.result, oldOutletResult);

  assert.equal(submitted.reused, false);
  assert.notEqual(submitted.job.id, historic.id);
  assert.deepEqual(legacySpec, inputBefore, 'normalization must not mutate the caller');
  assert.deepEqual(submitted.job.spec.requirements?.features, [LBM_GAUGE_FORCE_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE]);
  assert.notEqual(submitted.job.specFingerprint, fingerprintJobSpec(legacySpec));
  const duplicateFeatures = service.createJob({ spec: { ...spec,
    requirements: { ...spec.requirements, features: ['z-capability', LBM_GAUGE_FORCE_FEATURE, 'a-capability', LBM_GAUGE_FORCE_FEATURE] } } });
  assert.deepEqual(duplicateFeatures.spec.requirements?.features, ['a-capability', LBM_GAUGE_FORCE_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, 'z-capability']);
  service.cancelJob(duplicateFeatures.id);

  const caps = { kinds: ['lbm-d3q19' as const], backends: ['cpu' as const] };
  assert.equal(service.claimJob({ jobId: submitted.job.id, agentId: 'new-gauge-test', capabilities: caps }), null);
  for (const missing of [LBM_GAUGE_FORCE_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE]) {
    const features = [LBM_GAUGE_FORCE_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE].filter(feature => feature !== missing);
    assert.equal(service.claimJob({ jobId: submitted.job.id, agentId: 'new-gauge-test', capabilities: { ...caps, features } }), null, `Agent missing ${missing} must not claim`);
    assert.equal(service.getJob(submitted.job.id)?.status, 'queued');
  }
  assert.equal(service.claimJob({ jobId: submitted.job.id, agentId: 'new-gauge-test', capabilities: { ...caps, features: [LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE] } })?.id, submitted.job.id);
  for (const feature of [LBM_GAUGE_FORCE_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE]) for (const marker of [undefined, 0, '1']) {
    assert.throws(() => service.completeJob({ jobId: submitted.job.id, agentId: 'new-gauge-test',
      result: { ...result, derived: { ...result.derived, [feature]: marker } } }), /gauge-force/);
    assert.equal(service.getJob(submitted.job.id)?.status, 'leased');
  }
  assert.equal(service.completeJob({ jobId: submitted.job.id, agentId: 'new-gauge-test', result })?.status, 'succeeded');
  const reused = service.createOrReuseJob({ spec: legacySpec, reuseSucceeded: true });
  assert.equal(reused.reused, true);
  assert.equal(reused.job.id, submitted.job.id);
  assert.deepEqual(readHistoric(), historicBefore, 'legacy specification, fingerprint and result must stay byte-identical');
  assert.deepEqual(readOldInlet(), oldInletBefore, 'pre-inlet specification, fingerprint and result must stay byte-identical');
  assert.deepEqual(readOldMass(), oldMassBefore, 'pre-mass specification, fingerprint and result must stay byte-identical');
  for (const key of Object.keys(result.lbmMassBalance!) as Array<keyof NonNullable<JobResultV1['lbmMassBalance']>>) {
    if (key === 'scope') continue;
    const changed = { ...result, lbmMassBalance: { ...result.lbmMassBalance!, [key]: result.lbmMassBalance![key] + 1 } };
    assert.throws(() => service.completeJob({ jobId: submitted.job.id, agentId: 'new-gauge-test', result: changed }), { status: 409 }, key);
  }
});


test('LBM settlement verifies actual sampling intervals, finite forces and evidence for early stopping', async () => {
  const { runLbmWasm, prepareLbmInput } = await import('../../../src/lib/sim/lbm-compute');
  const { validateLbmResult, validateJobResult } = await import('../src/lib/tasks/validate-result');
  const base = lbmSpec(); base.outputs.fields = [];
  const prepared = prepareLbmInput(base, lbmGeometry);
  const spec = { ...base, run: { maxSteps: 5, forceSampleEvery: 3, warmupSteps: 2 } };
  const { result } = await runLbmWasm(spec, prepared);
  assert.deepEqual(result.history!.step, [3, 5]); // Mean of step 3, then mean of steps 4..5.
  const caps = { backends: ['cpu' as const], features: [LBM_GAUGE_FORCE_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE] };
  const job = service.createJob({ spec });
  service.claimJob({ jobId: job.id, agentId: 'sample-audit', capabilities: caps });
  const invalid: JobResultV1[] = [
    ...[0, -1, 0.5, 6].map(steps => ({ ...result, summary: { ...result.summary, steps } })),
    { ...result, summary: { ...result.summary, wallTimeMs: -1 } },
    { ...result, history: undefined },
    { ...result, summary: { ...result.summary, dragN: undefined } },
    { ...result, history: { ...result.history!, cd: undefined } },
    { ...result, summary: { ...result.summary, dragN: result.summary.dragN! + 1 } },
    ...[[3, 3], [3, 4], [5, 3], [2, 5], [3, 5.5]].map(step => ({ ...result, history: { ...result.history!, step } })),
  ];
  for (const candidate of invalid) {
    assert.throws(() => service.completeJob({ jobId: job.id, agentId: 'sample-audit', result: candidate }), { status: 400 });
    assert.equal(service.getJob(job.id)?.status, 'leased');
  }
  assert.equal(service.completeJob({ jobId: job.id, agentId: 'sample-audit', result })?.status, 'succeeded');
  assert.deepEqual(service.getJob(job.id)?.result?.history, result.history);
  for (const history of [false, true]) {
    const stoppedSpec = { ...base, outputs: { ...base.outputs, history },
      run: { maxSteps: 5, forceSampleEvery: 1, warmupSteps: 0, stopWhen: { maxCdVariance: 1e100, window: 2 } } };
    const { result: stopped } = await runLbmWasm(stoppedSpec, prepared);
    assert.equal(stopped.summary.steps, 2);
    assert.deepEqual(stopped.history!.step, [1, 2], 'stopping evidence survives even when plotting history was not requested');
    const target = service.createJob({ spec: stoppedSpec });
    service.claimJob({ jobId: target.id, agentId: 'sample-audit', capabilities: caps });
    for (const changed of [
      { ...stopped, history: undefined },
      { ...stopped, summary: { ...stopped.summary, cd: 1e60 }, history: { ...stopped.history!, cd: [-1e60, 1e60] } },
    ]) assert.throws(() => service.completeJob({ jobId: target.id, agentId: 'sample-audit', result: changed }), { status: 400 });
    assert.throws(() => validateLbmResult({ ...stoppedSpec, run: { ...stoppedSpec.run, stopWhen: undefined } }, stopped), /early stopping/);
    assert.throws(() => validateLbmResult({ ...stoppedSpec, run: { ...stoppedSpec.run, stopWhen: { maxCdVariance: 1e100, window: 3 } } }, stopped), /complete Cd variance window/);
    assert.equal(service.completeJob({ jobId: target.id, agentId: 'sample-audit', result: stopped })?.status, 'succeeded');
  }
  const warmupSpec = { ...spec, run: { ...spec.run, warmupSteps: 5 } };
  const warmup = await runLbmWasm(warmupSpec, prepared);
  assert.deepEqual(warmup.result.history!.step, []);
  assert.doesNotThrow(() => validateLbmResult(warmupSpec, warmup.result));
  const noHistorySpec = { ...spec, outputs: { ...spec.outputs, history: false } };
  const noHistory = await runLbmWasm(noHistorySpec, prepared);
  assert.equal(noHistory.result.history, undefined);
  assert.doesNotThrow(() => validateLbmResult(noHistorySpec, noHistory.result));
  // Generic result validation remains unchanged for other domains.
  const other: JobResultV1 = { schemaVersion: 1, summary: { steps: 0, wallTimeMs: 1 },
    history: { step: [0], temperature: [25] }, backend: { id: 'cpu' } };
  assert.doesNotThrow(() => validateJobResult(other));
  assert.doesNotThrow(() => validateLbmResult({ ...spec, kind: 'waveworld-module', parameters: {} }, other));
});

test('fieldStride decimates stored frames and rejects full-resolution forgeries', async () => {
  const { runLbmWasm } = await import('../../../src/lib/sim/lbm-compute');
  const { decimatedCellCount } = await import('@w-sim/solvers-lbm/d3q19');
  const model = artifacts.saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
    ownerUserId: 'alice', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
  const spec = lbmSpec(model.id);
  spec.outputs = { ...spec.outputs, fieldFrames: 3, fieldStride: 2 };
  const job = service.createJob({ spec, createdBy: 'alice' });
  const capabilities = { backends: ['cpu' as const], features: [...spec.requirements!.features!, LBM_FIELD_HISTORY_FEATURE] };
  assert.ok(service.claimJob({ jobId: job.id, agentId: 'stride', capabilities }));
  const { lbm, mask } = compute.prepareComputeLbm(job);
  const solved = await runLbmWasm(job.spec, { lbm, flags: new Uint8Array(artifacts.readArtifactBytes(mask.id)!.data) });
  assert.equal(solved.snapshots.length, 3);
  assert.equal(solved.snapshots[0].nx, Math.ceil(lbm.nx / 2));
  assert.equal(solved.snapshots[0].flags.length, decimatedCellCount(lbm.nx, lbm.ny, lbm.nz, 2));
  const result = solved.result;
  result.artifacts = solved.snapshots.map(frame => compute.storeComputeFlow(job, new Uint8Array(encodeFlowSnapshot(frame)), frame.step, lbm, mask.id));
  // A full-resolution frame must be rejected: dims and flags no longer match the coarse mask.
  const full = { ...solved.snapshots[0], nx: lbm.nx, ny: lbm.ny, nz: lbm.nz,
    display: new Float32Array(lbm.nx * lbm.ny * lbm.nz * solved.snapshots[0].displayStride),
    flags: new Uint32Array(lbm.nx * lbm.ny * lbm.nz) };
  assert.throws(() => compute.storeComputeFlow(job, new Uint8Array(encodeFlowSnapshot(full)), full.step, lbm, mask.id), /Invalid native flow/);
  assert.equal(service.completeJob({ jobId: job.id, agentId: 'stride', result })?.status, 'succeeded');
});

test('batched WVZ1 sequence artifacts settle and full-resolution forgeries are still rejected', async () => {
  const { runLbmWasm } = await import('../../../src/lib/sim/lbm-compute');
  const { decimatedCellCount } = await import('@w-sim/solvers-lbm/d3q19');
  const model = artifacts.saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
    ownerUserId: 'alice', data: new Uint8Array(encodeModelGeometry(lbmGeometry)) });
  const spec = lbmSpec(model.id);
  spec.outputs = { ...spec.outputs, fieldFrames: 3, fieldStride: 2 };
  const job = service.createJob({ spec, createdBy: 'alice' });
  const capabilities = { backends: ['cpu' as const], features: [...spec.requirements!.features!, LBM_FIELD_HISTORY_FEATURE] };
  assert.ok(service.claimJob({ jobId: job.id, agentId: 'seq-agent', capabilities }));
  const { lbm, mask } = compute.prepareComputeLbm(job);
  const solved = await runLbmWasm(job.spec, { lbm, flags: new Uint8Array(artifacts.readArtifactBytes(mask.id)!.data) });
  assert.equal(solved.snapshots.length, 3);
  assert.equal(solved.snapshots[0].flags.length, decimatedCellCount(lbm.nx, lbm.ny, lbm.nz, 2));
  // The agent path uploads one compressed WVS1 artifact holding all WVF3 frames.
  const packed = await compressSequenceBlob(encodeFlowSequence(solved.snapshots));
  const stored = artifacts.saveArtifact({ jobId: job.id, ownerUserId: 'alice',
    kind: FLOW_SEQUENCE_KIND, contentType: FLOW_SEQUENCE_CONTENT_TYPE, data: new Uint8Array(packed) });
  const result = { ...solved.result, artifacts: [{ artifactId: stored.id, bytes: stored.bytes, kind: FLOW_SEQUENCE_KIND, contentType: FLOW_SEQUENCE_CONTENT_TYPE }] };
  assert.equal(service.completeJob({ jobId: job.id, agentId: 'seq-agent', result })?.status, 'succeeded');

  // A sequence containing a forged full-resolution frame must fail settlement.
  const job2 = service.createJob({ spec, createdBy: 'alice' });
  assert.ok(service.claimJob({ jobId: job2.id, agentId: 'seq-agent2', capabilities }));
  const fake = { ...solved.snapshots[0], nx: lbm.nx, ny: lbm.ny, nz: lbm.nz,
    display: new Float32Array(lbm.nx * lbm.ny * lbm.nz * solved.snapshots[0].displayStride),
    flags: new Uint32Array(lbm.nx * lbm.ny * lbm.nz) };
  const badPacked = await compressSequenceBlob(encodeFlowSequence([...solved.snapshots.slice(0, 2), fake]));
  const badStored = artifacts.saveArtifact({ jobId: job2.id, ownerUserId: 'alice',
    kind: FLOW_SEQUENCE_KIND, contentType: FLOW_SEQUENCE_CONTENT_TYPE, data: new Uint8Array(badPacked) });
  const bad = { ...solved.result, artifacts: [{ artifactId: badStored.id, bytes: badStored.bytes, kind: FLOW_SEQUENCE_KIND, contentType: FLOW_SEQUENCE_CONTENT_TYPE }] };
  assert.throws(() => service.completeJob({ jobId: job2.id, agentId: 'seq-agent2', result: bad }), /LBM frames|Invalid|不一致|model/);
});
