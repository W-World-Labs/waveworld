/**
 * Hybrid-π BJT small-signal · pure teaching stubs.
 * gm = Ic / VT  with VT = kT/q ≈ 0.026 V at room temp
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · hybrid-π model. */
export const METHOD_HYBRID_PI = 'method-hybrid-pi'

/** Algo · transconductance gm = Ic / VT. */
export const METHOD_ALGO_GM = 'method-algo-gm'

/** Parent alias. */
export const HYBRID_PI_PARENT = METHOD_HYBRID_PI

export const HYBRID_PI_METHOD_IDS = [METHOD_ALGO_GM] as const

/** Thermal voltage VT at ~300 K (V). */
export const VT_ROOM = 0.026

/** Default collector current Ic (A). */
export const DEFAULT_IC = 1e-3

/** Default thermal voltage VT (V). */
export const DEFAULT_VT = VT_ROOM

/**
 * BJT/MOS teaching transconductance (S = A/V):
 *   gm = Ic / VT
 *
 * Ic: collector (or drain bias) current (A), VT: thermal voltage (V).
 * Requires finite Ic and VT>0; else NaN.
 */
export function transconductanceGm(Ic: number, VT: number = VT_ROOM): number {
  if (!Number.isFinite(Ic) || !Number.isFinite(VT) || !(VT > 0)) {
    return NaN
  }
  return Ic / VT
}

/**
 * Thermal voltage (V):
 *   VT = k T / q
 *
 * T: temperature (K). Uses k=1.380649e-23, q=1.602176634e-19.
 * Requires T>0, finite; else NaN.
 */
export function thermalVoltage(T: number): number {
  if (!Number.isFinite(T) || !(T > 0)) return NaN
  const k = 1.380649e-23
  const q = 1.602176634e-19
  return (k * T) / q
}

/**
 * Hybrid-π gm sample: gm = Ic/VT; ∝ Ic; ∝ 1/VT; VT≤0 illegal.
 */
export function runGmSample(opts?: {
  Ic?: number
  VT?: number
}): {
  Ic: number
  VT: number
  gm: number
  gm_doubleIc: number
  gm_halfVT: number
  gm_badVT: number
  VT_fromT: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_GM
  familyId: typeof METHOD_HYBRID_PI
} {
  const Ic = opts?.Ic ?? DEFAULT_IC
  const VT = opts?.VT ?? DEFAULT_VT

  const gm = transconductanceGm(Ic, VT)
  const gm_doubleIc = transconductanceGm(2 * Ic, VT)
  const gm_halfVT = transconductanceGm(Ic, VT / 2)
  const gm_badVT = transconductanceGm(Ic, 0)
  const VT_fromT = thermalVoltage(300)

  const finite =
    Number.isFinite(gm) &&
    Number.isFinite(gm_doubleIc) &&
    Number.isFinite(gm_halfVT) &&
    Number.isFinite(VT_fromT)

  const expected = Ic / VT
  const formulaOk =
    Math.abs(gm - expected) < 1e-12 * Math.max(1, Math.abs(gm))
  const linIcOk =
    Math.abs(gm_doubleIc - 2 * gm) < 1e-12 * Math.max(1, Math.abs(gm))
  const halfVTOk =
    Math.abs(gm_halfVT - 2 * gm) < 1e-12 * Math.max(1, Math.abs(gm))
  const badOk = !Number.isFinite(gm_badVT)
  // room-temp VT ~ 25–26 mV
  const vtOk = VT_fromT > 0.025 && VT_fromT < 0.027
  const positiveOk = gm > 0

  const ok =
    finite && formulaOk && linIcOk && halfVTOk && badOk && vtOk && positiveOk

  return {
    Ic,
    VT,
    gm,
    gm_doubleIc,
    gm_halfVT,
    gm_badVT,
    VT_fromT,
    finite,
    ok,
    methodId: METHOD_ALGO_GM,
    familyId: METHOD_HYBRID_PI,
  }
}
