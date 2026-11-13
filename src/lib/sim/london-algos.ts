/**
 * London penetration depth · pure teaching stubs.
 * λ_L = √(m / (μ0 · n · e²))
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · London magnetic penetration. */
export const METHOD_LONDON = 'method-london-penetration'

/** Algo · London depth λ_L. */
export const METHOD_ALGO_LONDON_LAMBDA = 'method-algo-london-lambda'

/** Parent alias (aligns with familyId). */
export const LONDON_PARENT = METHOD_LONDON

export const LONDON_METHOD_IDS = [METHOD_ALGO_LONDON_LAMBDA] as const

/** Vacuum permeability μ0 (H/m). */
export const MU0 = 1.25663706212e-6 // 4π × 10⁻⁷

/** Elementary charge e (C). */
export const E_CHARGE = 1.602176634e-19

/** Electron mass m_e (kg). */
export const M_E = 9.1093837015e-31

/** Default superconducting carrier density n (m⁻³); metal-class toy. */
export const DEFAULT_N = 1e28

/**
 * London penetration depth (m):
 *   λ_L = √( m / (μ0 · n · e²) )
 *
 * m: effective mass (kg), n: superfluid density (m⁻³),
 * μ0: vacuum permeability (H/m), e: charge (C).
 * Requires m>0, n>0, μ0>0, e≠0, finite; else NaN.
 */
export function londonLambda(
  n: number,
  m: number = M_E,
  mu0: number = MU0,
  e: number = E_CHARGE,
): number {
  if (
    !Number.isFinite(n) ||
    !Number.isFinite(m) ||
    !Number.isFinite(mu0) ||
    !Number.isFinite(e) ||
    !(n > 0) ||
    !(m > 0) ||
    !(mu0 > 0) ||
    e === 0
  ) {
    return NaN
  }
  return Math.sqrt(m / (mu0 * n * e * e))
}

/**
 * London-λ sample: λ_L formula; ∝ 1/√n, √m; n≤0 illegal.
 */
export function runLondonLambdaSample(opts?: {
  n?: number
  m?: number
}): {
  n: number
  m: number
  lambdaL: number
  lambdaL_doubleN: number
  lambdaL_doubleM: number
  lambdaL_badN: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_LONDON_LAMBDA
  familyId: typeof METHOD_LONDON
} {
  const n = opts?.n ?? DEFAULT_N
  const m = opts?.m ?? M_E

  const lambdaL = londonLambda(n, m)
  const lambdaL_doubleN = londonLambda(2 * n, m)
  const lambdaL_doubleM = londonLambda(n, 2 * m)
  const lambdaL_badN = londonLambda(0, m)

  const finite =
    Number.isFinite(lambdaL) &&
    Number.isFinite(lambdaL_doubleN) &&
    Number.isFinite(lambdaL_doubleM)

  const expected = Math.sqrt(m / (MU0 * n * E_CHARGE * E_CHARGE))
  const formulaOk =
    Math.abs(lambdaL - expected) < 1e-12 * Math.max(1e-30, lambdaL)
  const invSqrtNOk =
    Math.abs(lambdaL_doubleN - lambdaL / Math.SQRT2) <
    1e-12 * Math.max(1e-30, lambdaL)
  const sqrtMOk =
    Math.abs(lambdaL_doubleM - lambdaL * Math.SQRT2) <
    1e-12 * Math.max(1e-30, lambdaL)
  const badOk = !Number.isFinite(lambdaL_badN)
  const positiveOk = lambdaL > 0

  const ok =
    finite && formulaOk && invSqrtNOk && sqrtMOk && badOk && positiveOk

  return {
    n,
    m,
    lambdaL,
    lambdaL_doubleN,
    lambdaL_doubleM,
    lambdaL_badN,
    finite,
    ok,
    methodId: METHOD_ALGO_LONDON_LAMBDA,
    familyId: METHOD_LONDON,
  }
}
