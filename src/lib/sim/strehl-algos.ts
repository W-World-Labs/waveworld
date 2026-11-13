/**
 * Strehl ratio · pure teaching stubs.
 * Maréchal approximation: S ≈ exp(−(2π σ / λ)²)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Strehl ratio (optical quality). */
export const METHOD_STREHL = 'method-strehl-ratio'

/** Algo · Maréchal Strehl approximation. */
export const METHOD_ALGO_STREHL = 'method-algo-strehl'

/** Parent alias (aligns with familyId). */
export const STREHL_PARENT = METHOD_STREHL

export const STREHL_METHOD_IDS = [METHOD_ALGO_STREHL] as const

/** Default RMS wavefront error σ (m). */
export const DEFAULT_SIGMA = 50e-9

/** Default wavelength λ (m); green-ish toy. */
export const DEFAULT_LAMBDA = 550e-9

/**
 * Maréchal Strehl ratio (dimensionless, ≈1 for perfect optics):
 *   S ≈ exp( −(2 · π · σ / λ)² )
 *
 * sigma: RMS wavefront error (same units as lambda),
 * lambda: wavelength > 0.
 * Requires σ≥0, λ>0, finite; else NaN.
 * S ∈ (0, 1] for valid inputs.
 */
export function strehlMarechal(sigma: number, lambda: number): number {
  if (
    !Number.isFinite(sigma) ||
    !Number.isFinite(lambda) ||
    !(sigma >= 0) ||
    !(lambda > 0)
  ) {
    return NaN
  }
  const phi = (2 * Math.PI * sigma) / lambda
  return Math.exp(-(phi * phi))
}

/**
 * Strehl sample: Maréchal S; σ=0 ⇒ S=1; larger σ lowers S.
 */
export function runStrehlSample(opts?: {
  sigma?: number
  lambda?: number
}): {
  sigma: number
  lambda: number
  S: number
  S_perfect: number
  S_doubleSigma: number
  S_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_STREHL
  familyId: typeof METHOD_STREHL
} {
  const sigma = opts?.sigma ?? DEFAULT_SIGMA
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA

  const S = strehlMarechal(sigma, lambda)
  const S_perfect = strehlMarechal(0, lambda)
  const S_doubleSigma = strehlMarechal(2 * sigma, lambda)
  const S_bad = strehlMarechal(sigma, 0)

  const finite =
    Number.isFinite(S) &&
    Number.isFinite(S_perfect) &&
    Number.isFinite(S_doubleSigma)

  const phi = (2 * Math.PI * sigma) / lambda
  const expected = Math.exp(-(phi * phi))
  const formulaOk =
    Math.abs(S - expected) < 1e-12 * Math.max(1e-30, S)
  const perfectOk = Math.abs(S_perfect - 1) < 1e-15
  const degradeOk = S_doubleSigma < S
  const boundOk = S > 0 && S <= 1
  const badOk = !Number.isFinite(S_bad)

  const ok = finite && formulaOk && perfectOk && degradeOk && boundOk && badOk

  return {
    sigma,
    lambda,
    S,
    S_perfect,
    S_doubleSigma,
    S_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_STREHL,
    familyId: METHOD_STREHL,
  }
}
