/**
 * Numerical aperture · pure teaching stubs.
 * NA = n sin(θ_max); fiber NA = √(n_core² − n_clad²).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · numerical aperture. */
export const METHOD_NA = 'method-numerical-aperture'

/** Algo · numerical aperture NA. */
export const METHOD_ALGO_NA = 'method-algo-na'

/** Parent alias (aligns with familyId). */
export const NA_PARENT = METHOD_NA

export const NA_METHOD_IDS = [METHOD_ALGO_NA] as const

/** Default external / object-space refractive index n. */
export const DEFAULT_N = 1

/** Default max acceptance half-angle θ_max (rad). */
export const DEFAULT_THETA = Math.PI / 6 // 30°

/** Default fiber core index. */
export const DEFAULT_N_CORE = 1.48

/** Default fiber cladding index. */
export const DEFAULT_N_CLAD = 1.46

/**
 * Optical system numerical aperture:
 *   NA = n · sin(θ_max)
 *
 * n: refractive index of immersion medium, θ_max: half-angle (rad).
 * Requires n≥0, finite θ; else NaN. |sin| used for magnitude if θ outside
 * usual range still returns signed sin form (teaching: θ in [0, π/2]).
 */
export function numericalAperture(n: number, thetaMax: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(thetaMax) || !(n >= 0)) {
    return NaN
  }
  return n * Math.sin(thetaMax)
}

/**
 * Step-index fiber numerical aperture:
 *   NA = √(n_core² − n_clad²)
 *
 * Requires n_core > n_clad ≥ 0; else NaN.
 */
export function fiberNA(nCore: number, nClad: number): number {
  if (
    !Number.isFinite(nCore) ||
    !Number.isFinite(nClad) ||
    !(nCore > nClad) ||
    !(nClad >= 0)
  ) {
    return NaN
  }
  return Math.sqrt(nCore * nCore - nClad * nClad)
}

/**
 * Acceptance half-angle from fiber NA and external n:
 *   θ = arcsin(NA / n)  for NA ≤ n
 */
export function acceptanceAngle(na: number, n: number = 1): number {
  if (
    !Number.isFinite(na) ||
    !Number.isFinite(n) ||
    !(n > 0) ||
    !(na >= 0) ||
    !(na <= n)
  ) {
    return NaN
  }
  return Math.asin(na / n)
}

/**
 * NA sample: NA = n sin θ; fiber form; acceptance angle inverse.
 */
export function runNaSample(opts?: {
  n?: number
  thetaMax?: number
  nCore?: number
  nClad?: number
}): {
  n: number
  thetaMax: number
  nCore: number
  nClad: number
  NA: number
  NA_fiber: number
  theta_from_fiber: number
  NA_badFiber: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_NA
  familyId: typeof METHOD_NA
} {
  const n = opts?.n ?? DEFAULT_N
  const thetaMax = opts?.thetaMax ?? DEFAULT_THETA
  const nCore = opts?.nCore ?? DEFAULT_N_CORE
  const nClad = opts?.nClad ?? DEFAULT_N_CLAD

  const NA = numericalAperture(n, thetaMax)
  const NA_fiber = fiberNA(nCore, nClad)
  const theta_from_fiber = acceptanceAngle(NA_fiber, n)
  const NA_badFiber = fiberNA(nClad, nCore) // swapped → NaN

  const finite =
    Number.isFinite(NA) &&
    Number.isFinite(NA_fiber) &&
    Number.isFinite(theta_from_fiber)

  const formulaOk =
    Math.abs(NA - n * Math.sin(thetaMax)) < 1e-15 * Math.max(1, Math.abs(NA))
  const fiberOk =
    Math.abs(NA_fiber - Math.sqrt(nCore * nCore - nClad * nClad)) <
    1e-12 * Math.max(1e-30, NA_fiber)
  // n sin(θ) = NA_fiber for air n=1 when θ = arcsin(NA_fiber)
  const invOk =
    Math.abs(numericalAperture(n, theta_from_fiber) - NA_fiber) <
    1e-12 * Math.max(1e-30, NA_fiber)
  const badOk = !Number.isFinite(NA_badFiber)
  const rangeOk = NA > 0 && NA_fiber > 0 && NA <= n

  const ok = finite && formulaOk && fiberOk && invOk && badOk && rangeOk

  return {
    n,
    thetaMax,
    nCore,
    nClad,
    NA,
    NA_fiber,
    theta_from_fiber,
    NA_badFiber,
    finite,
    ok,
    methodId: METHOD_ALGO_NA,
    familyId: METHOD_NA,
  }
}
