/**
 * Clausius–Clapeyron equation · pure teaching stubs.
 * dP/dT = L / (T · ΔV)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Clausius–Clapeyron phase equilibrium. */
export const METHOD_CC = 'method-clausius-clapeyron'

/** Algo · coexistence slope dP/dT. */
export const METHOD_ALGO_CC_DP_DT = 'method-algo-cc-slope'

/** Parent alias (aligns with familyId). */
export const CC_PARENT = METHOD_CC

export const CC_METHOD_IDS = [METHOD_ALGO_CC_DP_DT] as const

/** Default latent heat L (J/kg or J/mol teaching). */
export const DEFAULT_L = 2.26e6

/** Default temperature T (K). */
export const DEFAULT_T = 373.15

/** Default volume change ΔV (m³/kg teaching). */
export const DEFAULT_DELTA_V = 1.67

/**
 * Clausius–Clapeyron slope (Pa/K teaching):
 *   dP/dT = L / (T · ΔV)
 *
 * L: latent heat, T: absolute temperature (K), deltaV: volume change.
 * Requires T>0, deltaV≠0, finite; else NaN.
 */
export function clausiusClapeyronSlope(
  L: number,
  T: number,
  deltaV: number,
): number {
  if (
    !Number.isFinite(L) ||
    !Number.isFinite(T) ||
    !Number.isFinite(deltaV) ||
    !(T > 0) ||
    deltaV === 0
  ) {
    return NaN
  }
  return L / (T * deltaV)
}

/**
 * CC sample: slope = L/(T ΔV); ∝ L; 1/T; T≤0 or ΔV=0 illegal.
 */
export function runCcSlopeSample(opts?: {
  L?: number
  T?: number
  deltaV?: number
}): {
  L: number
  T: number
  deltaV: number
  dPdT: number
  dPdT_doubleL: number
  dPdT_doubleT: number
  dPdT_badT: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_CC_DP_DT
  familyId: typeof METHOD_CC
} {
  const L = opts?.L ?? DEFAULT_L
  const T = opts?.T ?? DEFAULT_T
  const deltaV = opts?.deltaV ?? DEFAULT_DELTA_V

  const dPdT = clausiusClapeyronSlope(L, T, deltaV)
  const dPdT_doubleL = clausiusClapeyronSlope(2 * L, T, deltaV)
  const dPdT_doubleT = clausiusClapeyronSlope(L, 2 * T, deltaV)
  const dPdT_badT = clausiusClapeyronSlope(L, 0, deltaV)

  const finite =
    Number.isFinite(dPdT) &&
    Number.isFinite(dPdT_doubleL) &&
    Number.isFinite(dPdT_doubleT)

  const expected = L / (T * deltaV)
  const formulaOk =
    Math.abs(dPdT - expected) < 1e-12 * Math.max(1, Math.abs(dPdT))
  const linLOk =
    Math.abs(dPdT_doubleL - 2 * dPdT) < 1e-12 * Math.max(1, Math.abs(dPdT))
  const halfTOk =
    Math.abs(dPdT_doubleT - dPdT / 2) < 1e-12 * Math.max(1, Math.abs(dPdT))
  const badOk = !Number.isFinite(dPdT_badT)
  const positiveOk = dPdT > 0

  const ok = finite && formulaOk && linLOk && halfTOk && badOk && positiveOk

  return {
    L,
    T,
    deltaV,
    dPdT,
    dPdT_doubleL,
    dPdT_doubleT,
    dPdT_badT,
    finite,
    ok,
    methodId: METHOD_ALGO_CC_DP_DT,
    familyId: METHOD_CC,
  }
}
