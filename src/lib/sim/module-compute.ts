import { signalArrayResult, signalArrayMeasurements, type SignalArrayScene, type SignalArrayResult } from './signal-array'
import { validateRecording, RECORDING_MAX_SAMPLES } from '../signal-recording'
import type { JobKindParametersValidator, JobProgress, JobResultV1, JobSpecV1, RegisteredJobKindValidator } from '@w-sim/contracts'
import { OPTICS_PALETTE, SCENE_H, SCENE_W, SCREEN_BINS, createOpticsTrace, readOpticsTrace, type OpticsComponent, type TraceResult } from '../lab/optics-lab'
import { acousticPlaneWaveObservables, emPlaneWaveObservables, createAcousticPlaneWave, readAcousticPlaneWave, createEmPlaneWave, readEmPlaneWave, emWave3DResult, EM_WAVE3D_SAMPLES, type EmWave3DParams, type AcousticPlaneWaveParams, type EmPlaneWaveParams } from './spectrum-runnable-algos'
import { createField, fdtdStep, injectSoftSource, injectFdtdSceneSources, FDTD_PRESETS, FDTD_NX, FDTD_NY, COURANT_DEFAULT, type FdtdScene } from './fdtd'
import { antennaLinkResult, type AntennaLinkParams } from './antennalink'
import { antenna3DResult, ANTENNA_POLAR_SEGMENTS, type Antenna3DParams } from './antenna'
import { WasmLaser, WasmRadar } from './wasm-fields'
import { DEFAULT as LASER_DEFAULT } from './laser'
import { laserCharacteristics, LASER_MAX_PUMP, LASER_DT, type LaserState } from './laser'
import { phasedArrayResult, type PhasedArrayParams } from './phasedarray'
import { nljdResult, type JunctionKind } from './nljd'
import { radarResult, RADAR_N, RADAR_BUFFER, RADAR_SAMPLE_STRIDE, type RadarScene } from './radar-algos'

import { localizationResult, LOCALIZATION_W, LOCALIZATION_H, type LocalizationScene } from './trilateration'
import { tdoaResult, TDOA_W, TDOA_H, type TdoaScene } from './tdoa'
import { stmScanResult, STM_SAMPLES, type StmScene } from './stm'
import { afmScanResult, AFM_SAMPLES, type AfmScene } from './afm'

import { rlcResult, createRlcScene, readRlcScene, type RlcScene } from './rlc'
import { mutualResult, createMutualScene, stepMutualScene, readMutualScene, type MutualScene } from './mutual'
import { transientResult, type TransientScene } from './transient'
import { faradayResult, type FaradayScene } from './faraday'
import { smithResult, type SmithScene } from './smith-chart'
import { hasNativeAlgorithmSelector, isNativeAlgorithmInput, isNativeAlgorithmModule, type NativeAlgorithmInput } from './native-algorithm'
export { isNativeAlgorithmInput, type NativeAlgorithmInput } from './native-algorithm'

import { ecgResult, type EcgScene } from './ecg'
import { eegResult, measureBandPower, stateWeights, type EegScene } from './eeg'
import { emgResult, type EmgScene } from './emg'
import { neuronResult, createNeuronScene, readNeuronScene, type NeuronScene } from './neuron'
import { ultrasoundResult, type UltrasoundScene } from './ultrasound'
import { bioPipelineResult, mean as bioMean, type BioPipelineScene } from './biodsp'
import { HEAT_W, HEAT_H, HeatField, heatFieldResult, type HeatScene } from './heat'
import { HEAT_1D_M, HEAT_1D_L, HEAT_1D_X0, initHeat1D, ftcsStep, heat1DResult, type Heat1DScene } from './heaterfc'
import { MD_DT, MD_BATCH_STEPS, MD_RDF_BINS, MD_PARTICLE_COUNTS, mdMaxSteps, mdBoxLength, mdResult, type MdScene, type MdHistory } from './md'
import { createMdScene, advanceMdScene } from '../webgpu/mdSim'
import { createIsingScene, stepIsingScene, isingSceneSteps, isingResult, initIsing, onsagerReferences, type IsingScene } from './ising'
import { vibrationResult, createVibrationScene, readVibrationScene, VIBRATION_DT, VIBRATION_RESONANCE_SAMPLES, type VibrationScene } from './spectrum-runnable-algos'
import { RIPPLE_N, createRippleScene, rippleResult, type RippleScene } from './wave'
import { FLUID_N, FLUID_DT, createFluidScene, stepFluidScene, fluidResult, type FluidScene, CONVECTION_N, CONVECTION_DT, createConvectionScene, stepConvectionScene, convectionResult, type ConvectionScene } from './fluid'
import { displayResult, type DisplayScene } from './display'
import { PARTICLE_RDF_BINS, particleCount, particleProperties, particleResult, type ParticleScene } from './particles'
import { createParticleScene, advanceParticleScene } from '../webgpu/particleSim'

/** Product-owned extension of the existing W-Sim job protocol. */
export const MODULE_JOB_KIND = 'waveworld-module'

