/**
 * Sellmeier equation · pure teaching stubs.
 * One-term: n² = 1 + B λ² / (λ² − C), λ in µm.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · Sellmeier refractive index. */
export const METHOD_SELLMEIER = 'method-sellmeier'

/** Algo · refractive index n from Sellmeier. */
export const METHOD_ALGO_SELLMEIER_N = 'method-algo-sellmeier-n'

/** Parent alias (aligns with familyId). */
export const SELLMEIER_PARENT = METHOD_SELLMEIER

export const SELLMEIER_METHOD_IDS = [METHOD_ALGO_SELLMEIER_N] as const

/** Default Sellmeier B (dimensionless); silica-ish one-term toy. */
export const DEFAULT_B = 1.03961212

/** Default Sellmeier C (µm²). */
export const DEFAULT_C = 0.00600069867

/** Default wavelength λ (µm). */
export const DEFAULT_LAM = 0.5876

/**
 * One-term Sellmeier refractive index:
 *   n = √( 1 + B · λ² / (λ² − C) )
 *
 * λ: wavelength in micrometres (µm). Requires λ² > C (above resonance),
 * B>0, C>0 (or C finite), finite inputs; else NaN.
 * When C ≤ 0 the pole is not in positive λ²; still evaluated if denom ≠ 0.
 */
export function sellmeierN(lam_um: number, B: number, C: number): number {
  if (
    !Number.isFinite(lam_um) ||
    !Number.isFinite(B) ||
    !Number.isFinite(C) ||
    !(lam_um > 0)
  ) {
    return NaN
  }
  const lam2 = lam_um * lam_um
  const denom = lam2 - C
  if (!(denom > 0)) return NaN
  const n2 = 1 + (B * lam2) / denom
  if (!(n2 > 0)) return NaN
  return Math.sqrt(n2)
}

/**
 * Multi-term Sellmeier n² = 1 + Σ B_i λ² / (λ² − C_i).
 * terms: array of { B, C } with C in µm².
 */
export function sellmeierNMulti(
  lam_um: number,
  terms: ReadonlyArray<{ B: number; C: number }>,
): number {
  if (!Number.isFinite(lam_um) || !(lam_um > 0) || terms.length === 0) {
    return NaN
  }
  const lam2 = lam_um * lam_um
  let n2 = 1
  for (const t of terms) {
    if (!Number.isFinite(t.B) || !Number.isFinite(t.C)) return NaN
    const denom = lam2 - t.C
    if (!(denom > 0)) return NaN
    n2 += (t.B * lam2) / denom
  }
  if (!(n2 > 0)) return NaN
  return Math.sqrt(n2)
}

/**
 * Sellmeier sample: n = √(1 + B λ²/(λ²−C)); n>1; pole at λ²=C → NaN.
 */
export function runSellmeierNSample(opts?: {
  lam_um?: number
  B?: number
  C?: number
}): {
  lam_um: number
  B: number
  C: number
  n: number
  n2: number
  n_nearPole: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SELLMEIER_N
  familyId: typeof METHOD_SELLMEIER
} {
  const lam_um = opts?.lam_um ?? DEFAULT_LAM
  const B = opts?.B ?? DEFAULT_B
  const C = opts?.C ?? DEFAULT_C

  const n = sellmeierN(lam_um, B, C)
  const lam2 = lam_um * lam_um
  const n2 = 1 + (B * lam2) / (lam2 - C)
  // sub-resonance λ² < C ⇒ NaN (avoid √C float pole miss)
  const n_nearPole = sellmeierN(Math.sqrt(C) * 0.5, B, C)

  const finite = Number.isFinite(n) && Number.isFinite(n2)

  const formulaOk = Math.abs(n - Math.sqrt(n2)) < 1e-12 * Math.max(1, n)
  const n2Ok =
    Math.abs(n * n - n2) < 1e-10 * Math.max(1, n2)
  const aboveOne = n > 1
  const poleOk = !Number.isFinite(n_nearPole)
  // multi-term with one term matches
  const multi = sellmeierNMulti(lam_um, [{ B, C }])
  const multiOk =
    Number.isFinite(multi) &&
    Math.abs(multi - n) < 1e-12 * Math.max(1, n)

  const ok = finite && formulaOk && n2Ok && aboveOne && poleOk && multiOk

  return {
    lam_um,
    B,
    C,
    n,
    n2,
    n_nearPole,
    finite,
    ok,
    methodId: METHOD_ALGO_SELLMEIER_N,
    familyId: METHOD_SELLMEIER,
  }
}
