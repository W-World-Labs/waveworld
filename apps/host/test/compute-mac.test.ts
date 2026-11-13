import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MAC_3D_FEATURE, type JobResultV1 } from '@w-sim/contracts';
import { prepareMacInput, runMacWasm } from '@w-sim/solvers-lbm/mac3d';
import { macSpec, macGeometry } from '../../../scripts/ci/mac-fixture';
import { encodeModelGeometry, MODEL_GEOMETRY_CONTENT_TYPE } from '../../lab/src/lib/models/geometry-contract';
import { encodeMacFlowSnapshot, MAC_FLOW_SNAPSHOT_KIND, MAC_FLOW_SNAPSHOT_CONTENT_TYPE } from '../../lab/src/lib/cfd/mac-flow-snapshot';

const directory = mkdtempSync(path.join(tmpdir(), 'waveworld-mac-host-'));
process.env.TASK_DB_PATH = path.join(directory, 'tasks.db');
process.env.ARTIFACT_ROOT = path.join(directory, 'artifacts');
process.env.W_COMPUTE_ENABLED = '0';
let service: typeof import('../src/lib/tasks/service');
let artifacts: typeof import('../src/lib/tasks/artifacts');
let compute: typeof import('../src/lib/tasks/compute-mac');
let output: Awaited<ReturnType<typeof runMacWasm>>;
let modelId: string;
const caps = { kinds: ['mac-3d'], backends: ['cpu' as const], features: [MAC_3D_FEATURE], thermal: true, fan: true };
before(async () => {
  service = await import('../src/lib/tasks/service');
  artifacts = await import('../src/lib/tasks/artifacts');
  compute = await import('../src/lib/tasks/compute-mac');
  modelId = artifacts.saveArtifact({ ownerUserId: 'mac-owner', kind: 'model-geometry', contentType: MODEL_GEOMETRY_CONTENT_TYPE, data: new Uint8Array(encodeModelGeometry(macGeometry)) }).id;
  const spec = macSpec(modelId, true), prepared = prepareMacInput(spec, macGeometry);
  output = await runMacWasm({ spec, input: prepared.mac, flags: prepared.flags });
});
after(() => rmSync(directory, { recursive: true, force: true }));

function candidate() {
  const job = service.createJob({ spec: macSpec(modelId, true), createdBy: 'mac-owner' });
  assert.ok(service.claimJob({ jobId: job.id, agentId: 'mac-agent', workspaceId: 'default', capabilities: caps }));
  const result = structuredClone(output.result);
  result.artifacts = output.snapshots.map(frame => {
    const ref = artifacts.saveArtifact({ ownerUserId: 'mac-owner', jobId: job.id, kind: MAC_FLOW_SNAPSHOT_KIND,
      contentType: MAC_FLOW_SNAPSHOT_CONTENT_TYPE, data: new Uint8Array(encodeMacFlowSnapshot(frame)) });
    return { artifactId: ref.id, kind: ref.kind, contentType: ref.contentType, bytes: ref.bytes, step: frame.step };
  });
  return { job: service.getJob(job.id)!, result };
}

test('MAC native preparation and owned replay settle under the same task envelope', () => {
  const { job, result } = candidate();
  const prepared = compute.prepareComputeMac(job);
  assert.equal(prepared.mask.kind, 'mac-grid-mask');
  assert.equal(prepared.mac.dxMeters, .01);
  assert.deepEqual(compute.expectedComputeMacSteps(job, 3, prepared.mac), [1, 2, 3]);
  const complete = service.completeJob({ jobId: job.id, agentId: 'mac-agent', result });
  assert.equal(complete?.status, 'succeeded');
  assert.equal(complete?.result?.summary.cd, undefined);
  assert.deepEqual(complete?.result?.history?.step, [2, 3]);
  assert.equal(service.completeJob({ jobId: job.id, agentId: 'mac-agent', result })?.status, 'succeeded');
  const changed = structuredClone(result); changed.mac!.fans[0].pressureRisePa += 1;
  assert.throws(() => service.completeJob({ jobId: job.id, agentId: 'mac-agent', result: changed }), /different|conflict|settlement/i);
});

