/**
 * Alphavoltaic power · pure teaching stubs.
 * P = η · A_activity · E_alpha  (conversion efficiency · activity · α energy).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · alphavoltaic conversion. */
export const METHOD_ALPHAVOLTAIC = 'method-alphavoltaic'

/** Algo · alphavoltaic electrical power. */
export const METHOD_ALGO_AV_POWER = 'method-algo-av-power'

/** Parent alias (aligns with familyId). */
export const AV_PARENT = METHOD_ALPHAVOLTAIC

export const AV_METHOD_IDS = [METHOD_ALGO_AV_POWER] as const

/** Default conversion efficiency η (dimensionless). */
export const DEFAULT_ETA = 0.05

/** Default activity (Bq = decays/s). */
export const DEFAULT_ACTIVITY = 1e9

/** Default α kinetic energy (J); ~5 MeV ≈ 8.01e-13 J. */
export const DEFAULT_E_ALPHA = 8.01e-13

/**
 * Alphavoltaic electrical power (W teaching):
 *   P = η · A_activity · E_alpha
 *
 * eta: conversion efficiency (0–1 teaching),
 * activityBq: source activity (Bq),
 * E_alpha_J: energy per alpha (J).
 * Non-finite inputs → NaN.
 */
export function avPower(
  eta: number,
  activityBq: number,
  E_alpha_J: number,
): number {
  if (
    !Number.isFinite(eta) ||
    !Number.isFinite(activityBq) ||
    !Number.isFinite(E_alpha_J)
  ) {
    return NaN
  }
  return eta * activityBq * E_alpha_J
}

/**
 * Alphavoltaic sample: P=η A E; linear in η, activity, E;
 * zero at η=0; positive for physical inputs.
 */
export function runAvPowerSample(opts?: {
  eta?: number
  activityBq?: number
  E_alpha_J?: number
}): {
  eta: number
  activityBq: number
  E_alpha_J: number
  P: number
  P_doubleEta: number
  P_zeroEta: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_AV_POWER
  familyId: typeof METHOD_ALPHAVOLTAIC
} {
  const eta = opts?.eta ?? DEFAULT_ETA
  const activityBq = opts?.activityBq ?? DEFAULT_ACTIVITY
  const E_alpha_J = opts?.E_alpha_J ?? DEFAULT_E_ALPHA

  const P = avPower(eta, activityBq, E_alpha_J)
  const P_doubleEta = avPower(2 * eta, activityBq, E_alpha_J)
  const P_zeroEta = avPower(0, activityBq, E_alpha_J)

  const finite =
    Number.isFinite(P) &&
    Number.isFinite(P_doubleEta) &&
    Number.isFinite(P_zeroEta)

  const expected = eta * activityBq * E_alpha_J
  const formulaOk =
    Math.abs(P - expected) < 1e-18 * Math.max(1e-30, Math.abs(P))
  const linOk =
    Math.abs(P_doubleEta - 2 * P) < 1e-18 * Math.max(1e-30, Math.abs(P))
  const zeroOk = Math.abs(P_zeroEta) < 1e-30
  const positiveOk = eta > 0 && activityBq > 0 && E_alpha_J > 0 ? P > 0 : true

  const ok = finite && formulaOk && linOk && zeroOk && positiveOk

  return {
    eta,
    activityBq,
    E_alpha_J,
    P,
    P_doubleEta,
    P_zeroEta,
    finite,
    ok,
    methodId: METHOD_ALGO_AV_POWER,
    familyId: METHOD_ALPHAVOLTAIC,
  }
}
