/**
 * Modulation transfer function (contrast) · pure teaching stubs.
 * MTF = (Imax − Imin) / (Imax + Imin)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · MTF / contrast transfer. */
export const METHOD_MTF = 'method-mtf'

/** Algo · contrast MTF from Imax, Imin. */
export const METHOD_ALGO_MTF = 'method-algo-mtf-contrast'

/** Parent alias. */
export const MTF_PARENT = METHOD_MTF

export const MTF_METHOD_IDS = [METHOD_ALGO_MTF] as const

/** Default peak intensity Imax (a.u.). */
export const DEFAULT_IMAX = 1

/** Default trough intensity Imin (a.u.). */
export const DEFAULT_IMIN = 0.5

/**
 * Contrast / modulation transfer (dimensionless, teaching):
 *   MTF = (Imax − Imin) / (Imax + Imin)
 *
 * Typically 0 ≤ MTF ≤ 1 when Imax ≥ Imin ≥ 0.
 * Requires finite Imax, Imin and (Imax+Imin) ≠ 0; else NaN.
 */
export function mtfContrast(Imax: number, Imin: number): number {
  if (!Number.isFinite(Imax) || !Number.isFinite(Imin)) return NaN
  const sum = Imax + Imin
  if (sum === 0) return NaN
  return (Imax - Imin) / sum
}

/**
 * MTF sample: contrast formula; full contrast Imin=0 ⇒ 1; equal ⇒ 0.
 */
export function runMtfSample(opts?: {
  Imax?: number
  Imin?: number
}): {
  Imax: number
  Imin: number
  MTF: number
  MTF_full: number
  MTF_flat: number
  MTF_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MTF
  familyId: typeof METHOD_MTF
} {
  const Imax = opts?.Imax ?? DEFAULT_IMAX
  const Imin = opts?.Imin ?? DEFAULT_IMIN

  const MTF = mtfContrast(Imax, Imin)
  const MTF_full = mtfContrast(Imax, 0)
  const MTF_flat = mtfContrast(Imax, Imax)
  const MTF_bad = mtfContrast(0, 0)

  const finite =
    Number.isFinite(MTF) &&
    Number.isFinite(MTF_full) &&
    Number.isFinite(MTF_flat)

  const expected = (Imax - Imin) / (Imax + Imin)
  const formulaOk =
    Math.abs(MTF - expected) < 1e-12 * Math.max(1, Math.abs(MTF))
  const fullOk = Math.abs(MTF_full - 1) < 1e-18
  const flatOk = Math.abs(MTF_flat) < 1e-18
  const rangeOk = MTF >= 0 && MTF <= 1
  const badOk = !Number.isFinite(MTF_bad)

  const ok = finite && formulaOk && fullOk && flatOk && rangeOk && badOk

  return {
    Imax,
    Imin,
    MTF,
    MTF_full,
    MTF_flat,
    MTF_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_MTF,
    familyId: METHOD_MTF,
  }
}