test('MAC admission rejects old agents and keeps LBM-only assumptions out', async () => {
  const { validateJobSpec } = await import('../src/lib/tasks/validate-spec');
  const spec = macSpec(modelId);
  assert.doesNotThrow(() => validateJobSpec(spec));
  for (const invalid of [{ ...caps, features: [] }, { ...caps, kinds: ['lbm-d3q19'] }, { ...caps, backends: ['webgpu-browser' as const] }]) {
    assert.equal(service.agentMatchesJob(invalid, spec), false);
  }
  for (const field of ['inletVelocity', 'ground', 'smagorinskyCs', 'fan']) {
    const invalid = structuredClone(spec); (invalid.parameters as unknown as Record<string, unknown>)[field] = 1;
    assert.throws(() => validateJobSpec(invalid));
  }
  assert.equal(service.agentMatchesJob(caps, spec), true);
  const original = structuredClone(spec); original.requirements!.features = [];
  const job = service.createJob({ spec: original, createdBy: 'mac-owner' });
  assert.deepEqual(original.requirements!.features, []);
  assert.deepEqual(job.spec.requirements!.features, [MAC_3D_FEATURE]);
});

test('MAC settlement rejects false convergence, changed units/physics, missing history and replay lies', () => {
  const mutations: Array<(result: JobResultV1) => void> = [
    r => { r.summary.steps = 2 }, r => { r.summary.steps = 3.5 },
    r => { r.summary.cd = 0 }, r => { r.summary.dragN = 1 }, r => { r.summary.converged = 'true' },
    r => { r.derived!.dx = .02 }, r => { r.derived!.dt = .002 }, r => { r.derived!.viscosityM2s = .02 },
    r => { delete r.derived![MAC_3D_FEATURE] }, r => { r.derived!.precision = 'mixed' },
    r => { r.summary.divergenceLinf = 1 }, r => { r.summary.combinedCfl = 1.01 }, r => { r.summary.projectionIterations = .5 },
    r => { delete r.history }, r => { r.history!.step![0] = 3 }, r => { r.history!.timeSeconds![0] = 2 },
    r => { r.history!.maxSpeedMps![1] *= 2 }, r => { r.history!.combinedCfl![0] = 2 },
    r => { r.history!.fan0PressurePa![0] += 1 }, r => { r.history!.fan1ForceN![0] *= 2 },
    r => { r.mac!.fans.pop() }, r => { r.mac!.fans[0].pressureRisePa += 1 }, r => { r.mac!.fans[0].forceN *= 2 },
    r => { r.thermal!.sourceEnergyJ += 1 }, r => { r.thermal!.thermalSubsteps = 4097 },
    r => { r.thermal!.thermalEnergyJ += 1 },
    r => { r.artifacts!.pop() }, r => { r.artifacts!.reverse() }, r => { delete r.artifacts![0].step },
  ];
  for (const mutate of mutations) {
    const { job, result } = candidate(); mutate(result);
    assert.throws(() => service.completeJob({ jobId: job.id, agentId: 'mac-agent', result }));
    assert.notEqual(service.getJob(job.id)?.status, 'succeeded');
  }
});

test('MAC stale leases and foreign frame ownership cannot become successful results', () => {
  const a = candidate(), b = candidate();
  a.result.artifacts![0] = b.result.artifacts![0];
  assert.throws(() => service.completeJob({ jobId: a.job.id, agentId: 'mac-agent', result: a.result }), /belong/);
  const expired = candidate();
  service.cancelJob(expired.job.id);
  assert.equal(service.completeJob({ jobId: expired.job.id, agentId: 'mac-agent', result: expired.result }), null);
});
