import { LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE } from '@w-sim/contracts'
import { signalArrayInputs, signalArrayRcInputs, invalidSignalArrays } from './signal-array-fixture'
import { detectionInputs, detectionEdgeInputs } from './detection-fixture'
import { opticsScene } from './optics-fixture'
import { planeInputs, extremePlaneInputs } from './plane-fixture'
import { antennaInputs, antennaEdgeInputs } from './antenna-fixture'
import { opticsPreset, OPTICS_PRESETS } from '../../src/lib/lab/optics-lab'
import assert from 'node:assert/strict'
import { fluidScene, convectionScene } from './fluid-fixture'
import { isingScene } from './ising-fixture'
import { rlcScene, mutualScene, neuronScene, vibrationScene, transientInputs, faradayInputs } from './ode-fixture'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { computeModule, createModuleJobSpec, readModuleJobInput, readModuleResult, type ModuleComputeInput } from '../../src/lib/sim/module-compute'
import { prepareParticleInput } from '../../src/lib/sim/particles'
import { parseLammpsData } from '../../src/lib/sim/lammps-data'
import { particleScene } from './particle-fixture'
import { prepareMdInput } from '../../src/lib/sim/md'
import { prepareFdtdInput } from '../../src/lib/sim/fdtd'
import { prepareLbmInput, runLbmWasm } from '../../src/lib/sim/lbm-compute'
import { WasmLbm } from '../../src/lib/sim/wasm-fields'
import { encodeFlowSnapshot, decodeFlowSnapshot, summarizeFlowSnapshot, FLOW_SNAPSHOT_V2_CONTENT_TYPE } from '../../apps/lab/src/lib/cfd/flow-snapshot'
import { lbmGeometry, lbmSpec, groundSpec, tinyForceFixture, fanGeometry, fanSpec, thermalSpec, solidPowerSpec, thermalRegionsSpec, thermalContactsSpec } from './lbm-fixture'
import { macSpec, macGeometry } from './mac-fixture'
import { prepareMacInput } from '@w-sim/solvers-lbm/mac3d'
import { encodeMacFlowSnapshot, decodeMacFlowSnapshot } from '../../apps/lab/src/lib/cfd/mac-flow-snapshot'

