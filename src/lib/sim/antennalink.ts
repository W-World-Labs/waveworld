// Shared Rust/WASM antenna patterns and Friis link budget; no DOM.
import { WasmAntenna } from './wasm-fields'

export type AntennaType = 'isotropic' | 'dipole' | 'directional'
const TYPES: AntennaType[] = ['isotropic', 'dipole', 'directional']
function kind(type: AntennaType) {
  const value = TYPES.indexOf(type)
  if (value < 0) throw new Error('Invalid antenna type')
  return value
}

/** Normalized field amplitude; dipole peaks broadside, directional peaks on axis. */
export function pattern2D(type: AntennaType, thetaRad: number, run = new WasmAntenna('antenna3d')): number {
  return run.patternAt(kind(type), thetaRad)
}
export function directivityDb(type: AntennaType): number {
  return new WasmAntenna('antenna3d').directivity(kind(type))
}
/** Half-power width from the existing fixed-step scan. */
export function beamwidth3dB(type: AntennaType): number {
  return new WasmAntenna('antenna3d').beamwidth(kind(type))
}
export function friisLink(ptDbm: number, gtDbi: number, grDbi: number, freqHz: number, distM: number): { prDbm: number; fsplDb: number } {
  const run = new WasmAntenna('antenna3d')
  run.parameters.set([ptDbm, gtDbi, grDbi, freqHz, distM])
  const [prDbm, fsplDb] = run.friis()
  return { prDbm, fsplDb }
}

export interface AntennaLinkParams {
  type: AntennaType; ptDbm: number; gtDbi: number; grDbi: number; frequencyHz: number; distM: number
}
export function antennaLinkResult(p: AntennaLinkParams, run = new WasmAntenna('antennapattern')) {
  run.parameters.set([p.ptDbm, p.gtDbi, p.grDbi, p.frequencyHz, p.distM])
  run.config.setUint32(40, kind(p.type), true)
  const [directivityDb, beamwidthDeg, prDbm, fsplDb] = run.read()
  return { pattern: Array.from(run.pattern), powersDbm: Array.from(run.powers), directivityDb, beamwidthDeg, link: { prDbm, fsplDb } }
}
