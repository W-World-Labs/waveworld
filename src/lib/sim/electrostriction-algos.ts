/**
 * Electrostriction · pure teaching stub.
 * Strain s = Q · E² (electrostrictive coefficient Q).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · electrostriction. */
export const METHOD_ELECTROSTRICT = 'method-electrostriction'

/** Algo · electrostrictive strain s = Q E². */
export const METHOD_ALGO_ELECTROSTRICT_STRAIN = 'method-algo-electrostrict-strain'

/** Parent alias (aligns with familyId). */
export const ELECTROSTRICT_PARENT = METHOD_ELECTROSTRICT

export const ELECTROSTRICT_METHOD_IDS = [
  METHOD_ALGO_ELECTROSTRICT_STRAIN,
] as const

/** Default electrostrictive coefficient Q (m²/V² teaching). */
export const DEFAULT_Q = 1e-18

/** Default electric field E (V/m). */
export const DEFAULT_E = 1e6

/**
 * Electrostrictive strain (even in E):
 *   s = Q · E²
 *
 * Q: electrostrictive coefficient (m²/V² teaching),
 * E: electric field (V/m). Strain ≥ 0 for Q>0; independent of E sign.
 * Non-finite → NaN.
 */
export function electrostrictStrain(Q: number, E: number): number {
  if (!Number.isFinite(Q) || !Number.isFinite(E)) return NaN
  return Q * E * E
}

/**
 * Electrostriction sample: Q=1e-18, E=1e6 → s=1e-6;
 * even in E; zero at E=0; scales as E².
 */
export function runElectrostrictStrainSample(opts?: {
  Q?: number
  E?: number
}): {
  Q: number
  E: number
  strain: number
  strain_negE: number
  strain_doubleE: number
  strain_zero: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_ELECTROSTRICT_STRAIN
  familyId: typeof METHOD_ELECTROSTRICT
} {
  const Q = opts?.Q ?? DEFAULT_Q
  const E = opts?.E ?? DEFAULT_E

  const strain = electrostrictStrain(Q, E)
  const strain_negE = electrostrictStrain(Q, -E)
  const strain_doubleE = electrostrictStrain(Q, 2 * E)
  const strain_zero = electrostrictStrain(Q, 0)

  const finite =
    Number.isFinite(strain) &&
    Number.isFinite(strain_negE) &&
    Number.isFinite(strain_doubleE) &&
    Number.isFinite(strain_zero)

  const formulaOk =
    Math.abs(strain - Q * E * E) < 1e-18 * Math.max(1, Math.abs(strain))
  const evenOk =
    Math.abs(strain_negE - strain) < 1e-18 * Math.max(1, Math.abs(strain))
  const quadOk =
    Math.abs(strain_doubleE - 4 * strain) <
    1e-18 * Math.max(1, Math.abs(strain))
  const zeroOk = Math.abs(strain_zero) < 1e-30
  const posOk = Q > 0 ? strain > 0 : true

  const ok = finite && formulaOk && evenOk && quadOk && zeroOk && posOk

  return {
    Q,
    E,
    strain,
    strain_negE,
    strain_doubleE,
    strain_zero,
    finite,
    ok,
    methodId: METHOD_ALGO_ELECTROSTRICT_STRAIN,
    familyId: METHOD_ELECTROSTRICT,
  }
}
