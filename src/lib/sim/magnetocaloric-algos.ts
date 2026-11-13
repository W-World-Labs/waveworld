/**
 * Magnetocaloric effect · pure teaching stub.
 * Adiabatic ΔT ≈ −(T/C) (∂M/∂T) μ0 dH  (finite-difference form).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · magnetocaloric effect. */
export const METHOD_MCE = 'method-magnetocaloric'

/** Algo · adiabatic temperature change ΔT_ad. */
export const METHOD_ALGO_MCE_DT = 'method-algo-mce-delta-t'

/** Parent alias (aligns with familyId). */
export const MCE_PARENT = METHOD_MCE

export const MCE_METHOD_IDS = [METHOD_ALGO_MCE_DT] as const

/**
 * Simplified adiabatic magnetocaloric temperature change:
 *   ΔT_ad = − (T / C) · (∂M/∂T) · μ0_dH
 *
 * From ΔT_ad = −∫ (T/C_H)(∂M/∂T)_H dH with one-step finite dH.
 * T: temperature (K), C: heat capacity per volume (or same units as M·dH),
 * dMdT: (∂M/∂T)_H (A/(m·K) SI-ish teaching),
 * mu0_dH: μ0 ΔH field step (T if μ0 H in tesla teaching units).
 *
 * For ferromagnets near Tc, (∂M/∂T)<0 so +field step ⇒ +ΔT (heating on
 * magnetization). Requires T>0, C≠0, all finite; else NaN.
 */
export function adiabaticDeltaT(
  T: number,
  C: number,
  dMdT: number,
  mu0_dH: number,
): number {
  if (
    !Number.isFinite(T) ||
    !Number.isFinite(C) ||
    !Number.isFinite(dMdT) ||
    !Number.isFinite(mu0_dH) ||
    !(T > 0) ||
    C === 0
  ) {
    return NaN
  }
  return -(T / C) * dMdT * mu0_dH
}

/** Alias matching method naming. */
export const mceDeltaT = adiabaticDeltaT

/**
 * MCE sample: ferro near Tc with dMdT<0 → +ΔT on +μ0 dH (heating).
 */
export function runMceDeltaTSample(opts?: {
  T?: number
  C?: number
  dMdT?: number
  mu0_dH?: number
}): {
  T: number
  C: number
  dMdT: number
  mu0_dH: number
  dT: number
  dT_doubleField: number
  dT_reverseField: number
  dT_badC: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MCE_DT
  familyId: typeof METHOD_MCE
} {
  // Teaching ferro near Tc: T=300 K, C large, dMdT negative, μ0 ΔH = 1 T
  const T = opts?.T ?? 300
  const C = opts?.C ?? 3e6 // J/(m³·K) order toy
  const dMdT = opts?.dMdT ?? -1e5 // A/(m·K) negative
  const mu0_dH = opts?.mu0_dH ?? 1 // T

  const dT = adiabaticDeltaT(T, C, dMdT, mu0_dH)
  const dT_doubleField = adiabaticDeltaT(T, C, dMdT, 2 * mu0_dH)
  const dT_reverseField = adiabaticDeltaT(T, C, dMdT, -mu0_dH)
  const dT_badC = adiabaticDeltaT(T, 0, dMdT, mu0_dH)

  const finite =
    Number.isFinite(dT) &&
    Number.isFinite(dT_doubleField) &&
    Number.isFinite(dT_reverseField)

  const expected = -(T / C) * dMdT * mu0_dH
  const formulaOk = Math.abs(dT - expected) < 1e-12 * Math.max(1, Math.abs(dT))
  // dMdT < 0, +μ0dH ⇒ dT > 0 (heating on magnetization)
  const heatOnMagnetize = dMdT < 0 && mu0_dH > 0 ? dT > 0 : true
  const linField =
    Math.abs(dT_doubleField - 2 * dT) < 1e-12 * Math.max(1, Math.abs(dT))
  const antisym =
    Math.abs(dT_reverseField + dT) < 1e-12 * Math.max(1, Math.abs(dT))
  const badOk = !Number.isFinite(dT_badC)

  const ok = finite && formulaOk && heatOnMagnetize && linField && antisym && badOk

  return {
    T,
    C,
    dMdT,
    mu0_dH,
    dT,
    dT_doubleField,
    dT_reverseField,
    dT_badC,
    finite,
    ok,
    methodId: METHOD_ALGO_MCE_DT,
    familyId: METHOD_MCE,
  }
}
