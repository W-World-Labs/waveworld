/**
 * Abbe number (V-number) · pure teaching stubs.
 * Vd = (nd − 1) / (nF − nC)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Abbe number (dispersion). */
export const METHOD_ABBE = 'method-abbe-number'

/** Algo · Abbe Vd = (nd − 1)/(nF − nC). */
export const METHOD_ALGO_ABBE_V = 'method-algo-abbe-v'

/** Parent alias (aligns with familyId). */
export const ABBE_PARENT = METHOD_ABBE

export const ABBE_METHOD_IDS = [METHOD_ALGO_ABBE_V] as const

/** Default d-line refractive index (He 587.6 nm, BK7-class toy). */
export const DEFAULT_ND = 1.5168

/** Default F-line refractive index (H 486.1 nm). */
export const DEFAULT_NF = 1.5224

/** Default C-line refractive index (H 656.3 nm). */
export const DEFAULT_NC = 1.5143

/**
 * Abbe number (dimensionless):
 *   Vd = (nd − 1) / (nF − nC)
 *
 * nd, nF, nC: refractive indices at d, F, C Fraunhofer lines.
 * Requires nF ≠ nC, finite; else NaN. Typical crown glass Vd ~ 50–65.
 */
export function abbeNumber(nd: number, nF: number, nC: number): number {
  if (
    !Number.isFinite(nd) ||
    !Number.isFinite(nF) ||
    !Number.isFinite(nC) ||
    nF === nC
  ) {
    return NaN
  }
  return (nd - 1) / (nF - nC)
}

/**
 * Abbe sample: Vd = (nd−1)/(nF−nC); high dispersion ⇒ lower Vd.
 */
export function runAbbeVSample(opts?: {
  nd?: number
  nF?: number
  nC?: number
}): {
  nd: number
  nF: number
  nC: number
  Vd: number
  Vd_highDisp: number
  Vd_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_ABBE_V
  familyId: typeof METHOD_ABBE
} {
  const nd = opts?.nd ?? DEFAULT_ND
  const nF = opts?.nF ?? DEFAULT_NF
  const nC = opts?.nC ?? DEFAULT_NC

  const Vd = abbeNumber(nd, nF, nC)
  // larger nF−nC (more dispersion) → smaller Vd
  const Vd_highDisp = abbeNumber(nd, nF + 0.01, nC)
  const Vd_bad = abbeNumber(nd, nF, nF)

  const finite = Number.isFinite(Vd) && Number.isFinite(Vd_highDisp)

  const expected = (nd - 1) / (nF - nC)
  const formulaOk =
    Math.abs(Vd - expected) < 1e-12 * Math.max(1, Math.abs(Vd))
  const dispOk = Vd_highDisp < Vd
  const positiveOk = Vd > 0
  const badOk = !Number.isFinite(Vd_bad)

  const ok = finite && formulaOk && dispOk && positiveOk && badOk

  return {
    nd,
    nF,
    nC,
    Vd,
    Vd_highDisp,
    Vd_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_ABBE_V,
    familyId: METHOD_ABBE,
  }
}
