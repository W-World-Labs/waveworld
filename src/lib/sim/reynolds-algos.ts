/**
 * Reynolds number · pure teaching stubs.
 * Re = ρ U L / μ
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Reynolds number. */
export const METHOD_RE = 'method-reynolds-number'

/** Algo · Re = ρ U L / μ. */
export const METHOD_ALGO_RE = 'method-algo-reynolds'

/** Parent alias (aligns with familyId). */
export const RE_PARENT = METHOD_RE

export const RE_METHOD_IDS = [METHOD_ALGO_RE] as const

/** Default density ρ (kg/m³) — water-class. */
export const DEFAULT_RHO = 1000

/** Default free-stream speed U (m/s). */
export const DEFAULT_U = 1

/** Default characteristic length L (m). */
export const DEFAULT_L = 0.1

/** Default dynamic viscosity μ (Pa·s) — water ~1e-3. */
export const DEFAULT_MU = 1e-3

/**
 * Reynolds number (dimensionless):
 *   Re = ρ · U · L / μ
 *
 * rho: density (kg/m³), U: velocity (m/s), L: length (m), mu: viscosity (Pa·s).
 * Requires finite inputs and μ>0; else NaN.
 */
export function reynoldsNumber(
  rho: number,
  U: number,
  L: number,
  mu: number,
): number {
  if (
    !Number.isFinite(rho) ||
    !Number.isFinite(U) ||
    !Number.isFinite(L) ||
    !Number.isFinite(mu) ||
    !(mu > 0)
  ) {
    return NaN
  }
  return (rho * U * L) / mu
}

/**
 * Reynolds sample: Re = ρUL/μ; ∝ U, L, ρ; ∝ 1/μ; μ≤0 illegal.
 */
export function runReynoldsSample(opts?: {
  rho?: number
  U?: number
  L?: number
  mu?: number
}): {
  rho: number
  U: number
  L: number
  mu: number
  Re: number
  Re_doubleU: number
  Re_halfMu: number
  Re_badMu: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_RE
  familyId: typeof METHOD_RE
} {
  const rho = opts?.rho ?? DEFAULT_RHO
  const U = opts?.U ?? DEFAULT_U
  const L = opts?.L ?? DEFAULT_L
  const mu = opts?.mu ?? DEFAULT_MU

  const Re = reynoldsNumber(rho, U, L, mu)
  const Re_doubleU = reynoldsNumber(rho, 2 * U, L, mu)
  const Re_halfMu = reynoldsNumber(rho, U, L, mu / 2)
  const Re_badMu = reynoldsNumber(rho, U, L, 0)

  const finite =
    Number.isFinite(Re) &&
    Number.isFinite(Re_doubleU) &&
    Number.isFinite(Re_halfMu)

  const expected = (rho * U * L) / mu
  const formulaOk =
    Math.abs(Re - expected) < 1e-12 * Math.max(1, Math.abs(Re))
  const linUOk =
    Math.abs(Re_doubleU - 2 * Re) < 1e-12 * Math.max(1, Math.abs(Re))
  const halfMuOk =
    Math.abs(Re_halfMu - 2 * Re) < 1e-12 * Math.max(1, Math.abs(Re))
  const badOk = !Number.isFinite(Re_badMu)
  const positiveOk = Re > 0

  const ok = finite && formulaOk && linUOk && halfMuOk && badOk && positiveOk

  return {
    rho,
    U,
    L,
    mu,
    Re,
    Re_doubleU,
    Re_halfMu,
    Re_badMu,
    finite,
    ok,
    methodId: METHOD_ALGO_RE,
    familyId: METHOD_RE,
  }
}
