/**
 * Drude model · pure teaching stubs.
 * DC σ = n e² τ / m; plasma ω_p = √(n e² / (ε0 m)).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Drude free-electron model. */
export const METHOD_DRUDE = 'method-drude-model'

/** Algo · DC Drude conductivity σ. */
export const METHOD_ALGO_DRUDE_SIGMA = 'method-algo-drude-sigma'

/** Parent alias (aligns with familyId). */
export const DRUDE_PARENT = METHOD_DRUDE

export const DRUDE_METHOD_IDS = [METHOD_ALGO_DRUDE_SIGMA] as const

/** Vacuum permittivity ε0 (F/m). */
export const EPS0 = 8.8541878128e-12

/** Elementary charge e (C). */
export const E_CHARGE = 1.602176634e-19

/** Electron mass m_e (kg). */
export const M_E = 9.1093837015e-31

/** Default carrier density n (m⁻³); metal-class toy. */
export const DEFAULT_N = 8.5e28

/** Default relaxation time τ (s). */
export const DEFAULT_TAU = 2.5e-14

/**
 * DC Drude conductivity (S/m):
 *   σ = n · e² · τ / m
 *
 * n: carrier density (m⁻³), e: charge (C), τ: relaxation time (s),
 * m: effective mass (kg). Requires n≥0, τ≥0, m>0, e finite; else NaN.
 */
export function drudeSigma(
  n: number,
  tau: number,
  m: number = M_E,
  e: number = E_CHARGE,
): number {
  if (
    !Number.isFinite(n) ||
    !Number.isFinite(tau) ||
    !Number.isFinite(m) ||
    !Number.isFinite(e) ||
    !(n >= 0) ||
    !(tau >= 0) ||
    !(m > 0)
  ) {
    return NaN
  }
  return (n * e * e * tau) / m
}

/**
 * Plasma angular frequency (rad/s):
 *   ω_p = √( n · e² / (ε0 · m) )
 *
 * Optional companion of the Drude model. Requires n≥0, eps0>0, m>0; else NaN.
 */
export function plasmaOmega(
  n: number,
  m: number = M_E,
  eps0: number = EPS0,
  e: number = E_CHARGE,
): number {
  if (
    !Number.isFinite(n) ||
    !Number.isFinite(m) ||
    !Number.isFinite(eps0) ||
    !Number.isFinite(e) ||
    !(n >= 0) ||
    !(m > 0) ||
    !(eps0 > 0)
  ) {
    return NaN
  }
  return Math.sqrt((n * e * e) / (eps0 * m))
}

/**
 * Drude-σ sample: σ = n e² τ / m; ∝ n, τ; ω_p companion.
 */
export function runDrudeSigmaSample(opts?: {
  n?: number
  tau?: number
  m?: number
  e?: number
}): {
  n: number
  tau: number
  m: number
  e: number
  sigma: number
  sigma_doubleN: number
  sigma_doubleTau: number
  omega_p: number
  sigma_badM: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_DRUDE_SIGMA
  familyId: typeof METHOD_DRUDE
} {
  const n = opts?.n ?? DEFAULT_N
  const tau = opts?.tau ?? DEFAULT_TAU
  const m = opts?.m ?? M_E
  const e = opts?.e ?? E_CHARGE

  const sigma = drudeSigma(n, tau, m, e)
  const sigma_doubleN = drudeSigma(2 * n, tau, m, e)
  const sigma_doubleTau = drudeSigma(n, 2 * tau, m, e)
  const omega_p = plasmaOmega(n, m, EPS0, e)
  const sigma_badM = drudeSigma(n, tau, 0, e)

  const finite =
    Number.isFinite(sigma) &&
    Number.isFinite(sigma_doubleN) &&
    Number.isFinite(sigma_doubleTau) &&
    Number.isFinite(omega_p)

  const expected = (n * e * e * tau) / m
  const formulaOk =
    Math.abs(sigma - expected) < 1e-12 * Math.max(1e-30, Math.abs(sigma))
  const linNOk =
    Math.abs(sigma_doubleN - 2 * sigma) <
    1e-12 * Math.max(1e-30, Math.abs(sigma))
  const linTauOk =
    Math.abs(sigma_doubleTau - 2 * sigma) <
    1e-12 * Math.max(1e-30, Math.abs(sigma))
  const plasmaOk =
    Math.abs(omega_p - Math.sqrt((n * e * e) / (EPS0 * m))) <
    1e-10 * Math.max(1, omega_p)
  const badOk = !Number.isFinite(sigma_badM)
  const positiveOk = sigma > 0 && omega_p > 0

  const ok =
    finite &&
    formulaOk &&
    linNOk &&
    linTauOk &&
    plasmaOk &&
    badOk &&
    positiveOk

  return {
    n,
    tau,
    m,
    e,
    sigma,
    sigma_doubleN,
    sigma_doubleTau,
    omega_p,
    sigma_badM,
    finite,
    ok,
    methodId: METHOD_ALGO_DRUDE_SIGMA,
    familyId: METHOD_DRUDE,
  }
}
