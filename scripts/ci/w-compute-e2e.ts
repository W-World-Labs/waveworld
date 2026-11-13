import { signalArrayRcInputs } from './signal-array-fixture';
import { detectionInputs } from './detection-fixture';
import { antennaInputs } from './antenna-fixture';
import { planeInputs } from './plane-fixture';
import { opticsScene } from './optics-fixture';
// Default: w-compute-e2e.py's isolated full lifecycle matrix.
// --mac-only: two three-step MAC jobs through an explicitly configured cluster,
// with an isolated TASK_DB_PATH/ARTIFACT_ROOT; no unrelated account inventory checks.
import assert from 'node:assert/strict';
import { fluidScene, convectionScene } from './fluid-fixture';
import { isingScene } from './ising-fixture';
import { rlcScene, mutualScene, neuronScene, vibrationScene, transientInputs, faradayInputs } from './ode-fixture';
import { particleScene } from './particle-fixture';
import { readFileSync, writeFileSync } from 'node:fs';
import { getComputeConfig, WComputeClient } from '../../apps/host/src/lib/tasks/w-compute-client';
import { createJob, getJob, cancelJob } from '../../apps/host/src/lib/tasks/service';
import { reconcileComputeJobs } from '../../apps/host/src/lib/tasks/w-compute';
import { createModuleJobSpec, computeModule, readModuleResult } from '../../src/lib/sim/module-compute';
import { fanGeometry, thermalSpec, thermalContactsSpec } from './lbm-fixture';
import { prepareLbmInput, runLbmWasm } from '../../src/lib/sim/lbm-compute';
import { saveArtifact, readArtifactBytes } from '../../apps/host/src/lib/tasks/artifacts';
import { encodeModelGeometry } from '../../apps/lab/src/lib/models/geometry-contract';
import { encodeFlowSnapshot } from '../../apps/lab/src/lib/cfd/flow-snapshot';
import { macSpec, macGeometry } from './mac-fixture';
import { prepareMacInput, runMacWasm } from '@w-sim/solvers-lbm/mac3d';
import { assertMacFlowFrames, decodeMacFlowSnapshot, encodeMacFlowSnapshot, MAC_FLOW_SNAPSHOT_KIND, MAC_FLOW_SNAPSHOT_CONTENT_TYPE } from '../../apps/lab/src/lib/cfd/mac-flow-snapshot';

const macOnly = process.argv.includes('--mac-only');
if (macOnly) {
  assert.ok(!process.argv.includes('--allocate-only'), '--mac-only does not run the allocation-restart scenario');
  assert.equal(process.env.W_COMPUTE_ENABLED, '1', '--mac-only requires managed compute to be enabled');
  for (const name of ['TASK_DB_PATH', 'ARTIFACT_ROOT', 'W_COMPUTE_ACCEPTANCE_STATE', 'W_COMPUTE_ACCEPTANCE_PROOF']) {
    assert.ok(process.env[name], `--mac-only requires ${name}; use isolated acceptance storage`);
  }
}
const config = getComputeConfig();
assert.ok(config, 'W_COMPUTE_ENABLED=1 and the existing compute configuration are required');
const client = new WComputeClient(config.origin, config.token, config.clusterId);

