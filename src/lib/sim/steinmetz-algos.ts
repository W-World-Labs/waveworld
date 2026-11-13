/**
 * Steinmetz core-loss equation · pure teaching stubs.
 * P = η · B^β · f^α  (classic empirical form).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Steinmetz magnetic core loss. */
export const METHOD_STEINMETZ = 'method-steinmetz'

/** Algo · Steinmetz power loss density P. */
export const METHOD_ALGO_STEINMETZ_P = 'method-algo-steinmetz-p'

/** Parent alias (aligns with familyId). */
export const STEINMETZ_PARENT = METHOD_STEINMETZ

export const STEINMETZ_METHOD_IDS = [METHOD_ALGO_STEINMETZ_P] as const

/** Default material coefficient η (W/m³ teaching units). */
export const DEFAULT_ETA = 100

/** Default peak flux density B (T). */
export const DEFAULT_B = 0.5

/** Default frequency f (Hz). */
export const DEFAULT_F = 50

/** Default Steinmetz frequency exponent α. */
export const DEFAULT_ALPHA = 1.6

/** Default Steinmetz flux exponent β. */
export const DEFAULT_BETA = 1.6

/**
 * Classic Steinmetz core loss density:
 *   P = η · B^β · f^α
 *
 * η: material constant, B: peak flux density (T), f: frequency (Hz),
 * alpha: frequency exponent (default 1.6), beta: flux exponent (default 1.6).
 * Requires B≥0, f≥0, η≥0, finite; else NaN.
 * Note: 0^α for α>0 is 0; B=0 or f=0 ⇒ P=0.
 */
export function steinmetzP(
  eta: number,
  B: number,
  f: number,
  alpha: number = DEFAULT_ALPHA,
  beta: number = DEFAULT_BETA,
): number {
  if (
    !Number.isFinite(eta) ||
    !Number.isFinite(B) ||
    !Number.isFinite(f) ||
    !Number.isFinite(alpha) ||
    !Number.isFinite(beta) ||
    !(eta >= 0) ||
    !(B >= 0) ||
    !(f >= 0)
  ) {
    return NaN
  }
  if (B === 0 || f === 0) return 0
  return eta * B ** beta * f ** alpha
}

/**
 * Steinmetz sample: P = η B^β f^α; scales with B^β, f^α; B=0 ⇒ 0.
 */
export function runSteinmetzPSample(opts?: {
  eta?: number
  B?: number
  f?: number
  alpha?: number
  beta?: number
}): {
  eta: number
  B: number
  f: number
  alpha: number
  beta: number
  P: number
  P_doubleB: number
  P_doubleF: number
  P_zeroB: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_STEINMETZ_P
  familyId: typeof METHOD_STEINMETZ
} {
  const eta = opts?.eta ?? DEFAULT_ETA
  const B = opts?.B ?? DEFAULT_B
  const f = opts?.f ?? DEFAULT_F
  const alpha = opts?.alpha ?? DEFAULT_ALPHA
  const beta = opts?.beta ?? DEFAULT_BETA

  const P = steinmetzP(eta, B, f, alpha, beta)
  const P_doubleB = steinmetzP(eta, 2 * B, f, alpha, beta)
  const P_doubleF = steinmetzP(eta, B, 2 * f, alpha, beta)
  const P_zeroB = steinmetzP(eta, 0, f, alpha, beta)

  const finite =
    Number.isFinite(P) &&
    Number.isFinite(P_doubleB) &&
    Number.isFinite(P_doubleF) &&
    Number.isFinite(P_zeroB)

  const expected = eta * B ** beta * f ** alpha
  const formulaOk =
    Math.abs(P - expected) < 1e-10 * Math.max(1, Math.abs(P))
  const scaleBOk =
    Math.abs(P_doubleB - P * 2 ** beta) <
    1e-10 * Math.max(1, Math.abs(P_doubleB))
  const scaleFOk =
    Math.abs(P_doubleF - P * 2 ** alpha) <
    1e-10 * Math.max(1, Math.abs(P_doubleF))
  const zeroOk = Math.abs(P_zeroB) < 1e-30
  const positiveOk = P > 0

  const ok =
    finite && formulaOk && scaleBOk && scaleFOk && zeroOk && positiveOk

  return {
    eta,
    B,
    f,
    alpha,
    beta,
    P,
    P_doubleB,
    P_doubleF,
    P_zeroB,
    finite,
    ok,
    methodId: METHOD_ALGO_STEINMETZ_P,
    familyId: METHOD_STEINMETZ,
  }
}
