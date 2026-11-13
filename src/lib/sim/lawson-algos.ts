/**
 * Lawson criterion · pure teaching stubs.
 * n·τ and triple product n·T·τ (fusion ignition teaching).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Lawson fusion criterion. */
export const METHOD_LAWSON = 'method-lawson-criterion'

/** Algo · Lawson nτ product + triple product nTτ. */
export const METHOD_ALGO_LAWSON_NTT = 'method-algo-lawson-ntt'

/** Parent alias (aligns with familyId). */
export const LAWSON_PARENT = METHOD_LAWSON

export const LAWSON_METHOD_IDS = [METHOD_ALGO_LAWSON_NTT] as const

/** Default ion density n (m⁻³); dense-plasma toy. */
export const DEFAULT_N = 1e20

/** Default confinement time τ (s). */
export const DEFAULT_TAU = 1

/** Default ion temperature T (keV or K-unit agnostic teaching). */
export const DEFAULT_T = 10

/**
 * Lawson n·τ product (s/m³ or density·time units):
 *   nτ = n · τ
 *
 * Requires n≥0, τ≥0, finite; else NaN.
 */
export function lawsonNTau(n: number, tau: number): number {
  if (
    !Number.isFinite(n) ||
    !Number.isFinite(tau) ||
    !(n >= 0) ||
    !(tau >= 0)
  ) {
    return NaN
  }
  return n * tau
}

/**
 * Fusion triple product (teaching form):
 *   nTτ = n · T · τ
 *
 * Requires n≥0, T≥0, τ≥0, finite; else NaN.
 */
export function tripleProduct(n: number, T: number, tau: number): number {
  if (
    !Number.isFinite(n) ||
    !Number.isFinite(T) ||
    !Number.isFinite(tau) ||
    !(n >= 0) ||
    !(T >= 0) ||
    !(tau >= 0)
  ) {
    return NaN
  }
  return n * T * tau
}

/**
 * Lawson sample: nτ and nTτ; ∝ n, τ, T; negatives illegal.
 */
export function runLawsonNttSample(opts?: {
  n?: number
  T?: number
  tau?: number
}): {
  n: number
  T: number
  tau: number
  nTau: number
  nTTau: number
  nTau_doubleN: number
  nTTau_doubleT: number
  nTau_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_LAWSON_NTT
  familyId: typeof METHOD_LAWSON
} {
  const n = opts?.n ?? DEFAULT_N
  const T = opts?.T ?? DEFAULT_T
  const tau = opts?.tau ?? DEFAULT_TAU

  const nTau = lawsonNTau(n, tau)
  const nTTau = tripleProduct(n, T, tau)
  const nTau_doubleN = lawsonNTau(2 * n, tau)
  const nTTau_doubleT = tripleProduct(n, 2 * T, tau)
  const nTau_bad = lawsonNTau(-1, tau)

  const finite =
    Number.isFinite(nTau) &&
    Number.isFinite(nTTau) &&
    Number.isFinite(nTau_doubleN) &&
    Number.isFinite(nTTau_doubleT)

  const nTauOk = Math.abs(nTau - n * tau) < 1e-12 * Math.max(1, nTau)
  const tripleOk =
    Math.abs(nTTau - n * T * tau) < 1e-12 * Math.max(1, nTTau)
  const linNOk =
    Math.abs(nTau_doubleN - 2 * nTau) < 1e-12 * Math.max(1, nTau)
  const linTOk =
    Math.abs(nTTau_doubleT - 2 * nTTau) < 1e-12 * Math.max(1, nTTau)
  const badOk = !Number.isFinite(nTau_bad)
  const positiveOk = nTau > 0 && nTTau > 0

  const ok =
    finite && nTauOk && tripleOk && linNOk && linTOk && badOk && positiveOk

  return {
    n,
    T,
    tau,
    nTau,
    nTTau,
    nTau_doubleN,
    nTTau_doubleT,
    nTau_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_LAWSON_NTT,
    familyId: METHOD_LAWSON,
  }
}
