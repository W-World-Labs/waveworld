/**
 * Young double-slit fringe + diffraction grating · pure teaching stubs.
 * δy = λ L / d;  d sinθ = m λ → sinθ = m λ / d.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Young double-slit. */
export const METHOD_YOUNG = 'method-young-double-slit'

/** Algo · fringe spacing δy = λ L / d. */
export const METHOD_ALGO_YOUNG_FRINGE = 'method-algo-young-fringe'

/** Family · diffraction grating. */
export const METHOD_GRATING = 'method-diffraction-grating'

/** Algo · grating order angle / sinθ = m λ / d. */
export const METHOD_ALGO_GRATING_ORDER = 'method-algo-grating-order'

/** Parent aliases. */
export const YOUNG_PARENT = METHOD_YOUNG
export const GRATING_PARENT = METHOD_GRATING

export const YOUNG_METHOD_IDS = [METHOD_ALGO_YOUNG_FRINGE] as const
export const GRATING_METHOD_IDS = [METHOD_ALGO_GRATING_ORDER] as const

export const YOUNG_GRATING_METHOD_IDS = [
  METHOD_ALGO_YOUNG_FRINGE,
  METHOD_ALGO_GRATING_ORDER,
] as const

/** Default wavelength λ (m) — 632.8 nm HeNe. */
export const DEFAULT_LAMBDA = 632.8e-9

/** Default screen distance L (m). */
export const DEFAULT_L = 1.0

/** Default slit separation d (m). */
export const DEFAULT_D_SLIT = 0.25e-3

/** Default grating spacing d (m) — 600 lines/mm → d = 1/600e3 m. */
export const DEFAULT_D_GRATING = 1 / 600e3

/** Default order m. */
export const DEFAULT_M = 1

/**
 * Young double-slit fringe spacing (m):
 *   δy = λ · L / d
 *
 * Requires λ>0, L>0, d>0, finite; else NaN.
 */
export function youngFringeSpacing(
  lambda: number,
  L: number,
  d: number,
): number {
  if (
    !Number.isFinite(lambda) ||
    !Number.isFinite(L) ||
    !Number.isFinite(d) ||
    !(lambda > 0) ||
    !(L > 0) ||
    !(d > 0)
  ) {
    return NaN
  }
  return (lambda * L) / d
}

/**
 * Grating equation sin θ for order m:
 *   sin θ = m · λ / d
 *
 * Returns NaN if |m λ / d| > 1 (no real angle) or invalid inputs.
 * m may be 0 (central order → 0).
 */
export function gratingSinTheta(
  m: number,
  lambda: number,
  d: number,
): number {
  if (
    !Number.isFinite(m) ||
    !Number.isFinite(lambda) ||
    !Number.isFinite(d) ||
    !(lambda > 0) ||
    !(d > 0) ||
    !Number.isInteger(m)
  ) {
    return NaN
  }
  const s = (m * lambda) / d
  if (Math.abs(s) > 1) return NaN
  return s
}

/**
 * Grating diffraction angle (rad):
 *   θ = arcsin(m · λ / d)
 */
export function gratingTheta(m: number, lambda: number, d: number): number {
  const s = gratingSinTheta(m, lambda, d)
  if (!Number.isFinite(s)) return NaN
  return Math.asin(s)
}

/**
 * Young fringe sample: δy = λ L / d; ∝ λ, L; ∝ 1/d.
 */
export function runYoungFringeSample(opts?: {
  lambda?: number
  L?: number
  d?: number
}): {
  lambda: number
  L: number
  d: number
  deltaY: number
  deltaY_doubleLambda: number
  deltaY_doubleD: number
  deltaY_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_YOUNG_FRINGE
  familyId: typeof METHOD_YOUNG
} {
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA
  const L = opts?.L ?? DEFAULT_L
  const d = opts?.d ?? DEFAULT_D_SLIT

  const deltaY = youngFringeSpacing(lambda, L, d)
  const deltaY_doubleLambda = youngFringeSpacing(2 * lambda, L, d)
  const deltaY_doubleD = youngFringeSpacing(lambda, L, 2 * d)
  const deltaY_bad = youngFringeSpacing(lambda, L, 0)

  const finite =
    Number.isFinite(deltaY) &&
    Number.isFinite(deltaY_doubleLambda) &&
    Number.isFinite(deltaY_doubleD)

  const expected = (lambda * L) / d
  const formulaOk =
    Math.abs(deltaY - expected) < 1e-12 * Math.max(1e-30, Math.abs(deltaY))
  const linLamOk =
    Math.abs(deltaY_doubleLambda - 2 * deltaY) <
    1e-12 * Math.max(1e-30, Math.abs(deltaY))
  const invDOk =
    Math.abs(deltaY_doubleD - deltaY / 2) <
    1e-12 * Math.max(1e-30, Math.abs(deltaY))
  const badOk = !Number.isFinite(deltaY_bad)
  const positiveOk = deltaY > 0

  const ok =
    finite && formulaOk && linLamOk && invDOk && badOk && positiveOk

  return {
    lambda,
    L,
    d,
    deltaY,
    deltaY_doubleLambda,
    deltaY_doubleD,
    deltaY_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_YOUNG_FRINGE,
    familyId: METHOD_YOUNG,
  }
}

/**
 * Grating sample: sinθ = mλ/d; θ = asin(...); m=0 ⇒ 0; oversize m → NaN.
 */
export function runGratingOrderSample(opts?: {
  m?: number
  lambda?: number
  d?: number
}): {
  m: number
  lambda: number
  d: number
  sinTheta: number
  theta: number
  sinTheta_m0: number
  sinTheta_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_GRATING_ORDER
  familyId: typeof METHOD_GRATING
} {
  const m = opts?.m ?? DEFAULT_M
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA
  const d = opts?.d ?? DEFAULT_D_GRATING

  const sinTheta = gratingSinTheta(m, lambda, d)
  const theta = gratingTheta(m, lambda, d)
  const sinTheta_m0 = gratingSinTheta(0, lambda, d)
  // Force |m λ / d| > 1
  const sinTheta_bad = gratingSinTheta(1_000_000, lambda, d)

  const finite = Number.isFinite(sinTheta) && Number.isFinite(theta)

  const expected = (m * lambda) / d
  const formulaOk =
    Math.abs(sinTheta - expected) < 1e-14 * Math.max(1e-30, Math.abs(sinTheta))
  const thetaOk =
    Math.abs(theta - Math.asin(expected)) <
    1e-12 * Math.max(1e-30, Math.abs(theta))
  const m0Ok = Math.abs(sinTheta_m0) < 1e-30
  const badOk = !Number.isFinite(sinTheta_bad)
  const rangeOk = Math.abs(sinTheta) <= 1

  const ok = finite && formulaOk && thetaOk && m0Ok && badOk && rangeOk

  return {
    m,
    lambda,
    d,
    sinTheta,
    theta,
    sinTheta_m0,
    sinTheta_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_GRATING_ORDER,
    familyId: METHOD_GRATING,
  }
}
