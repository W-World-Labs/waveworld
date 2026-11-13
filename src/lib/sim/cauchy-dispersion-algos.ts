/**
 * Cauchy dispersion formula · pure teaching stubs.
 * n = A + B / λ²  (λ in µm)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Cauchy dispersion. */
export const METHOD_CAUCHY = 'method-cauchy-dispersion'

/** Algo · refractive index n = A + B/λ². */
export const METHOD_ALGO_CAUCHY_N = 'method-algo-cauchy-n'

/** Parent alias (aligns with familyId). */
export const CAUCHY_PARENT = METHOD_CAUCHY

export const CAUCHY_METHOD_IDS = [METHOD_ALGO_CAUCHY_N] as const

/** Default Cauchy A (dimensionless); glass-class toy. */
export const DEFAULT_A = 1.458

/** Default Cauchy B (µm²). */
export const DEFAULT_B = 0.00354

/** Default wavelength λ (µm). */
export const DEFAULT_LAMBDA = 0.589

/**
 * Cauchy refractive index:
 *   n = A + B / λ²
 *
 * A, B: Cauchy coefficients; λ: wavelength in micrometres (µm).
 * Requires A,B finite, λ≠0; else NaN.
 */
export function cauchyN(A: number, B: number, lambda: number): number {
  if (
    !Number.isFinite(A) ||
    !Number.isFinite(B) ||
    !Number.isFinite(lambda) ||
    lambda === 0
  ) {
    return NaN
  }
  return A + B / (lambda * lambda)
}

/**
 * Cauchy-n sample: n = A + B/λ²; shorter λ ⇒ larger n; λ=0 illegal.
 */
export function runCauchyNSample(opts?: {
  A?: number
  B?: number
  lambda?: number
}): {
  A: number
  B: number
  lambda: number
  n: number
  n_halfLambda: number
  n_longWave: number
  n_badLambda: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_CAUCHY_N
  familyId: typeof METHOD_CAUCHY
} {
  const A = opts?.A ?? DEFAULT_A
  const B = opts?.B ?? DEFAULT_B
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA

  const n = cauchyN(A, B, lambda)
  const n_halfLambda = cauchyN(A, B, lambda / 2)
  // long-wave limit → n → A
  const n_longWave = cauchyN(A, B, 1e6)
  const n_badLambda = cauchyN(A, B, 0)

  const finite =
    Number.isFinite(n) &&
    Number.isFinite(n_halfLambda) &&
    Number.isFinite(n_longWave)

  const expected = A + B / (lambda * lambda)
  const formulaOk =
    Math.abs(n - expected) < 1e-12 * Math.max(1, Math.abs(n))
  // half λ ⇒ B term ×4 ⇒ n_half = A + 4(B/λ²) = A + 4(n−A)
  const halfOk =
    Math.abs(n_halfLambda - (A + 4 * (n - A))) <
    1e-12 * Math.max(1, Math.abs(n_halfLambda))
  const longOk = Math.abs(n_longWave - A) < 1e-6
  const badOk = !Number.isFinite(n_badLambda)
  const dispersionOk = B > 0 ? n_halfLambda > n : true
  const positiveOk = n > 1

  const ok =
    finite &&
    formulaOk &&
    halfOk &&
    longOk &&
    badOk &&
    dispersionOk &&
    positiveOk

  return {
    A,
    B,
    lambda,
    n,
    n_halfLambda,
    n_longWave,
    n_badLambda,
    finite,
    ok,
    methodId: METHOD_ALGO_CAUCHY_N,
    familyId: METHOD_CAUCHY,
  }
}
