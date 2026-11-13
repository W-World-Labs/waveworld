/**
 * Alfvén wave speed · pure teaching stubs.
 * vA = B / √(μ0 ρ)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Alfvén speed. */
export const METHOD_ALFVEN = 'method-alfven-speed'

/** Algo · Alfvén speed vA = B/√(μ0 ρ). */
export const METHOD_ALGO_ALFVEN_V = 'method-algo-alfven-v'

/** Parent alias (aligns with familyId). */
export const ALFVEN_PARENT = METHOD_ALFVEN

export const ALFVEN_METHOD_IDS = [METHOD_ALGO_ALFVEN_V] as const

/** Vacuum permeability μ0 (H/m). */
export const MU0 = 1.25663706212e-6

/** Default magnetic field B (T). */
export const DEFAULT_B = 1e-4

/** Default mass density ρ (kg/m³); lab-plasma class toy. */
export const DEFAULT_RHO = 1e-12

/**
 * Alfvén speed (m/s):
 *   vA = B / √(μ0 · ρ)
 *
 * B: magnetic field (T), rho: mass density (kg/m³), mu0: permeability.
 * Requires ρ>0, μ0>0, finite; else NaN.
 */
export function alfvenSpeed(
  B: number,
  rho: number,
  mu0: number = MU0,
): number {
  if (
    !Number.isFinite(B) ||
    !Number.isFinite(rho) ||
    !Number.isFinite(mu0) ||
    !(rho > 0) ||
    !(mu0 > 0)
  ) {
    return NaN
  }
  return Math.abs(B) / Math.sqrt(mu0 * rho)
}

/**
 * Alfvén sample: vA = B/√(μ0ρ); ∝ B; ∝ 1/√ρ.
 */
export function runAlfvenVSample(opts?: {
  B?: number
  rho?: number
}): {
  B: number
  rho: number
  mu0: number
  vA: number
  vA_doubleB: number
  vA_doubleRho: number
  vA_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_ALFVEN_V
  familyId: typeof METHOD_ALFVEN
} {
  const B = opts?.B ?? DEFAULT_B
  const rho = opts?.rho ?? DEFAULT_RHO

  const vA = alfvenSpeed(B, rho)
  const vA_doubleB = alfvenSpeed(2 * B, rho)
  const vA_doubleRho = alfvenSpeed(B, 2 * rho)
  const vA_bad = alfvenSpeed(B, 0)

  const finite =
    Number.isFinite(vA) &&
    Number.isFinite(vA_doubleB) &&
    Number.isFinite(vA_doubleRho)

  const expected = Math.abs(B) / Math.sqrt(MU0 * rho)
  const formulaOk =
    Math.abs(vA - expected) < 1e-12 * Math.max(1, Math.abs(vA))
  const linBOk =
    Math.abs(vA_doubleB - 2 * vA) < 1e-12 * Math.max(1, Math.abs(vA))
  const sqrtRhoOk =
    Math.abs(vA_doubleRho / vA - 1 / Math.SQRT2) < 1e-10
  const badOk = !Number.isFinite(vA_bad)
  const positiveOk = vA > 0

  const ok = finite && formulaOk && linBOk && sqrtRhoOk && badOk && positiveOk

  return {
    B,
    rho,
    mu0: MU0,
    vA,
    vA_doubleB,
    vA_doubleRho,
    vA_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_ALFVEN_V,
    familyId: METHOD_ALFVEN,
  }
}
