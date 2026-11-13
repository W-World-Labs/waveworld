/**
 * Rollett stability factor K · pure teaching stubs.
 * K = (1 − |S11|² − |S22|² + |Δ|²) / (2 |S12 S21|)
 * with Δ = S11 S22 − S12 S21.
 * Teaching: real Sij (phases 0/π) so |Sij| = |real value|.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Rollett K. */
export const METHOD_ROLLETT = 'method-rollett-k'

/** Algo · Rollett stability factor K. */
export const METHOD_ALGO_ROLLETT_K = 'method-algo-rollett-k'

/** Parent alias (aligns with familyId). */
export const ROLLETT_PARENT = METHOD_ROLLETT

export const ROLLETT_METHOD_IDS = [METHOD_ALGO_ROLLETT_K] as const

/** Default real S-parameters (unconditionally stable toy amp). */
export const DEFAULT_S11 = 0.2
export const DEFAULT_S12 = 0.05
export const DEFAULT_S21 = 2.0
export const DEFAULT_S22 = 0.3

/**
 * Rollett K-factor from real (teaching) S-parameters:
 *   Δ = S11·S22 − S12·S21
 *   K = (1 − |S11|² − |S22|² + |Δ|²) / (2 · |S12·S21|)
 *
 * Unconditional stability requires K>1 and |Δ|<1 (checked by sample).
 * Requires finite Sij and |S12 S21| > 0; else NaN.
 */
export function rollettK(
  S11: number,
  S12: number,
  S21: number,
  S22: number,
): number {
  if (
    !Number.isFinite(S11) ||
    !Number.isFinite(S12) ||
    !Number.isFinite(S21) ||
    !Number.isFinite(S22)
  ) {
    return NaN
  }
  const delta = S11 * S22 - S12 * S21
  const denom = 2 * Math.abs(S12 * S21)
  if (!(denom > 0) || !Number.isFinite(delta)) return NaN
  const num =
    1 - S11 * S11 - S22 * S22 + delta * delta
  return num / denom
}

/**
 * Determinant Δ = S11 S22 − S12 S21 (real teaching).
 */
export function rollettDelta(
  S11: number,
  S12: number,
  S21: number,
  S22: number,
): number {
  if (
    !Number.isFinite(S11) ||
    !Number.isFinite(S12) ||
    !Number.isFinite(S21) ||
    !Number.isFinite(S22)
  ) {
    return NaN
  }
  return S11 * S22 - S12 * S21
}

/**
 * Rollett K sample: formula; |S12 S21|=0 illegal; K>1 for stable toy.
 */
export function runRollettKSample(opts?: {
  S11?: number
  S12?: number
  S21?: number
  S22?: number
}): {
  S11: number
  S12: number
  S21: number
  S22: number
  K: number
  Delta: number
  K_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_ROLLETT_K
  familyId: typeof METHOD_ROLLETT
} {
  const S11 = opts?.S11 ?? DEFAULT_S11
  const S12 = opts?.S12 ?? DEFAULT_S12
  const S21 = opts?.S21 ?? DEFAULT_S21
  const S22 = opts?.S22 ?? DEFAULT_S22

  const K = rollettK(S11, S12, S21, S22)
  const Delta = rollettDelta(S11, S12, S21, S22)
  const K_bad = rollettK(S11, 0, 0, S22)

  const finite = Number.isFinite(K) && Number.isFinite(Delta)

  const deltaExp = S11 * S22 - S12 * S21
  const num = 1 - S11 * S11 - S22 * S22 + deltaExp * deltaExp
  const den = 2 * Math.abs(S12 * S21)
  const expected = num / den
  const formulaOk =
    Math.abs(K - expected) < 1e-12 * Math.max(1, Math.abs(K))
  const deltaOk = Math.abs(Delta - deltaExp) < 1e-18
  const badOk = !Number.isFinite(K_bad)
  // default toy should be unconditionally stable-ish
  const stableOk = K > 1 && Math.abs(Delta) < 1

  const ok = finite && formulaOk && deltaOk && badOk && stableOk

  return {
    S11,
    S12,
    S21,
    S22,
    K,
    Delta,
    K_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_ROLLETT_K,
    familyId: METHOD_ROLLETT,
  }
}
