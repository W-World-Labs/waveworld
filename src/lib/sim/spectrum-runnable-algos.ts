import { WasmOde, WasmPlane } from './wasm-fields'

/**
 * Teaching kernels for #5 / #19: make spectrum catalog pages runnable.
 * Shared Rust/WASM adapters — no DOM.
 *
 *  - EM plane wave: E/B, η, v_p, λ, intensity
 *  - Acoustic plane wave: p/v, Z=ρc, λ, intensity
 *  - Forced damped oscillator: time step + steady-state resonance |X(ω)|
 */

export const C0 = 299_792_458
export const MU0 = 4e-7 * Math.PI
export const EPS0 = 1 / (MU0 * C0 * C0)
/** Free-space impedance η₀ ≈ 376.73 Ω */
export const ETA0 = Math.sqrt(MU0 / EPS0)

export const EM_WAVE3D_SAMPLES = 140, EM_WAVE3D_RANGE = 14
export interface EmWave3DParams { waveNumber: number; amplitude: number; time: number }

/** Reduced c=1 plane wave along +z. Display c*Bx=-Ey so E×H points +z. */
export function createEmWave3D(p: EmWave3DParams) {
  const run = new WasmPlane('emwave3d', EM_WAVE3D_SAMPLES)
  run.parameters.set([p.waveNumber, p.amplitude, p.time])
  return run
}
export function readEmWave3D(run: WasmPlane) {
  run.read()
  return { z: Array.from(run.positions), ey: Array.from(run.first), cbx: Array.from(run.second), wavelength: run.readout[0] }
}
export function emWave3DResult(p: EmWave3DParams) { return readEmWave3D(createEmWave3D(p)) }

// ─── EM traveling wave ─────────────────────────────────────────────────────

export type EmPlaneWaveParams = {
  /** Frequency (Hz). */
  frequencyHz: number
  /** Relative refractive index n ≥ 1 (non-magnetic teaching: ε_r = n²). */
  refractiveIndex: number
  /** Peak E field (V/m). */
  ePeak: number
  /** Phase at x=0,t=0 (rad). */
  phase0?: number
}

export type EmPlaneWaveObservables = {
  wavelengthM: number
  phaseVelocity: number
  impedance: number
  bPeak: number
  intensityWm2: number
  ok: boolean
}

export function createEmPlaneWave(p: EmPlaneWaveParams, xs: ArrayLike<number> = []) {
  const run = new WasmPlane('electromagnetic', xs.length)
  run.parameters.set([p.frequencyHz, p.refractiveIndex, p.ePeak, p.phase0 ?? 0]); run.positions.set(xs)
  return run
}
export function readEmPlaneWave(run: WasmPlane): EmPlaneWaveObservables {
  const [wavelengthM, phaseVelocity, impedance, bPeak, intensityWm2] = run.read()
  return { wavelengthM, phaseVelocity, impedance, bPeak, intensityWm2, ok: true }
}
export function emPlaneWaveObservables(p: EmPlaneWaveParams): EmPlaneWaveObservables {
  return readEmPlaneWave(createEmPlaneWave(p))
}
/** E along y, B along z, propagation +x; both samples are owned FP64 WASM views. */
export function sampleEmPlaneWave(p: EmPlaneWaveParams, t: number, xs: Float64Array | number[]) {
  const run = createEmPlaneWave(p, xs); run.sample(t)
  return { E: run.first, B: run.second, ok: true }
}

// ─── Acoustic traveling wave ───────────────────────────────────────────────

export type AcousticMedium = {
  /** Density ρ (kg/m³). */
  rho: number
  /** Sound speed c (m/s). */
  c: number
}

export type AcousticPlaneWaveParams = AcousticMedium & {
  frequencyHz: number
  /** Peak pressure (Pa). */
  pPeak: number
  phase0?: number
}

export type AcousticPlaneWaveObservables = {
  wavelengthM: number
  impedance: number
  vPeak: number
  intensityWm2: number
  ok: boolean
}

