/**
 * Debye length + plasma frequency · pure teaching stubs.
 * λ_D = √(ε0 kT / (n e²)); ω_p = √(n e² / (ε0 m_e))
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Debye screening length. */
export const METHOD_DEBYE = 'method-debye-length'

/** Algo · Debye length λ_D. */
export const METHOD_ALGO_DEBYE_L = 'method-algo-debye-length'

/** Family · plasma frequency. */
export const METHOD_PLASMA = 'method-plasma-frequency'

/** Algo · electron plasma angular frequency ω_p. */
export const METHOD_ALGO_PLASMA_W = 'method-algo-plasma-omega'

/** Parent aliases. */
export const DEBYE_PARENT = METHOD_DEBYE
export const PLASMA_PARENT = METHOD_PLASMA

export const DEBYE_METHOD_IDS = [METHOD_ALGO_DEBYE_L] as const
export const PLASMA_METHOD_IDS = [METHOD_ALGO_PLASMA_W] as const

export const DEBYE_PLASMA_METHOD_IDS = [
  METHOD_ALGO_DEBYE_L,
  METHOD_ALGO_PLASMA_W,
] as const

/** Vacuum permittivity ε0 (F/m). */
export const EPS0 = 8.8541878128e-12

/** Boltzmann constant k_B (J/K). */
export const KB = 1.380649e-23

/** Elementary charge e (C). */
export const E_CHARGE = 1.602176634e-19

/** Electron mass m_e (kg). */
export const M_E = 9.1093837015e-31

/** Default density n (m⁻³); lab-plasma class toy. */
export const DEFAULT_N = 1e16

/** Default temperature T (K). */
export const DEFAULT_T = 1e4

/**
 * Debye length (m):
 *   λ_D = √( ε0 · k · T / (n · e²) )
 *
 * n: number density (m⁻³), T: temperature (K).
 * Requires n>0, T≥0, constants positive; else NaN.
 */
export function debyeLength(
  n: number,
  T: number,
  eps0: number = EPS0,
  k: number = KB,
  e: number = E_CHARGE,
): number {
  if (
    !Number.isFinite(n) ||
    !Number.isFinite(T) ||
    !Number.isFinite(eps0) ||
    !Number.isFinite(k) ||
    !Number.isFinite(e) ||
    !(n > 0) ||
    !(T >= 0) ||
    !(eps0 > 0) ||
    !(k > 0) ||
    !(e > 0)
  ) {
    return NaN
  }
  return Math.sqrt((eps0 * k * T) / (n * e * e))
}

/**
 * Electron plasma angular frequency (rad/s):
 *   ω_p = √( n · e² / (ε0 · m_e) )
 *
 * Requires n≥0, m_e>0, eps0>0, e>0; else NaN.
 */
export function plasmaOmega(
  n: number,
  eps0: number = EPS0,
  e: number = E_CHARGE,
  m_e: number = M_E,
): number {
  if (
    !Number.isFinite(n) ||
    !Number.isFinite(eps0) ||
    !Number.isFinite(e) ||
    !Number.isFinite(m_e) ||
    !(n >= 0) ||
    !(eps0 > 0) ||
    !(e > 0) ||
    !(m_e > 0)
  ) {
    return NaN
  }
  return Math.sqrt((n * e * e) / (eps0 * m_e))
}

/**
 * Debye sample: λ_D formula; ∝ √T, 1/√n; n≤0 illegal.
 */
export function runDebyeLengthSample(opts?: {
  n?: number
  T?: number
}): {
  n: number
  T: number
  lambdaD: number
  lambdaD_doubleT: number
  lambdaD_doubleN: number
  lambdaD_badN: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_DEBYE_L
  familyId: typeof METHOD_DEBYE
} {
  const n = opts?.n ?? DEFAULT_N
  const T = opts?.T ?? DEFAULT_T

  const lambdaD = debyeLength(n, T)
  const lambdaD_doubleT = debyeLength(n, 2 * T)
  const lambdaD_doubleN = debyeLength(2 * n, T)
  const lambdaD_badN = debyeLength(0, T)

  const finite =
    Number.isFinite(lambdaD) &&
    Number.isFinite(lambdaD_doubleT) &&
    Number.isFinite(lambdaD_doubleN)

  const expected = Math.sqrt((EPS0 * KB * T) / (n * E_CHARGE * E_CHARGE))
  const formulaOk =
    Math.abs(lambdaD - expected) < 1e-12 * Math.max(1e-30, lambdaD)
  const sqrtTOk =
    Math.abs(lambdaD_doubleT - lambdaD * Math.SQRT2) <
    1e-12 * Math.max(1e-30, lambdaD)
  const invSqrtNOk =
    Math.abs(lambdaD_doubleN - lambdaD / Math.SQRT2) <
    1e-12 * Math.max(1e-30, lambdaD)
  const badOk = !Number.isFinite(lambdaD_badN)
  const positiveOk = lambdaD > 0

  const ok =
    finite && formulaOk && sqrtTOk && invSqrtNOk && badOk && positiveOk

  return {
    n,
    T,
    lambdaD,
    lambdaD_doubleT,
    lambdaD_doubleN,
    lambdaD_badN,
    finite,
    ok,
    methodId: METHOD_ALGO_DEBYE_L,
    familyId: METHOD_DEBYE,
  }
}

/**
 * Plasma-ω sample: ω_p ∝ √n; n=0 ⇒ 0.
 */
export function runPlasmaOmegaSample(opts?: { n?: number }): {
  n: number
  omegaP: number
  omegaP_doubleN: number
  omegaP_zeroN: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PLASMA_W
  familyId: typeof METHOD_PLASMA
} {
  const n = opts?.n ?? DEFAULT_N

  const omegaP = plasmaOmega(n)
  const omegaP_doubleN = plasmaOmega(2 * n)
  const omegaP_zeroN = plasmaOmega(0)

  const finite =
    Number.isFinite(omegaP) &&
    Number.isFinite(omegaP_doubleN) &&
    Number.isFinite(omegaP_zeroN)

  const expected = Math.sqrt((n * E_CHARGE * E_CHARGE) / (EPS0 * M_E))
  const formulaOk =
    Math.abs(omegaP - expected) < 1e-12 * Math.max(1e-30, omegaP)
  const sqrtNOk =
    Math.abs(omegaP_doubleN - omegaP * Math.SQRT2) <
    1e-12 * Math.max(1e-30, omegaP)
  const zeroOk = Math.abs(omegaP_zeroN) < 1e-30
  const positiveOk = omegaP > 0

  const ok = finite && formulaOk && sqrtNOk && zeroOk && positiveOk

  return {
    n,
    omegaP,
    omegaP_doubleN,
    omegaP_zeroN,
    finite,
    ok,
    methodId: METHOD_ALGO_PLASMA_W,
    familyId: METHOD_PLASMA,
  }
}
