// Numeric per-particle interactions; the shared Rust core owns force evaluation.
import { computeMdForces } from './wasm-fields'

export interface ScreeningParams { epsR: number; lambdaD: number; kCoulomb: number }

/** Heterogeneous shifted LJ + screened Coulomb in a periodic box. */
export function computeChargedForces(
  pos: Float32Array, charge: Float32Array, L: number, N: number, dim: number, rc: number,
  params: ScreeningParams, sigma?: Float32Array, eps?: Float32Array,
): { force: Float32Array; potential: number; virial: number } {
  if ((sigma === undefined) !== (eps === undefined)) throw new Error('Both sigma and epsilon arrays are required for a particle mixture')
  const uniform = sigma ? undefined : new Float32Array(N).fill(1)
  return computeMdForces(pos, L, N, dim, rc, { ...params, charge, sigma: sigma ?? uniform!, eps: eps ?? uniform! })
}
