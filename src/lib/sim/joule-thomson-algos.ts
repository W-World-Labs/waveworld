/**
 * Joule–Thomson expansion · pure teaching stub.
 * Temperature change ΔT = μ_JT · ΔP (teaching units).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Joule–Thomson effect. */
export const METHOD_JT = 'method-joule-thomson'

/** Algo · JT temperature shift ΔT = μ · ΔP. */
export const METHOD_ALGO_JT_MU = 'method-algo-jt-mu'

/** Parent alias (aligns with familyId). */
export const JT_PARENT = METHOD_JT

export const JT_METHOD_IDS = [METHOD_ALGO_JT_MU] as const

/**
 * Default teaching μ_JT (K/Pa).
 * 0.25e-5 K/Pa ≈ 0.25 K/bar-class toy order.
 */
export const DEFAULT_MU_JT = 0.25e-5

/** Default pressure drop ΔP for samples (Pa); 1 bar ≈ 1e5 Pa. */
export const DEFAULT_DELTA_P = 1e5

/**
 * Joule–Thomson temperature change (isenthalpic teaching):
 *   ΔT = μ_JT · ΔP
 *
 * μ_JT: Joule–Thomson coefficient (K/Pa teaching units),
 * ΔP: pressure change (Pa); expansion ΔP < 0 typically cools when μ>0.
 * Non-finite inputs → NaN.
 */
export function jtDeltaT(mu: number, deltaP: number): number {
  if (!Number.isFinite(mu) || !Number.isFinite(deltaP)) return NaN
  return mu * deltaP
}

/**
 * JT sample: μ=0.25e-5 K/Pa, ΔP=−1e5 Pa (1 bar drop) → ΔT = −0.25 K;
 * linear in ΔP; zero at ΔP=0.
 */
export function runJtMuSample(opts?: {
  mu?: number
  deltaP?: number
}): {
  mu: number
  deltaP: number
  dT: number
  dT_double: number
  dT_zero: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_JT_MU
  familyId: typeof METHOD_JT
} {
  const mu = opts?.mu ?? DEFAULT_MU_JT
  // Default: pressure drop (expansion) → negative ΔP
  const deltaP = opts?.deltaP ?? -DEFAULT_DELTA_P

  const dT = jtDeltaT(mu, deltaP)
  const dT_double = jtDeltaT(mu, 2 * deltaP)
  const dT_zero = jtDeltaT(mu, 0)

  const finite =
    Number.isFinite(dT) &&
    Number.isFinite(dT_double) &&
    Number.isFinite(dT_zero)

  const formulaOk = Math.abs(dT - mu * deltaP) < 1e-18 * Math.max(1, Math.abs(dT))
  const linOk =
    Math.abs(dT_double - 2 * dT) < 1e-18 * Math.max(1, Math.abs(dT))
  const zeroOk = Math.abs(dT_zero) < 1e-30
  // μ>0, ΔP<0 ⇒ cooling (dT<0)
  const coolOnExpand = mu > 0 && deltaP < 0 ? dT < 0 : true

  const ok = finite && formulaOk && linOk && zeroOk && coolOnExpand

  return {
    mu,
    deltaP,
    dT,
    dT_double,
    dT_zero,
    finite,
    ok,
    methodId: METHOD_ALGO_JT_MU,
    familyId: METHOD_JT,
  }
}
