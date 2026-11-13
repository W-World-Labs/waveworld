/**
 * Meissner expulsion + BCS gap · pure teaching stubs.
 * B_in = B0 · exp(−x/λ);  Δ(T) ≈ Δ0 · √(1 − (T/Tc)²).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Meissner field expulsion. */
export const METHOD_MEISSNER = 'method-meissner'

/** Algo · exponential field expulsion B_in = B0 exp(−x/λ). */
export const METHOD_ALGO_MEISSNER_B = 'method-algo-meissner-expel'

/** Family · BCS superconducting gap. */
export const METHOD_BCS = 'method-bcs-gap'

/** Algo · approximate gap Δ(T). */
export const METHOD_ALGO_BCS_GAP = 'method-algo-bcs-gap'

/** Parent aliases. */
export const MEISSNER_PARENT = METHOD_MEISSNER
export const BCS_PARENT = METHOD_BCS

export const MEISSNER_METHOD_IDS = [METHOD_ALGO_MEISSNER_B] as const
export const BCS_METHOD_IDS = [METHOD_ALGO_BCS_GAP] as const

export const MEISSNER_BCS_METHOD_IDS = [
  METHOD_ALGO_MEISSNER_B,
  METHOD_ALGO_BCS_GAP,
] as const

/** Default external field B0 (T). */
export const DEFAULT_B0 = 0.01

/** Default depth x (m). */
export const DEFAULT_X = 1e-7

/** Default London penetration depth λ (m). */
export const DEFAULT_LAMBDA = 1e-7

/** Default gap amplitude Δ0 (eV teaching units). */
export const DEFAULT_DELTA0 = 1.5e-3

/** Default temperature T (K). */
export const DEFAULT_T = 4

/** Default critical temperature Tc (K). */
export const DEFAULT_TC = 9.2

/**
 * Meissner / London-like expelled field at depth x (T):
 *   B_in = B0 · exp(−x / λ)
 *
 * B0: external field (T), x: depth (m), λ: penetration depth (m).
 * Requires λ>0, finite; else NaN.
 */
export function meissnerField(
  B0: number,
  x: number,
  lambda: number,
): number {
  if (
    !Number.isFinite(B0) ||
    !Number.isFinite(x) ||
    !Number.isFinite(lambda) ||
    !(lambda > 0)
  ) {
    return NaN
  }
  return B0 * Math.exp(-x / lambda)
}

/**
 * Approximate BCS gap (teaching units):
 *   Δ(T) ≈ Δ0 · √(1 − (T/Tc)²)   for 0 ≤ T ≤ Tc
 *
 * Requires Δ0 finite, Tc>0, 0 ≤ T ≤ Tc; else NaN.
 * At T=0 ⇒ Δ0; at T=Tc ⇒ 0.
 */
export function bcsGap(delta0: number, T: number, Tc: number): number {
  if (
    !Number.isFinite(delta0) ||
    !Number.isFinite(T) ||
    !Number.isFinite(Tc) ||
    !(Tc > 0) ||
    !(T >= 0) ||
    !(T <= Tc)
  ) {
    return NaN
  }
  const r = T / Tc
  return delta0 * Math.sqrt(1 - r * r)
}

/**
 * Meissner sample: B_in = B0 e^{−x/λ}; deeper ⇒ smaller; λ≤0 illegal.
 */
export function runMeissnerBSample(opts?: {
  B0?: number
  x?: number
  lambda?: number
}): {
  B0: number
  x: number
  lambda: number
  Bin: number
  Bin_doubleX: number
  Bin_surface: number
  Bin_badLambda: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MEISSNER_B
  familyId: typeof METHOD_MEISSNER
} {
  const B0 = opts?.B0 ?? DEFAULT_B0
  const x = opts?.x ?? DEFAULT_X
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA

  const Bin = meissnerField(B0, x, lambda)
  const Bin_doubleX = meissnerField(B0, 2 * x, lambda)
  const Bin_surface = meissnerField(B0, 0, lambda)
  const Bin_badLambda = meissnerField(B0, x, 0)

  const finite =
    Number.isFinite(Bin) &&
    Number.isFinite(Bin_doubleX) &&
    Number.isFinite(Bin_surface)

  const expected = B0 * Math.exp(-x / lambda)
  const formulaOk =
    Math.abs(Bin - expected) < 1e-12 * Math.max(1e-30, Math.abs(Bin))
  const deeperOk = Math.abs(Bin_doubleX) < Math.abs(Bin) || Bin === 0
  const surfaceOk =
    Math.abs(Bin_surface - B0) < 1e-12 * Math.max(1e-30, Math.abs(B0))
  const badOk = !Number.isFinite(Bin_badLambda)
  const positiveOk = B0 > 0 && x >= 0 ? Bin > 0 : true

  const ok =
    finite && formulaOk && deeperOk && surfaceOk && badOk && positiveOk

  return {
    B0,
    x,
    lambda,
    Bin,
    Bin_doubleX,
    Bin_surface,
    Bin_badLambda,
    finite,
    ok,
    methodId: METHOD_ALGO_MEISSNER_B,
    familyId: METHOD_MEISSNER,
  }
}

/**
 * BCS gap sample: Δ(T) ≈ Δ0 √(1−(T/Tc)²); T=0 ⇒ Δ0; T=Tc ⇒ 0; T>Tc illegal.
 */
export function runBcsGapSample(opts?: {
  delta0?: number
  T?: number
  Tc?: number
}): {
  delta0: number
  T: number
  Tc: number
  Delta: number
  Delta_T0: number
  Delta_Tc: number
  Delta_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BCS_GAP
  familyId: typeof METHOD_BCS
} {
  const delta0 = opts?.delta0 ?? DEFAULT_DELTA0
  const T = opts?.T ?? DEFAULT_T
  const Tc = opts?.Tc ?? DEFAULT_TC

  const Delta = bcsGap(delta0, T, Tc)
  const Delta_T0 = bcsGap(delta0, 0, Tc)
  const Delta_Tc = bcsGap(delta0, Tc, Tc)
  const Delta_bad = bcsGap(delta0, Tc + 1, Tc)

  const finite =
    Number.isFinite(Delta) &&
    Number.isFinite(Delta_T0) &&
    Number.isFinite(Delta_Tc)

  const r = T / Tc
  const expected = delta0 * Math.sqrt(1 - r * r)
  const formulaOk =
    Math.abs(Delta - expected) < 1e-12 * Math.max(1e-30, Math.abs(Delta))
  const t0Ok =
    Math.abs(Delta_T0 - delta0) < 1e-12 * Math.max(1e-30, Math.abs(delta0))
  const tcOk = Math.abs(Delta_Tc) < 1e-30
  const badOk = !Number.isFinite(Delta_bad)
  const positiveOk = delta0 > 0 && T < Tc ? Delta > 0 : true
  const monoOk = Delta < Delta_T0 || Math.abs(T) < 1e-30

  const ok =
    finite && formulaOk && t0Ok && tcOk && badOk && positiveOk && monoOk

  return {
    delta0,
    T,
    Tc,
    Delta,
    Delta_T0,
    Delta_Tc,
    Delta_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_BCS_GAP,
    familyId: METHOD_BCS,
  }
}
