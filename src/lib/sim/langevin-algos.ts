/**
 * Langevin function · pure teaching stubs.
 * L(x) = coth(x) − 1/x  (paramagnetism / rubber elasticity teaching).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Langevin response. */
export const METHOD_LANGEVIN = 'method-langevin'

/** Algo · Langevin function L(x). */
export const METHOD_ALGO_LANGEVIN_L = 'method-algo-langevin-l'

/** Parent alias (aligns with familyId). */
export const LANGEVIN_PARENT = METHOD_LANGEVIN

export const LANGEVIN_METHOD_IDS = [METHOD_ALGO_LANGEVIN_L] as const

/** Default argument x (dimensionless). */
export const DEFAULT_X = 1

/** |x| below this uses series L(x) ≈ x/3 − x³/45 to avoid 0/0. */
const NEAR_ZERO = 1e-8

/**
 * Langevin function:
 *   L(x) = coth(x) − 1/x
 *
 * Odd function; L(0) = 0 via series; |L| → 1 as |x| → ∞.
 * Non-finite x → NaN.
 */
export function langevinL(x: number): number {
  if (!Number.isFinite(x)) return NaN
  const ax = Math.abs(x)
  if (ax < NEAR_ZERO) {
    // L(x) = x/3 − x³/45 + O(x⁵)
    const x2 = x * x
    return x * (1 / 3 - x2 / 45)
  }
  // |x| ≳ 20: tanh saturates; coth(x) → sign(x)
  if (ax > 20) {
    return Math.sign(x) * (1 - 1 / ax)
  }
  // coth(x) = 1/tanh(x)
  return 1 / Math.tanh(x) - 1 / x
}

/**
 * Langevin sample: L formula; odd; small-x series; large-x → ±1.
 */
export function runLangevinLSample(opts?: { x?: number }): {
  x: number
  L: number
  L_neg: number
  L_zero: number
  L_large: number
  L_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_LANGEVIN_L
  familyId: typeof METHOD_LANGEVIN
} {
  const x = opts?.x ?? DEFAULT_X

  const L = langevinL(x)
  const L_neg = langevinL(-x)
  const L_zero = langevinL(0)
  const L_large = langevinL(1e6)
  const L_bad = langevinL(NaN)

  const finite =
    Number.isFinite(L) &&
    Number.isFinite(L_neg) &&
    Number.isFinite(L_zero) &&
    Number.isFinite(L_large)

  const expected = 1 / Math.tanh(x) - 1 / x
  const formulaOk =
    Math.abs(L - expected) < 1e-12 * Math.max(1, Math.abs(L))
  const oddOk = Math.abs(L_neg + L) < 1e-12 * Math.max(1, Math.abs(L))
  const zeroOk = Math.abs(L_zero) < 1e-18
  const largeOk = Math.abs(L_large - 1) < 1e-5
  const badOk = !Number.isFinite(L_bad)
  const boundOk = Math.abs(L) < 1

  const ok =
    finite && formulaOk && oddOk && zeroOk && largeOk && badOk && boundOk

  return {
    x,
    L,
    L_neg,
    L_zero,
    L_large,
    L_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_LANGEVIN_L,
    familyId: METHOD_LANGEVIN,
  }
}
