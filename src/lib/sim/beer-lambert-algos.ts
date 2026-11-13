/**
 * Beer–Lambert law · pure teaching stubs.
 * A = ε · c · L; T = 10^(−A); also I/I0 = exp(−μ L).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Beer–Lambert absorption. */
export const METHOD_BEER = 'method-beer-lambert'

/** Algo · absorbance A = ε c L (+ transmittance helpers). */
export const METHOD_ALGO_BEER_ABSORBANCE = 'method-algo-beer-absorbance'

/** Parent alias (aligns with familyId). */
export const BEER_PARENT = METHOD_BEER

export const BEER_METHOD_IDS = [METHOD_ALGO_BEER_ABSORBANCE] as const

/** Default molar absorptivity ε (L/(mol·cm) teaching). */
export const DEFAULT_EPS = 1e4

/** Default concentration c (mol/L). */
export const DEFAULT_C = 1e-4

/** Default path length L (cm). */
export const DEFAULT_L = 1

/**
 * Beer–Lambert absorbance (dimensionless teaching):
 *   A = ε · c · L
 *
 * ε: molar absorptivity, c: concentration, L: path length.
 * Non-finite inputs → NaN.
 */
export function beerAbsorbance(eps: number, c: number, L: number): number {
  if (!Number.isFinite(eps) || !Number.isFinite(c) || !Number.isFinite(L)) {
    return NaN
  }
  return eps * c * L
}

/**
 * Transmittance from absorbance (common-log form):
 *   T = 10^(−A)
 *
 * Requires finite A; T ∈ (0, 1] for A ≥ 0.
 */
export function transmittanceFromA(A: number): number {
  if (!Number.isFinite(A)) return NaN
  return 10 ** -A
}

/**
 * Exponential attenuation (natural form):
 *   I/I0 = exp(−μ L)
 *
 * μ: linear attenuation coefficient (1/length), L: path length.
 * Requires finite inputs; else NaN.
 */
export function transmittanceExp(mu: number, L: number): number {
  if (!Number.isFinite(mu) || !Number.isFinite(L)) return NaN
  return Math.exp(-mu * L)
}

/**
 * Convert absorbance A to equivalent μ via A = (μ L)/ln(10):
 *   μ = A · ln(10) / L   (when L>0)
 */
export function muFromAbsorbance(A: number, L: number): number {
  if (!Number.isFinite(A) || !Number.isFinite(L) || !(L > 0)) return NaN
  return (A * Math.LN10) / L
}

/**
 * Beer sample: A=εcL; T=10^(−A); exp form; A=0 ⇒ T=1; doubles with L.
 */
export function runBeerAbsorbanceSample(opts?: {
  eps?: number
  c?: number
  L?: number
}): {
  eps: number
  c: number
  L: number
  A: number
  T: number
  A_doubleL: number
  T_zeroA: number
  T_exp: number
  mu: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BEER_ABSORBANCE
  familyId: typeof METHOD_BEER
} {
  const eps = opts?.eps ?? DEFAULT_EPS
  const c = opts?.c ?? DEFAULT_C
  const L = opts?.L ?? DEFAULT_L

  const A = beerAbsorbance(eps, c, L)
  const T = transmittanceFromA(A)
  const A_doubleL = beerAbsorbance(eps, c, 2 * L)
  const T_zeroA = transmittanceFromA(0)
  const mu = muFromAbsorbance(A, L)
  const T_exp = transmittanceExp(mu, L)

  const finite =
    Number.isFinite(A) &&
    Number.isFinite(T) &&
    Number.isFinite(A_doubleL) &&
    Number.isFinite(T_zeroA) &&
    Number.isFinite(mu) &&
    Number.isFinite(T_exp)

  const formulaOk = Math.abs(A - eps * c * L) < 1e-18 * Math.max(1, Math.abs(A))
  const TOk = Math.abs(T - 10 ** -A) < 1e-12 * Math.max(1e-30, T)
  const doubleOk =
    Math.abs(A_doubleL - 2 * A) < 1e-18 * Math.max(1, Math.abs(A))
  const zeroAOk = Math.abs(T_zeroA - 1) < 1e-15
  // 10^(−A) ≈ exp(−μ L) with μ = A ln(10)/L
  const expMatch =
    Math.abs(T_exp - T) < 1e-10 * Math.max(1e-30, Math.abs(T))
  const rangeOk = A > 0 && T > 0 && T < 1

  const ok =
    finite && formulaOk && TOk && doubleOk && zeroAOk && expMatch && rangeOk

  return {
    eps,
    c,
    L,
    A,
    T,
    A_doubleL,
    T_zeroA,
    T_exp,
    mu,
    finite,
    ok,
    methodId: METHOD_ALGO_BEER_ABSORBANCE,
    familyId: METHOD_BEER,
  }
}
