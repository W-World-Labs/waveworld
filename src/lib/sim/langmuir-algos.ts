/**
 * Langmuir adsorption isotherm · pure teaching stubs.
 * θ = K P / (1 + K P)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Langmuir isotherm. */
export const METHOD_LANGMUIR = 'method-langmuir-isotherm'

/** Algo · fractional coverage θ. */
export const METHOD_ALGO_LANGMUIR_THETA = 'method-algo-langmuir-theta'

/** Parent alias (aligns with familyId). */
export const LANGMUIR_PARENT = METHOD_LANGMUIR

export const LANGMUIR_METHOD_IDS = [METHOD_ALGO_LANGMUIR_THETA] as const

/** Default equilibrium constant K (1/pressure units teaching). */
export const DEFAULT_K = 1

/** Default pressure P (same units as 1/K). */
export const DEFAULT_P = 1

/**
 * Langmuir fractional surface coverage (dimensionless):
 *   θ = (K · P) / (1 + K · P)
 *
 * K: adsorption equilibrium constant, P: partial pressure.
 * Requires finite K,P; denominator ≠ 0 (always true for finite K·P > −1
 * in physical domain K≥0, P≥0); non-finite → NaN.
 * Physical domain teaching: K≥0, P≥0 ⇒ θ ∈ [0, 1).
 */
export function langmuirTheta(K: number, P: number): number {
  if (!Number.isFinite(K) || !Number.isFinite(P)) return NaN
  const den = 1 + K * P
  if (den === 0) return NaN
  return (K * P) / den
}

/**
 * Langmuir sample: θ = KP/(1+KP); P=0 ⇒ 0; large KP → 1; linear at low P.
 */
export function runLangmuirThetaSample(opts?: {
  K?: number
  P?: number
}): {
  K: number
  P: number
  theta: number
  theta_zeroP: number
  theta_highP: number
  theta_doubleP: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_LANGMUIR_THETA
  familyId: typeof METHOD_LANGMUIR
} {
  const K = opts?.K ?? DEFAULT_K
  const P = opts?.P ?? DEFAULT_P

  const theta = langmuirTheta(K, P)
  const theta_zeroP = langmuirTheta(K, 0)
  const theta_highP = langmuirTheta(K, 1e6 * (P === 0 ? 1 : P))
  const theta_doubleP = langmuirTheta(K, 2 * P)

  const finite =
    Number.isFinite(theta) &&
    Number.isFinite(theta_zeroP) &&
    Number.isFinite(theta_highP) &&
    Number.isFinite(theta_doubleP)

  const expected = (K * P) / (1 + K * P)
  const formulaOk =
    Math.abs(theta - expected) < 1e-12 * Math.max(1e-30, Math.abs(theta))
  const zeroOk = Math.abs(theta_zeroP) < 1e-30
  // high coverage approaches 1 from below
  const highOk = theta_highP > 0.99 && theta_highP <= 1
  // θ ∈ (0,1) for K,P > 0
  const boundOk = K > 0 && P > 0 ? theta > 0 && theta < 1 : true
  // increasing in P for K>0
  const monoOk = K > 0 && P > 0 ? theta_doubleP > theta : true

  const ok = finite && formulaOk && zeroOk && highOk && boundOk && monoOk

  return {
    K,
    P,
    theta,
    theta_zeroP,
    theta_highP,
    theta_doubleP,
    finite,
    ok,
    methodId: METHOD_ALGO_LANGMUIR_THETA,
    familyId: METHOD_LANGMUIR,
  }
}
