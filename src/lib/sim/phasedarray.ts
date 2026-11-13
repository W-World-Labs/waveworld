// Uniform linear-array calculations from the shared FP64 Rust kernel.
import { WasmAntenna } from './wasm-fields'

function configure(run: WasmAntenna, n: number, d: number, steer: number) {
  if (!Number.isInteger(n) || n < 0 || n > 4096) throw new Error('Invalid array element count')
  run.parameters.set([d, steer]); run.config.setUint32(16, n, true)
}
function samples(count: number) {
  if (!Number.isFinite(count)) throw new Error('Invalid array sample count')
  return Math.max(2, Math.floor(count))
}
function points(values: Float64Array) {
  return Array.from({ length: values.length / 2 }, (_, i) => ({ theta: values[2 * i], gain: values[2 * i + 1] }))
}
/** Sum the element phasors; the kernel preserves the existing summation order. */
export function arrayFactor(thetaDeg: number, N: number, dOverLambda: number, steerDeg: number): number {
  const run = new WasmAntenna('phasedarray', 2); configure(run, N, dOverLambda, steerDeg)
  return run.arrayFactor(thetaDeg)
}
export function pattern(N: number, dOverLambda: number, steerDeg: number, count: number): { theta: number; gain: number }[] {
  const run = new WasmAntenna('phasedarray', samples(count)); configure(run, N, dOverLambda, steerDeg)
  return points(run.arrayPattern())
}
/** Width of the steered lobe in the visible interval, including clipped lobes. */
export function beamwidth3dB(N: number, dOverLambda: number, steerDeg: number, count = 2001): number {
  const run = new WasmAntenna('phasedarray', samples(count)); configure(run, N, dOverLambda, steerDeg)
  return run.arrayBeamwidth()
}
export function gratingLobes(dOverLambda: number, steerDeg: number): number[] {
  return Array.from(new WasmAntenna('phasedarray', 2).gratingLobes(dOverLambda, steerDeg))
}
export interface PhasedArrayParams { n: number; dOverLambda: number; steerDeg: number }
export function phasedArrayResult(p: PhasedArrayParams, run = new WasmAntenna('phasedarray')) {
  configure(run, p.n, p.dOverLambda, p.steerDeg)
  const [beamwidthDeg, clipped, count] = run.read()
  return { pattern: points(run.pattern), phases: Array.from(run.phases.subarray(0, p.n)),
    beamwidthDeg, beamwidthClipped: !!clipped, grating: Array.from(run.grating.subarray(0, count)) }
}
