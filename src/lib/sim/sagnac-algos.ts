/**
 * Sagnac effect · pure teaching stubs.
 * δφ = 8 π A Ω / (λ c)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Sagnac interferometer / gyroscope. */
export const METHOD_SAGNAC = 'method-sagnac'

/** Algo · Sagnac phase shift δφ = 8πAΩ/(λc). */
export const METHOD_ALGO_SAGNAC_PHASE = 'method-algo-sagnac-phase'

/** Parent alias (aligns with familyId). */
export const SAGNAC_PARENT = METHOD_SAGNAC

export const SAGNAC_METHOD_IDS = [METHOD_ALGO_SAGNAC_PHASE] as const

/** Speed of light (m/s). */
export const C = 299792458

/** Default enclosed area A (m²). */
export const DEFAULT_A = 1

/** Default rotation rate Ω (rad/s). */
export const DEFAULT_OMEGA = 1e-4

/** Default wavelength λ (m). */
export const DEFAULT_LAMBDA = 1550e-9

/**
 * Sagnac phase shift (rad) for a closed loop:
 *   δφ = 8 π A Ω / (λ c)
 *
 * A: enclosed area (m²), Omega: angular rate (rad/s),
 * lambda: wavelength (m), c: speed of light (m/s).
 * Requires λ>0, c>0, finite; else NaN.
 */
export function sagnacPhase(
  A: number,
  Omega: number,
  lambda: number,
  c: number = C,
): number {
  if (
    !Number.isFinite(A) ||
    !Number.isFinite(Omega) ||
    !Number.isFinite(lambda) ||
    !Number.isFinite(c) ||
    !(lambda > 0) ||
    !(c > 0)
  ) {
    return NaN
  }
  return (8 * Math.PI * A * Omega) / (lambda * c)
}

/**
 * Sagnac sample: δφ ∝ A·Ω; ∝ 1/λ; Ω=0 ⇒ 0.
 */
export function runSagnacPhaseSample(opts?: {
  A?: number
  Omega?: number
  lambda?: number
}): {
  A: number
  Omega: number
  lambda: number
  c: number
  deltaPhi: number
  deltaPhi_doubleA: number
  deltaPhi_doubleOmega: number
  deltaPhi_zero: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SAGNAC_PHASE
  familyId: typeof METHOD_SAGNAC
} {
  const A = opts?.A ?? DEFAULT_A
  const Omega = opts?.Omega ?? DEFAULT_OMEGA
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA

  const deltaPhi = sagnacPhase(A, Omega, lambda)
  const deltaPhi_doubleA = sagnacPhase(2 * A, Omega, lambda)
  const deltaPhi_doubleOmega = sagnacPhase(A, 2 * Omega, lambda)
  const deltaPhi_zero = sagnacPhase(A, 0, lambda)

  const finite =
    Number.isFinite(deltaPhi) &&
    Number.isFinite(deltaPhi_doubleA) &&
    Number.isFinite(deltaPhi_doubleOmega) &&
    Number.isFinite(deltaPhi_zero)

  const expected = (8 * Math.PI * A * Omega) / (lambda * C)
  const formulaOk =
    Math.abs(deltaPhi - expected) < 1e-12 * Math.max(1e-30, Math.abs(deltaPhi))
  const linAOk =
    Math.abs(deltaPhi_doubleA - 2 * deltaPhi) <
    1e-12 * Math.max(1e-30, Math.abs(deltaPhi))
  const linOmegaOk =
    Math.abs(deltaPhi_doubleOmega - 2 * deltaPhi) <
    1e-12 * Math.max(1e-30, Math.abs(deltaPhi))
  const zeroOk = Math.abs(deltaPhi_zero) < 1e-30

  const ok = finite && formulaOk && linAOk && linOmegaOk && zeroOk

  return {
    A,
    Omega,
    lambda,
    c: C,
    deltaPhi,
    deltaPhi_doubleA,
    deltaPhi_doubleOmega,
    deltaPhi_zero,
    finite,
    ok,
    methodId: METHOD_ALGO_SAGNAC_PHASE,
    familyId: METHOD_SAGNAC,
  }
}