if (macOnly) {
  const owner = 'acceptance-owner', statePath = process.env.W_COMPUTE_ACCEPTANCE_STATE!;
  const state: { mode: string; jobs: { jobId: string; thermal: boolean; instanceId?: string }[] } = { mode: 'mac-only', jobs: [] };
  const proof = [];
  const model = saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
    ownerUserId: owner, data: new Uint8Array(encodeModelGeometry(macGeometry)) });
  for (const thermal of [false, true]) {
    const spec = macSpec(model.id, thermal), prepared = prepareMacInput(spec, macGeometry);
    // Build the local oracle before allocating; only the same three short steps.
    const reference = await runMacWasm({ spec, input: prepared.mac, flags: prepared.flags });
    const job = createJob({ spec, createdBy: owner });
    const receipt: (typeof state.jobs)[number] = { jobId: job.id, thermal };
    state.jobs.push(receipt);
    writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    console.log(`MAC ${thermal ? 'thermal' : 'cold'} acceptance job ${job.id}`);
    const deadline = Date.now() + 100000;
    while (Date.now() < deadline && getJob(job.id)?.compute?.phase !== 'stopped') {
      await reconcileComputeJobs(config);
      const current = getJob(job.id)!;
      if (current.compute?.instanceId && receipt.instanceId !== current.compute.instanceId) {
        receipt.instanceId = current.compute.instanceId;
        writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
      }
      if (current.compute?.error) console.log('Reconciliation:', current.compute.error);
      if (current.compute?.phase !== 'stopped') await new Promise(resolve => setTimeout(resolve, 1100));
    }
    const done = getJob(job.id)!;
    assert.equal(done.compute?.phase, 'stopped', `MAC cleanup incomplete for ${job.id}: ${done.compute?.error ?? done.error}`);
    assert.equal(done.status, 'succeeded', done.error ?? 'MAC task failed');
    assert.ok(done.compute?.instanceId);
    const instance = await client.getInstance(done.compute.instanceId);
    assert.equal(instance.state, 'stopped'); assert.equal(instance.reserved, false);
    assert.ok(instance.observed_generation >= instance.generation, 'MAC stop generation has not been observed');
    const result = done.result!;
    assert.equal(result.summary.steps, 3); assert.equal(result.summary.cd, undefined); assert.equal(result.summary.dragN, undefined);
    assert.equal(result.derived?.engine, 'rust-native'); assert.equal(result.derived?.precision, 'float64');
    assert.deepEqual({ ...result.summary, wallTimeMs: 0 }, { ...reference.result.summary, wallTimeMs: 0 });
    assert.deepEqual(result.history, reference.result.history);
    assert.deepEqual(result.history?.step, [2, 3]);
    assert.deepEqual(result.history?.timeSeconds, [2, 3].map(step => step * spec.parameters.dtSeconds));
    assert.deepEqual(result.mac, reference.result.mac); assert.equal(result.mac?.fans.length, 2);
    assert.equal(result.mac?.samplePhase, 'before-momentum-step');
    assert.deepEqual(result.thermal, reference.result.thermal);
    assert.ok(Number(result.summary.maxSpeedMps) > 0);
    if (thermal) {
      const heat = result.thermal!, expectedSource = 2 * spec.parameters.dtSeconds * 3;
      assert.ok(Math.abs(heat.sourceEnergyJ - expectedSource) < 1e-12);
      assert.ok(Math.abs(heat.thermalEnergyJ - heat.sourceEnergyJ - heat.boundaryEnergyJ - heat.energyResidualJ) < 1e-12);
    }
    assert.equal(result.artifacts?.length, 3);
    assert.deepEqual(result.artifacts.map(ref => ref.step), [1, 2, 3]);
    const frames = [];
    for (const [index, ref] of result.artifacts.entries()) {
      assert.equal(ref.kind, MAC_FLOW_SNAPSHOT_KIND); assert.equal(ref.contentType, MAC_FLOW_SNAPSHOT_CONTENT_TYPE);
      const saved = readArtifactBytes(ref.artifactId)!;
      assert.ok(saved); assert.equal(saved.meta.ownerUserId, owner); assert.equal(saved.meta.jobId, job.id);
      assert.equal(saved.meta.kind, MAC_FLOW_SNAPSHOT_KIND); assert.equal(saved.meta.contentType, MAC_FLOW_SNAPSHOT_CONTENT_TYPE);
      assert.deepEqual(saved.data, Buffer.from(encodeMacFlowSnapshot(reference.snapshots[index])));
      const frame = decodeMacFlowSnapshot(saved.data.buffer.slice(saved.data.byteOffset, saved.data.byteOffset + saved.data.byteLength) as ArrayBuffer);
      assert.equal(frame.step, index + 1); frames.push(frame);
      const name = index === 2 ? 'flow.bin' : `flow-${index + 1}.bin`;
      assert.deepEqual(Buffer.from(await client.getFile(instance.id, name)), saved.data);
    }
    assertMacFlowFrames(frames, spec, 3);
    const native = JSON.parse(new TextDecoder().decode(await client.getFile(instance.id, 'result.json')));
    assert.equal(native.jobId, job.id); assert.equal(native.status, 'succeeded');
    proof.push({ jobId: job.id, instanceId: instance.id, status: done.status, phase: done.compute.phase,
      reserved: instance.reserved, thermal, steps: 3, fieldSteps: frames.map(frame => frame.step),
      fanCount: result.mac!.fans.length, curveSource: 'synthetic-ci-fixture', resultsEqualWasm: true,
      ...(result.thermal ? { energy: result.thermal } : {}) });
  }
  assert.equal(new Set(proof.map(row => row.instanceId)).size, 2);
  writeFileSync(process.env.W_COMPUTE_ACCEPTANCE_PROOF!, JSON.stringify({ nativeDocker: true, mode: 'mac-only',
    mac3d: true, instances: proof }, null, 2), { mode: 0o600 });
  console.log('PASS MAC cold/thermal, two P-Q fans, three SI frames, exact WASM parity and confirmed instance stop');
  process.exit(0);
}
const available = [
  { module: 'ripple' as const, scene: { damping: 0.998, steps: 3, seeds: [{ x: 90, y: 90, radius: 2, amount: 6 }] } },
  { module: 'sim' as const, scene: { r: 0.21, steps: 3, seeds: [{ x: 0, y: 0, radius: 3, amount: 80 }] } },
  { module: 'fdtd' as const, scene: { preset: 'lens' as const, boundary: 'mur' as const, shape: 'line' as const, time: 'cw' as const, omega: 0.3, steps: 3, sources: [{ i: 109, j: 100 }] } },
  { module: 'md' as const, scene: { N: 64, temperature: 0.4, thermostat: true, barostat: true, targetP: 0.5, tauP: 0.5, steps: 7, seed: 3 } },
  { module: 'particles' as const, scene: particleScene() },
  { module: 'fluid' as const, scene: fluidScene() },
  { module: 'convection' as const, scene: convectionScene() },
  { module: 'ising' as const, scene: isingScene() },
  { module: 'rlc' as const, scene: rlcScene() },
  { module: 'mutual' as const, scene: mutualScene() },
  { module: 'neuron' as const, scene: neuronScene() },
  { module: 'vibration' as const, scene: vibrationScene() },
  { module: 'optics-lab' as const, components: opticsScene() },
  ...planeInputs, ...antennaInputs, ...detectionInputs, signalArrayRcInputs[1], ...transientInputs, ...faradayInputs.slice(0, 1),
];
// Opt-in lifecycle acceptance can target changed modules; retain allocation recovery,
// cancellation and thermal-artifact transport in every run. Default is the full matrix.
const selected = process.env.W_COMPUTE_ACCEPTANCE_MODULES?.split(',').map(value => value.trim()).filter(Boolean);
if (selected?.some(name => !available.some(input => input.module === name))) throw new Error('Unknown acceptance module');
const samples = available.filter((input, index) => index < 2 || !selected || selected.includes(input.module));
const recoveryPath = process.env.W_COMPUTE_ACCEPTANCE_STATE!;
if (process.argv.includes('--allocate-only')) {
  const job = createJob({ spec: createModuleJobSpec(samples[0]), createdBy: 'acceptance-owner' });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && !getJob(job.id)?.compute?.instanceId) {
    await reconcileComputeJobs(config);
    await new Promise(resolve => setTimeout(resolve, 1100));
  }
  assert.ok(getJob(job.id)?.compute?.instanceId);
  writeFileSync(recoveryPath, JSON.stringify({ jobId: job.id }), { mode: 0o600 });
  console.log('PASS allocation persisted before Host process exit');
  process.exit(0);
}
const recovery = JSON.parse(readFileSync(recoveryPath, 'utf8'));
const proof = [];
for (const [index, input] of samples.entries()) {
  const job = index === 0 ? getJob(recovery.jobId)! : createJob({ spec: createModuleJobSpec(input), createdBy: 'acceptance-owner' });
  let cancelled = false;
  const deadline = Date.now() + 100000;
  while (Date.now() < deadline) {
    await reconcileComputeJobs(config);
    const current = getJob(job.id)!;
    // The heat sample cancels after actual allocation, before input transfer.
    if (index === 1 && !cancelled && current.compute?.instanceId) {
      // Pause Host staging until the actual native process is waiting for job.json.
      while ((await client.getInstance(current.compute.instanceId)).state !== 'running') {
        assert.ok(Date.now() < deadline, 'native container did not start before cancellation');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      cancelJob(job.id); cancelled = true;
    }
    if (current.compute?.phase === 'stopped') break;
    if (current.compute?.error) console.log('Reconciliation:', current.compute.error);
    await new Promise(resolve => setTimeout(resolve, 1100));
  }
  const done = getJob(job.id)!;
  assert.equal(done.compute?.phase, 'stopped', `cleanup incomplete: ${done.compute?.error}`);
  assert.equal(done.status, index === 1 ? 'cancelled' : 'succeeded');
  const instance = await client.getInstance(done.compute!.instanceId!);
  assert.equal(instance.state, 'stopped'); assert.equal(instance.reserved, false);
  if (index !== 1) {
    assert.equal(done.result?.derived?.engine, 'rust-native');
    assert.deepEqual(readModuleResult(done.result!, input), await computeModule(input));
    const saved = JSON.parse(new TextDecoder().decode(await client.getFile(instance.id, 'result.json')));
    assert.equal(saved.jobId, job.id); assert.equal(saved.status, 'succeeded');
  } else assert.equal(done.result, null);
  proof.push({ jobId: job.id, instanceId: instance.id, status: done.status, phase: done.compute?.phase,
    reserved: instance.reserved, resultsEqualWasm: index !== 1 });
}
const model = saveArtifact({ kind: 'model-geometry', contentType: 'application/vnd.waveworld.mesh-v2',
  ownerUserId: 'acceptance-owner', data: new Uint8Array(encodeModelGeometry(fanGeometry)) });
const spec = thermalContactsSpec(model.id);
spec.parameters = { ...spec.parameters, inletVelocity: 0, fan: thermalSpec().parameters.fan };
const wind = createJob({ spec, createdBy: 'acceptance-owner' });
const windDeadline = Date.now() + 100000;
while (Date.now() < windDeadline && getJob(wind.id)?.compute?.phase !== 'stopped') {
  await reconcileComputeJobs(config);
  await new Promise(resolve => setTimeout(resolve, 1100));
}
const done = getJob(wind.id)!;
assert.equal(done.status, 'succeeded', done.error ?? done.compute?.error ?? 'wind failed');
assert.equal(done.compute?.phase, 'stopped');
const reference = await runLbmWasm(spec, prepareLbmInput(spec, fanGeometry));
assert.ok(reference.snapshot!.display.some((value, i) => i % 3 === 0 && value > 0));
assert.deepEqual(done.result!.history, reference.result.history);
assert.equal(done.result!.derived!.ambientC, 25); assert.equal(done.result!.derived!.temperatureScaleC, 1);
assert.deepEqual(done.result!.thermal, reference.result.thermal);
assert.ok(Math.abs(done.result!.thermal!.sourceEnergyJ - 7 * 0.0001 * 3) < 1e-12);
assert.ok(reference.snapshot!.flags.includes(5) && reference.snapshot!.flags.includes(6));
assert.ok(reference.snapshot!.display.some((value, i) => i % 3 === 2 && !reference.snapshot!.flags[Math.floor(i / 3)] && value > 0));
const field = readArtifactBytes(done.result!.artifacts![0].artifactId)!;
assert.deepEqual(field.data, Buffer.from(encodeFlowSnapshot(reference.snapshot!)));
assert.equal(field.meta.ownerUserId, 'acceptance-owner'); assert.equal(field.meta.jobId, wind.id);
const instance = await client.getInstance(done.compute!.instanceId!);
assert.equal(instance.state, 'stopped'); assert.equal(instance.reserved, false);
assert.deepEqual(Buffer.from(await client.getFile(instance.id, 'flow.bin')), field.data);
proof.push({ jobId: wind.id, instanceId: instance.id, status: done.status, phase: done.compute?.phase,
  reserved: instance.reserved, resultsEqualWasm: true });
assert.equal((await client.listInstances()).length, samples.length + 1);
writeFileSync(process.env.W_COMPUTE_ACCEPTANCE_PROOF!, JSON.stringify({ nativeDocker: true, hostProcessRestart: true,
  ...Object.fromEntries(samples.filter((_, index) => index !== 1).map(input => [input.module, true])),
  zeroInletFan: true, thermalFan: true, solidPower: true, thermalRegions: true, thermalContacts: true,
  thermal: done.result!.thermal, instances: proof }, null, 2), { mode: 0o600 });
console.log('PASS real native compute, Host persistence, WASM parity, stop confirmation, retained result and cancellation');
