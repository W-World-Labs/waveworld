/**
 * Miller capacitance · pure teaching stubs.
 * Cin = Cgs + Cgd · (1 + gm · RL)  with Av = gm · RL.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Miller effect capacitance. */
export const METHOD_MILLER = 'method-miller-capacitance'

/** Algo · input capacitance with Miller multiplication. */
export const METHOD_ALGO_MILLER_CIN = 'method-algo-miller-cin'

/** Parent alias (aligns with familyId). */
export const MILLER_PARENT = METHOD_MILLER

export const MILLER_METHOD_IDS = [METHOD_ALGO_MILLER_CIN] as const

/** Default gate–source capacitance Cgs (F). */
export const DEFAULT_CGS = 1e-12

/** Default gate–drain capacitance Cgd (F). */
export const DEFAULT_CGD = 0.2e-12

/** Default transconductance gm (S). */
export const DEFAULT_GM = 0.01

/** Default load resistance RL (Ω). */
export const DEFAULT_RL = 1000

/**
 * Miller-amplified input capacitance (F):
 *   Cin = Cgs + Cgd · (1 + gm · RL)
 *       = Cgs + Cgd · (1 + Av)    with Av = gm · RL
 *
 * Requires finite inputs; capacitances and gm, RL unrestricted in sign
 * for teaching algebra (typical use: all ≥ 0).
 */
export function millerCin(
  Cgs: number,
  Cgd: number,
  gm: number,
  RL: number,
): number {
  if (
    !Number.isFinite(Cgs) ||
    !Number.isFinite(Cgd) ||
    !Number.isFinite(gm) ||
    !Number.isFinite(RL)
  ) {
    return NaN
  }
  return Cgs + Cgd * (1 + gm * RL)
}

/**
 * Effective Miller Cgd:
 *   Cgd_eff = Cgd · (1 + Av),  Av = gm · RL
 */
export function millerCgdEff(Cgd: number, gm: number, RL: number): number {
  if (
    !Number.isFinite(Cgd) ||
    !Number.isFinite(gm) ||
    !Number.isFinite(RL)
  ) {
    return NaN
  }
  return Cgd * (1 + gm * RL)
}

/**
 * Miller Cin sample: Cin = Cgs + Cgd(1+gm RL); Av = gm RL.
 */
export function runMillerCinSample(opts?: {
  Cgs?: number
  Cgd?: number
  gm?: number
  RL?: number
}): {
  Cgs: number
  Cgd: number
  gm: number
  RL: number
  Av: number
  Cin: number
  Cgd_eff: number
  Cin_zeroGm: number
  Cin_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MILLER_CIN
  familyId: typeof METHOD_MILLER
} {
  const Cgs = opts?.Cgs ?? DEFAULT_CGS
  const Cgd = opts?.Cgd ?? DEFAULT_CGD
  const gm = opts?.gm ?? DEFAULT_GM
  const RL = opts?.RL ?? DEFAULT_RL

  const Av = gm * RL
  const Cin = millerCin(Cgs, Cgd, gm, RL)
  const Cgd_eff = millerCgdEff(Cgd, gm, RL)
  const Cin_zeroGm = millerCin(Cgs, Cgd, 0, RL)
  const Cin_bad = millerCin(Cgs, Cgd, NaN, RL)

  const finite =
    Number.isFinite(Cin) &&
    Number.isFinite(Cgd_eff) &&
    Number.isFinite(Cin_zeroGm)

  const formulaOk =
    Math.abs(Cin - (Cgs + Cgd * (1 + Av))) <
    1e-18 * Math.max(1e-30, Math.abs(Cin))
  const effOk =
    Math.abs(Cgd_eff - Cgd * (1 + Av)) <
    1e-18 * Math.max(1e-30, Math.abs(Cgd_eff))
  const splitOk =
    Math.abs(Cin - (Cgs + Cgd_eff)) <
    1e-18 * Math.max(1e-30, Math.abs(Cin))
  const zeroGmOk =
    Math.abs(Cin_zeroGm - (Cgs + Cgd)) <
    1e-18 * Math.max(1e-30, Math.abs(Cin_zeroGm))
  const badOk = !Number.isFinite(Cin_bad)
  const boostOk = Cin > Cgs + Cgd

  const ok =
    finite && formulaOk && effOk && splitOk && zeroGmOk && badOk && boostOk

  return {
    Cgs,
    Cgd,
    gm,
    RL,
    Av,
    Cin,
    Cgd_eff,
    Cin_zeroGm,
    Cin_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_MILLER_CIN,
    familyId: METHOD_MILLER,
  }
}
