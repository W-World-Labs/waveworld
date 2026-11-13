/**
 * Yukawa potential · pure teaching stubs.
 * V(r) = −A · exp(−r/λ) / r
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Yukawa screened potential. */
export const METHOD_YUKAWA = 'method-yukawa-potential'

/** Algo · Yukawa potential V(r). */
export const METHOD_ALGO_YUKAWA_V = 'method-algo-yukawa-v'

/** Parent alias (aligns with familyId). */
export const YUKAWA_PARENT = METHOD_YUKAWA

export const YUKAWA_METHOD_IDS = [METHOD_ALGO_YUKAWA_V] as const

/** Default amplitude A (energy·length units, teaching). */
export const DEFAULT_A = 1

/** Default screening length λ (m). */
export const DEFAULT_LAMBDA = 1

/** Default radius r (m). */
export const DEFAULT_R = 1

/**
 * Yukawa (screened Coulomb) potential:
 *   V = −A · exp(−r / λ) / r
 *
 * A: strength (same units as V·r), r: distance > 0,
 * lambda: screening length > 0.
 * Requires r>0, λ>0, A finite; else NaN.
 */
export function yukawaPotential(
  r: number,
  A: number = DEFAULT_A,
  lambda: number = DEFAULT_LAMBDA,
): number {
  if (
    !Number.isFinite(r) ||
    !Number.isFinite(A) ||
    !Number.isFinite(lambda) ||
    !(r > 0) ||
    !(lambda > 0)
  ) {
    return NaN
  }
  return (-A * Math.exp(-r / lambda)) / r
}

/**
 * Yukawa sample: V = −A e^(−r/λ)/r; attractive for A>0; r≤0 illegal.
 */
export function runYukawaVSample(opts?: {
  r?: number
  A?: number
  lambda?: number
}): {
  r: number
  A: number
  lambda: number
  V: number
  V_doubleR: number
  V_coulombLike: number
  V_badR: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_YUKAWA_V
  familyId: typeof METHOD_YUKAWA
} {
  const r = opts?.r ?? DEFAULT_R
  const A = opts?.A ?? DEFAULT_A
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA

  const V = yukawaPotential(r, A, lambda)
  const V_doubleR = yukawaPotential(2 * r, A, lambda)
  // large λ ⇒ nearly Coulomb −A/r
  const V_coulombLike = yukawaPotential(r, A, 1e12)
  const V_badR = yukawaPotential(0, A, lambda)

  const finite =
    Number.isFinite(V) &&
    Number.isFinite(V_doubleR) &&
    Number.isFinite(V_coulombLike)

  const expected = (-A * Math.exp(-r / lambda)) / r
  const formulaOk =
    Math.abs(V - expected) < 1e-12 * Math.max(1e-30, Math.abs(V))
  const attractiveOk = A > 0 ? V < 0 : true
  // larger r ⇒ |V| smaller for A>0 (less negative / toward zero)
  const decayOk = A > 0 ? V_doubleR > V && V_doubleR < 0 : true
  const coulombOk =
    Math.abs(V_coulombLike - -A / r) < 1e-6 * Math.max(1, Math.abs(A / r))
  const badOk = !Number.isFinite(V_badR)

  const ok = finite && formulaOk && attractiveOk && decayOk && coulombOk && badOk

  return {
    r,
    A,
    lambda,
    V,
    V_doubleR,
    V_coulombLike,
    V_badR,
    finite,
    ok,
    methodId: METHOD_ALGO_YUKAWA_V,
    familyId: METHOD_YUKAWA,
  }
}
