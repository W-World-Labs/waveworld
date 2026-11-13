/**
 * Skin effect · pure teaching stubs.
 * δ = 1/√(π f μ σ)  (= √(2ρ/(ω μ)) with ω=2πf, ρ=1/σ).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · electromagnetic skin effect. */
export const METHOD_SKIN = 'method-skin-effect'

/** Algo · skin depth δ. */
export const METHOD_ALGO_SKIN_DEPTH = 'method-algo-skin-depth'

/** Parent alias (aligns with familyId). */
export const SKIN_PARENT = METHOD_SKIN

export const SKIN_METHOD_IDS = [METHOD_ALGO_SKIN_DEPTH] as const

/** Vacuum permeability μ₀ (H/m). */
export const MU0 = 1.25663706212e-6

/** Default frequency f (Hz). */
export const DEFAULT_F = 1e6

/** Default permeability μ (H/m) ≈ μ₀ (non-magnetic). */
export const DEFAULT_MU = MU0

/** Default conductivity σ (S/m); copper-class toy. */
export const DEFAULT_SIGMA = 5.8e7

/**
 * Skin depth (m):
 *   δ = 1 / √(π · f · μ · σ)
 *
 * Equivalent form: δ = √(2 ρ / (ω μ)) with ω = 2π f, ρ = 1/σ.
 * Requires f>0, μ>0, σ>0, finite; else NaN.
 */
export function skinDepth(f: number, mu: number, sigma: number): number {
  if (
    !Number.isFinite(f) ||
    !Number.isFinite(mu) ||
    !Number.isFinite(sigma) ||
    !(f > 0) ||
    !(mu > 0) ||
    !(sigma > 0)
  ) {
    return NaN
  }
  return 1 / Math.sqrt(Math.PI * f * mu * sigma)
}

/**
 * Skin depth via resistivity form:
 *   δ = √(2 ρ / (ω μ)),  ω = 2π f, ρ = 1/σ
 */
export function skinDepthFromRho(
  f: number,
  mu: number,
  rho: number,
): number {
  if (
    !Number.isFinite(f) ||
    !Number.isFinite(mu) ||
    !Number.isFinite(rho) ||
    !(f > 0) ||
    !(mu > 0) ||
    !(rho > 0)
  ) {
    return NaN
  }
  const omega = 2 * Math.PI * f
  return Math.sqrt((2 * rho) / (omega * mu))
}

/**
 * Skin-depth sample: δ = 1/√(π f μ σ); ∝ 1/√f; ρ-form matches.
 */
export function runSkinDepthSample(opts?: {
  f?: number
  mu?: number
  sigma?: number
}): {
  f: number
  mu: number
  sigma: number
  delta: number
  delta_doubleF: number
  delta_rho: number
  delta_badF: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SKIN_DEPTH
  familyId: typeof METHOD_SKIN
} {
  const f = opts?.f ?? DEFAULT_F
  const mu = opts?.mu ?? DEFAULT_MU
  const sigma = opts?.sigma ?? DEFAULT_SIGMA

  const delta = skinDepth(f, mu, sigma)
  const delta_doubleF = skinDepth(2 * f, mu, sigma)
  const delta_rho = skinDepthFromRho(f, mu, 1 / sigma)
  const delta_badF = skinDepth(0, mu, sigma)

  const finite =
    Number.isFinite(delta) &&
    Number.isFinite(delta_doubleF) &&
    Number.isFinite(delta_rho)

  const expected = 1 / Math.sqrt(Math.PI * f * mu * sigma)
  const formulaOk =
    Math.abs(delta - expected) < 1e-12 * Math.max(1e-30, Math.abs(delta))
  // √(1/2) = 1/√2 when f doubles
  const invSqrtFOk =
    Math.abs(delta_doubleF - delta / Math.SQRT2) <
    1e-10 * Math.max(1e-30, Math.abs(delta))
  const rhoMatch =
    Math.abs(delta_rho - delta) < 1e-10 * Math.max(1e-30, Math.abs(delta))
  const badOk = !Number.isFinite(delta_badF)
  const positiveOk = delta > 0

  const ok =
    finite && formulaOk && invSqrtFOk && rhoMatch && badOk && positiveOk

  return {
    f,
    mu,
    sigma,
    delta,
    delta_doubleF,
    delta_rho,
    delta_badF,
    finite,
    ok,
    methodId: METHOD_ALGO_SKIN_DEPTH,
    familyId: METHOD_SKIN,
  }
}
