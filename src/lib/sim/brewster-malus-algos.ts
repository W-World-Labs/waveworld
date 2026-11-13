/**
 * Brewster angle + Malus' law · pure teaching stubs.
 * θ_B = atan(n2/n1); I = I0 cos²(θ)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Brewster angle. */
export const METHOD_BREWSTER = 'method-brewster'

/** Algo · Brewster angle θ_B. */
export const METHOD_ALGO_BREWSTER = 'method-algo-brewster-angle'

/** Family · Malus polarization law. */
export const METHOD_MALUS = 'method-malus-law'

/** Algo · transmitted intensity I = I0 cos²θ. */
export const METHOD_ALGO_MALUS = 'method-algo-malus-i'

/** Parent aliases. */
export const BREWSTER_PARENT = METHOD_BREWSTER
export const MALUS_PARENT = METHOD_MALUS

export const BREWSTER_METHOD_IDS = [METHOD_ALGO_BREWSTER] as const
export const MALUS_METHOD_IDS = [METHOD_ALGO_MALUS] as const

export const BREWSTER_MALUS_METHOD_IDS = [
  METHOD_ALGO_BREWSTER,
  METHOD_ALGO_MALUS,
] as const

/** Default n1 (incident medium); air. */
export const DEFAULT_N1 = 1

/** Default n2 (transmitted medium); glass. */
export const DEFAULT_N2 = 1.5

/** Default incident intensity I0. */
export const DEFAULT_I0 = 1

/** Default polarizer angle θ (rad). */
export const DEFAULT_THETA = Math.PI / 4

/**
 * Brewster angle (radians):
 *   θ_B = arctan(n2 / n1)
 *
 * Requires n1>0, n2>0, finite; else NaN.
 */
export function brewsterAngle(n1: number, n2: number): number {
  if (
    !Number.isFinite(n1) ||
    !Number.isFinite(n2) ||
    !(n1 > 0) ||
    !(n2 > 0)
  ) {
    return NaN
  }
  return Math.atan(n2 / n1)
}

/**
 * Malus' law transmitted intensity:
 *   I = I0 · cos²(θ)
 *
 * I0: incident intensity, theta: angle between polarizer axes (rad).
 * Non-finite → NaN.
 */
export function malusIntensity(I0: number, theta: number): number {
  if (!Number.isFinite(I0) || !Number.isFinite(theta)) return NaN
  const c = Math.cos(theta)
  return I0 * c * c
}

/**
 * Brewster sample: θ_B = atan(n2/n1); air→glass ≈ 56.3°; swap n.
 */
export function runBrewsterSample(opts?: {
  n1?: number
  n2?: number
}): {
  n1: number
  n2: number
  thetaB: number
  thetaB_swapped: number
  thetaB_equalN: number
  thetaB_badN: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BREWSTER
  familyId: typeof METHOD_BREWSTER
} {
  const n1 = opts?.n1 ?? DEFAULT_N1
  const n2 = opts?.n2 ?? DEFAULT_N2

  const thetaB = brewsterAngle(n1, n2)
  const thetaB_swapped = brewsterAngle(n2, n1)
  const thetaB_equalN = brewsterAngle(n1, n1)
  const thetaB_badN = brewsterAngle(0, n2)

  const finite =
    Number.isFinite(thetaB) &&
    Number.isFinite(thetaB_swapped) &&
    Number.isFinite(thetaB_equalN)

  const expected = Math.atan(n2 / n1)
  const formulaOk = Math.abs(thetaB - expected) < 1e-14
  // equal n ⇒ 45°
  const equalOk = Math.abs(thetaB_equalN - Math.PI / 4) < 1e-14
  // n2>n1 ⇒ θ_B > π/4
  const denserOk = n2 > n1 ? thetaB > Math.PI / 4 : true
  // tan(θ_B_swapped) = n1/n2 = 1/tan(θ_B) complementary relation
  const swapOk =
    Math.abs(Math.tan(thetaB) * Math.tan(thetaB_swapped) - 1) < 1e-12
  const badOk = !Number.isFinite(thetaB_badN)
  const positiveOk = thetaB > 0

  const ok =
    finite && formulaOk && equalOk && denserOk && swapOk && badOk && positiveOk

  return {
    n1,
    n2,
    thetaB,
    thetaB_swapped,
    thetaB_equalN,
    thetaB_badN,
    finite,
    ok,
    methodId: METHOD_ALGO_BREWSTER,
    familyId: METHOD_BREWSTER,
  }
}

/**
 * Malus sample: I = I0 cos²θ; θ=0 ⇒ I0; θ=π/2 ⇒ 0; θ=π/4 ⇒ I0/2.
 */
export function runMalusSample(opts?: {
  I0?: number
  theta?: number
}): {
  I0: number
  theta: number
  I: number
  I_aligned: number
  I_crossed: number
  I_45: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MALUS
  familyId: typeof METHOD_MALUS
} {
  const I0 = opts?.I0 ?? DEFAULT_I0
  const theta = opts?.theta ?? DEFAULT_THETA

  const I = malusIntensity(I0, theta)
  const I_aligned = malusIntensity(I0, 0)
  const I_crossed = malusIntensity(I0, Math.PI / 2)
  const I_45 = malusIntensity(I0, Math.PI / 4)

  const finite =
    Number.isFinite(I) &&
    Number.isFinite(I_aligned) &&
    Number.isFinite(I_crossed) &&
    Number.isFinite(I_45)

  const c = Math.cos(theta)
  const expected = I0 * c * c
  const formulaOk =
    Math.abs(I - expected) < 1e-12 * Math.max(1e-30, Math.abs(I))
  const alignedOk = Math.abs(I_aligned - I0) < 1e-15 * Math.max(1, Math.abs(I0))
  const crossedOk = Math.abs(I_crossed) < 1e-15
  const halfOk =
    Math.abs(I_45 - I0 / 2) < 1e-12 * Math.max(1e-30, Math.abs(I0))
  const nonNegOk = I >= 0

  const ok =
    finite && formulaOk && alignedOk && crossedOk && halfOk && nonNegOk

  return {
    I0,
    theta,
    I,
    I_aligned,
    I_crossed,
    I_45,
    finite,
    ok,
    methodId: METHOD_ALGO_MALUS,
    familyId: METHOD_MALUS,
  }
}