const binary = resolve(process.env.WAVEWORLD_NATIVE_BIN ?? 'apps/lab/bin/native/waveworld-agent')
const samples: ModuleComputeInput[] = [
  { module: 'ripple', scene: { damping: 0.998, steps: 5, seeds: [{ x: 1, y: 1, radius: 2, amount: -1.37 }, { x: 90, y: 90, radius: 3, amount: 6.12 }] } },
  { module: 'sim', scene: { r: 0.21, steps: 5, seeds: [{ x: 0, y: 0, radius: 3, amount: 71.23 }, { x: 90, y: 60, radius: 4, amount: 80 }] } },
]
function run(spec: unknown, prepare?: (dir: string) => void) {
  const dir = mkdtempSync(resolve(tmpdir(), 'waveworld-native-smoke-'))
  try {
    let fdtd, md
    try {
      const input = readModuleJobInput(spec as Parameters<typeof readModuleJobInput>[0])
      if (input.module === 'fdtd') fdtd = prepareFdtdInput(input.scene)
      if (input.module === 'md') md = prepareMdInput(input.scene)
      if (input.module === 'particles') md = prepareParticleInput(input.scene)
    } catch { /* Invalid specs must reach the native validation. */ }
    writeFileSync(resolve(dir, 'job.json'), JSON.stringify({ schemaVersion: 1, jobId: 'smoke', spec, maxWallTimeMs: 5000, inputs: [], fdtd, md }))
    prepare?.(dir)
    const execution = spawnSync(binary, ['execute-file', '--directory', dir, '--job-id', 'smoke', '--wait-ms', '0'], { timeout: 10000, encoding: 'utf8' })
    if (execution.error) throw execution.error
    const result = JSON.parse(readFileSync(resolve(dir, 'result.json'), 'utf8'))
    return { code: execution.status, result, flow: result.files?.length ? readFileSync(resolve(dir, 'flow.bin')) : undefined,
      frames: (result.files ?? []).map((file: { name: string }) => readFileSync(resolve(dir, file.name))) }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('MAC native/WASM preserve two fan curves, physical time, heat audit and SI replay in three steps', async () => {
  const { runMacWasm } = await import('@w-sim/solvers-lbm/mac3d')
  for (const mode of ['cold', 'heated', 'reverse-axis']) {
    const heated = mode === 'heated', spec = macSpec(undefined, heated)
    if (mode === 'reverse-axis') spec.parameters.fans!.forEach(fan => { fan.axis = '-x' })
    const { mac, flags } = prepareMacInput(spec, macGeometry)
    const native = run(spec, dir => {
      writeFileSync(resolve(dir, 'flags.bin'), flags)
      writeFileSync(resolve(dir, 'job.json'), JSON.stringify({ schemaVersion: 1, jobId: 'smoke', spec,
        maxWallTimeMs: 5000, mac, inputs: [{ name: 'flags.bin', bytes: flags.length }] }))
    })
    assert.equal(native.code, 0, JSON.stringify(native.result))
    const wasm = await runMacWasm({ spec, input: mac, flags })
    const actual = native.result.result
    assert.deepEqual({ ...actual.summary, wallTimeMs: 0 }, { ...wasm.result.summary, wallTimeMs: 0 })
    assert.deepEqual(actual.history, wasm.result.history)
    assert.deepEqual(actual.mac, wasm.result.mac)
    assert.deepEqual(actual.thermal, wasm.result.thermal)
    assert.deepEqual({ ...actual.derived, engine: '' }, { ...wasm.result.derived, engine: '' })
    assert.equal(actual.summary.cd, undefined)
    assert.equal(actual.summary.dragN, undefined)
    assert.ok(actual.summary.maxSpeedMps > 0)
    assert.deepEqual(actual.history.step, [2, 3])
    assert.deepEqual(native.frames.map((frame: Buffer) => decodeMacFlowSnapshot(frame.slice().buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer).step), [1, 2, 3])
    assert.equal(native.frames.length, wasm.snapshots.length)
    wasm.snapshots.forEach((frame, i) => assert.ok(native.frames[i].equals(Buffer.from(encodeMacFlowSnapshot(frame))), `MAC frame ${i} differs`))
    assert.equal(actual.mac.fans.length, 2)
    assert.equal(actual.mac.samplePhase, 'before-momentum-step')
    if (mode === 'reverse-axis') assert.ok(actual.mac.fans.every((fan: { forceN: number }) => fan.forceN < 0))
    if (heated) assert.ok(Math.abs(actual.thermal.sourceEnergyJ - .0006) < 1e-15)
  }
})

test('MAC native fails closed on changed physical units, wrong executor feature, missing masks and unstable dt', () => {
  const base = macSpec(), prepared = prepareMacInput(base, macGeometry)
  for (const change of [
    (job: any) => { job.spec.requirements.features = [] },
    (job: any) => { job.spec.requirements.precision = 'mixed' },
    (job: any) => { job.mac.dtSeconds *= 2 },
    (job: any) => { job.mac.kinematicViscosity *= 2 },
    (job: any) => { job.mac.fanPoints[0].pressurePa *= 2 },
    (job: any) => { job.spec.parameters.inletVelocity = 1 },
    (job: any) => { job.spec.parameters.projectionMaxIterations = null },
    (job: any) => { job.spec.parameters.absoluteDivergenceTolerance = '0.000001' },
    (job: any) => { job.spec.outputs.history = 'true' },
    (job: any) => { job.spec.outputs.forces = true },
    (job: any) => { job.spec.run.stopWhen = { maxCdVariance: 1 } },
    (job: any) => { job.inputs = [] },
    (job: any) => { job.mac.dtSeconds = job.spec.parameters.dtSeconds = 10 },
  ]) {
    const output = run(base, dir => {
      const job = structuredClone({ schemaVersion: 1, jobId: 'smoke', spec: base, maxWallTimeMs: 5000,
        mac: prepared.mac, inputs: [{ name: 'flags.bin', bytes: prepared.flags.length }] })
      change(job)
      writeFileSync(resolve(dir, 'flags.bin'), prepared.flags)
      writeFileSync(resolve(dir, 'job.json'), JSON.stringify(job))
    })
    assert.notEqual(output.code, 0)
    assert.equal(output.result.status, 'failed')
    assert.equal(output.result.result, undefined)
    assert.deepEqual(output.result.files, [])
  }
})

test('native and WASM return identical wave/heat fields through the existing result contract', async () => {
  for (const input of samples) {
    const spec = createModuleJobSpec(input), native = run(spec)
    assert.equal(native.code, 0)
    assert.equal(native.result.status, 'succeeded')
    assert.equal(native.result.result.derived.engine, 'rust-native')
    assert.equal(native.result.result.derived.precision, 'mixed')
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
  }
})

test('native/WASM plane waves preserve FP64 fields at typical and extreme phases; invalid jobs fail', async () => {
  for (const input of [...planeInputs, ...extremePlaneInputs]) {
    const native = run(createModuleJobSpec(input))
    assert.equal(native.code, 0, JSON.stringify(native.result))
    assert.equal(native.result.status, 'succeeded')
    assert.equal(native.result.result.derived.precision, 'float64')
    assert.equal(native.result.result.derived.engine, 'rust-native')
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
  }
  for (const input of planeInputs) {
    for (const change of [
      (spec: any) => { spec.run.maxSteps = 2 },
      (spec: any) => { spec.requirements.precision = 'mixed' },
      (spec: any) => { spec.model.inline.params = {} },
      (spec: any) => { spec.model.inline.params.phase0 = null; spec.model.inline.params.time = null },
      (spec: any) => { spec.model.inline.params.frequencyHz = '1'; spec.model.inline.params.amplitude = '1' },
      (spec: any) => { spec.model.inline.xs = [0]; spec.model.inline.params.waveNumber = 0 },
      (spec: any) => { spec.model.inline.xs = [0, null]; spec.model.inline.params.time = -1 },
    ]) {
      const spec = structuredClone(createModuleJobSpec(input)); change(spec)
      const native = run(spec)
      assert.notEqual(native.code, 0)
      assert.equal(native.result.status, 'failed')
      assert.equal(native.result.result, undefined)
    }
  }
})

test('native/WASM antenna and array snapshots preserve fields, null links, clipped lobes and validation', async () => {
  for (const input of [...antennaInputs, ...antennaEdgeInputs]) {
    const native = run(createModuleJobSpec(input))
    assert.equal(native.code, 0, JSON.stringify(native.result))
    assert.equal(native.result.status, 'succeeded')
    assert.equal(native.result.result.derived.precision, 'float64')
    assert.equal(native.result.result.derived.engine, 'rust-native')
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
  }
  for (const input of antennaInputs) {
    for (const change of [
      (s: any) => { s.run.maxSteps = 2 },
      (s: any) => { s.requirements.precision = 'mixed' },
      (s: any) => { s.model.inline.params = {} },
      (s: any) => { s.model.inline.params.frequencyHz = null; s.model.inline.params.n = null },
      (s: any) => { s.model.inline.params.distM = 0; s.model.inline.params.n = 49 },
      (s: any) => { s.model.inline.params.ptDbm = '20'; s.model.inline.params.n = 2.5 },
      (s: any) => { s.model.inline.params.type = 'unknown'; s.model.inline.params.polarizationDeg = 91; s.model.inline.params.steerDeg = 81 },
    ]) {
      const spec = structuredClone(createModuleJobSpec(input)); change(spec)
      const native = run(spec)
      assert.notEqual(native.code, 0)
      assert.equal(native.result.status, 'failed')
      assert.equal(native.result.result, undefined)
    }
  }
})

test('native/WASM radar, laser and NLJD preserve fields, partial chunks and diagnostics', async () => {
  for (const input of [...detectionInputs, ...detectionEdgeInputs]) {
    const native = run(createModuleJobSpec(input))
    assert.equal(native.code, 0, JSON.stringify(native.result))
    assert.equal(native.result.status, 'succeeded')
    assert.equal(native.result.result.derived.precision, input.module === 'radar' ? 'mixed' : 'float64')
    assert.equal(native.result.result.derived.engine, 'rust-native')
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
  }
  for (const input of detectionInputs) {
    for (const change of [
      (s: any) => { s.run.maxSteps = 0 },
      (s: any) => { s.requirements.precision = input.module === 'radar' ? 'float64' : 'mixed' },
      (s: any) => { s.model.inline = { module: input.module } },
      (s: any) => { Object.assign(s.model.inline, { pump: null, kind: 'unknown', scene: { mode: 'cw', steps: 5, probes: [] } }) },
      (s: any) => { Object.assign(s.model.inline, { pump: 4001, kind: null, scene: { mode: 'pulse', steps: 5, probes: [{ x: 200, y: 100 }, null, null, null] } }) },
      (s: any) => { Object.assign(s.model.inline, { steps: 2.5, kind: 0, scene: { mode: 'unknown', steps: 5, probes: [null, null, null, null] } }) },
    ]) {
      const spec = structuredClone(createModuleJobSpec(input)); change(spec)
      const native = run(spec)
      assert.notEqual(native.code, 0)
      assert.equal(native.result.status, 'failed')
      assert.equal(native.result.result, undefined)
    }
  }
})

test('native/WASM Ising preserves seeded spins, temperature-sweep statistics and sample nulls', async () => {
  for (const scene of [isingScene(), { ...isingScene(), seed: 0, hot: false },
    { ...isingScene(), seed: 4294967295, temperatures: [4, 2, 0.5] },
    { ...isingScene(), size: 17, temperatures: [2], burnIn: 0, samples: 1 }]) {
    const input = { module: 'ising' as const, scene }, native = run(createModuleJobSpec(input))
    assert.equal(native.code, 0)
    assert.equal(native.result.status, 'succeeded')
    assert.equal(native.result.result.derived.precision, 'float64')
    assert.equal(native.result.result.derived.engine, 'rust-native')
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
  }
  for (const change of [{ temperatures: [] }, { temperatures: [0] }, { size: 15 }, { size: 257 },
    { samples: 0 }, { burnIn: -1 }, { seed: 4294967296 }, { hot: 'false' }, { samples: 1000, burnIn: 1000 }]) {
    const spec = createModuleJobSpec({ module: 'ising', scene: isingScene() })
    Object.assign((spec.model as any).inline.scene, change)
    const native = run(spec)
    assert.notEqual(native.code, 0)
    assert.equal(native.result.status, 'failed')
    assert.equal(native.result.result, undefined)
  }
  const spec = createModuleJobSpec({ module: 'ising', scene: isingScene() })
  spec.run.maxSteps++
  assert.equal(run(spec).result.status, 'failed')
  spec.run.maxSteps--; spec.requirements!.precision = 'mixed'
  assert.equal(run(spec).result.status, 'failed')
})

test('native/WASM ODE modules preserve full trajectories, diagnostics and partial chunks', async () => {
  const inputs: ModuleComputeInput[] = [
    { module: 'rlc', scene: rlcScene() }, { module: 'rlc', scene: { zeta: 0, drive: 'energy', steps: 3 } },
    { module: 'rlc', scene: { zeta: 2, drive: 'step', steps: 9 } },
    { module: 'mutual', scene: mutualScene() }, { module: 'mutual', scene: { ...mutualScene(), mode: 'step' } },
    { module: 'mutual', scene: { k: 0, n: 3, mode: 'sine', steps: 3 } },
    { module: 'vibration', scene: vibrationScene() },
    { module: 'vibration', scene: { mass: 0.2, stiffness: 400, damping: 8, driveFrequency: 5, steps: 3 } },
    { module: 'neuron', scene: neuronScene() }, { module: 'neuron', scene: { current: 0, steps: 3, pulses: [] } },
    { module: 'neuron', scene: { current: 1, steps: 80, pulses: [0, 30, 79] } },
  ]
  for (const input of inputs) {
    const native = run(createModuleJobSpec(input))
    assert.equal(native.code, 0, JSON.stringify(native.result))
    assert.equal(native.result.status, 'succeeded')
    assert.equal(native.result.result.derived.precision, 'float64')
    assert.equal(native.result.result.derived.engine, 'rust-native')
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
  }
  for (const [module, scene, changes] of [
    ['rlc', rlcScene(), [{ zeta: -1 }, { drive: 'invalid' }]],
    ['mutual', mutualScene(), [{ k: 1 }, { n: 0 }, { mode: 'invalid' }]],
    ['vibration', vibrationScene(), [{ mass: 0 }, { driveFrequency: 6 }]],
    ['neuron', neuronScene(), [{ current: 2 }, { pulses: [4, 0] }, { pulses: [0, 0] }, { pulses: [9] }]],
  ] as const) for (const change of changes) {
    const spec = createModuleJobSpec({ module, scene: { ...scene } } as ModuleComputeInput)
    Object.assign((spec.model as any).inline.scene, change)
    assert.equal(run(spec).result.status, 'failed')
  }
})

test('native/WASM wind tunnel has byte-identical fields, forces and convergence stopping', async () => {
  const geometry = { ...lbmGeometry, vertices: lbmGeometry.vertices.slice() }
  // A yawed body produces a real nonzero side force in this short transient.
  for (let i = 0; i < geometry.vertices.length; i += 3) {
    const x = geometry.vertices[i], z = geometry.vertices[i + 2]
    geometry.vertices[i] = 0.8 * x - 0.6 * z; geometry.vertices[i + 2] = 0.6 * x + 0.8 * z
  }
  const spec = lbmSpec(), prepared = prepareLbmInput(spec, geometry)
  const stage = (dir: string) => {
    const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
    job.lbm = prepared.lbm; job.inputs = [{ name: 'flags.bin', bytes: prepared.flags.length }]
    writeFileSync(path, JSON.stringify(job)); writeFileSync(resolve(dir, 'flags.bin'), prepared.flags)
  }
  for (const [stopWhen, history] of [[undefined, true], [{ maxCdVariance: 1e100, window: 2 }, true], [{ maxCdVariance: 1e100, window: 2 }, false]] as const) {
    const input = { ...spec, outputs: { ...spec.outputs, history }, run: { ...spec.run, stopWhen } }, native = run(input, stage)
    assert.equal(native.result.status, 'succeeded', native.result.error)
    const wasm = await runLbmWasm(input, prepared)
    assert.equal(native.result.result.derived[LBM_GAUGE_FORCE_FEATURE], 1)
    assert.equal(native.result.result.derived[LBM_NEE_OUTLET_FEATURE], 1)
    assert.equal(native.result.result.derived[LBM_NEE_INLET_FEATURE], 1)
    assert.equal(wasm.result.derived?.[LBM_GAUGE_FORCE_FEATURE], 1)
    assert.equal(wasm.result.derived?.[LBM_NEE_OUTLET_FEATURE], 1)
    assert.equal(wasm.result.derived?.[LBM_NEE_INLET_FEATURE], 1)
    assert.deepEqual(native.flow, Buffer.from(encodeFlowSnapshot(wasm.snapshot!)))
    assert.deepEqual(native.result.result.history, wasm.result.history)
    assert.deepEqual(native.result.result.lbmMassBalance, wasm.result.lbmMassBalance)
    for (const key of ['steps', 'cd', 'cl', 'dragN', 'liftN', 'sideN', 'solidCells']) {
      assert.equal(native.result.result.summary[key], wasm.result.summary[key])
    }
    assert.ok(Math.abs(Number(wasm.result.summary.sideN)) > 1e-6)
    assert.equal(native.result.result.summary.steps, stopWhen ? 2 : 3)
    for (const key of ['viscosityMode', 'requestedViscosityM2s', 'simulatedViscosityM2s']) assert.equal(native.result.result.derived[key], wasm.result.derived?.[key])
  }
  for (const params of [{ thermalEnabled: true }, { fan: { enabled: true } }]) {
    assert.equal(run({ ...spec, parameters: { ...spec.parameters, ...params } }, stage).result.status, 'failed')
  }
  const oldForceSpec = { ...spec, requirements: { ...spec.requirements, features: [LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE] } }
  const oldForce = run(oldForceSpec, stage)
  assert.equal(oldForce.result.status, 'failed')
  assert.match(oldForce.result.error, /lbm-gauge-force-v1/)
  await assert.rejects(runLbmWasm(oldForceSpec, prepared), /lbm-gauge-force-v1/)
  const oldOutletSpec = { ...spec, requirements: { ...spec.requirements, features: [LBM_GAUGE_FORCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE] } }
  const oldOutlet = run(oldOutletSpec, stage)
  assert.equal(oldOutlet.result.status, 'failed')
  assert.match(oldOutlet.result.error, /lbm-nee-outlet-v1/)
  await assert.rejects(runLbmWasm(oldOutletSpec, prepared), /lbm-nee-outlet-v1/)
  const oldInletSpec = { ...spec, requirements: { ...spec.requirements, features: [LBM_GAUGE_FORCE_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_MASS_BALANCE_FEATURE] } }
  const oldInlet = run(oldInletSpec, stage)
  assert.equal(oldInlet.result.status, 'failed')
  assert.match(oldInlet.result.error, /lbm-nee-inlet-v1/)
  await assert.rejects(runLbmWasm(oldInletSpec, prepared), /lbm-nee-inlet-v1/)
  const oldMassSpec = { ...spec, requirements: { ...spec.requirements, features: spec.requirements!.features!.filter(feature => feature !== LBM_MASS_BALANCE_FEATURE) } }
  const oldMass = run(oldMassSpec, stage)
  assert.equal(oldMass.result.status, 'failed')
  assert.match(oldMass.result.error, /lbm-mass-balance-v1/)
  await assert.rejects(runLbmWasm(oldMassSpec, prepared), /lbm-mass-balance-v1/)
  const linked = run(spec, dir => { stage(dir); rmSync(resolve(dir, 'flags.bin')); symlinkSync('job.json', resolve(dir, 'flags.bin')) })
  assert.equal(linked.result.status, 'failed')
  const corrupt = run(spec, dir => { stage(dir); const flags = prepared.flags.slice(); flags[0] = 3; writeFileSync(resolve(dir, 'flags.bin'), flags) })
  assert.match(corrupt.result.error, /model mask/)
})

test('native/WASM temporal flow frames preserve real steps, early final frames and identical physics', async () => {
  for (const mode of ['fluid', 'thermal', 'fluid-pressure', 'thermal-pressure', 'early-between', 'early-scheduled'] as const) {
    const spec = mode.startsWith('thermal') ? solidPowerSpec() : lbmSpec();
    const pressure = mode.endsWith('pressure');
    if (pressure) {
      spec.outputs.fields!.push('pressure');
      spec.requirements!.features!.push(LBM_PRESSURE_FIELD_FEATURE);
    }
    spec.outputs.fieldFrames = 3;
    if (mode.startsWith('early')) {
      spec.run.maxSteps = 5;
      spec.run.stopWhen = { maxCdVariance: 1e100, window: mode === 'early-between' ? 2 : 3 };
    }
    const prepared = prepareLbmInput(spec, lbmGeometry);
    const stage = (dir: string) => {
      const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'));
      job.lbm = prepared.lbm; job.inputs = [{ name: 'flags.bin', bytes: prepared.flags.length }];
      writeFileSync(path, JSON.stringify(job)); writeFileSync(resolve(dir, 'flags.bin'), prepared.flags);
    };
    const native = run(spec, stage), wasm = await runLbmWasm(spec, prepared);
    assert.equal(native.result.status, 'succeeded', native.result.error);
    const steps = mode === 'early-between' ? [1, 2] : mode === 'early-scheduled' ? [1, 3] : [1, 2, 3];
    assert.deepEqual(native.result.files.map((file: { step: number }) => file.step), steps);
    assert.deepEqual(native.result.files.map((file: { name: string }) => file.name), steps.map((step, i) => i === steps.length - 1 ? 'flow.bin' : `flow-${step}.bin`));
    assert.deepEqual(native.frames, wasm.snapshots.map(frame => Buffer.from(encodeFlowSnapshot(frame))));
    assert.notDeepEqual(native.frames[0], native.flow);
    assert.deepEqual(native.result.result.history, wasm.result.history)
    assert.deepEqual(native.result.result.lbmMassBalance, wasm.result.lbmMassBalance);
    assert.deepEqual(native.result.result.thermal, wasm.result.thermal);
    assert.equal(native.result.result.derived['lbm-field-history-v1'], 1);
    assert.equal(wasm.result.derived?.['lbm-field-history-v1'], 1);
    for (const key of ['steps', 'cd', 'cl', 'dragN', 'liftN', 'sideN']) assert.equal(native.result.result.summary[key], wasm.result.summary[key]);
    if (pressure) {
      const scale = prepared.lbm.density * (prepared.lbm.units.dx / prepared.lbm.units.dt) ** 2;
      assert.equal(native.result.result.derived.pressureScalePa, scale);
      assert.equal(wasm.result.derived?.pressureScalePa, scale);
      assert.equal(wasm.result.derived?.[LBM_PRESSURE_FIELD_FEATURE], 1);
      const withoutPressure = { ...spec, outputs: { ...spec.outputs, fields: spec.outputs.fields!.filter(field => field !== 'pressure') },
        requirements: { ...spec.requirements, features: spec.requirements!.features!.filter(feature => feature !== LBM_PRESSURE_FIELD_FEATURE) } };
      const baseline = await runLbmWasm(withoutPressure, prepared);
      assert.deepEqual(wasm.result.history, baseline.result.history);
      assert.deepEqual(wasm.result.lbmMassBalance, baseline.result.lbmMassBalance);
      assert.deepEqual(wasm.result.thermal, baseline.result.thermal);
      assert.equal(baseline.result.derived?.pressureScalePa, undefined);
      wasm.snapshots.forEach((frame, index) => {
        assert.equal(native.result.files[index].contentType, FLOW_SNAPSHOT_V2_CONTENT_TYPE);
        const decoded = decodeFlowSnapshot(encodeFlowSnapshot(frame), FLOW_SNAPSHOT_V2_CONTENT_TYPE);
        assert.equal(decoded.hasPressure, true);
        assert.equal(frame.displayStride, baseline.snapshots[index].displayStride + 1);
        const old = baseline.snapshots[index];
        for (let cell = 0; cell < frame.flags.length; cell++) {
          for (let field = 0; field < old.displayStride; field++) assert.equal(frame.display[cell * frame.displayStride + field], old.display[cell * old.displayStride + field]);
          if (frame.flags[cell]) assert.equal(frame.display[(cell + 1) * frame.displayStride - 1], 0);
        }
        assert.ok(summarizeFlowSnapshot(frame, wasm.result.derived!).pressurePa);
      });
      const missingFeature = { ...spec, requirements: withoutPressure.requirements };
      assert.match(run(missingFeature, stage).result.error, /lbm-pressure-field-v1/);
      await assert.rejects(runLbmWasm(missingFeature, prepared), /lbm-pressure-field-v1/);
    }
    if (mode === 'fluid') {
      const finalOnly = run({ ...spec, outputs: { ...spec.outputs, fieldFrames: 1 } }, stage);
      assert.deepEqual(finalOnly.flow, native.flow);
      assert.deepEqual(finalOnly.result.result.history, native.result.result.history);
      assert.equal(finalOnly.result.result.derived['lbm-field-history-v1'], undefined);
      for (const fieldFrames of [0, 4097, 1.5, null]) assert.match(run({ ...spec, outputs: { ...spec.outputs, fieldFrames } }, stage).result.error, /fieldFrames/);
      assert.match(run({ ...spec, outputs: { fields: [], fieldFrames: 3 } }, stage).result.error, /fieldFrames/);
    }
  }
});

test('native/WASM ground jobs preserve translated fields and reject missing or altered wall speeds', async () => {
  for (const mode of ['stationary', 'moving'] as const) {
    const spec = groundSpec(undefined, mode), prepared = prepareLbmInput(spec, lbmGeometry)
    const stage = (dir: string, value = prepared.lbm) => {
      const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
      job.lbm = value; job.inputs = [{ name: 'flags.bin', bytes: prepared.flags.length }]
      writeFileSync(path, JSON.stringify(job)); writeFileSync(resolve(dir, 'flags.bin'), prepared.flags)
    }
    const native = run(spec, stage), wasm = await runLbmWasm(spec, prepared)
    assert.equal(native.result.status, 'succeeded', native.result.error)
    assert.deepEqual(native.flow, Buffer.from(encodeFlowSnapshot(wasm.snapshot!)))
    assert.deepEqual(native.result.result.history, wasm.result.history)
    assert.deepEqual(native.result.result.lbmMassBalance, wasm.result.lbmMassBalance)
    for (const key of ['groundMode', 'groundClearanceM', 'groundVelocityMps', 'lbm-ground-v1']) {
      assert.equal(native.result.result.derived[key], wasm.result.derived?.[key])
    }
    assert.equal(wasm.result.derived?.groundMode, mode)
    assert.equal(wasm.result.derived?.groundClearanceM, 0.1)
    assert.equal(wasm.result.derived?.groundVelocityMps, mode === 'moving' ? spec.parameters.inletVelocity : 0)
    for (const groundVelocityLattice of [undefined, prepared.lbm.groundVelocityLattice! + .001]) {
      const lbm = { ...prepared.lbm, groundVelocityLattice }
      assert.match(run(spec, dir => stage(dir, lbm)).result.error, /ground/)
      await assert.rejects(runLbmWasm(spec, { ...prepared, lbm }), /ground/)
    }
    const absent = { ...spec, parameters: { ...spec.parameters, ground: undefined } }
    assert.match(run(absent, stage).result.error, /ground/)
    await assert.rejects(runLbmWasm(absent, prepared), /ground/)
  }
  const spec = solidPowerSpec()
  spec.parameters.ground = { mode: 'moving', clearanceM: 0.0005 }
  const prepared = prepareLbmInput(spec, lbmGeometry)
  const native = run(spec, dir => {
    const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
    job.lbm = prepared.lbm; job.inputs = [{ name: 'flags.bin', bytes: prepared.flags.length }]
    writeFileSync(path, JSON.stringify(job)); writeFileSync(resolve(dir, 'flags.bin'), prepared.flags)
  })
  const wasm = await runLbmWasm(spec, prepared)
  assert.equal(native.result.status, 'succeeded', native.result.error)
  assert.deepEqual(native.flow, Buffer.from(encodeFlowSnapshot(wasm.snapshot!)))
  assert.deepEqual(native.result.result.thermal, wasm.result.thermal)
})

test('native/WASM force units and warmup preserve the same tiny analytical model', async () => {
  const { spec, prepared } = tinyForceFixture()
  const stage = (dir: string, value = prepared.lbm) => {
    const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
    job.lbm = value; job.inputs = [{ name: 'flags.bin', bytes: prepared.flags.length }]
    writeFileSync(path, JSON.stringify(job)); writeFileSync(resolve(dir, 'flags.bin'), prepared.flags)
  }
  const perStep = await runLbmWasm({ ...spec, run: { ...spec.run, maxSteps: 5 } }, prepared)
  const solver = new WasmLbm(prepared.lbm, prepared.flags)
  const rawMass = (bulk: boolean) => {
    let mass = 0
    for (let cell = 0; cell < prepared.flags.length; cell++) {
      const x = cell % prepared.lbm.nx
      if (prepared.flags[cell] || (x > 0 && x < prepared.lbm.nx - 1) !== bulk) continue
      for (let q = 0; q < 19; q++) mass += solver.distributions[cell * 19 + q]
    }
    return mass
  }
  const initialMass = rawMass(true), measured: { bulk: number; boundary: number; residual: number; max: number }[] = []
  let residual = 0, max = 0
  for (let step = 0; step < 5; step++) {
    const m = solver.step().massBalance
    const value = m.bulkMassAfter - m.bulkMassBefore - m.inletNetMass + m.outletNetMass - m.collisionMassChange
    residual += value; max = Math.max(max, Math.abs(value))
    measured.push({ bulk: rawMass(true), boundary: rawMass(false), residual, max })
  }
  const massScale = prepared.lbm.density * prepared.lbm.units.dx ** 3
  assert.ok(Math.abs(perStep.result.history!.dragN![0] - 0.1) < 3e-8, 'isolated voxel first-step force = 2*rho_lattice*U_lattice in SI')
  assert.ok(Math.abs(perStep.result.history!.cd![0] - 66.66666666666667) < 2e-5)
  for (const [maxSteps, warmupSteps, forceSampleEvery] of [[3, 2, 3], [5, 2, 3], [5, 4, 3], [3, 3, 2]]) {
    const input = { ...spec, run: { ...spec.run, maxSteps, warmupSteps, forceSampleEvery } }
    const wasm = await runLbmWasm(input, prepared), native = run(input, stage)
    assert.equal(native.result.status, 'succeeded', native.result.error)
    assert.deepEqual(native.result.result.history, wasm.result.history)
    assert.deepEqual(native.result.result.lbmMassBalance, wasm.result.lbmMassBalance)
    const report = wasm.result.lbmMassBalance!, measurement = measured[maxSteps - 1]
    assert.equal(wasm.result.derived?.[LBM_MASS_BALANCE_FEATURE], 1)
    assert.equal(native.result.result.derived[LBM_MASS_BALANCE_FEATURE], 1)
    assert.equal(report.scope, 'internal-fluid-x')
    // Independent raw population sums bind SI masses; no dt factor and no warmup trimming.
    for (const [actual, expected] of [[report.initialMassKg, initialMass * massScale],
      [report.finalMassKg, measurement.bulk * massScale], [report.boundaryFinalMassKg, measurement.boundary * massScale],
      [report.balanceResidualKg, measurement.residual * massScale], [report.maxAbsStepBalanceResidualKg, measurement.max * massScale]]) {
      assert.ok(Math.abs(actual - expected) <= 1e-15, `mass account ${actual} != ${expected}`)
    }
    assert.equal(native.result.result.summary.dragN, wasm.result.summary.dragN)
    const expectedSteps = Array.from({ length: maxSteps }, (_, i) => i + 1).filter(step => step > warmupSteps && (step % forceSampleEvery === 0 || step === maxSteps))
    assert.deepEqual(wasm.result.history!.step, expectedSteps)
    let previous = warmupSteps
    expectedSteps.forEach((step, i) => {
      const values = perStep.result.history!.dragN!.slice(previous, step)
      const expected = values.reduce((sum, value) => sum + value, 0) / values.length
      assert.ok(Math.abs(wasm.result.history!.dragN![i] - expected) < 1e-14)
      previous = step
    })
  }
  for (const change of [{ forceScale: prepared.lbm.forceScale * 2 }, { uInlet: prepared.lbm.uInlet * 2 },
    { referenceArea: prepared.lbm.referenceArea * 2, coefficientScale: prepared.lbm.coefficientScale! / 2 }]) {
    const lbm = { ...prepared.lbm, ...change }
    const native = run(spec, dir => stage(dir, lbm))
    assert.equal(native.result.status, 'failed')
    assert.match(native.result.error, /physical units|reference area/)
    await assert.rejects(runLbmWasm(spec, { ...prepared, lbm }), /physical units|reference area/)
  }
})

test('native/WASM physical LBM preserves viscosity and rejects altered preparation', async () => {
  const spec = lbmSpec()
  // A deliberately low-Re physical case, not adjusted air viscosity hidden by a clamp.
  spec.parameters = { ...spec.parameters, viscosityMode: 'physical', fluidViscosity: 1.225 * 0.02 }
  const prepared = prepareLbmInput(spec, lbmGeometry)
  const stage = (dir: string, value = prepared.lbm) => {
    const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
    job.lbm = value; job.inputs = [{ name: 'flags.bin', bytes: prepared.flags.length }]
    writeFileSync(path, JSON.stringify(job)); writeFileSync(resolve(dir, 'flags.bin'), prepared.flags)
  }
  const native = run(spec, stage), wasm = await runLbmWasm(spec, prepared)
  assert.equal(native.result.status, 'succeeded', native.result.error)
  assert.deepEqual(native.flow, Buffer.from(encodeFlowSnapshot(wasm.snapshot!)))
  assert.deepEqual(native.result.result.history, wasm.result.history)
    assert.deepEqual(native.result.result.lbmMassBalance, wasm.result.lbmMassBalance)
  assert.equal(native.result.result.derived.viscosityMode, 'physical')
  assert.equal(native.result.result.derived.requestedViscosityM2s, 0.02)
  assert.ok(Math.abs(native.result.result.derived.simulatedViscosityM2s - 0.02) < 1e-12)
  assert.ok(Math.abs(Number(wasm.result.summary.reynoldsLattice) - 250) < 1e-9)
  const unresolved = lbmSpec(); delete unresolved.parameters.viscosityMode
  assert.throws(() => prepareLbmInput(unresolved, lbmGeometry), /physical LBM requires/)
  for (const change of [
    { units: { ...prepared.lbm.units, viscosityMode: 'stabilized-preview' as const } },
    { units: { ...prepared.lbm.units, requestedViscosityM2s: 0.01 } },
    { units: { ...prepared.lbm.units, simulatedViscosityM2s: 0.01 } },
    { tau: prepared.lbm.tau + 0.01 }, { density: prepared.lbm.density * 2 },
    { inletVelocity: 0 }, { coefficientScale: 0 },
  ]) {
    const lbm = { ...prepared.lbm, ...change }
    assert.equal(run(spec, dir => stage(dir, lbm)).result.status, 'failed')
    await assert.rejects(runLbmWasm(spec, { ...prepared, lbm }), /viscosity|coefficient|physical units/)
  }
})

test('a zero-inlet fan drives the same native/WASM field and cannot silently lose its forcing', async () => {
  const spec = fanSpec(), prepared = prepareLbmInput(spec, fanGeometry)
  assert.equal(prepared.lbm.uInlet, 0); assert.ok(prepared.lbm.fan)
  const stage = (dir: string) => {
    const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
    job.lbm = prepared.lbm; job.inputs = [{ name: 'flags.bin', bytes: prepared.flags.length }]
    writeFileSync(path, JSON.stringify(job)); writeFileSync(resolve(dir, 'flags.bin'), prepared.flags)
  }
  const native = run(spec, stage), wasm = await runLbmWasm(spec, prepared)
  assert.equal(native.result.status, 'succeeded', native.result.error)
  assert.deepEqual(native.flow, Buffer.from(encodeFlowSnapshot(wasm.snapshot!)))
  assert.deepEqual(native.result.result.history, wasm.result.history)
    assert.deepEqual(native.result.result.lbmMassBalance, wasm.result.lbmMassBalance)
  assert.ok(wasm.snapshot!.display.some((value, i) => i % 2 === 0 && value > 0))
  assert.equal('cd' in native.result.result.summary, false)
  assert.equal('cl' in native.result.result.summary, false)
  assert.equal('cd' in native.result.result.history, false)
  assert.equal('cl' in native.result.result.history, false)
  assert.equal(native.result.result.history.dragN.length, 3)
  assert.ok(native.result.result.history.dragN.every(Number.isFinite))
  const invalidStop = { ...spec, run: { ...spec.run, stopWhen: { maxCdVariance: 1e100, window: 2 } } }
  assert.match(run(invalidStop, stage).result.error, /positive inlet/)
  await assert.rejects(runLbmWasm(invalidStop, prepared), /positive inlet/)
  for (const mismatch of ['spec', 'prepared']) {
    const invalid = run(spec, dir => {
      stage(dir)
      const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
      if (mismatch === 'spec') delete job.spec.parameters.fan
      else delete job.lbm.fan
      writeFileSync(path, JSON.stringify(job))
    })
    assert.match(invalid.result.error, /must agree/)
  }
})

test('unsupported modules, precision, job mismatch, unstable inputs and links fail explicitly', () => {
  const spec = createModuleJobSpec(samples[0])
  const cases = [
    { ...spec, requirements: { ...spec.requirements, precision: 'float64' } },
    { ...spec, requirements: { ...spec.requirements, precision: ['float64'] } },
    { ...spec, kind: 'lbm' },
    { ...spec, run: { maxSteps: 9999999 } },
    { ...spec, model: { source: 'inline', inline: { module: 'ripple', scene: { ...samples[0].scene, damping: 1.1 } } } },
  ]
  for (const invalid of cases) {
    const native = run(invalid)
    assert.equal(native.code, 1)
    assert.equal(native.result.status, 'failed')
    assert.equal(native.result.result, undefined)
  }
  const other = run(spec, dir => {
    const path = resolve(dir, 'job.json')
    const job = JSON.parse(readFileSync(path, 'utf8')); job.jobId = 'other'
    writeFileSync(path, JSON.stringify(job))
  })
  assert.match(other.result.error, /another job/)
  const link = run(spec, dir => {
    const path = resolve(dir, 'job.json'), original = readFileSync(path)
    rmSync(path); writeFileSync(resolve(dir, 'linked.json'), original)
    symlinkSync('linked.json', path)
  })
  assert.equal(link.result.status, 'failed')
  const fifo = run(spec, dir => {
    const path = resolve(dir, 'job.json'); rmSync(path); execFileSync('mkfifo', [path])
  })
  assert.equal(fifo.result.status, 'failed')
  assert.match(fifo.result.error, /regular file/)
})


test('thermal fan native/WASM fields match exactly and preserve physical temperature scale', async () => {
  const spec = thermalSpec(), prepared = prepareLbmInput(spec, fanGeometry)
  const stage = (dir: string) => {
    const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
    job.lbm = prepared.lbm; job.inputs = [{ name: 'flags.bin', bytes: prepared.flags.length }]
    writeFileSync(path, JSON.stringify(job)); writeFileSync(resolve(dir, 'flags.bin'), prepared.flags)
  }
  const native = run(spec, stage), wasm = await runLbmWasm(spec, prepared)
  assert.equal(native.result.status, 'succeeded', native.result.error)
  assert.deepEqual(native.flow, Buffer.from(encodeFlowSnapshot(wasm.snapshot!)))
  assert.deepEqual(native.result.result.history, wasm.result.history)
    assert.deepEqual(native.result.result.lbmMassBalance, wasm.result.lbmMassBalance)
  assert.equal(wasm.snapshot!.displayStride, 3)
  assert.deepEqual(native.result.result.thermal, wasm.result.thermal)
  assert.ok(wasm.snapshot!.display.some((value, i) => i % 3 === 2 && !wasm.snapshot!.flags[Math.floor(i / 3)] && value > 0))
  for (const key of ['ambientC', 'temperatureScaleC', 'thermalDiffusivityPhysical']) {
    assert.equal(native.result.result.derived[key], wasm.result.derived![key])
  }
  assert.equal(wasm.result.derived!.ambientC, 25)
  assert.equal(wasm.result.derived!.temperatureScaleC, 35)
  const early = { ...spec, run: { ...spec.run, stopWhen: { maxCdVariance: 1e100, window: 2 } } }
  assert.match(run(early, stage).result.error, /positive inlet|thermal jobs cannot stop/)
  await assert.rejects(runLbmWasm(early, prepared), /positive inlet|Thermal jobs cannot stop/)
  for (const heatSourceTemp of [25, 0]) {
    assert.throws(() => prepareLbmInput({ ...spec, parameters: { ...spec.parameters, heatSourceTemp } }, fanGeometry))
  }
  const mismatch = run(spec, dir => {
    stage(dir); const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
    delete job.lbm.thermal; writeFileSync(path, JSON.stringify(job))
  })
  assert.match(mismatch.result.error, /must agree/)
})

test('solid power produces identical native/WASM temperature and a conserved energy account', async () => {
  const spec = solidPowerSpec(), prepared = prepareLbmInput(spec, lbmGeometry)
  const stage = (dir: string) => {
    const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
    job.lbm = prepared.lbm; job.inputs = [{ name: 'flags.bin', bytes: prepared.flags.length }]
    writeFileSync(path, JSON.stringify(job)); writeFileSync(resolve(dir, 'flags.bin'), prepared.flags)
  }
  const native = run(spec, stage), wasm = await runLbmWasm(spec, prepared)
  assert.equal(native.result.status, 'succeeded', native.result.error)
  assert.deepEqual(native.flow, Buffer.from(encodeFlowSnapshot(wasm.snapshot!)))
  assert.deepEqual(native.result.result.thermal, wasm.result.thermal)
  const heat = wasm.result.thermal!
  assert.equal(heat.mode, 'solid-power')
  assert.equal(wasm.result.derived!.temperatureScaleC, 1)
  assert.ok(Math.abs(heat.sourceEnergyJ - 10 * 0.0001 * 3) < 1e-12)
  assert.ok(heat.solidMaxC > 25 && heat.solidMaxC < 26)
  assert.ok(Math.abs(heat.thermalEnergyJ - heat.sourceEnergyJ - heat.boundaryEnergyJ - heat.energyResidualJ) < 1e-10)
  assert.ok(heat.maxAbsEnergyResidualJ < 1e-10)
  const mismatch = run(spec, dir => {
    stage(dir); const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
    job.lbm.thermal.mode = 'fixed-temperature'; writeFileSync(path, JSON.stringify(job))
  })
  assert.equal(mismatch.result.status, 'failed')
  const differentPower = { ...spec, parameters: { ...spec.parameters, totalPowerW: 12 } }
  assert.equal(run(differentPower, stage).result.status, 'failed')
  await assert.rejects(runLbmWasm(differentPower, prepared), /must agree/)
})


test('native FDTD matches WASM for every prepared preset and rejects malformed input', async () => {
  for (const preset of ['free', 'interface', 'doubleslit', 'lens', 'cavity'] as const) {
    const input = { module: 'fdtd' as const, scene: { preset, boundary: preset === 'cavity' ? 'pec' as const : 'mur' as const,
      shape: preset === 'lens' ? 'line' as const : 'point' as const, time: preset === 'interface' ? 'cw' as const : 'pulse' as const,
      omega: 0.3, steps: 3, sources: [{ i: preset === 'interface' ? 109 : preset === 'doubleslit' ? 89 : 1, j: 2 }] } }
    const spec = createModuleJobSpec(input), native = run(spec)
    assert.equal(native.result.status, 'succeeded', native.result.error)
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
    const result = native.result.result.moduleResult
    assert.ok(result.Ez.some((value: number) => Math.abs(value) > 0))
    assert.equal(result.dt, prepareFdtdInput(input.scene).dt)
    if (preset === 'free') {
      for (const invalid of ['missing', 'length', 'coefficient', 'source', 'steps'] as const) {
        const rejected = run(spec, dir => {
          const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
          if (invalid === 'missing') delete job.fdtd
          else if (invalid === 'length') job.fdtd.eps.pop()
          else if (invalid === 'coefficient') job.fdtd.eps[0] = 0
          else if (invalid === 'source') job.spec.model.inline.scene.sources[0].i = -1
          else job.fdtd.amplitudes.pop()
          writeFileSync(path, JSON.stringify(job))
        })
        assert.equal(rejected.code, 1)
        assert.equal(rejected.result.status, 'failed')
        assert.equal(rejected.result.result, undefined)
      }
    }
  }
})


test('native MD and WASM match particles, baths, RDF and diffusion including partial final batches', async () => {
  const scene = { N: 64, temperature: 0.4, thermostat: true, barostat: false, targetP: 0.5, tauP: 0.5, steps: 9, seed: 3 }
  for (const options of [{ thermostat: false }, {}, { steps: 6 }, { steps: 7 }, { barostat: true, steps: 7 }]) {
    const input = { module: 'md' as const, scene: { ...scene, ...options } }
    const native = run(createModuleJobSpec(input))
    assert.equal(native.result.status, 'succeeded', native.result.error)
    assert.equal(native.code, 0)
    assert.equal(native.result.result.derived.engine, 'rust-native')
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
    const result = native.result.result.moduleResult.result
    assert.equal(result.history.at(-1).step, input.scene.steps)
    assert.equal(result.history.length, Math.ceil(input.scene.steps / 4) + 1)
    assert.equal(result.diffusion === null, input.scene.barostat || result.history.length < 4)
    if (input.scene.barostat) assert.notEqual(result.observables.boxL, prepareMdInput(input.scene).boxL)
  }
  const spec = createModuleJobSpec({ module: 'md', scene })
  for (const invalid of ['missing', 'length', 'coefficient', 'box', 'overlap', 'unexpected']) {
    const failed = run(spec, dir => {
      const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
      if (invalid === 'missing') delete job.md
      else if (invalid === 'length') job.md.vel.pop()
      else if (invalid === 'coefficient') job.md.dt = 0.01
      else if (invalid === 'box') job.md.boxL = 1
      else if (invalid === 'overlap') job.md.pos.splice(2, 2, ...job.md.pos.slice(0, 2))
      else job.fdtd = prepareFdtdInput({ preset: 'free', boundary: 'mur', shape: 'point', time: 'cw', omega: 0.3, steps: 9, sources: [{ i: 100, j: 100 }] })
      writeFileSync(path, JSON.stringify(job))
    })
    assert.equal(failed.code, 1, invalid)
    assert.equal(failed.result.status, 'failed', invalid)
    assert.equal(failed.result.result, undefined, invalid)
  }
})


test('native and WASM particle mixtures preserve imported state, species, charges and RDF', async () => {
  const base = particleScene()
  const seeded = { ...base, species: base.species.map(sp => ({ ...sp, count: 8 })), boxL: 8, positions: undefined, velocities: undefined, kind: undefined, steps: 6 }
  const imported = parseLammpsData(readFileSync('public/datasets/lammps-lj-2d.data', 'utf8'))
  // A valid coordinate immediately below boxL can round onto the edge in FP32.
  const edge = { ...base, positions: [base.boxL - 1e-7, ...base.positions!.slice(1)] }
  for (const scene of [base, { ...base, thermostat: false, steps: 5 }, { ...base, kCoulomb: 0 }, seeded, imported, edge]) {
    const input = { module: 'particles' as const, scene }, native = run(createModuleJobSpec(input))
    assert.equal(native.result.status, 'succeeded', native.result.error)
    assert.equal(native.code, 0)
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
    const result = native.result.result.moduleResult.result
    assert.deepEqual(result.kind, prepareParticleInput(scene).particles.kind)
    assert.deepEqual(result.charge, prepareParticleInput(scene).particles.charge)
    assert.equal(result.rdf.r.length, 50)
    assert.equal(result.history, undefined)
    if (scene === imported) assert.notDeepEqual(result.pos, scene.positions)
  }
  const spec = createModuleJobSpec({ module: 'particles', scene: base })
  for (const invalid of ['missing', 'length', 'kind', 'charge', 'sigma', 'eps', 'screening', 'position', 'velocity']) {
    const failed = run(spec, dir => {
      const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
      if (invalid === 'missing') delete job.md.particles
      else if (invalid === 'length') job.md.particles.charge.pop()
      else if (invalid === 'kind') job.md.particles.kind[0] = 3
      else if (invalid === 'screening') job.md.particles.epsR = 80
      else if (invalid === 'position') job.md.pos[0] += 0.1
      else if (invalid === 'velocity') job.md.vel[0] += 0.1
      else job.md.particles[invalid][0] += 0.1
      writeFileSync(path, JSON.stringify(job))
    })
    assert.equal(failed.code, 1, invalid)
    assert.equal(failed.result.status, 'failed', invalid)
    assert.equal(failed.result.result, undefined, invalid)
  }
})

test('native and WASM share local heat sources and multiple solid materials through the existing mask transport', async () => {
  const base = thermalRegionsSpec()
  for (const angleOfAttack of [0, 11]) {
    const spec = { ...base, parameters: { ...base.parameters, angleOfAttack } }
    const prepared = prepareLbmInput(spec, lbmGeometry)
    assert.ok(prepared.flags.includes(5) && prepared.flags.includes(6))
    const stage = (dir: string) => {
      const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
      job.lbm = prepared.lbm; job.inputs = [{ name: 'flags.bin', bytes: prepared.flags.length }]
      writeFileSync(path, JSON.stringify(job)); writeFileSync(resolve(dir, 'flags.bin'), prepared.flags)
    }
    const native = run(spec, stage), wasm = await runLbmWasm(spec, prepared)
    assert.equal(native.result.status, 'succeeded', native.result.error)
    assert.deepEqual(native.flow, Buffer.from(encodeFlowSnapshot(wasm.snapshot!)))
    assert.deepEqual(native.result.result.thermal, wasm.result.thermal)
    assert.ok(Math.abs(wasm.result.thermal!.sourceEnergyJ - 7 * 0.0001 * 3) < 1e-15)
    const temperature = (flag: number) => Math.max(...wasm.snapshot!.display.filter((_, i) => i % 3 === 2 && wasm.snapshot!.flags[Math.floor(i / 3)] === flag))
    assert.ok(temperature(5) > temperature(6))
    assert.ok(temperature(6) > 0, 'unpowered region receives conducted heat')
    for (const invalid of ['missing', 'material', 'power', 'mask']) {
      const failed = run(spec, dir => {
        stage(dir)
        const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
        if (invalid === 'missing') delete job.lbm.thermal.materials
        else if (invalid === 'material') job.lbm.thermal.materials[0].density += 1
        else if (invalid === 'power') job.lbm.thermal.materials[0].totalPowerW += 1
        else { const mask = prepared.flags.slice(); mask[0] = 7; writeFileSync(resolve(dir, 'flags.bin'), mask) }
        writeFileSync(path, JSON.stringify(job))
      })
      assert.equal(failed.result.status, 'failed', invalid)
      assert.equal(failed.result.result, undefined, invalid)
    }
  }
})


test('native/WASM contact resistance reduces inter-material heat transfer and rejects altered prepared contacts', async () => {
  const spec = thermalContactsSpec(), prepared = prepareLbmInput(spec, lbmGeometry)
  const stage = (dir: string) => {
    const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
    job.lbm = prepared.lbm; job.inputs = [{ name: 'flags.bin', bytes: prepared.flags.length }]
    writeFileSync(path, JSON.stringify(job)); writeFileSync(resolve(dir, 'flags.bin'), prepared.flags)
  }
  const native = run(spec, stage), wasm = await runLbmWasm(spec, prepared)
  assert.equal(native.result.status, 'succeeded', native.result.error)
  assert.deepEqual(native.flow, Buffer.from(encodeFlowSnapshot(wasm.snapshot!)))
  assert.deepEqual(native.result.result.thermal, wasm.result.thermal)
  const idealSpec = thermalRegionsSpec(), ideal = await runLbmWasm(idealSpec, prepareLbmInput(idealSpec, lbmGeometry))
  const passiveTemperature = (snapshot: NonNullable<typeof wasm.snapshot>) =>
    Math.max(...snapshot.display.filter((_, i) => i % 3 === 2 && snapshot.flags[Math.floor(i / 3)] === 6))
  assert.ok(passiveTemperature(wasm.snapshot!) > 0)
  assert.ok(passiveTemperature(wasm.snapshot!) < passiveTemperature(ideal.snapshot!))
  assert.equal(wasm.result.thermal!.sourceEnergyJ, ideal.result.thermal!.sourceEnergyJ)
  assert.ok(Math.abs(wasm.result.thermal!.energyResidualJ) < 1e-12)
  for (const invalid of ['missing', 'resistance', 'pair']) {
    const altered = structuredClone(prepared)
    if (invalid === 'missing') delete altered.lbm.thermal!.contacts
    else if (invalid === 'resistance') altered.lbm.thermal!.contacts![0].resistanceM2KW *= 2
    else altered.lbm.thermal!.contacts![0].first = 0
    await assert.rejects(runLbmWasm(spec, altered), /contacts.*agree/)
    const failed = run(spec, dir => {
      stage(dir)
      const path = resolve(dir, 'job.json'), job = JSON.parse(readFileSync(path, 'utf8'))
      job.lbm = altered.lbm; writeFileSync(path, JSON.stringify(job))
    })
    assert.equal(failed.code, 1, invalid)
    assert.equal(failed.result.status, 'failed', invalid)
    assert.match(failed.result.error, /contacts.*agree/, invalid)
  }
})


test('native fluid/convection share all fields and readouts with WASM, including inlet, obstacle, diffusion and per-step decay', async () => {
  const fluid = fluidScene()
  const cases: ModuleComputeInput[] = [
    { module: 'fluid', scene: fluid },
    { module: 'fluid', scene: { ...fluid, viscosity: 0, diffusion: 0, rotation: 0, decay: 1, inlet: undefined, obstacle: undefined } },
    { module: 'fluid', scene: { ...fluid, seeds: [], rotation: 0, inlet: undefined, obstacle: undefined } },
    { module: 'convection', scene: convectionScene() },
    { module: 'convection', scene: { ...convectionScene(), buoyancy: 0, initialDrop: false } },
    { module: 'convection', scene: { ...convectionScene(), initialDrop: false, seeds: [] } },
  ]
  for (const input of cases) {
    const spec = createModuleJobSpec(input), native = run(spec)
    assert.equal(native.code, 0, native.result.error)
    assert.equal(native.result.status, 'succeeded', native.result.error)
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
  }
  const base = createModuleJobSpec(cases[0])
  for (const change of [{ viscosity: -1 }, { seeds: [{ x: 2, y: 2, radius: 1, density: 1, vx: 8, vy: 0 }] },
    { inlet: { speed: 1, density: 2, spacing: 2, width: 3 } }, { obstacle: [1] },
    { obstacle: Array.from({ length: 10000 }, (_, i) => i === 0 ? 1 : 0) }]) {
    const spec = structuredClone(base)
    Object.assign((spec.model!.inline as any).scene, change)
    const failed = run(spec)
    assert.equal(failed.code, 1)
    assert.equal(failed.result.status, 'failed')
    assert.equal(failed.result.result, undefined)
  }
})


test('native optics preserves all preset rays, events, note rounding and screen profiles through JSON', async () => {
  const cases = [[], opticsScene(), ...OPTICS_PRESETS.map(p => opticsPreset(p.id))]
  const rounded = opticsPreset('malus')
  rounded.find(c => c.kind === 'polarizer')!.polAngleDeg = -1.5
  cases.push(rounded)
  for (const components of cases) {
    const input = { module: 'optics-lab' as const, components }
    const spec = createModuleJobSpec(input), native = run(spec)
    assert.equal(native.code, 0, native.result.error)
    assert.equal(native.result.result.derived.precision, 'float64')
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
  }
  const base = createModuleJobSpec({ module: 'optics-lab', components: opticsScene() })
  for (const change of [{ id: '__proto__' }, { id: 'split' }, { x: -1 }, { n: 0 }, { kind: 'unsupported' }, { power: -1 }, { splitT: 2 }, { label: 1 }]) {
    const spec = structuredClone(base)
    Object.assign((spec.model!.inline as any).components[0], change)
    const failed = run(spec)
    assert.equal(failed.code, 1)
    assert.equal(failed.result.status, 'failed')
  }
  const invalidSteps = run({ ...base, run: { maxSteps: 2 } })
  assert.equal(invalidSteps.code, 1)
})

// One snapshot each: protocol and cross-target correctness, not a convergence benchmark.
test('native/WASM spatial arrays preserve coupled sensing, coding, noise, null reconstruction and ridge', async () => {
  for (const input of [...signalArrayInputs, ...signalArrayRcInputs]) {
    const native = run(createModuleJobSpec(input))
    assert.equal(native.code, 0, JSON.stringify(native.result))
    assert.equal(native.result.status, 'succeeded')
    assert.equal(native.result.result.derived.precision, 'float64')
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
  }
  for (const change of [...invalidSignalArrays.map(change => (s: any) => Object.assign(s.model.inline.scene, change)),
    (s: any) => { s.run.maxSteps = 2 }, (s: any) => { s.requirements.precision = 'mixed' },
    (s: any) => { Object.assign(s.model.inline.scene, { sensing: [[1, 2], [2, 4]], regularization: 1e-30 }) },
  ]) {
    const spec = structuredClone(createModuleJobSpec(signalArrayInputs[0])); change(spec)
    const native = run(spec)
    assert.notEqual(native.code, 0)
    assert.equal(native.result.status, 'failed')
    assert.equal(native.result.result, undefined)
  }
})

test('native/WASM RC and RL share full curves and reject malformed or incompatible jobs', async () => {
  for (const input of transientInputs) {
    const native = run(createModuleJobSpec(input))
    assert.equal(native.code, 0, JSON.stringify(native.result))
    assert.equal(native.result.result.derived.precision, 'float64')
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
  }
  for (const change of [
    (s: any) => { s.model.inline.scene.mode = ['rc-charge'] },
    (s: any) => { s.model.inline.scene.r = 0 }, (s: any) => { s.model.inline.scene.c = null },
    (s: any) => { s.run.maxSteps = 2 }, (s: any) => { s.requirements.precision = 'mixed' },
  ]) {
    const spec = structuredClone(createModuleJobSpec(transientInputs[0])); change(spec)
    const native = run(spec); assert.notEqual(native.code, 0); assert.equal(native.result.status, 'failed')
  }
  for (const readout of [null, {}, { resistanceOhm: 0, capacitanceF: 1e-7, dwellS: 1e-4, initialV: 0 },
    { resistanceOhm: 1000, capacitanceF: 1e-7, dwellS: 0, initialV: 0 },
  ]) {
    const spec = structuredClone(createModuleJobSpec(signalArrayInputs[0])); (spec.model as any).inline.scene.readout = readout
    const native = run(spec); assert.notEqual(native.code, 0); assert.equal(native.result.status, 'failed')
  }
})

test('native/WASM Faraday shares complete induction curves and rejects invalid jobs', async () => {
  for (const input of faradayInputs) {
    const native = run(createModuleJobSpec(input))
    assert.equal(native.code, 0, JSON.stringify(native.result))
    assert.equal(native.result.result.derived.precision, 'float64')
    assert.deepEqual(readModuleResult(native.result.result, input), await computeModule(input))
  }
  for (const change of [
    (s: any) => { s.model.inline.scene.N = 10.5 }, (s: any) => { s.model.inline.scene.omega = 0 },
    (s: any) => { s.model.inline.scene.B = null }, (s: any) => { s.model.inline.scene.vBar = '2' },
    (s: any) => { s.run.maxSteps = 2 }, (s: any) => { s.requirements.precision = 'mixed' },
  ]) {
    const spec = structuredClone(createModuleJobSpec(faradayInputs[0])); change(spec)
    const native = run(spec)
    assert.notEqual(native.code, 0); assert.equal(native.result.status, 'failed')
  }
})
