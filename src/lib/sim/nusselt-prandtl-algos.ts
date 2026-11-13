/**
 * Nusselt & Prandtl numbers · pure teaching stubs.
 * Nu = h L / k ;  Pr = μ cp / k
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Nusselt number. */
export const METHOD_NU = 'method-nusselt-number'

/** Algo · Nu = h L / k. */
export const METHOD_ALGO_NU = 'method-algo-nusselt'

/** Family · Prandtl number. */
export const METHOD_PR = 'method-prandtl-number'

/** Algo · Pr = μ cp / k. */
export const METHOD_ALGO_PR = 'method-algo-prandtl'

/** Parent aliases. */
export const NU_PARENT = METHOD_NU
export const PR_PARENT = METHOD_PR

export const NU_METHOD_IDS = [METHOD_ALGO_NU] as const
export const PR_METHOD_IDS = [METHOD_ALGO_PR] as const

/** Default heat-transfer coefficient h (W/(m²·K)). */
export const DEFAULT_H = 100

/** Default characteristic length L (m). */
export const DEFAULT_L = 0.1

/** Default thermal conductivity k (W/(m·K)). */
export const DEFAULT_K = 0.6

/** Default dynamic viscosity μ (Pa·s). */
export const DEFAULT_MU = 1e-3

/** Default specific heat cp (J/(kg·K)). */
export const DEFAULT_CP = 4180

/**
 * Nusselt number (dimensionless):
 *   Nu = h · L / k
 *
 * h: convection coefficient (W/(m²·K)), L: length (m), k: conductivity (W/(m·K)).
 * Requires finite inputs and k>0; else NaN.
 */
export function nusseltNumber(h: number, L: number, k: number): number {
  if (
    !Number.isFinite(h) ||
    !Number.isFinite(L) ||
    !Number.isFinite(k) ||
    !(k > 0)
  ) {
    return NaN
  }
  return (h * L) / k
}

/**
 * Prandtl number (dimensionless):
 *   Pr = μ · cp / k
 *
 * mu: viscosity (Pa·s), cp: specific heat (J/(kg·K)), k: conductivity (W/(m·K)).
 * Requires finite inputs and k>0; else NaN.
 */
export function prandtlNumber(mu: number, cp: number, k: number): number {
  if (
    !Number.isFinite(mu) ||
    !Number.isFinite(cp) ||
    !Number.isFinite(k) ||
    !(k > 0)
  ) {
    return NaN
  }
  return (mu * cp) / k
}

/**
 * Nusselt sample: Nu = hL/k; ∝ h, L; ∝ 1/k; k≤0 illegal.
 */
export function runNusseltSample(opts?: {
  h?: number
  L?: number
  k?: number
}): {
  h: number
  L: number
  k: number
  Nu: number
  Nu_doubleH: number
  Nu_halfK: number
  Nu_badK: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_NU
  familyId: typeof METHOD_NU
} {
  const h = opts?.h ?? DEFAULT_H
  const L = opts?.L ?? DEFAULT_L
  const k = opts?.k ?? DEFAULT_K

  const Nu = nusseltNumber(h, L, k)
  const Nu_doubleH = nusseltNumber(2 * h, L, k)
  const Nu_halfK = nusseltNumber(h, L, k / 2)
  const Nu_badK = nusseltNumber(h, L, 0)

  const finite =
    Number.isFinite(Nu) &&
    Number.isFinite(Nu_doubleH) &&
    Number.isFinite(Nu_halfK)

  const expected = (h * L) / k
  const formulaOk =
    Math.abs(Nu - expected) < 1e-12 * Math.max(1, Math.abs(Nu))
  const linHOk =
    Math.abs(Nu_doubleH - 2 * Nu) < 1e-12 * Math.max(1, Math.abs(Nu))
  const halfKOk =
    Math.abs(Nu_halfK - 2 * Nu) < 1e-12 * Math.max(1, Math.abs(Nu))
  const badOk = !Number.isFinite(Nu_badK)
  const positiveOk = Nu > 0

  const ok = finite && formulaOk && linHOk && halfKOk && badOk && positiveOk

  return {
    h,
    L,
    k,
    Nu,
    Nu_doubleH,
    Nu_halfK,
    Nu_badK,
    finite,
    ok,
    methodId: METHOD_ALGO_NU,
    familyId: METHOD_NU,
  }
}

/**
 * Prandtl sample: Pr = μ cp / k; ∝ μ, cp; ∝ 1/k; k≤0 illegal.
 */
export function runPrandtlSample(opts?: {
  mu?: number
  cp?: number
  k?: number
}): {
  mu: number
  cp: number
  k: number
  Pr: number
  Pr_doubleMu: number
  Pr_halfK: number
  Pr_badK: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PR
  familyId: typeof METHOD_PR
} {
  const mu = opts?.mu ?? DEFAULT_MU
  const cp = opts?.cp ?? DEFAULT_CP
  const k = opts?.k ?? DEFAULT_K

  const Pr = prandtlNumber(mu, cp, k)
  const Pr_doubleMu = prandtlNumber(2 * mu, cp, k)
  const Pr_halfK = prandtlNumber(mu, cp, k / 2)
  const Pr_badK = prandtlNumber(mu, cp, 0)

  const finite =
    Number.isFinite(Pr) &&
    Number.isFinite(Pr_doubleMu) &&
    Number.isFinite(Pr_halfK)

  const expected = (mu * cp) / k
  const formulaOk =
    Math.abs(Pr - expected) < 1e-12 * Math.max(1, Math.abs(Pr))
  const linMuOk =
    Math.abs(Pr_doubleMu - 2 * Pr) < 1e-12 * Math.max(1, Math.abs(Pr))
  const halfKOk =
    Math.abs(Pr_halfK - 2 * Pr) < 1e-12 * Math.max(1, Math.abs(Pr))
  const badOk = !Number.isFinite(Pr_badK)
  const positiveOk = Pr > 0

  const ok = finite && formulaOk && linMuOk && halfKOk && badOk && positiveOk

  return {
    mu,
    cp,
    k,
    Pr,
    Pr_doubleMu,
    Pr_halfK,
    Pr_badK,
    finite,
    ok,
    methodId: METHOD_ALGO_PR,
    familyId: METHOD_PR,
  }
}
