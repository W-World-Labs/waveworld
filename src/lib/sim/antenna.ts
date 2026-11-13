// Shared Rust/WASM half-wave dipole and ideal far-field link.
import { pattern2D, friisLink } from './antennalink'
import { WasmAntenna } from './wasm-fields'

export function dipoleFieldPattern(thetaRad: number): number { return pattern2D('dipole', thetaRad) }
export function dipolePowerPattern(thetaRad: number, run = new WasmAntenna('antenna3d')): number { return run.dipolePower(thetaRad) }
export function freeSpacePathLoss(freqHz: number, distM: number): number { return friisLink(0, 0, 0, freqHz, distM).fsplDb }
export function friisReceivedDbm(ptDbm: number, gtDbi: number, grDbi: number, freqHz: number, distM: number): number {
  return friisLink(ptDbm, gtDbi, grDbi, freqHz, distM).prDbm
}
export function polarizationLoss(mismatchRad: number): number { return new WasmAntenna('antenna3d').polarization(mismatchRad) }

export const ANTENNA_POLAR_SEGMENTS = 48
export interface Antenna3DParams {
  frequencyHz: number; ptDbm: number; distM: number; elevationDeg: number; polarizationDeg: number
}
/** null dBm denotes ideal zero received power, including orthogonal polarization. */
export function antenna3DResult(p: Antenna3DParams, run = new WasmAntenna('antenna3d')) {
  run.parameters.set([p.frequencyHz, p.ptDbm, p.distM, p.elevationDeg, p.polarizationDeg])
  const [pr, fsplDb, plf, defined] = run.read()
  return { prDbm: defined ? pr : null, fsplDb, plf, pattern: Array.from(run.pattern) }
}
