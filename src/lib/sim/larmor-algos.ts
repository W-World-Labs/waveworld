/**
 * Larmor precession · pure teaching stubs.
 * ω_L = γ · B  (gyromagnetic ratio × magnetic field).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Larmor precession. */
export const METHOD_LARMOR = 'method-larmor-precession'

/** Algo · Larmor angular frequency ω = γ B. */
export const METHOD_ALGO_LARMOR_W = 'method-algo-larmor-omega'

/** Parent alias (aligns with familyId). */
export const LARMOR_PARENT = METHOD_LARMOR

export const LARMOR_METHOD_IDS = [METHOD_ALGO_LARMOR_W] as const

/** Default gyromagnetic ratio γ (rad/(s·T)); proton-class toy. */
export const DEFAULT_GAMMA = 2.675e8

/** Default |B| (T). */
export const DEFAULT_B = 1.5

/**
 * Larmor angular frequency (rad/s):
 *   ω = γ · B
 *
 * γ: gyromagnetic ratio (rad/(s·T)), B: magnetic field (T).
 * Non-finite → NaN. Sign follows γ · B.
 */
export function larmorOmega(gamma: number, B: number): number {
  if (!Number.isFinite(gamma) || !Number.isFinite(B)) return NaN
  return gamma * B
}

/**
 * Larmor sample: ω = γ B; linear in γ and B; B=0 ⇒ 0.
 */
export function runLarmorOmegaSample(opts?: {
  gamma?: number
  B?: number
}): {
  gamma: number
  B: number
  omega: number
  omega_doubleB: number
  omega_doubleGamma: number
  omega_zeroB: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_LARMOR_W
  familyId: typeof METHOD_LARMOR
} {
  const gamma = opts?.gamma ?? DEFAULT_GAMMA
  const B = opts?.B ?? DEFAULT_B

  const omega = larmorOmega(gamma, B)
  const omega_doubleB = larmorOmega(gamma, 2 * B)
  const omega_doubleGamma = larmorOmega(2 * gamma, B)
  const omega_zeroB = larmorOmega(gamma, 0)

  const finite =
    Number.isFinite(omega) &&
    Number.isFinite(omega_doubleB) &&
    Number.isFinite(omega_doubleGamma) &&
    Number.isFinite(omega_zeroB)

  const expected = gamma * B
  const formulaOk =
    Math.abs(omega - expected) < 1e-12 * Math.max(1e-30, Math.abs(omega))
  const linBOk =
    Math.abs(omega_doubleB - 2 * omega) <
    1e-12 * Math.max(1e-30, Math.abs(omega))
  const linGOk =
    Math.abs(omega_doubleGamma - 2 * omega) <
    1e-12 * Math.max(1e-30, Math.abs(omega))
  const zeroOk = Math.abs(omega_zeroB) < 1e-30
  const positiveOk = gamma > 0 && B > 0 ? omega > 0 : true
  const badOk = !Number.isFinite(larmorOmega(NaN, B))

  const ok =
    finite && formulaOk && linBOk && linGOk && zeroOk && positiveOk && badOk

  return {
    gamma,
    B,
    omega,
    omega_doubleB,
    omega_doubleGamma,
    omega_zeroB,
    finite,
    ok,
    methodId: METHOD_ALGO_LARMOR_W,
    familyId: METHOD_LARMOR,
  }
}
