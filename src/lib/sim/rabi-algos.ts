/**
 * Rabi frequency · pure teaching stubs.
 * Magnetic Rabi: Ω_R = γ · B1  (teaching form of μ E / ℏ class).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Rabi oscillation. */
export const METHOD_RABI = 'method-rabi'

/** Algo · Rabi frequency Ω = γ B1. */
export const METHOD_ALGO_RABI_FREQ = 'method-algo-rabi-freq'

/** Parent alias (aligns with familyId). */
export const RABI_PARENT = METHOD_RABI

export const RABI_METHOD_IDS = [METHOD_ALGO_RABI_FREQ] as const

/** Default gyromagnetic ratio γ (rad/(s·T)); proton-class toy. */
export const DEFAULT_GAMMA = 2.675e8

/** Default RF field amplitude B1 (T). */
export const DEFAULT_B1 = 1e-4

/**
 * Magnetic Rabi angular frequency (rad/s):
 *   Ω_R = γ · B1
 *
 * Teaching form of Ω = μ E / ℏ for magnetic drive (γ B1).
 * γ: gyromagnetic ratio (rad/(s·T)), B1: transverse RF field (T).
 * Non-finite → NaN.
 */
export function rabiFreq(gamma: number, B1: number): number {
  if (!Number.isFinite(gamma) || !Number.isFinite(B1)) return NaN
  return gamma * B1
}

/**
 * Rabi sample: Ω = γ B1; linear in γ and B1; B1=0 ⇒ 0.
 */
export function runRabiFreqSample(opts?: {
  gamma?: number
  B1?: number
}): {
  gamma: number
  B1: number
  Omega: number
  Omega_doubleB1: number
  Omega_doubleGamma: number
  Omega_zero: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_RABI_FREQ
  familyId: typeof METHOD_RABI
} {
  const gamma = opts?.gamma ?? DEFAULT_GAMMA
  const B1 = opts?.B1 ?? DEFAULT_B1

  const Omega = rabiFreq(gamma, B1)
  const Omega_doubleB1 = rabiFreq(gamma, 2 * B1)
  const Omega_doubleGamma = rabiFreq(2 * gamma, B1)
  const Omega_zero = rabiFreq(gamma, 0)

  const finite =
    Number.isFinite(Omega) &&
    Number.isFinite(Omega_doubleB1) &&
    Number.isFinite(Omega_doubleGamma) &&
    Number.isFinite(Omega_zero)

  const expected = gamma * B1
  const formulaOk =
    Math.abs(Omega - expected) < 1e-12 * Math.max(1e-30, Math.abs(Omega))
  const linBOk =
    Math.abs(Omega_doubleB1 - 2 * Omega) <
    1e-12 * Math.max(1e-30, Math.abs(Omega))
  const linGOk =
    Math.abs(Omega_doubleGamma - 2 * Omega) <
    1e-12 * Math.max(1e-30, Math.abs(Omega))
  const zeroOk = Math.abs(Omega_zero) < 1e-30
  const positiveOk = gamma > 0 && B1 > 0 ? Omega > 0 : true
  const badOk = !Number.isFinite(rabiFreq(NaN, B1))

  const ok =
    finite && formulaOk && linBOk && linGOk && zeroOk && positiveOk && badOk

  return {
    gamma,
    B1,
    Omega,
    Omega_doubleB1,
    Omega_doubleGamma,
    Omega_zero,
    finite,
    ok,
    methodId: METHOD_ALGO_RABI_FREQ,
    familyId: METHOD_RABI,
  }
}
