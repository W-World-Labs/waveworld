/**
 * Faraday rotation · pure teaching stub.
 * θ = V · B · L (Verdet constant).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Faraday magneto-optic rotation. */
export const METHOD_FARADAY_ROT = 'method-faraday-rotation'

/** Algo · Faraday rotation angle θ = V B L. */
export const METHOD_ALGO_FARADAY_THETA = 'method-algo-faraday-theta'

/** Parent alias (aligns with familyId). */
export const FARADAY_ROT_PARENT = METHOD_FARADAY_ROT

export const FARADAY_ROT_METHOD_IDS = [METHOD_ALGO_FARADAY_THETA] as const

/** Default Verdet constant V (rad/(T·m) teaching). */
export const DEFAULT_VERDET = 10

/** Default magnetic field B (T). */
export const DEFAULT_B = 0.5

/** Default path length L (m). */
export const DEFAULT_L = 0.1

/**
 * Faraday rotation angle:
 *   θ = V · B · L
 *
 * V: Verdet constant (rad/(T·m)), B: axial field (T), L: path length (m).
 * Sign follows V·B·L (handed by field direction); non-finite → NaN.
 */
export function faradayTheta(V: number, B: number, L: number): number {
  if (!Number.isFinite(V) || !Number.isFinite(B) || !Number.isFinite(L)) {
    return NaN
  }
  return V * B * L
}

/**
 * Faraday sample: V=10, B=0.5 T, L=0.1 m → θ=0.5 rad;
 * linear in B,L; antisymmetric under B reverse.
 */
export function runFaradayThetaSample(opts?: {
  V?: number
  B?: number
  L?: number
}): {
  V: number
  B: number
  L: number
  theta: number
  theta_doubleB: number
  theta_negB: number
  theta_zeroL: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FARADAY_THETA
  familyId: typeof METHOD_FARADAY_ROT
} {
  const V = opts?.V ?? DEFAULT_VERDET
  const B = opts?.B ?? DEFAULT_B
  const L = opts?.L ?? DEFAULT_L

  const theta = faradayTheta(V, B, L)
  const theta_doubleB = faradayTheta(V, 2 * B, L)
  const theta_negB = faradayTheta(V, -B, L)
  const theta_zeroL = faradayTheta(V, B, 0)

  const finite =
    Number.isFinite(theta) &&
    Number.isFinite(theta_doubleB) &&
    Number.isFinite(theta_negB) &&
    Number.isFinite(theta_zeroL)

  const formulaOk =
    Math.abs(theta - V * B * L) < 1e-18 * Math.max(1, Math.abs(theta))
  const linB =
    Math.abs(theta_doubleB - 2 * theta) <
    1e-18 * Math.max(1, Math.abs(theta))
  const antisym =
    Math.abs(theta_negB + theta) < 1e-18 * Math.max(1, Math.abs(theta))
  const zeroOk = Math.abs(theta_zeroL) < 1e-30

  const ok = finite && formulaOk && linB && antisym && zeroOk

  return {
    V,
    B,
    L,
    theta,
    theta_doubleB,
    theta_negB,
    theta_zeroL,
    finite,
    ok,
    methodId: METHOD_ALGO_FARADAY_THETA,
    familyId: METHOD_FARADAY_ROT,
  }
}