export function createAcousticPlaneWave(p: AcousticPlaneWaveParams, xs: ArrayLike<number> = []) {
  const run = new WasmPlane('sound', xs.length)
  run.parameters.set([p.frequencyHz, p.rho, p.c, p.pPeak, p.phase0 ?? 0]); run.positions.set(xs)
  return run
}
export function readAcousticPlaneWave(run: WasmPlane): AcousticPlaneWaveObservables {
  const [wavelengthM, impedance, vPeak, intensityWm2] = run.read()
  return { wavelengthM, impedance, vPeak, intensityWm2, ok: true }
}
export function acousticPlaneWaveObservables(p: AcousticPlaneWaveParams): AcousticPlaneWaveObservables {
  return readAcousticPlaneWave(createAcousticPlaneWave(p))
}
/** Samples share the same Rust core as native jobs; callers can reuse a scene owner. */
export function sampleAcousticPlaneWave(p: AcousticPlaneWaveParams, t: number, xs: Float64Array | number[]) {
  const run = createAcousticPlaneWave(p, xs); run.sample(t)
  return { pressure: run.first, velocity: run.second, ok: true }
}

// ─── Forced damped harmonic oscillator ─────────────────────────────────────

export type ForcedOscillatorParams = {
  mass: number
  stiffness: number
  /** Viscous damping coefficient c (N·s/m). */
  damping: number
  driveAmp: number
  driveOmega: number
}

export type ForcedOscillatorState = { x: number; v: number }

export const VIBRATION_DT = 1 / 240
export const VIBRATION_RESONANCE_SAMPLES = 80
export type VibrationScene = {
  mass: number; stiffness: number; damping: number; driveFrequency: number; steps: number
}

function oscillatorKernel(state: ForcedOscillatorState, p: ForcedOscillatorParams, dt: number, steps = 0, curvePoints = 0) {
  return new WasmOde({ kind: 'vibration', parameters: [p.mass, p.stiffness, p.damping, p.driveAmp, p.driveOmega, dt],
    initial: [state.x, state.v], capacity: steps, curvePoints })
}
export function createVibrationScene(scene: VibrationScene) {
  return oscillatorKernel({ x: 0, v: 0 }, { mass: scene.mass, stiffness: scene.stiffness, damping: scene.damping,
    driveAmp: 1, driveOmega: 2 * Math.PI * scene.driveFrequency }, VIBRATION_DT, scene.steps, VIBRATION_RESONANCE_SAMPLES)
}
export function readVibrationScene(run: WasmOde) {
  const read = run.read(), omega0 = read[0], amplitude = read[1]
  const resonance = run.resonance(Math.max(0.1, omega0 * 0.2), omega0 * 2.5)
  return { steps: run.completed, dt: VIBRATION_DT, time: run.completed * VIBRATION_DT,
    states: Array.from({ length: run.completed + 1 }, (_, i) => ({ x: run.values[2 * i], v: run.values[2 * i + 1] })),
    omega0, amplitude, resonance: { omega: Array.from(resonance.omega), amplitude: Array.from(resonance.amp) } }
}
export function vibrationResult(scene: VibrationScene) {
  const run = createVibrationScene(scene); run.advance(scene.steps)
  return readVibrationScene(run)
}
/** Existing pure helper now invokes the shared Rust RK4 stages and drive. */
export function forcedOscillatorStep(state: ForcedOscillatorState, p: ForcedOscillatorParams, t: number, dt: number): ForcedOscillatorState {
  const run = oscillatorKernel(state, p, dt); run.step(t)
  return { x: run.state[0], v: run.state[1] }
}
export function forcedOscillatorAmplitude(p: ForcedOscillatorParams, driveOmega: number = p.driveOmega): number {
  return oscillatorKernel({ x: 0, v: 0 }, p, 1).oscillatorAmplitude(driveOmega)
}
export function forcedOscillatorOmega0(mass: number, stiffness: number): number {
  return oscillatorKernel({ x: 0, v: 0 }, { mass, stiffness, damping: 0, driveAmp: 0, driveOmega: 0 }, 1).oscillatorOmega0(mass, stiffness)
}
export function forcedOscillatorResonanceCurve(p: ForcedOscillatorParams, omegaMin: number, omegaMax: number, n: number): { omega: Float64Array; amp: Float64Array; ok: boolean } {
  return oscillatorKernel({ x: 0, v: 0 }, p, 1, 0, n).resonance(omegaMin, omegaMax)
}