/** Registers this product kind with W-Sim's strict contract validator. */
export function validateModuleJobParameters(parameters: unknown, spec?: JobSpecV1): { ok: true } | { ok: false; message: string } {
  if (!spec) return { ok: false, message: 'waveworld-module validation requires its complete JobSpec' }
  try {
    readModuleJobInput({ ...spec, parameters } as JobSpecV1)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function registeredModuleJobKindValidator(spec: JobSpecV1): RegisteredJobKindValidator {
  const validateParameters: JobKindParametersValidator = (parameters) => validateModuleJobParameters(parameters, spec)
  return { kind: MODULE_JOB_KIND, validateParameters }
}

export type ModuleComputeInput =
  | { module: 'signal-array'; scene: SignalArrayScene }
  | { module: 'optics-lab'; components: OpticsComponent[] }
  | { module: 'electromagnetic'; params: EmPlaneWaveParams; timeSeconds: number; xs: number[] }
  | { module: 'sound'; params: AcousticPlaneWaveParams; timeSeconds: number; xs: number[] }
  | { module: 'fdtd'; scene: FdtdScene }
  | { module: 'emwave3d'; params: EmWave3DParams }
  | { module: 'antennapattern'; params: AntennaLinkParams }
  | { module: 'antenna3d'; params: Antenna3DParams }
  | { module: 'laser'; pump: number; steps: number }
  | { module: 'phasedarray'; params: PhasedArrayParams }
  | { module: 'nljd'; kind: JunctionKind }
  | { module: 'radar'; scene: RadarScene }
  | { module: 'localization'; scene: LocalizationScene }
  | { module: 'tdoa'; scene: TdoaScene }
  | { module: 'stm'; scene: StmScene }
  | { module: 'afm'; scene: AfmScene }

  | { module: 'rlc'; scene: RlcScene }
  | { module: 'mutual'; scene: MutualScene }
  | { module: 'transient'; scene: TransientScene }
  | { module: 'faraday'; scene: FaradayScene }
  | { module: 'smith'; scene: SmithScene }

  | { module: 'ecg'; scene: EcgScene }
  | { module: 'eeg'; scene: EegScene }
  | { module: 'emg'; scene: EmgScene }
  | { module: 'neuron'; scene: NeuronScene }
  | { module: 'ultrasound'; scene: UltrasoundScene }
  | { module: 'biopipeline'; scene: BioPipelineScene }
  | { module: 'sim'; scene: HeatScene }
  | { module: 'heaterfc'; scene: Heat1DScene }
  | { module: 'md'; scene: MdScene }
  | { module: 'ising'; scene: IsingScene }
  | { module: 'vibration'; scene: VibrationScene }
  | { module: 'ripple'; scene: RippleScene }
  | { module: 'convection'; scene: ConvectionScene }
  | { module: 'display'; scene: DisplayScene }
  | { module: 'particles'; scene: ParticleScene }
  | { module: 'fluid'; scene: FluidScene }
  | NativeAlgorithmInput
  | SwModuleInput

/**
 * sw-* compute blocks have no host implementation — they execute inside the
 * w-sim-cuda binary's `module` subcommand (CUDA_KIND_ROUTES in the agent).
 * The inline shape is the binary's own module input: `module`/`backend` plus
 * optional `method` and module-specific fields (flat or under `params`),
 * admission-checked natively. `backend` is mandatory so a job-level cuda
 * request can never silently degrade to host math.
 */
export type SwModuleInput = {
  module: `sw-${string}`
  backend: 'host' | 'auto' | 'cuda'
  method?: string
  params?: Record<string, unknown>
  [key: string]: unknown
}

type WireTrace = Omit<TraceResult, 'profiles'> & {
  profiles: Array<Omit<TraceResult['profiles'][number], 'bins'> & { bins: number[] }>
}
export type ModuleComputeOutput =
  | { module: 'signal-array'; result: SignalArrayResult }
  | { module: 'optics-lab'; trace: WireTrace }
  | { module: 'electromagnetic'; observables: ReturnType<typeof emPlaneWaveObservables>; E: number[]; B: number[] }
  | { module: 'sound'; observables: ReturnType<typeof acousticPlaneWaveObservables>; pressure: number[]; velocity: number[] }
  | { module: 'fdtd'; nx: number; ny: number; steps: number; dt: number; Ez: number[] }
  | { module: 'emwave3d'; fields: ReturnType<typeof emWave3DResult> }
  | { module: 'antennapattern'; result: ReturnType<typeof antennaLinkResult> }
  | { module: 'antenna3d'; result: ReturnType<typeof antenna3DResult> }
  | { module: 'laser'; state: LaserState; characteristics: ReturnType<typeof laserCharacteristics>; steps: number; dt: number }
  | { module: 'phasedarray'; result: ReturnType<typeof phasedArrayResult> }
  | { module: 'nljd'; result: ReturnType<typeof nljdResult> }
  | { module: 'radar'; nx: number; steps: number; sampleStride: number; field: number[]; traces: number[][]; readout: ReturnType<typeof radarResult>['readout'] }
  | { module: 'localization'; result: ReturnType<typeof localizationResult> }
  | { module: 'tdoa'; result: ReturnType<typeof tdoaResult> }
  | { module: 'stm'; result: ReturnType<typeof stmScanResult> }
  | { module: 'afm'; result: ReturnType<typeof afmScanResult> }
  | { module: 'rlc'; result: ReturnType<typeof rlcResult> }
  | { module: 'mutual'; result: ReturnType<typeof mutualResult> }
  | { module: 'transient'; result: ReturnType<typeof transientResult> }
  | { module: 'faraday'; result: ReturnType<typeof faradayResult> }
  | { module: 'smith'; result: ReturnType<typeof smithResult> }
  | { module: 'ecg'; result: ReturnType<typeof ecgResult> }
  | { module: 'eeg'; result: ReturnType<typeof eegResult> }
  | { module: 'emg'; result: ReturnType<typeof emgResult> }
  | { module: 'neuron'; result: ReturnType<typeof neuronResult> }
  | { module: 'ultrasound'; result: ReturnType<typeof ultrasoundResult> }
  | { module: 'biopipeline'; result: ReturnType<typeof bioPipelineResult> }
  | { module: 'sim'; result: ReturnType<typeof heatFieldResult> }
  | { module: 'heaterfc'; result: ReturnType<typeof heat1DResult> }
  | { module: 'md'; result: ReturnType<typeof mdResult> }
  | { module: 'ising'; result: ReturnType<typeof isingResult> }
  | { module: 'vibration'; result: ReturnType<typeof vibrationResult> }
  | { module: 'ripple'; result: ReturnType<typeof rippleResult> }
  | { module: 'convection'; result: ReturnType<typeof convectionResult> }
  | { module: 'display'; result: ReturnType<typeof displayResult> }
  | { module: 'particles'; result: ReturnType<typeof particleResult> }
  | { module: 'fluid'; result: ReturnType<typeof fluidResult> }
  | { module: `sw-${string}`; [key: string]: unknown }
export type ModuleJobResult = JobResultV1 & { moduleResult: ModuleComputeOutput }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('module value must be an object')
  return value as Record<string, unknown>
}
function finite(value: unknown, name: string, min = -1e20, max = 1e20): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be finite in [${min}, ${max}]`)
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`module array must contain at most ${max} entries`)
  return value
}
function numbers(value: unknown, max: number): number[] {
  const values = array(value, max)
  values.forEach(v => finite(v, 'sample'))
  return values as number[]
}

/** Bound work before either browser or agent enters the same pure algorithms. */
export function validateModuleInput(value: unknown): asserts value is ModuleComputeInput {
  const input = record(value)
  if (isNativeAlgorithmModule(input.module)) {
    if (input.module === 'mna' && input.operation !== undefined && input.method !== undefined) {
      throw new Error('conflicting native algorithm selectors for mna')
    }
    if (hasNativeAlgorithmSelector(input)) {
      if (!isNativeAlgorithmInput(input)) throw new Error('native algorithm operations require backend host')
      return
    }
    // The original laser pump/steps interface remains a teaching operation.
    // An arbitrary operation field must not turn it into a native admission.
    const preservesTeachingInput = input.operation === undefined && (
      input.module === 'laser' ||
      (input.module === 'fdtd' && input.scene !== undefined) ||
      (input.module === 'faraday' && input.scene !== undefined)
    )
    if (!preservesTeachingInput) throw new Error('unsupported native algorithm operation selector')
  }
  // sw-* compute blocks: admission is owned by the w-sim-cuda binary; intake
  // only pins the routing shape. `backend` is mandatory — the binary defaults
  // a missing backend to host, which would silently satisfy a cuda request.
  if (typeof input.module === 'string' && input.module.startsWith('sw-')) {
    if (!/^sw-[a-z0-9][a-z0-9-]*$/.test(input.module)) throw new Error('sw-* module names must be lowercase kebab-case')
    if (input.backend !== 'host' && input.backend !== 'auto' && input.backend !== 'cuda') throw new Error('sw-* module backend must be host, auto or cuda')
    if (input.method !== undefined && (typeof input.method !== 'string' || !input.method)) throw new Error('sw-* module method must be a non-empty string')
    if (input.params !== undefined) record(input.params)
    return
  }
  if (input.module === 'fluid') {
    const scene = record(input.scene)
    finite(scene.viscosity, 'fluid viscosity', 0, 0.0001); finite(scene.diffusion, 'dye diffusion', 0, 0.0001)
    finite(scene.rotation, 'initial fluid rotation', -0.04, 0.04); finite(scene.decay, 'dye decay', 0.9, 1)
    finite(scene.steps, 'fluid steps', 1, 2000)
    if (!Number.isInteger(scene.steps)) throw new Error('fluid steps must be an integer')
    if (scene.inlet !== undefined) {
      const inlet = record(scene.inlet)
      finite(inlet.speed, 'inlet speed', 0, 3); finite(inlet.density, 'inlet dye', 0, 100)
      finite(inlet.spacing, 'inlet stripe spacing', 1, FLUID_N - 2)
      finite(inlet.width, 'inlet stripe width', 1, inlet.spacing)
      if (![inlet.spacing, inlet.width].every(Number.isInteger)) throw new Error('inlet stripe dimensions must be integers')
    }
    if (scene.obstacle !== undefined) {
      const mask = array(scene.obstacle, FLUID_N * FLUID_N)
      if (mask.length !== FLUID_N * FLUID_N) throw new Error('obstacle must match the fluid grid')
      mask.forEach((cell, i) => {
        if (cell !== 0 && cell !== 1) throw new Error('obstacle cells must be 0 or 1')
        const x = i % FLUID_N, y = Math.floor(i / FLUID_N)
        if (cell && (x < 2 || y < 2 || x >= FLUID_N - 2 || y >= FLUID_N - 2)) throw new Error('obstacles must leave two boundary cell layers clear')
      })
    }
    for (const value of array(scene.seeds, 64)) {
      const seed = record(value)
      finite(seed.x, 'fluid seed x', 1, FLUID_N - 2); finite(seed.y, 'fluid seed y', 1, FLUID_N - 2)
      finite(seed.radius, 'fluid seed radius', 1, 12)
      if (![seed.x, seed.y, seed.radius].every(Number.isInteger)) throw new Error('fluid seed coordinates and radius must be integers')
      finite(seed.density, 'dye density', 0, 100); finite(seed.vx, 'initial vx', -4, 4); finite(seed.vy, 'initial vy', -4, 4)
    }
    return
  }
  if (input.module === 'particles') {
    const scene = record(input.scene), species = array(scene.species, 16)
    if (!species.length) throw new Error('particle species are required')
    const names = new Set<string>()
    let N = 0
    for (const value of species) {
      const sp = record(value)
      if (typeof sp.name !== 'string' || !sp.name.trim() || sp.name.length > 80 || names.has(sp.name)) throw new Error('particle species require unique names of 1–80 characters')
      names.add(sp.name)
      finite(sp.count, 'particle count', 1, 400)
      if (!Number.isInteger(sp.count)) throw new Error('particle counts must be integers')
      N += sp.count
      finite(sp.charge, 'particle charge', -8, 8); finite(sp.sigma, 'particle sigma', 0.1, 2); finite(sp.epsilon, 'particle epsilon', 0, 4)
    }
    finite(N, 'total particles', 2, 400)
    finite(scene.boxL, 'particle box length', 5.01, 100)
    finite(scene.epsR, 'relative permittivity', 1, 200); finite(scene.lambdaD, 'screening length', 0.1, 100); finite(scene.kCoulomb, 'Coulomb coefficient', 0, 10)
    finite(scene.steps, 'particle steps', 1, mdMaxSteps(N)); finite(scene.seed, 'particle seed', 0, 4294967295)
    if (!Number.isInteger(scene.steps) || !Number.isInteger(scene.seed)) throw new Error('particle steps and seed must be integers')
    finite(scene.temperature, 'particle temperature', 0.1, 2)
    if (typeof scene.thermostat !== 'boolean') throw new Error('particle thermostat must be boolean')
    if (scene.kind !== undefined) {
      const kind = numbers(scene.kind, N), counts = Array<number>(species.length).fill(0)
      if (kind.length !== N) throw new Error('particle kind must have one species index per particle')
      for (const index of kind) {
        if (!Number.isInteger(index) || index < 0 || index >= species.length) throw new Error('invalid particle species index')
        counts[index]++
      }
      if (counts.some((count, i) => count !== record(species[i]).count)) throw new Error('particle kind counts must match species')
    }
    if (scene.dim !== undefined && scene.dim !== 2 && scene.dim !== 3) throw new Error('particle dim must be 2 or 3')
    const dim = scene.dim === 2 ? 2 : 3
    if (scene.velocities !== undefined) {
      const velocities = numbers(scene.velocities, N * dim)
      if (velocities.length !== N * dim) throw new Error(`particle velocities must contain ${dim === 3 ? 'vx,vy,vz' : 'vx,vy'} for every particle`)
      velocities.forEach(v => finite(v, 'particle velocity', -16, 16))
    }
    if (scene.positions !== undefined) {
      const positions = numbers(scene.positions, N * dim)
      if (positions.length !== N * dim) throw new Error(`particle positions must contain ${dim === 3 ? 'x,y,z' : 'x,y'} for every seeded particle index`)
      positions.forEach(v => { finite(v, 'particle position', 0, scene.boxL as number); if (v >= (scene.boxL as number)) throw new Error('particle position is outside periodic box') })
      const occupied = new Set<string>()
      for (let i = 0; i < N; i++) {
        const key = Array.from({ length: dim }, (_, d) => Math.fround(positions[dim*i + d])).join(',')
        if (occupied.has(key)) throw new Error('particle positions must not overlap')
        occupied.add(key)
      }
    }
    return
  }
  if (input.module === 'display') {
    const scene = record(input.scene)
    if (scene.mode === 'LED') finite(scene.bandgap, 'display bandgap', 1.6, 3.4)
    else if (scene.mode === 'OLED') {
      const channels = numbers(scene.channels, 3)
      if (channels.length !== 3) throw new Error('OLED requires three channels')
      channels.forEach(c => finite(c, 'OLED channel', 0, 1))
    } else if (scene.mode === 'LCD') finite(scene.rotationDeg, 'LCD rotation', 0, 90)
    else throw new Error('unsupported display mode')
    return
  }
  if (input.module === 'ripple' || input.module === 'convection') {
    const scene = record(input.scene), n = input.module === 'ripple' ? RIPPLE_N : CONVECTION_N
    finite(scene.steps, 'steps', 1, 2000)
    if (!Number.isInteger(scene.steps)) throw new Error('field steps must be an integer')
    if (input.module === 'ripple') finite(scene.damping, 'ripple damping', 0.98, 1)
    else {
      finite(scene.buoyancy, 'convection buoyancy', 0, 0.2)
      if (typeof scene.initialDrop !== 'boolean') throw new Error('convection initialDrop must be boolean')
    }
    for (const value of array(scene.seeds, 64)) {
      const seed = record(value)
      finite(seed.x, 'seed x', 1, n - 2); finite(seed.y, 'seed y', 1, n - 2)
      if (!Number.isInteger(seed.x) || !Number.isInteger(seed.y)) throw new Error('seed coordinates must be integers')
      if (input.module === 'ripple') {
        finite(seed.radius, 'ripple radius', 1, 12); finite(seed.amount, 'ripple displacement', -8, 8)
        if (!Number.isInteger(seed.radius)) throw new Error('ripple radius must be an integer')
      } else if (typeof seed.hot !== 'boolean') throw new Error('convection seed hot must be boolean')
    }
    return
  }
  if (input.module === 'ising') {
    const scene = record(input.scene)
    finite(scene.size, 'Ising size', 16, 256)
    finite(scene.seed, 'Ising seed', 0, 4294967295)
    finite(scene.burnIn, 'Ising burn-in', 0, 1000); finite(scene.samples, 'Ising samples', 1, 1000)
    if (![scene.size, scene.seed, scene.burnIn, scene.samples].every(Number.isInteger)) throw new Error('Ising sizes, seed and sweep counts must be integers')
    if (typeof scene.hot !== 'boolean') throw new Error('Ising hot start must be boolean')
    const temperatures = numbers(scene.temperatures, 57)
    if (!temperatures.length || temperatures.length * (scene.burnIn + scene.samples) > 2000) throw new Error('Ising requires 1–57 temperatures and at most 2000 total sweeps')
    temperatures.forEach(T => finite(T, 'Ising temperature', 0.5, 4))
    return
  }
  if (input.module === 'vibration') {
    const scene = record(input.scene)
    finite(scene.mass, 'mass', 0.2, 5); finite(scene.stiffness, 'stiffness', 10, 400)
    finite(scene.damping, 'damping', 0.05, 8); finite(scene.driveFrequency, 'drive frequency', 0.2, 5)
    finite(scene.steps, 'vibration steps', 1, 2000)
    if (!Number.isInteger(scene.steps)) throw new Error('vibration steps must be an integer')
    return
  }
  if (input.module === 'md') {
    const scene = record(input.scene)
    finite(scene.N, 'N', 64, 2048)
    if (!(MD_PARTICLE_COUNTS as readonly number[]).includes(scene.N)) throw new Error('unsupported MD particle count')
    finite(scene.steps, 'steps', 1, mdMaxSteps(scene.N))
    finite(scene.seed, 'seed', 0, 4294967295)
    if (![scene.steps, scene.seed].every(Number.isInteger)) throw new Error('MD steps and seed must be integers')
    finite(scene.temperature, 'temperature', 0.05, 2.5)
    finite(scene.targetP, 'targetP', -1, 8); finite(scene.tauP, 'tauP', 0.1, 3)
    if (typeof scene.thermostat !== 'boolean' || typeof scene.barostat !== 'boolean') throw new Error('MD bath flags must be boolean')
    return
  }
  if (input.module === 'sim' || input.module === 'heaterfc') {
    const scene = record(input.scene)
    finite(scene.steps, 'steps', 1, 2000)
    if (!Number.isInteger(scene.steps)) throw new Error('heat steps must be an integer')
    if (input.module === 'heaterfc') finite(scene.kappa, 'kappa', 0.1, 1.5)
    else {
      finite(scene.r, 'r', 0.05, 0.25)
      for (const value of array(scene.seeds, 32)) {
        const seed = record(value)
        finite(seed.x, 'seed x', 0, HEAT_W - 1); finite(seed.y, 'seed y', 0, HEAT_H - 1)
        finite(seed.radius, 'seed radius', 1, 20); finite(seed.amount, 'seed amount', 0, 1000)
        if (![seed.x, seed.y, seed.radius].every(Number.isInteger)) throw new Error('heat seed coordinates and radius must be integers')
      }
    }
    return
  }
  if (input.module === 'ecg' || input.module === 'eeg' || input.module === 'emg' || input.module === 'biopipeline') {
    const scene = record(input.scene)
    if (input.module === 'ecg' && 'recording' in scene) {
      validateRecording(scene.recording)
      finite(scene.channel, 'channel', 0, scene.recording.channels.length - 1)
      if (!Number.isInteger(scene.channel)) throw new Error('recording channel must be an integer')
      return
    }
    if (input.module !== 'biopipeline') {
      finite(scene.samples, 'samples', 8, 2000)
      if (!Number.isInteger(scene.samples)) throw new Error('biosignal samples must be an integer')
    }
    if (input.module !== 'ecg') {
      finite(scene.seed, 'seed', 0, 4294967295)
      if (!Number.isInteger(scene.seed)) throw new Error('signal seed must be an integer')
    }
    if (input.module === 'ecg') finite(scene.hr, 'hr', 40, 180)
    else if (input.module === 'eeg') { finite(scene.state, 'state', 0, 3); finite(scene.noise, 'noise', 0, 0.8) }
    else if (input.module === 'emg') { finite(scene.agonist, 'agonist', 0, 1); finite(scene.antag, 'antag', 0, 1) }
    else if (!['ECG', 'EMG', 'EEG'].includes(String(scene.source))) throw new Error('invalid pipeline signal source')
    return
  }
  if (input.module === 'neuron') {
    const scene = record(input.scene)
    finite(scene.current, 'current', 0, 1); finite(scene.steps, 'steps', 1, 2000)
    if (!Number.isInteger(scene.steps)) throw new Error('neuron steps must be an integer')
    let previous = -1
    for (const start of numbers(scene.pulses, 64)) {
      if (!Number.isInteger(start) || start <= previous || start >= scene.steps) throw new Error('stimulus starts must be sorted unique in-range steps')
      previous = start
    }
    return
  }
  if (input.module === 'ultrasound') {
    const scene = record(input.scene)
    finite(scene.atten, 'atten', 0, 0.06); finite(scene.gain, 'gain', 0.4, 2)
    return
  }
  if (input.module === 'rlc' || input.module === 'mutual') {
    const scene = record(input.scene)
    finite(scene.steps, 'steps', 1, 2000)
    if (!Number.isInteger(scene.steps)) throw new Error('circuit steps must be an integer')
    if (input.module === 'rlc') {
      finite(scene.zeta, 'zeta', 0, 2)
      if (scene.drive !== 'energy' && scene.drive !== 'step') throw new Error('invalid RLC drive')
    } else {
      finite(scene.k, 'k', 0, 0.99); finite(scene.n, 'n', 0.3, 3)
      if (scene.mode !== 'sine' && scene.mode !== 'step') throw new Error('invalid mutual drive')
    }
    return
  }
  if (input.module === 'transient') {
    const scene = record(input.scene)
    if (typeof scene.mode !== 'string' || !['rc-charge', 'rc-discharge', 'rl'].includes(scene.mode)) throw new Error('invalid transient mode')
    finite(scene.v0, 'v0', 1, 12); finite(scene.r, 'r', 100, 5000)
    finite(scene.c, 'c', 1e-5, 5e-4); finite(scene.l, 'l', 0.05, 2)
    return
  }
  if (input.module === 'faraday') {
    const scene = record(input.scene)
    finite(scene.omega, 'omega', 0.4 * Math.PI, 20 * Math.PI); finite(scene.B, 'B', 0.05, 1)
    finite(scene.N, 'N', 10, 500); finite(scene.A, 'A', 0.001, 0.05)
    if (!Number.isInteger(scene.N)) throw new Error('coil turns must be an integer')
    finite(scene.vBar, 'vBar', 0, 10); finite(scene.bMot, 'bMot', 0.05, 2); finite(scene.lBar, 'lBar', 0.05, 1)
    return
  }
  if (input.module === 'smith') {
    const scene = record(input.scene)
    finite(scene.resistance, 'resistance', 0, 5000); finite(scene.reactance, 'reactance', -2000, 2000)
    finite(scene.thetaDeg, 'thetaDeg', 0, 180)
    return
  }
  if (input.module === 'localization' || input.module === 'tdoa') {
    const scene = record(input.scene), point = record(input.module === 'localization' ? scene.target : scene.source)
    finite(point.x, 'x', 0, input.module === 'localization' ? LOCALIZATION_W : TDOA_W)
    finite(point.y, 'y', 0, input.module === 'localization' ? LOCALIZATION_H : TDOA_H)
    finite(scene.noise, 'noise', 0, input.module === 'localization' ? 25 : 20)
    finite(scene.seed, 'seed', 0, 4294967295)
    if (!Number.isInteger(scene.seed)) throw new Error('measurement seed must be an integer')
    if (input.module === 'localization') finite(scene.bandwidth, 'bandwidth', 6, 120)
    return
  }
  if (input.module === 'stm') {
    const scene = record(input.scene)
    if (scene.mode !== 'height' && scene.mode !== 'current') throw new Error('invalid STM mode')
    finite(scene.tipHeight, 'tipHeight', 0.18, 0.42); finite(scene.setCurrent, 'setCurrent', 0.005, 0.06)
    return
  }
  if (input.module === 'afm') {
    const scene = record(input.scene)
    finite(scene.base, 'base', 2.1, 3.2); finite(scene.k, 'k', 2, 20)
    return
  }
  if (input.module === 'phasedarray') {
    const p = record(input.params)
    finite(p.n, 'n', 2, 48); finite(p.dOverLambda, 'dOverLambda', 0.25, 1.5); finite(p.steerDeg, 'steerDeg', -80, 80)
    if (!Number.isInteger(p.n)) throw new Error('array element count must be an integer')
    return
  }
  if (input.module === 'signal-array') {
    const s = record(input.scene)
    finite(s.rows, 'rows', 1, 64); finite(s.cols, 'cols', 1, 64)
    if (!Number.isInteger(s.rows) || !Number.isInteger(s.cols) || s.rows * s.cols > 64) throw new Error('Array grid must contain 1–64 cells')
    if (typeof s.unit !== 'string' || !s.unit.trim() || Array.from(s.unit).length > 32) throw new Error('Array input unit is required (at most 32 characters)')
    const n = s.rows * s.cols
    const vector = (value: unknown, count: number, name: string) => {
      if (array(value, count).length !== count) throw new Error(`${name} length mismatch`)
      for (const v of value as unknown[]) finite(v, name, -1e6, 1e6)
    }
    vector(s.input, n, 'spatial input')
    const sensing = array(s.sensing, 64)
    if (!sensing.length) throw new Error('At least one sensor is required')
    sensing.forEach(row => vector(row, n, 'sensing row'))
    vector(s.bias, sensing.length, 'sensor bias')
    const code = record(s.encoding)
    if (code.kind === 'custom') {
      const matrix = array(code.matrix, 128)
      if (!matrix.length) throw new Error('At least one encoded measurement is required')
      matrix.forEach(row => vector(row, sensing.length, 'encoding row'))
    } else if (code.kind !== 'direct' && code.kind !== 'hadamard') throw new Error('Unknown array encoding')
    if (code.kind === 'hadamard' && (sensing.length & (sensing.length - 1))) throw new Error('Hadamard encoding requires a power-of-two sensor count')
    finite(s.noisePeakV, 'peak noise', 0, 1e6); finite(s.regularization, 'regularization', 0, 1e6)
    finite(s.seed, 'seed', 0, 4294967295)
    if (!Number.isInteger(s.seed)) throw new Error('Array seed must be an integer')
    if (s.readout !== undefined) {
      const r = record(s.readout)
      finite(r.resistanceOhm, 'readout resistance', 1e-3, 1e12)
      finite(r.capacitanceF, 'readout capacitance', 1e-15, 1)
      finite(r.dwellS, 'channel dwell', 1e-12, 1e3)
      finite(r.initialV, 'initial capacitor voltage', -1e6, 1e6)
    }
    return
  }
  if (input.module === 'nljd') {
    if (typeof input.kind !== 'string' || !['semiconductor', 'corrosion', 'metal'].includes(input.kind)) throw new Error('unknown junction kind')
    return
  }
  if (input.module === 'radar') {
    const scene = record(input.scene)
    if (scene.mode !== 'pulse' && scene.mode !== 'cw') throw new Error('invalid radar source mode')
    finite(scene.steps, 'steps', 1, 2000)
    if (!Number.isInteger(scene.steps)) throw new Error('radar steps must be an integer')
    if (array(scene.probes, 4).length !== 4) throw new Error('radar requires four probe slots')
    for (const raw of scene.probes as unknown[]) {
      if (raw === null) continue
      const p = record(raw)
      finite(p.x, 'probe.x', 0, RADAR_N - 1); finite(p.y, 'probe.y', 0, RADAR_N - 1)
      if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) throw new Error('probe coordinates must be integers')
    }
    return
  }
  if (input.module === 'emwave3d') {
    const p = record(input.params)
    finite(p.waveNumber, 'waveNumber', 0.3, 1.6); finite(p.amplitude, 'amplitude', 0, 4); finite(p.time, 'time', 0, 1e6)
    return
  }
  if (input.module === 'antennapattern' || input.module === 'antenna3d') {
    const p = record(input.params)
    finite(p.frequencyHz, 'frequencyHz', 1e8, 28e9); finite(p.distM, 'distM', 1, 1e5); finite(p.ptDbm, 'ptDbm', -10, 46)
    if (input.module === 'antennapattern') {
      if (!['isotropic', 'dipole', 'directional'].includes(String(p.type))) throw new Error('invalid antenna type')
      finite(p.gtDbi, 'gtDbi', 0, 30); finite(p.grDbi, 'grDbi', 0, 30)
    } else {
      finite(p.elevationDeg, 'elevationDeg', 0, 180); finite(p.polarizationDeg, 'polarizationDeg', 0, 90)
    }
    return
  }
  if (input.module === 'laser') {
    finite(input.pump, 'pump', 0, LASER_MAX_PUMP); finite(input.steps, 'steps', 1, 2000)
    if (!Number.isInteger(input.steps)) throw new Error('laser steps must be an integer')
    return
  }
  if (input.module === 'fdtd') {
    const s = record(input.scene)
    if (!FDTD_PRESETS.some(p => p.id === s.preset)) throw new Error('unknown FDTD preset')
    if (s.boundary !== 'mur' && s.boundary !== 'pec') throw new Error('invalid FDTD boundary')
    if (s.shape !== 'line' && s.shape !== 'point') throw new Error('invalid FDTD source shape')
    if (s.time !== 'pulse' && s.time !== 'cw') throw new Error('invalid FDTD source waveform')
    finite(s.omega, 'omega', 0.05, 1.2)
    finite(s.steps, 'steps', 1, 2000)
    if (!Number.isInteger(s.steps)) throw new Error('FDTD steps must be an integer')
    const sources = array(s.sources, 32)
    if (!sources.length) throw new Error('FDTD requires at least one source')
    for (const raw of sources) {
      const source = record(raw)
      finite(source.i, 'source.i', 1, FDTD_NX - 2); finite(source.j, 'source.j', 1, FDTD_NY - 2)
      if (!Number.isInteger(source.i) || !Number.isInteger(source.j)) throw new Error('FDTD source coordinates must be integers')
    }
    return
  }
  if (input.module === 'optics-lab') {
    const ids = new Set<string>()
    for (const item of array(input.components, 64)) {
      const c = record(item)
      if (typeof c.id !== 'string' || !c.id || c.id.length > 128 || ids.has(c.id) || ['__proto__', 'constructor', 'prototype'].includes(c.id)) throw new Error('component id must be unique and valid')
      ids.add(c.id)
      if (!OPTICS_PALETTE.some(p => p.kind === c.kind)) throw new Error('unknown optics component')
      finite(c.x, 'x', 0, SCENE_W); finite(c.y, 'y', 0, SCENE_H)
      finite(c.rot, 'rot', -3600, 3600); finite(c.length, 'length', 0, 2000)
      for (const key of ['power', 'wavelengthNm', 'focalLength', 'n', 'polAngleDeg', 'splitT']) {
        if (c[key] !== undefined) finite(c[key], key, -1e4, 1e4)
      }
      if (c.power !== undefined) finite(c.power, 'power', 0, 100)
      if (c.wavelengthNm !== undefined) finite(c.wavelengthNm, 'wavelengthNm', 1, 1e4)
      if (c.n !== undefined) finite(c.n, 'n', 1, 100)
      if (c.splitT !== undefined) finite(c.splitT, 'splitT', 0, 1)
      if (c.label !== undefined && typeof c.label !== 'string') throw new Error('component label must be a string')
      for (const key of ['slitPlate', 'lloydMirror', 'edgeWave', 'biprism', 'machZehnder', 'newtonRings', 'fabryPerot', 'michelsonWave', 'zonePlate'] as const) {
        if (c[key] !== undefined && c[key] !== true && c[key] !== false) throw new Error(`${key} must be boolean`)
      }
    }
    return
  }
  if (input.module !== 'electromagnetic' && input.module !== 'sound') throw new Error('module is not connected to backend compute')
  finite(input.timeSeconds, 'timeSeconds', 0, 1e6)
  if (numbers(input.xs, 2048).length < 2) throw new Error('at least two sample positions required')
  const p = record(input.params)
  finite(p.frequencyHz, 'frequencyHz', 1e-6, 1e20)
  if (p.phase0 !== undefined) finite(p.phase0, 'phase0', -1e6, 1e6)
  if (input.module === 'electromagnetic') {
    finite(p.refractiveIndex, 'refractiveIndex', 1, 100)
    finite(p.ePeak, 'ePeak', 0, 1e6)
  } else {
    finite(p.rho, 'rho', 1e-6, 1e6); finite(p.c, 'c', 1e-6, 1e6)
    finite(p.pPeak, 'pPeak', 0, 1e6)
  }
}

/** Modules whose CPU stepping is shared Rust on native and browser Agents. */
export function isNativeModule(module: unknown): module is 'ripple' | 'sim' | 'fdtd' | 'md' | 'particles' | 'fluid' | 'convection' | 'ising' | 'rlc' | 'mutual' | 'vibration' | 'neuron' | 'optics-lab' | 'electromagnetic' | 'sound' | 'emwave3d' | 'antennapattern' | 'antenna3d' | 'phasedarray' | 'radar' | 'laser' | 'nljd' | 'signal-array' | 'transient' | 'faraday' {
  return module === 'ripple' || module === 'sim' || module === 'fdtd' || module === 'md' || module === 'particles' || module === 'fluid' || module === 'convection' || module === 'ising' || module === 'rlc' || module === 'mutual' || module === 'vibration' || module === 'neuron' || module === 'optics-lab' || module === 'electromagnetic' || module === 'sound' || module === 'emwave3d' || module === 'antennapattern' || module === 'antenna3d' || module === 'phasedarray' || module === 'radar' || module === 'laser' || module === 'nljd' || module === 'signal-array' || module === 'transient' || module === 'faraday'
}

/** sw-* inputs run only inside the w-sim-cuda binary; never on the host path. */
export function isSwModuleInput(input: ModuleComputeInput): input is SwModuleInput {
  return input.module.startsWith('sw-')
}

export function moduleComputeSteps(input: ModuleComputeInput): number {
  if (input.module === 'mna' && input.method === 'method-algo-mna-dc-sweep') {
    const steps = (input as { sweep?: { steps?: unknown } }).sweep?.steps
    if (typeof steps === 'number' && Number.isInteger(steps) && steps >= 2 && steps <= 1001) return steps
  }
  if (input.module === 'mna' && input.method === 'method-algo-mna-transient-be') {
    const steps = (input as { steps?: unknown }).steps
    if (typeof steps === 'number' && Number.isInteger(steps) && steps >= 1 && steps <= 2_000) return steps
  }
  if (isNativeAlgorithmInput(input)) return 1
  if (input.module === 'particles') return input.scene.steps
  if (input.module === 'ripple' || input.module === 'convection' || input.module === 'fluid') return input.scene.steps
  if (input.module === 'ising') return isingSceneSteps(input.scene)
  return input.module === 'fdtd' || input.module === 'radar' || input.module === 'rlc' || input.module === 'mutual' || input.module === 'neuron' || input.module === 'sim' || input.module === 'heaterfc' || input.module === 'md' || input.module === 'vibration' ? input.scene.steps : input.module === 'laser' ? input.steps : 1
}

/** Iterative CPU field cores use FP64 arithmetic with Float32 storage; do not label them FP64. */
export function moduleComputePrecision(input: ModuleComputeInput): 'mixed' | 'float64' {
  if (isNativeAlgorithmInput(input)) return 'float64'
  // sw-* 的 precision 由 w-sim-cuda 二进制如实自报——宿主侧没有可查依据，
  // 编造 'float64' 是伪造溯源。
  if (isSwModuleInput(input)) throw new Error('sw-* module precision is reported by the w-sim-cuda binary, not fabricated host-side')
  if (input.module === 'particles') return 'mixed'
  if (input.module === 'ripple' || input.module === 'convection' || input.module === 'fluid') return 'mixed'
  return input.module === 'fdtd' || input.module === 'radar' || input.module === 'ultrasound' || input.module === 'sim' || input.module === 'heaterfc' || input.module === 'md' ? 'mixed' : 'float64'
}

/** Return known precision only; native sw-* modules report this from their executor. */
export function knownModuleComputePrecision(input: ModuleComputeInput): 'mixed' | 'float64' | null {
  return isSwModuleInput(input) ? null : moduleComputePrecision(input)
}

export function createModuleJobSpec(input: ModuleComputeInput): JobSpecV1 {
  validateModuleInput(input)
  return {
    schemaVersion: 1, kind: MODULE_JOB_KIND, name: input.module,
    parameters: { module: input.module }, model: { source: 'inline', inline: { ...input } },
    run: { maxSteps: moduleComputeSteps(input) }, outputs: {},
    // sw-* 只能落在 w-sim-cuda 原生后端；inline.backend 已显式声明模块内
    // 数学后端（host/auto/cuda），precision 由二进制如实上报。
    requirements: isSwModuleInput(input) || isNativeAlgorithmInput(input)
      ? { backends: ['cuda'] }
      : { backends: ['cpu'], precision: moduleComputePrecision(input) },
  }
}

export function readModuleJobInput(spec: JobSpecV1): ModuleComputeInput {
  if (spec.kind !== MODULE_JOB_KIND || spec.model?.source !== 'inline') throw new Error('waveworld-module requires an inline model')
  const input = spec.model.inline
  validateModuleInput(input)
  if (record(spec.parameters).module !== input.module) throw new Error('parameters.module must match model.inline.module')
  if (isNativeAlgorithmInput(input)) {
    const backends = spec.requirements?.backends
    if (!Array.isArray(backends) || !backends.includes('cuda') || backends.some(b => b !== 'cuda' && b !== 'native-cuda')) {
      throw new Error('native algorithm operations require the native w-sim-cuda backend; requirements.backends must be [\'cuda\'] (\'native-cuda\' may be added)')
    }
    if (spec.run?.maxSteps !== moduleComputeSteps(input)) throw new Error('native algorithm operation run.maxSteps must match its requested work')
    if (spec.requirements?.precision !== undefined) throw new Error('native algorithm operation precision is reported by the native executor')
    if (JSON.stringify(input).length > (1 << 20)) throw new Error('native algorithm inline model exceeds the 1 MiB bound')
    return input
  }
  if (isSwModuleInput(input)) {
    // requirements.backends 是 any-of 语义：含 'cpu' 会让任务落到 computeModule
    // 而被拒；'native-cuda' 单独使用与 agent 声明的 'cuda' 无字面重叠而不可领。
    // maxSteps/precision 由 w-sim-cuda 自有契约裁决，宿主不再等值校验。
    const backends = spec.requirements?.backends
    if (!Array.isArray(backends) || !backends.includes('cuda') || backends.some(b => b !== 'cuda' && b !== 'native-cuda')) {
      throw new Error('sw-* modules run only on the native w-sim-cuda backend; requirements.backends must be [\'cuda\'] (\'native-cuda\' may be added)')
    }
    // run.maxSteps 是宿主侧的元数据（w-sim-cuda 自有裁决），但仍须是有界的
    // 正整数——伪造的极大值不应进入任务记录。
    if (spec.run?.maxSteps !== undefined) {
      const maxSteps = spec.run.maxSteps
      if (typeof maxSteps !== 'number' || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 1e9) throw new Error('sw-* module run.maxSteps must be a bounded positive integer')
    }
    // sw-* 允许任意平铺字段（admission 归二进制），任务记录仍须有界。
    if (JSON.stringify(input).length > (1 << 20)) throw new Error('sw-* inline model exceeds the 1 MiB bound')
    return input
  }
  if (spec.run?.maxSteps !== moduleComputeSteps(input)) throw new Error('module maxSteps must match its requested steps')
  const precision = spec.requirements?.precision
  if (precision !== undefined && ![precision].flat().includes(moduleComputePrecision(input))) throw new Error('module precision must match its numeric implementation')
  // cpu 是浏览器/agent 的 WASM 路径；cuda/native-cuda 由 w-sim-cuda `module`
  // 子命令在原生 Rust 中执行同一 computeModule 语义。requirements.backends
  // 是 any-of：必须至少含一个真实可领的后端——agent 只声明 cpu/cuda，
  // 'native-cuda' 单独出现是永远无法被领取的僵尸 spec。
  const backends = spec.requirements?.backends
  if (backends !== undefined && (!Array.isArray(backends) || backends.some(backend => backend !== 'cpu' && backend !== 'cuda' && backend !== 'native-cuda'))) throw new Error('waveworld-module supports only the cpu or native-cuda backends')
  if (Array.isArray(backends) && backends.length > 0 && !backends.some(backend => backend === 'cpu' || backend === 'cuda')) throw new Error('waveworld-module requires at least one claimable backend (cpu or cuda)')
  return input
}

/** Numeric arrays stay arrays after a JSON round trip, including screen bins. */
export async function computeModule(input: ModuleComputeInput, signal?: AbortSignal, onProgress?: (progress: JobProgress) => void | Promise<void>): Promise<ModuleComputeOutput> {
  validateModuleInput(input)
  signal?.throwIfAborted()
  if (isNativeAlgorithmInput(input)) throw new Error(`module '${input.module}' native algorithm operation has no browser/host implementation; submit requirements.backends:['cuda'] so it runs on the w-sim-cuda binary`)
  if (isSwModuleInput(input)) throw new Error(`module '${input.module}' has no host implementation; submit requirements.backends:['cuda'] so it runs on the w-sim-cuda binary`)
  const total = moduleComputeSteps(input)
  // Reuse the solver's bounded chunks for progress, lease renewal and cancellation.
  // The Agent throttles network updates; browser callers need no callback.
  // emit=false still yields + probes abort — the step-0 progress emit is
  // deduped against the entry checkpoint, the abort check must not be.
  const checkpoint = async (step: number, emit = true) => {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    signal?.throwIfAborted()
    if (emit) await onProgress?.({ step, total })
    signal?.throwIfAborted()
  }
  if (onProgress) await checkpoint(0)
  if (input.module === 'display') return { module: input.module, result: displayResult(input.scene) }
  if (input.module === 'particles') {
    const sim = await createParticleScene(input.scene, true)
    try {
      let steps = 0, frame = await sim.read()
      signal?.throwIfAborted()
      while (steps < input.scene.steps) {
        await checkpoint(steps, steps > 0 || !onProgress)
        const next = await advanceParticleScene(sim, input.scene, steps)
        steps = next.steps; frame = next.frame
      }
      return { module: input.module, result: particleResult(frame, steps) }
    } finally { sim.destroy() }
  }
  if (input.module === 'fluid') {
    const fluid = createFluidScene(input.scene)
    for (let step = 0; step < input.scene.steps; step++) {
      if (step % 4 === 0) await checkpoint(step, step > 0 || !onProgress)
      stepFluidScene(fluid, input.scene)
    }
    return { module: input.module, result: fluidResult(fluid, input.scene.steps) }
  }
  if (input.module === 'ripple') {
    const wave = createRippleScene(input.scene)
    for (let step = 0; step < input.scene.steps; step++) {
      if (step % 8 === 0) await checkpoint(step, step > 0 || !onProgress)
      wave.step()
    }
    return { module: input.module, result: rippleResult(wave.u, input.scene.steps) }
  }
  if (input.module === 'convection') {
    const fluid = createConvectionScene(input.scene)
    for (let step = 0; step < input.scene.steps; step++) {
      await checkpoint(step, step > 0 || !onProgress)
      stepConvectionScene(fluid)
    }
    return { module: input.module, result: convectionResult(fluid, input.scene.steps) }
  }
  if (input.module === 'ising') {
    const run = createIsingScene(input.scene), steps = isingSceneSteps(input.scene)
    signal?.throwIfAborted()
    while (run.steps < steps) {
      if (run.steps % 8 === 0) await checkpoint(run.steps, run.steps > 0 || !onProgress)
      stepIsingScene(run, input.scene)
    }
    return { module: input.module, result: isingResult(run) }
  }
  if (input.module === 'rlc' || input.module === 'mutual' || input.module === 'vibration' || input.module === 'neuron') {
    const run = input.module === 'rlc' ? createRlcScene(input.scene) : input.module === 'mutual' ? createMutualScene(input.scene)
      : input.module === 'vibration' ? createVibrationScene(input.scene) : createNeuronScene(input.scene)
    while (run.completed < input.scene.steps) {
      await checkpoint(run.completed, run.completed > 0 || !onProgress)
      const count = Math.min(8, input.scene.steps - run.completed)
      if (input.module === 'mutual') stepMutualScene(run, input.scene, count)
      else run.advance(count)
    }
    if (input.module === 'rlc') return { module: input.module, result: readRlcScene(run) }
    if (input.module === 'mutual') return { module: input.module, result: readMutualScene(run) }
    if (input.module === 'vibration') return { module: input.module, result: readVibrationScene(run) }
    return { module: input.module, result: readNeuronScene(run) }
  }
  if (input.module === 'md') {
    const sim = await createMdScene(input.scene, true)
    try {
      let frame = await sim.read(), steps = 0
      signal?.throwIfAborted()
      const history: MdHistory = [{ step: 0, time: 0, msd: frame.observables.msd }]
      while (steps < input.scene.steps) {
        await checkpoint(steps, steps > 0 || !onProgress)
        const next = await advanceMdScene(sim, input.scene, steps, history)
        steps = next.steps; frame = next.frame
      }
      return { module: input.module, result: mdResult(frame, steps, history, input.scene.barostat) }
    } finally { sim.destroy() }
  }
  if (input.module === 'sim') {
    const heat = new HeatField(HEAT_W, HEAT_H)
    for (const seed of input.scene.seeds) heat.seed(seed)
    for (let step = 0; step < input.scene.steps; step++) {
      if (step % 8 === 0) await checkpoint(step, step > 0 || !onProgress)
      heat.step(input.scene.r)
    }
    return { module: input.module, result: heatFieldResult(heat.field, input.scene.steps) }
  }
  if (input.module === 'heaterfc') {
    const h = initHeat1D(HEAT_1D_M, HEAT_1D_L, input.scene.kappa, HEAT_1D_X0)
    for (let step = 0; step < input.scene.steps; step++) {
      if (step % 64 === 0) await checkpoint(step, step > 0 || !onProgress)
      ftcsStep(h)
    }
    return { module: input.module, result: heat1DResult(h, input.scene.steps) }
  }
  if (input.module === 'ecg') return { module: input.module, result: ecgResult(input.scene) }
  if (input.module === 'eeg') return { module: input.module, result: eegResult(input.scene) }
  if (input.module === 'emg') return { module: input.module, result: emgResult(input.scene) }
  if (input.module === 'ultrasound') return { module: input.module, result: ultrasoundResult(input.scene) }
  if (input.module === 'biopipeline') return { module: input.module, result: bioPipelineResult(input.scene) }
  if (input.module === 'transient') return { module: input.module, result: transientResult(input.scene) }
  if (input.module === 'faraday') return { module: input.module, result: faradayResult(input.scene) }
  if (input.module === 'smith') return { module: input.module, result: smithResult(input.scene) }
  if (input.module === 'localization') return { module: input.module, result: localizationResult(input.scene) }
  if (input.module === 'tdoa') return { module: input.module, result: tdoaResult(input.scene) }
  if (input.module === 'stm') return { module: input.module, result: stmScanResult(input.scene) }
  if (input.module === 'afm') return { module: input.module, result: afmScanResult(input.scene) }
  if (input.module === 'phasedarray') return { module: input.module, result: phasedArrayResult(input.params) }
  if (input.module === 'signal-array') return { module: input.module, result: signalArrayResult(input.scene) }
  if (input.module === 'nljd') return { module: input.module, result: nljdResult(input.kind) }
  if (input.module === 'radar') {
    const owner = new WasmRadar(input.scene)
    for (let step = 0; step < input.scene.steps; step += 8) {
      await checkpoint(step, step > 0 || !onProgress)
      owner.advance(Math.min(8, input.scene.steps - step))
    }
    return { module: input.module, ...radarResult(owner) }
  }
  if (input.module === 'emwave3d') return { module: input.module, fields: emWave3DResult(input.params) }
  if (input.module === 'antennapattern') return { module: input.module, result: antennaLinkResult(input.params) }
  if (input.module === 'antenna3d') return { module: input.module, result: antenna3DResult(input.params) }
  if (input.module === 'laser') {
    const owner = new WasmLaser()
    owner.configure(LASER_DEFAULT, input.pump, LASER_DT)
    for (let step = 0; step < input.steps; step += 64) {
      await checkpoint(step, step > 0 || !onProgress)
      owner.advance(Math.min(64, input.steps - step))
    }
    return { module: input.module, state: owner.snapshot(), steps: input.steps, dt: LASER_DT, characteristics: laserCharacteristics(input.pump, owner) }
  }
  if (input.module === 'fdtd') {
    const scene = input.scene
    const preset = FDTD_PRESETS.find(p => p.id === scene.preset)!
    const field = createField(FDTD_NX, FDTD_NY, { boundary: scene.boundary, eps: preset.eps?.(), pecMask: preset.pec?.() })
    const inject = (i: number, j: number, amplitude: number) => injectSoftSource(field, i, j, amplitude)
    for (let step = 0; step < scene.steps; step++) {
      // Yield between bounded chunks so lease heartbeats and cancellation can run.
      if (step % 8 === 0) await checkpoint(step, step > 0 || !onProgress)
      injectFdtdSceneSources(scene, step, inject)
      fdtdStep(field)
    }
    signal?.throwIfAborted()
    return { module: input.module, nx: FDTD_NX, ny: FDTD_NY, steps: scene.steps, dt: field.dt, Ez: Array.from(field.Ez) }
  }
  if (input.module === 'optics-lab') {
    const run = createOpticsTrace(input.components)
    while (!run.done) {
      await checkpoint(0, run.processed > 0 || !onProgress)
      run.advance()
    }
    signal?.throwIfAborted()
    const trace = readOpticsTrace(run, input.components)
    return { module: input.module, trace: { ...trace, profiles: trace.profiles.map(p => ({ ...p, bins: Array.from(p.bins) })) } }
  }
  if (input.module === 'electromagnetic') {
    const run = createEmPlaneWave(input.params, input.xs)
    const observables = readEmPlaneWave(run)
    run.sample(input.timeSeconds)
    return { module: input.module, observables, E: Array.from(run.first), B: Array.from(run.second) }
  }
  const run = createAcousticPlaneWave(input.params, input.xs)
  const observables = readAcousticPlaneWave(run)
  run.sample(input.timeSeconds)
  return { module: input.module, observables, pressure: Array.from(run.first), velocity: Array.from(run.second) }
}

/** sw-* 模块自报的数学后端 id（形状深浅不一：backend.id / result.backend.id / 裸 string）。 */
function swModuleBackendId(output: Record<string, unknown>): string | undefined {
  const candidates = [output.backend, (output.result as Record<string, unknown> | undefined)?.backend]
  for (const candidate of candidates) {
    if (typeof candidate === 'string') return candidate
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const id = (candidate as Record<string, unknown>).id
      if (typeof id === 'string') return id
    }
  }
  return undefined
}

/** sw-* 结果 backend.id 是否满足 inline backend 要求（'cuda'→GPU 系，'host'→host 数学系）。 */
function swBackendAllowed(id: string, requested: 'host' | 'auto' | 'cuda'): boolean {
  const cudaFamily = id === 'cuda' || id === 'w-sim-cuda' || id.startsWith('native-cuda')
  const hostFamily = id === 'cpu' || id.startsWith('cpu-') || id === 'w-sim-cuda-host' || id === 'host-f64' || id.startsWith('host-f64-')
  if (requested === 'cuda') return cudaFamily
  if (requested === 'host') return hostFamily
  return cudaFamily || hostFamily
}

/** Validate returned fields before persistence or drawing; never fill missing results with zeros. */
export function readModuleResult(result: JobResultV1, input: ModuleComputeInput): ModuleComputeOutput {
  // 信封级 error 与成功 moduleResult 自相矛盾——拒绝按成功结算。
  if (typeof (result as Partial<JobResultV1>).error === 'string' && (result as Partial<JobResultV1>).error!.length > 0) {
    throw new Error('job result carries an error message and cannot settle as a successful module result')
  }
  const output = record((result as Partial<ModuleJobResult>).moduleResult)
  if (isSwModuleInput(input)) {
    // sw-* 结果形状归 w-sim-cuda 所有：模块自报 id（或 module）与真实
    // backend/deviceName；宿主只做身份与信封健全性核对，不伪造字段。
    if (result.schemaVersion !== 1) throw new Error('module result must report schemaVersion 1')
    if (output.ok === false) throw new Error('module result reports failure and cannot settle as success')
    const id = output.module ?? output.id
    if (id !== input.module || (output.module !== undefined && output.id !== undefined && output.module !== output.id)) throw new Error('module result does not match the requested module')
    const hasTopLevelPayload = Object.entries(output).some(([key, value]) =>
      value !== undefined && !['module', 'id', 'backend', 'deviceName', 'meta', 'ok', 'method', 'result'].includes(key),
    )
    if (output.result === undefined && output.backend === undefined && output.meta === undefined && !hasTopLevelPayload) {
      throw new Error('module result carries no payload')
    }
    // 模块自报 backend（output.backend.id 或 output.result.backend.id）是
    // 数学路径的真值：'native-cuda-*' 是 GPU，'w-sim-cuda-host'/'host-f64'
    // 是 host 数学。envelope backend.id 恒为 'w-sim-cuda'（执行体身份），
    // 只在模块未自报时兜底。backend:'cuda' 的任务不得以 host 数学结果
    // 结算；'host' 不得以 cuda 结果结算；'auto' 两者皆可。
    const moduleBackend = swModuleBackendId(output)
    const backendId = moduleBackend ?? result.backend?.id
    if (backendId !== undefined && !swBackendAllowed(backendId, input.backend)) {
      throw new Error(`module result backend '${backendId}' does not satisfy the requested backend '${input.backend}'`)
    }
    const steps = result.summary?.steps
    if (steps !== undefined && (!Number.isInteger(steps) || steps < 0)) throw new Error('module result summary.steps must be a non-negative integer')
    return output as ModuleComputeOutput
  }
  if (isNativeAlgorithmInput(input)) {
    if (result.schemaVersion !== 1 || result.summary?.steps !== moduleComputeSteps(input)) throw new Error('native algorithm result must report the requested completed steps')
    if (output.ok === false || output.module !== input.module || (output.id !== undefined && output.id !== input.module)) throw new Error('native algorithm result does not match the requested module')
    if (Object.keys(output).length <= 2) throw new Error('native algorithm result carries no payload')
    const moduleBackend = swModuleBackendId(output)
    const backendId = moduleBackend ?? result.backend?.id
    if (backendId === undefined || !swBackendAllowed(backendId, 'host')) throw new Error(`native algorithm result must report a host backend; received '${backendId ?? 'missing'}'`)
    return output as ModuleComputeOutput
  }
  if (result.schemaVersion !== 1 || result.summary?.steps !== moduleComputeSteps(input)) throw new Error('module result must report the requested completed steps')
  if (output.module !== input.module) throw new Error('module result does not match the requested module')
  if (input.module === 'particles') {
    const data = record(output.result), obs = record(data.observables), n = particleCount(input.scene), L = input.scene.boxL
    const dim = input.scene.dim === 2 ? 2 : 3, volume = L ** dim
    if (data.steps !== input.scene.steps || data.dt !== MD_DT || data.time !== input.scene.steps * MD_DT) throw new Error('Particle steps or time mismatch')
    const pos = numbers(data.pos, n * dim), speed = numbers(data.speed, n), kind = numbers(data.kind, n), charge = numbers(data.charge, n)
    if (pos.length !== n * dim || speed.length !== n || kind.length !== n || charge.length !== n) throw new Error('Particle particle arrays mismatch')
    pos.forEach(v => finite(v, 'Particle position', 0, L)); speed.forEach(v => finite(v, 'Particle speed', 0))
    const properties = particleProperties(input.scene)
    properties.kind.forEach((s, i) => {
      if (kind[i] !== s || charge[i] !== properties.charge[i]) throw new Error('particle species or charge mismatch')
    })
    for (const key of ['temperature', 'kinetic', 'potential', 'total', 'pressure', 'msd', 'boxL', 'volume', 'density', 'totalCharge']) finite(obs[key], `Particle ${key}`)
    for (const key of ['temperature', 'kinetic', 'msd']) finite(obs[key], `Particle ${key}`, 0)
    const close = (actual: unknown, expected: number) => {
      finite(actual, 'Particle observable')
      if (Math.abs(actual - expected) > 1e-6 * Math.max(1, Math.abs(expected))) throw new Error('Particle observable mismatch')
    }
    close(obs.boxL, L); close(obs.volume, volume); close(obs.density, n / volume)
    close(obs.total, (obs.kinetic as number) + (obs.potential as number)); close(obs.kinetic, (obs.temperature as number) * n * dim / 2)
    close(obs.kinetic, speed.reduce((sum, v) => sum + v * v / 2, 0))
    close(obs.totalCharge, charge.reduce((sum, q) => sum + q, 0))
    const rdf = record(data.rdf)
    for (const key of ['r', 'g']) {
      const values = numbers(rdf[key], PARTICLE_RDF_BINS)
      if (values.length !== PARTICLE_RDF_BINS) throw new Error('Particle RDF length mismatch')
      values.forEach(v => finite(v, 'Particle RDF value', 0))
      if (key === 'r') values.forEach((v, i) => close(v, (i + 0.5) * L / (2 * PARTICLE_RDF_BINS)))
    }
  } else if (input.module === 'display') {
    const data = record(output.result), expected = displayResult(input.scene)
    if (data.mode !== input.scene.mode) throw new Error('display mode mismatch')
    // These cheap analytic relations also reject stale or mismatched renderer data.
    // Only known fields are compared; future response fields are tolerated.
    for (const [key, value] of Object.entries(expected)) {
      if (JSON.stringify(data[key]) !== JSON.stringify(value)) throw new Error(`display ${key} does not match the requested scene`)
    }
  } else if (input.module === 'ripple' || input.module === 'convection' || input.module === 'fluid') {
    const data = record(output.result), n = input.module === 'ripple' ? RIPPLE_N : input.module === 'fluid' ? FLUID_N : CONVECTION_N
    if (data.nx !== n || data.steps !== input.scene.steps) throw new Error('field grid or steps mismatch')
    const readField = (key: string) => {
      const values = numbers(data[key], n * n)
      if (values.length !== n * n) throw new Error(`${key} field length mismatch`)
      return values
    }
    const match = (key: string, expected: number) => {
      finite(data[key], key)
      if (Math.abs(data[key] - expected) > 1e-10 * Math.max(1, Math.abs(expected))) throw new Error(`${key} must match the returned field`)
    }
    if (input.module === 'ripple') {
      const field = readField('field'), stats = rippleResult(field, data.steps as number)
      for (let i = 0; i < n; i++) {
        if (field[i] !== 0 || field[i + n * (n - 1)] !== 0 || field[i * n] !== 0 || field[i * n + n - 1] !== 0) throw new Error('ripple fixed boundary must be zero')
      }
      match('peak', stats.peak); match('rms', stats.rms)
    } else if (input.module === 'fluid') {
      if (data.dt !== FLUID_DT || data.time !== input.scene.steps * FLUID_DT) throw new Error('fluid timestep or time mismatch')
      const dens = readField('density'), vx = readField('vx'), vy = readField('vy')
      dens.forEach(v => finite(v, 'dye density', 0))
      if (input.scene.obstacle || data.solid !== undefined) {
        const solid = readField('solid')
        for (let i = 0; i < solid.length; i++) {
          if (solid[i] !== (input.scene.obstacle?.[i] ?? 0)) throw new Error('solid mask must match the requested geometry')
          if (solid[i] && (dens[i] !== 0 || vx[i] !== 0 || vy[i] !== 0)) throw new Error('solid-cell dye and velocity must be zero')
        }
      }
      const stats = fluidResult({ dens, vx, vy }, data.steps as number)
      for (const key of ['peakDensity', 'meanDensity', 'maxSpeed', 'gridDivergence'] as const) match(key, stats[key])
    } else {
      if (data.dt !== CONVECTION_DT || data.time !== input.scene.steps * CONVECTION_DT) throw new Error('convection timestep or time mismatch')
      const temp = readField('temperature'), vx = readField('vx'), vy = readField('vy')
      const stats = convectionResult({ temp, vx, vy }, data.steps as number)
      for (const key of ['minTemperature', 'maxTemperature', 'maxSpeed', 'gridDivergence'] as const) match(key, stats[key])
    }
  } else if (input.module === 'ising') {
    const data = record(output.result), count = input.scene.size ** 2
    if (data.size !== input.scene.size || data.steps !== isingSceneSteps(input.scene)) throw new Error('Ising size or sweeps mismatch')
    const spins = numbers(data.spins, count)
    if (spins.length !== count || !spins.every(s => s === -1 || s === 1)) throw new Error('invalid Ising spin field')
    finite(data.magnetization, 'Ising magnetization', 0, 1); finite(data.energy, 'Ising energy', -2, 2)
    const field = initIsing(input.scene.size, input.scene.temperatures.at(-1)!, 0, false)
    field.spins.set(spins)
    const stats = field.read(), references = onsagerReferences(input.scene.temperatures)
    if (data.magnetization !== stats.magnetization || data.energy !== stats.energy) throw new Error('Ising energy and magnetization must match spins')
    const point = (value: unknown, T: number, reference: number) => {
      const p = record(value)
      if (p.temperature !== T || p.samples !== input.scene.samples) throw new Error('Ising temperature or sample count mismatch')
      finite(p.meanM, 'Ising mean m', -1, 1); finite(p.meanAbsM, 'Ising mean |m|', 0, 1)
      finite(p.meanEnergy, 'Ising mean energy', -2, 2)
      if (p.meanAbsM + 1e-12 < Math.abs(p.meanM)) throw new Error('inconsistent Ising magnetization means')
      if (p.reference !== reference) throw new Error('Ising reference mismatch')
      if (p.samples < 2) {
        if (p.specificHeat !== null || p.susceptibility !== null) throw new Error('Ising fluctuation estimates require two samples')
      } else {
        finite(p.specificHeat, 'Ising specific heat', 0, 4 * count / (T * T))
        finite(p.susceptibility, 'Ising susceptibility', 0, count / T)
      }
      return p
    }
    const points = array(data.points, 57)
    if (points.length !== input.scene.temperatures.length) throw new Error('Ising temperature series length mismatch')
    points.forEach((p, i) => point(p, input.scene.temperatures[i], references[i]))
    const current = point(data.current, input.scene.temperatures.at(-1)!, references.at(-1)!)
    const last = record(points.at(-1))
    for (const key of ['samples', 'meanM', 'meanAbsM', 'meanEnergy', 'specificHeat', 'susceptibility', 'reference']) {
      if (current[key] !== last[key]) throw new Error('Ising final statistics mismatch')
    }
  } else if (input.module === 'vibration') {
    const data = record(output.result)
    if (data.steps !== input.scene.steps || data.dt !== VIBRATION_DT || data.time !== input.scene.steps * VIBRATION_DT) throw new Error('vibration steps or time mismatch')
    const states = array(data.states, 2001)
    if (states.length !== input.scene.steps + 1) throw new Error('vibration trajectory length mismatch')
    states.forEach(s => { const state = record(s); finite(state.x, 'displacement'); finite(state.v, 'velocity') })
    if (record(states[0]).x !== 0 || record(states[0]).v !== 0) throw new Error('vibration must start from rest')
    finite(data.omega0, 'natural frequency', 0); finite(data.amplitude, 'steady amplitude', 0)
    if (data.omega0 !== Math.sqrt(input.scene.stiffness / input.scene.mass)) throw new Error('vibration natural frequency mismatch')
    const curve = record(data.resonance)
    for (const key of ['omega', 'amplitude']) {
      const values = numbers(curve[key], VIBRATION_RESONANCE_SAMPLES)
      if (values.length !== VIBRATION_RESONANCE_SAMPLES) throw new Error('vibration resonance length mismatch')
      values.forEach(v => finite(v, 'resonance value', 0))
    }
  } else if (input.module === 'md') {
    const data = record(output.result), obs = record(data.observables)
    if (data.steps !== input.scene.steps || data.dt !== MD_DT || data.time !== input.scene.steps * MD_DT) throw new Error('MD steps or time mismatch')
    for (const key of ['temperature', 'kinetic', 'potential', 'total', 'pressure', 'msd', 'boxL', 'volume', 'density']) finite(obs[key], `MD ${key}`)
    for (const key of ['temperature', 'kinetic', 'msd', 'volume', 'density']) finite(obs[key], `MD ${key}`, 0)
    finite(obs.boxL, 'MD boxL', 5)
    if (obs.boxL <= 5) throw new Error('MD box must exceed twice the cutoff')
    const close = (actual: unknown, expected: number) => {
      finite(actual, 'MD value')
      if (Math.abs(actual - expected) > 1e-6 * Math.max(1, Math.abs(expected))) throw new Error('inconsistent MD result')
    }
    close(obs.volume, obs.boxL * obs.boxL * obs.boxL); close(obs.density, input.scene.N / (obs.volume as number))
    close(obs.temperature, (obs.kinetic as number) * 2 / (3 * input.scene.N))
    close(obs.total, (obs.kinetic as number) + (obs.potential as number))
    if (!input.scene.barostat) close(obs.boxL, mdBoxLength(input.scene.N))
    const pos = numbers(data.pos, input.scene.N * 3), speed = numbers(data.speed, input.scene.N)
    if (pos.length !== input.scene.N * 3 || speed.length !== input.scene.N) throw new Error('MD particle length mismatch')
    pos.forEach(v => finite(v, 'MD position', 0, (obs.boxL as number) + 1e-5))
    speed.forEach(v => finite(v, 'MD speed', 0))
    close(obs.kinetic, speed.reduce((sum, v) => sum + v * v / 2, 0))
    const history = array(data.history, 501)
    if (history.length !== Math.ceil(input.scene.steps / MD_BATCH_STEPS) + 1) throw new Error('MD history length mismatch')
    history.forEach((value, index) => {
      const point = record(value), step = Math.min(index * MD_BATCH_STEPS, input.scene.steps)
      if (point.step !== step || point.time !== step * MD_DT) throw new Error('MD sample time mismatch')
      finite(point.msd, 'MD displacement', 0)
      if (index === 0 && point.msd !== 0) throw new Error('MD initial displacement must be zero')
    })
    close(record(history.at(-1)).msd, obs.msd as number)
    const rdf = record(data.rdf)
    for (const key of ['r', 'g']) {
      const values = numbers(rdf[key], MD_RDF_BINS)
      if (values.length !== MD_RDF_BINS) throw new Error('MD RDF length mismatch')
      values.forEach(v => finite(v, 'MD RDF value', 0))
      if (key === 'r') values.forEach((v, i) => close(v, (i + 0.5) * (obs.boxL as number) / (2 * MD_RDF_BINS)))
    }
    if (input.scene.barostat || history.length < 4) {
      if (data.diffusion !== null) throw new Error('MD diffusion fit is unavailable for this scene')
    } else {
      const fit = record(data.diffusion)
      for (const key of ['D', 'slope', 'intercept']) finite(fit[key], `MD fit ${key}`)
      finite(fit.r2, 'MD fit r2', 0, 1)
      if (fit.nFit !== history.length - Math.floor(history.length * 0.2)) throw new Error('MD fit count mismatch')
      close(fit.D, (fit.slope as number) / 6)
    }
  } else if (input.module === 'sim') {
    const data = record(output.result)
    if (data.width !== HEAT_W || data.height !== HEAT_H || data.steps !== input.scene.steps) throw new Error('heat field shape or steps mismatch')
    const field = numbers(data.field, HEAT_W * HEAT_H)
    if (field.length !== HEAT_W * HEAT_H) throw new Error('heat field length mismatch')
    field.forEach(value => finite(value, 'heat value', 0, 32000))
    finite(data.peak, 'heat peak', 0, 32000); finite(data.total, 'heat total', 0, HEAT_W * HEAT_H * 32000)
    if (data.peak !== field.reduce((m, v) => Math.max(m, v), 0) || data.total !== field.reduce((s, v) => s + v, 0)) throw new Error('heat field aggregates do not match the returned field')
  } else if (input.module === 'heaterfc') {
    const data = record(output.result)
    if (data.steps !== input.scene.steps) throw new Error('heat profile steps mismatch')
    const h = initHeat1D(HEAT_1D_M, HEAT_1D_L, input.scene.kappa, HEAT_1D_X0)
    finite(data.time, 'heat time', 0); finite(data.dt, 'heat dt', 0)
    if (data.dt !== h.dt || Math.abs(data.time - data.steps * h.dt) > 1e-10) throw new Error('heat profile time mismatch')
    for (const key of ['temperatures', 'reference']) {
      const values = numbers(data[key], HEAT_1D_M)
      if (values.length !== HEAT_1D_M) throw new Error('heat profile length mismatch')
      values.forEach(value => finite(value, 'temperature', 0, 1))
    }
    finite(data.diffusionLength, 'diffusion length', 0, HEAT_1D_L); finite(data.maxError, 'heat max error', 0, 1)
    const temps = numbers(data.temperatures, HEAT_1D_M), refs = numbers(data.reference, HEAT_1D_M)
    if (data.maxError !== temps.reduce((m, t, i) => Math.max(m, Math.abs(t - refs[i])), 0)) throw new Error('heat max error mismatch')
    if (Math.abs((data.diffusionLength as number) - Math.sqrt(h.kappa * (data.time as number))) > 1e-9) throw new Error('heat diffusion length mismatch')
  } else if (input.module === 'ecg' || input.module === 'eeg' || input.module === 'emg') {
    const data = record(output.result)
    const ecgRecording = input.module === 'ecg' && 'recording' in input.scene ? input.scene : null
    const count = ecgRecording ? ecgRecording.recording.channels[ecgRecording.channel].values.length : (input.scene as { samples: number }).samples
    const sampleRate = input.module === 'ecg' ? ecgRecording?.recording.sampleRate ?? 240 : input.module === 'eeg' ? 256 : 512
    if (data.sampleRate !== sampleRate) throw new Error('biosignal sample rate mismatch')
    if (input.module === 'ecg') {
      if (numbers(data.values, RECORDING_MAX_SAMPLES).length !== count) throw new Error('ECG sample count mismatch')
      if (ecgRecording) {
        if (data.bpm !== null || data.rr !== null || data.source !== 'recording') throw new Error('recording must not invent heart-rate readouts')
      } else {
        finite(data.bpm, 'bpm', 40, 180); finite(data.rr, 'rr', 1 / 3, 1.5)
        if (data.source !== 'synthetic') throw new Error('invalid ECG source')
      }
      if (typeof data.label !== 'string' || data.label.length > 64 || typeof data.unit !== 'string' || data.unit.length > 16) throw new Error('invalid ECG signal metadata')
      finite(data.mean, 'mean'); finite(data.rms, 'rms', 0)
      const values = numbers(data.values, RECORDING_MAX_SAMPLES)
      const n = values.length
      if (data.mean !== values.reduce((s, v) => s + v, 0) / n || data.rms !== Math.sqrt(values.reduce((s, v) => s + v * v, 0) / n)) throw new Error('ECG aggregates do not match the returned signal')
    } else {
      const channels = array(data.channels, 4)
      if (channels.length !== (input.module === 'eeg' ? 4 : 2)) throw new Error('biosignal channel count mismatch')
      for (const values of channels) if (numbers(values, 2000).length !== count) throw new Error('biosignal sample count mismatch')
      if (input.module === 'eeg') {
        finite(data.stateIndex, 'stateIndex', 0, 3)
        if (!Number.isInteger(data.stateIndex)) throw new Error('invalid EEG state index')
        const power = record(data.power), bands = ['delta', 'theta', 'alpha', 'beta', 'gamma']
        if (!bands.includes(String(data.dominant))) throw new Error('invalid dominant EEG band')
        for (const band of bands) finite(power[band], band, 0, 1)
        if (data.stateIndex !== stateWeights(input.scene.state).stateIndex) throw new Error('EEG state index does not match the scene state')
        const expected = Object.fromEntries(bands.map(b => [b, 0]))
        for (const ch of channels as number[][]) {
          const p = measureBandPower(ch, 256)
          for (const band of bands) expected[band] += p[band] / channels.length
        }
        for (const band of bands) if (Math.abs((power[band] as number) - expected[band]) > 1e-9) throw new Error('EEG band power does not match the returned channels')
        for (const band of bands) if ((power[data.dominant as string] as number) < (power[band] as number)) throw new Error('EEG dominant band is not the maximum power band')
      } else {
        if (array(data.rms, 2).length !== 2) throw new Error('EMG RMS channel count mismatch')
        for (const values of data.rms as unknown[]) {
          const samples = numbers(values, 2000)
          if (samples.length !== count) throw new Error('EMG RMS sample count mismatch')
          samples.forEach(v => finite(v, 'RMS', 0))
        }
        finite(data.baselineRms, 'baselineRms', 0)
      }
    }
  } else if (input.module === 'neuron') {
    const data = record(output.result)
    if (data.dt !== 0.06 || numbers(data.voltage, 2001).length !== input.scene.steps + 1) throw new Error('neuron trajectory mismatch')
    finite(data.peak, 'peak')
    if (data.peak !== Math.max(...numbers(data.voltage, 2001))) throw new Error('neuron peak does not match the returned voltage trace')
    let previous = 0
    for (const spike of numbers(data.spikes, 2000)) {
      if (!Number.isInteger(spike) || spike <= previous || spike > input.scene.steps) throw new Error('invalid neuron spike times')
      previous = spike
    }
  } else if (input.module === 'ultrasound') {
    const data = record(output.result)
    if (data.lines !== 200 || data.samples !== 256 || data.maxDepth !== 100) throw new Error('ultrasound field shape mismatch')
    if (numbers(data.field, 51200).length !== 51200 || numbers(data.envelope, 256).length !== 256 || numbers(data.echoes, 200).length !== 200 || numbers(data.coefficients, 3).length !== 3) throw new Error('ultrasound result length mismatch')
    ;(data.field as number[]).forEach(v => finite(v, 'echo amplitude', 0))
    ;(data.envelope as number[]).forEach(v => finite(v, 'envelope', 0, 1))
    ;(data.echoes as number[]).forEach(v => { if (!Number.isInteger(v) || v < 0 || v > 128) throw new Error('invalid echo peak count') })
    ;(data.coefficients as number[]).forEach(v => finite(v, 'reflection coefficient', -1, 1))
  } else if (input.module === 'biopipeline') {
    const data = record(output.result)
    if (array(data.series, 5).length !== 5) throw new Error('pipeline stage count mismatch')
    for (const series of data.series as unknown[]) if (numbers(series, 600).length !== 600) throw new Error('pipeline sample count mismatch')
    finite(data.rawMean, 'rawMean'); finite(data.rawPeak, 'rawPeak', 0); finite(data.finalPeak, 'finalPeak', 0)
    const stages = data.series as number[][]
    if (data.rawMean !== bioMean(stages[0]) ||
        data.rawPeak !== Math.max(...stages[0].map(Math.abs)) ||
        data.finalPeak !== Math.max(...stages[4].map(Math.abs))) throw new Error('pipeline aggregates do not match the returned series')
  } else if (input.module === 'rlc' || input.module === 'mutual') {
    const data = record(output.result), states = array(data.states, 2001)
    if (states.length !== input.scene.steps + 1 || data.dt !== (input.module === 'rlc' ? 0.01 : 1 / 240)) throw new Error('circuit trajectory shape mismatch')
    for (const raw of states) {
      const state = record(raw)
      for (const name of input.module === 'rlc' ? ['q', 'i'] : ['i1', 'i2']) finite(state[name], name)
    }
    if (input.module === 'rlc') {
      finite(data.w0, 'w0', 0); finite(data.z, 'z', 0, 2)
      if (input.scene.zeta === 0 ? data.Q !== null : typeof data.Q !== 'number') throw new Error('invalid RLC quality factor limit')
      if (data.Q !== null) finite(data.Q, 'Q', 0)
    } else {
      finite(data.k, 'k', 0, 0.99 + 1e-12); finite(data.n, 'n', 0.3, 3)
      finite(data.substeps, 'substeps', 1, 5)
      if (!Number.isInteger(data.substeps)) throw new Error('invalid mutual substeps')
      const shares = numbers(data.secondaryShare, 2001)
      if (shares.length !== states.length) throw new Error('mutual dissipation sample count mismatch')
      shares.forEach(v => finite(v, 'secondaryShare', 0, 1))
    }
  } else if (input.module === 'transient') {
    const data = record(output.result)
    if (numbers(data.values, 241).length !== 241 || data.unit !== (input.scene.mode === 'rl' ? 'A' : 'V')) throw new Error('transient curve or unit mismatch')
    for (const name of ['tau', 'yMax', 'steady']) finite(data[name], name, 0)
  } else if (input.module === 'faraday') {
    const data = record(output.result)
    for (const name of ['flux', 'emf']) if (numbers(data[name], 361).length !== 361) throw new Error('induction curve length mismatch')
    for (const name of ['peak', 'linkage', 'motionalEmf', 'frequency', 'period']) finite(data[name], name, 0)
  } else if (input.module === 'smith') {
    const data = record(output.result), atLoad = record(data.atLoad)
    const complex = (value: unknown) => { const z = record(value); finite(z.re, 're'); finite(z.im, 'im') }
    for (const name of ['Z', 'zNorm', 'gamma']) complex(atLoad[name])
    complex(data.gIn)
    if ((data.zIn === null) !== (data.zNormIn === null)) throw new Error('inconsistent open-line impedance')
    if (data.zIn !== null) { complex(data.zIn); complex(data.zNormIn) }
    for (const name of ['gammaMag', 'powerRefl', 'powerTrans']) finite(data[name], name, -1e-12, 1 + 1e-12)
    finite(data.theta, 'theta', 0, Math.PI); finite(data.gammaPhaseDeg, 'gammaPhaseDeg', -180, 180)
    if (data.vswr !== null) finite(data.vswr, 'vswr', 1)
    if (data.returnLossDb !== null) finite(data.returnLossDb, 'returnLossDb', -1e-10)
    for (const [name, count] of [['resistancePath', 161], ['linePath', 73]] as const) {
      const points = array(data[name], count)
      if (points.length !== count) throw new Error('Smith path sample count mismatch')
      for (const raw of points) { const p = record(raw); finite(p.x, 'path.x', -1 - 1e-9, 1 + 1e-9); finite(p.y, 'path.y', -1 - 1e-9, 1 + 1e-9) }
    }
  } else if (input.module === 'localization' || input.module === 'tdoa') {
    const data = record(output.result), est = record(data.est)
    finite(est.x, 'estimate.x'); finite(est.y, 'estimate.y'); finite(data.err, 'error', 0)
    const readings = numbers(input.module === 'localization' ? data.ranges : data.diffs, 4)
    if (readings.length !== 4) throw new Error('location measurement count mismatch')
    if (input.module === 'localization') {
      readings.forEach(value => finite(value, 'range', 0)); finite(data.resolution, 'resolution', 0)
    } else {
      if (readings[0] !== 0 || array(data.curves, 3).length !== 3) throw new Error('invalid TDOA reference or curves')
      for (const curve of data.curves as unknown[]) {
        const points = array(curve, 121)
        if (points.length !== 0 && points.length !== 121) throw new Error('TDOA curve length mismatch')
        for (const raw of points) { const p = record(raw); finite(p.x, 'curve.x'); finite(p.y, 'curve.y') }
      }
    }
  } else if (input.module === 'stm' || input.module === 'afm') {
    const data = record(output.result), count = input.module === 'stm' ? STM_SAMPLES : AFM_SAMPLES
    const fields = input.module === 'stm' ? ['surface', 'gaps', 'tipHeights', 'currents'] : ['surface', 'gaps', 'forces', 'deflections']
    for (const field of fields) {
      const values = numbers(data[field], count)
      if (values.length !== count) throw new Error('scan sample count mismatch')
      if (field !== 'forces' && field !== 'deflections') values.forEach(v => finite(v, field, 0))
    }
  } else if (input.module === 'phasedarray') {
    const data = record(output.result)
    finite(data.beamwidthDeg, 'beamwidthDeg', 0, 180)
    if (typeof data.beamwidthClipped !== 'boolean') throw new Error('missing beamwidth clipping flag')
    if (numbers(data.phases, 48).length !== input.params.n) throw new Error('array phase count mismatch')
    numbers(data.grating, 4).forEach(v => finite(v, 'grating angle', -90, 90))
    if (array(data.pattern, 361).length !== 361) throw new Error('array pattern length mismatch')
    for (const raw of data.pattern as unknown[]) {
      const p = record(raw); finite(p.theta, 'theta', -90, 90); finite(p.gain, 'gain', 0, 1 + 1e-12)
    }
  } else if (input.module === 'signal-array') {
    const d = record(output.result), s = input.scene
    const n = s.rows * s.cols, sensors = s.sensing.length, measurements = signalArrayMeasurements(s)
    const vector = (v: unknown, count: number) => {
      if (array(v, count).length !== count) throw new Error('Array result vector length mismatch')
      for (const x of v as unknown[]) finite(x, 'array value', -1e100, 1e100)
    }
    if (array(d.encoding, measurements).length !== measurements) throw new Error('Encoding matrix height mismatch')
    for (const row of d.encoding as unknown[]) vector(row, sensors)
    vector(d.sensorV, sensors); vector(d.measuredV, measurements)
    if (s.readout || d.idealV !== undefined || d.sampledV !== undefined || d.settlingFraction !== undefined || d.readoutTauS !== undefined) {
      vector(d.idealV, measurements); vector(d.sampledV, measurements)
      finite(d.settlingFraction, 'readout settling fraction', 0, 1)
      finite(d.readoutTauS, 'readout time constant', 0, 1e12)
      if (s.readout ? d.readoutTauS <= 0 : d.settlingFraction !== 1 || d.readoutTauS !== 0) throw new Error('Array readout time constant or settling mismatch')
    }
    finite(d.rankTolerance, 'array rank threshold', 0, 1e100)
    finite(d.rank, 'array rank', 0, Math.min(n, sensors, measurements))
    if (!Number.isInteger(d.rank)) throw new Error('Array rank must be an integer')
    const expected = s.regularization > 0 ? 'regularized' : d.rank < n ? 'rank-deficient' : 'solved'
    if (d.status !== expected) throw new Error('Array reconstruction status mismatch')
    if (expected === 'rank-deficient') {
      if ([d.reconstructed, d.error, d.rmse, d.residualRmsV].some(v => v !== null)) throw new Error('Rank-deficient array cannot claim a unique reconstruction')
    } else {
      vector(d.reconstructed, n); vector(d.error, n)
      finite(d.rmse, 'reconstruction RMSE', 0, 1e100); finite(d.residualRmsV, 'measurement residual', 0, 1e100)
    }
  } else if (input.module === 'nljd') {
    const data = record(output.result), coefficients = record(data.coefficients)
    finite(coefficients.a2, 'a2'); finite(coefficients.a3, 'a3')
    if (!['semiconductor', 'corrosion', 'metal'].includes(String(data.verdict))) throw new Error('invalid junction verdict')
    if (data.verdict !== input.kind) throw new Error('junction verdict does not match the requested kind')
    for (const key of ['harmonics', 'relative']) {
      const h = record(data[key])
      for (const k of ['f1', 'f2', 'f3']) finite(h[k], k, 0, key === 'relative' ? 1 : 1e20)
    }
    if (numbers(data.transfer, 81).length !== 81) throw new Error('junction transfer curve length mismatch')
  } else if (input.module === 'radar') {
    if (output.nx !== RADAR_N || output.steps !== input.scene.steps || output.sampleStride !== RADAR_SAMPLE_STRIDE) throw new Error('radar field shape or steps mismatch')
    if (numbers(output.field, RADAR_N * RADAR_N).length !== RADAR_N * RADAR_N) throw new Error('radar field length mismatch')
    if (array(output.traces, 4).length !== 4 || array(output.readout, 4).length !== 4) throw new Error('radar channel count mismatch')
    const count = Math.min(RADAR_BUFFER, Math.ceil(input.scene.steps / RADAR_SAMPLE_STRIDE))
    input.scene.probes.forEach((probe, ch) => {
      const trace = numbers((output.traces as unknown[])[ch], RADAR_BUFFER)
      if (trace.length !== (probe ? count : 0)) throw new Error('radar sample count mismatch')
      const raw = (output.readout as unknown[])[ch]
      if (!probe) { if (raw !== null) throw new Error('unplaced probe must have no readout'); return }
      const r = record(raw); finite(r.v, 'probe value'); finite(r.pp, 'probe peak-to-peak', 0)
    })
  } else if (input.module === 'emwave3d') {
    const fields = record(output.fields)
    for (const name of ['z', 'ey', 'cbx']) {
      if (numbers(fields[name], EM_WAVE3D_SAMPLES).length !== EM_WAVE3D_SAMPLES) throw new Error('EM 3D samples length mismatch')
    }
    finite(fields.wavelength, 'wavelength', 0)
  } else if (input.module === 'antennapattern' || input.module === 'antenna3d') {
    const data = record(output.result)
    const length = input.module === 'antennapattern' ? 361 : ANTENNA_POLAR_SEGMENTS + 1
    if (numbers(data.pattern, length).length !== length) throw new Error('antenna pattern length mismatch')
    ;(data.pattern as number[]).forEach(value => finite(value, 'pattern', 0, 1))
    if (input.module === 'antenna3d') {
      if (data.prDbm !== null) finite(data.prDbm, 'prDbm')
      finite(data.fsplDb, 'fsplDb'); finite(data.plf, 'plf', 0, 1)
    } else {
      finite(data.directivityDb, 'directivityDb'); finite(data.beamwidthDeg, 'beamwidthDeg', 0, 360)
      if (numbers(data.powersDbm, 121).length !== 121) throw new Error('antenna link curve length mismatch')
      const link = record(data.link)
      finite(link.prDbm, 'prDbm'); finite(link.fsplDb, 'fsplDb')
    }
  } else if (input.module === 'laser') {
    if (output.steps !== input.steps || output.dt !== LASER_DT) throw new Error('laser steps or timestep mismatch')
    const state = record(output.state), c = record(output.characteristics)
    finite(state.N, 'N', 0); finite(state.S, 'S', 0)
    for (const name of ['threshold', 'pumpMax', 'steadyPhotons']) finite(c[name], name, 0)
    if (array(c.curve, 51).length !== 51) throw new Error('laser curve length mismatch')
    for (const raw of c.curve as unknown[]) {
      const point = record(raw); finite(point.p, 'curve.p', 0); finite(point.s, 'curve.s', 0)
    }
  } else if (input.module === 'fdtd') {
    if (output.nx !== FDTD_NX || output.ny !== FDTD_NY || output.steps !== input.scene.steps) throw new Error('FDTD field shape or step mismatch')
    finite(output.dt, 'dt', 0, 1 / Math.SQRT2)
    if (output.dt !== COURANT_DEFAULT.value / Math.SQRT2 || numbers(output.Ez, FDTD_NX * FDTD_NY).length !== FDTD_NX * FDTD_NY) throw new Error('invalid FDTD field')
  } else if (input.module === 'optics-lab') {
    const trace = record(output.trace)
    for (const [name, fields] of [
      ['segments', ['x0', 'y0', 'x1', 'y1', 'intensity', 'wavelengthNm']],
      ['hits', ['x', 'y', 'intensity', 'wavelengthNm']],
      ['events', ['x', 'y', 'intensityIn']],
    ] as const) {
      for (const raw of array(trace[name], 20000)) {
        const item = record(raw)
        for (const key of fields) finite(item[key], key)
        if (name !== 'segments') {
          const component = input.components.find(c => c.id === item.componentId)
          if (!component || (name === 'hits' ? item.kind : item.componentKind) !== component.kind) throw new Error('unknown result component')
        }
        if (name === 'events') {
          if (!['reflect', 'refract', 'tir', 'lens', 'polarize', 'split', 'screen', 'block'].includes(String(item.type))) throw new Error('unknown optics event')
          if (item.note !== undefined && typeof item.note !== 'string') throw new Error('event note must be a string')
        }
        for (const key of ['s', 'intensityOut', 'thetaIDeg', 'thetaTDeg']) {
          if (item[key] !== undefined) finite(item[key], key)
        }
      }
    }
    const screenPower = record(trace.screenPower), profileIds = new Set<string>()
    for (const [id, power] of Object.entries(screenPower)) {
      if (!input.components.some(c => c.id === id && c.kind === 'screen')) throw new Error('unknown result screen')
      finite(power, 'screenPower', 0)
    }
    for (const raw of array(trace.profiles, 64)) {
      const p = record(raw)
      if (!input.components.some(c => c.id === p.componentId && c.kind === 'screen')) throw new Error('unknown result screen')
      const id = p.componentId as string
      if (profileIds.has(id) || !Object.prototype.hasOwnProperty.call(screenPower, id)) throw new Error('screen profile and power IDs must agree')
      profileIds.add(id)
      if (numbers(p.bins, SCREEN_BINS).length !== SCREEN_BINS) throw new Error('screen bins length mismatch')
      finite(p.total, 'total', 0); finite(p.peakS, 'peakS', 0, 1); finite(p.peakBin, 'peakBin', 0, SCREEN_BINS - 1)
      if (!Number.isInteger(p.peakBin)) throw new Error('peakBin must be an integer')
    }
    if (profileIds.size !== Object.keys(screenPower).length) throw new Error('screen profile and power IDs must agree')
  } else {
    const obs = record(output.observables)
    if (obs.ok !== true) throw new Error('invalid wave observables')
    const names = input.module === 'sound' ? ['wavelengthM', 'impedance', 'vPeak', 'intensityWm2'] : ['wavelengthM', 'impedance', 'phaseVelocity', 'bPeak', 'intensityWm2']
    // The admitted acoustic extremes yield p²/(2ρc) up to 5e23 W/m².
    for (const name of names) finite(obs[name], name, 0, input.module === 'sound' && name === 'intensityWm2' ? 5e23 : 1e20)
    for (const name of input.module === 'sound' ? ['pressure', 'velocity'] : ['E', 'B']) {
      if (numbers(output[name], 2048).length !== input.xs.length) throw new Error('wave sample length mismatch')
    }
  }
  return output as ModuleComputeOutput
}

export function restoreOpticsTrace(trace: WireTrace): TraceResult {
  return { ...trace, profiles: trace.profiles.map(p => ({ ...p, bins: Float64Array.from(p.bins) })) }
}
