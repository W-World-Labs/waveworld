/**
 * Stokes' law drag · pure teaching stubs.
 * F = 6 π μ r v  (low-Re sphere).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Stokes drag. */
export const METHOD_STOKES = 'method-stokes-drag'

/** Algo · Stokes drag force F. */
export const METHOD_ALGO_STOKES_F = 'method-algo-stokes-force'

/** Parent alias (aligns with familyId). */
export const STOKES_PARENT = METHOD_STOKES

export const STOKES_METHOD_IDS = [METHOD_ALGO_STOKES_F] as const

/** Default viscosity μ (Pa·s); water. */
export const DEFAULT_MU = 1e-3

/** Default radius r (m). */
export const DEFAULT_R = 1e-6

/** Default speed v (m/s). */
export const DEFAULT_V = 1e-3

/**
 * Stokes drag force magnitude (N):
 *   F = 6 · π · μ · r · v
 *
 * mu: dynamic viscosity (Pa·s), r: radius (m), v: speed (m/s).
 * Non-finite → NaN.
 */
export function stokesForce(mu: number, r: number, v: number): number {
  if (!Number.isFinite(mu) || !Number.isFinite(r) || !Number.isFinite(v)) {
    return NaN
  }
  return 6 * Math.PI * mu * r * v
}

/**
 * Stokes sample: F = 6πμrv; linear in μ, r, v; zero at v=0.
 */
export function runStokesForceSample(opts?: {
  mu?: number
  r?: number
  v?: number
}): {
  mu: number
  r: number
  v: number
  F: number
  F_doubleV: number
  F_doubleR: number
  F_zeroV: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_STOKES_F
  familyId: typeof METHOD_STOKES
} {
  const mu = opts?.mu ?? DEFAULT_MU
  const r = opts?.r ?? DEFAULT_R
  const v = opts?.v ?? DEFAULT_V

  const F = stokesForce(mu, r, v)
  const F_doubleV = stokesForce(mu, r, 2 * v)
  const F_doubleR = stokesForce(mu, 2 * r, v)
  const F_zeroV = stokesForce(mu, r, 0)

  const finite =
    Number.isFinite(F) &&
    Number.isFinite(F_doubleV) &&
    Number.isFinite(F_doubleR) &&
    Number.isFinite(F_zeroV)

  const expected = 6 * Math.PI * mu * r * v
  const formulaOk =
    Math.abs(F - expected) < 1e-12 * Math.max(1e-30, Math.abs(F))
  const linVOk =
    Math.abs(F_doubleV - 2 * F) < 1e-12 * Math.max(1e-30, Math.abs(F))
  const linROk =
    Math.abs(F_doubleR - 2 * F) < 1e-12 * Math.max(1e-30, Math.abs(F))
  const zeroOk = Math.abs(F_zeroV) < 1e-30
  const positiveOk = F > 0

  const ok = finite && formulaOk && linVOk && linROk && zeroOk && positiveOk

  return {
    mu,
    r,
    v,
    F,
    F_doubleV,
    F_doubleR,
    F_zeroV,
    finite,
    ok,
    methodId: METHOD_ALGO_STOKES_F,
    familyId: METHOD_STOKES,
  }
}
