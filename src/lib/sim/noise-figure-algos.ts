/**
 * Noise figure / Friis cascade · pure teaching stubs.
 * F = F1 + (F2−1)/G1 + (F3−1)/(G1 G2); NF_dB = 10 log10(F).
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · noise figure. */
export const METHOD_NF = 'method-noise-figure'

/** Algo · Friis cascade noise factor. */
export const METHOD_ALGO_FRIIS_NF = 'method-algo-friis-nf'

/** Parent alias (aligns with familyId). */
export const NF_PARENT = METHOD_NF

export const NF_METHOD_IDS = [METHOD_ALGO_FRIIS_NF] as const

/** Default stage-1 noise factor F1 (linear). */
export const DEFAULT_F1 = 2

/** Default stage-1 available gain G1 (linear). */
export const DEFAULT_G1 = 10

/** Default stage-2 noise factor F2 (linear). */
export const DEFAULT_F2 = 3

/** Default stage-2 gain G2 (linear). */
export const DEFAULT_G2 = 10

/** Default stage-3 noise factor F3 (linear). */
export const DEFAULT_F3 = 4

/**
 * Convert noise factor F (linear) to noise figure (dB):
 *   NF_dB = 10 · log10(F)
 *
 * Requires F>0, finite; else NaN.
 */
export function noiseFigureDb(F: number): number {
  if (!Number.isFinite(F) || !(F > 0)) return NaN
  return 10 * Math.log10(F)
}

/**
 * Convert noise figure (dB) to linear noise factor:
 *   F = 10^(NF_dB / 10)
 */
export function noiseFactorFromDb(nfDb: number): number {
  if (!Number.isFinite(nfDb)) return NaN
  return 10 ** (nfDb / 10)
}

/**
 * Friis cascade noise factor (linear) for up to 3 stages:
 *   F = F1 + (F2 − 1)/G1 + (F3 − 1)/(G1 · G2)
 *
 * All F_i, G_i linear (not dB). Requires F1≥1 (physically ≥1 for passive
 * at T0, but we only require F_i>0, G_i>0 for numerical validity).
 * Omit stage 3 by leaving F3 undefined / NaN treated as unused via opts.
 */
export function friisNoiseFactor(
  F1: number,
  G1: number,
  F2: number,
  G2?: number,
  F3?: number,
): number {
  if (
    !Number.isFinite(F1) ||
    !Number.isFinite(G1) ||
    !Number.isFinite(F2) ||
    !(F1 > 0) ||
    !(G1 > 0) ||
    !(F2 > 0)
  ) {
    return NaN
  }
  let F = F1 + (F2 - 1) / G1
  if (F3 !== undefined && Number.isFinite(F3)) {
    if (!Number.isFinite(G2!) || !(G2! > 0) || !(F3 > 0)) return NaN
    F += (F3 - 1) / (G1 * G2!)
  }
  return F
}

/**
 * Friis sample: 3-stage cascade; NF dB; G1↑ reduces later-stage impact.
 */
export function runFriisNfSample(opts?: {
  F1?: number
  G1?: number
  F2?: number
  G2?: number
  F3?: number
}): {
  F1: number
  G1: number
  F2: number
  G2: number
  F3: number
  F: number
  NF_dB: number
  F_twoStage: number
  F_highG1: number
  F_badG: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FRIIS_NF
  familyId: typeof METHOD_NF
} {
  const F1 = opts?.F1 ?? DEFAULT_F1
  const G1 = opts?.G1 ?? DEFAULT_G1
  const F2 = opts?.F2 ?? DEFAULT_F2
  const G2 = opts?.G2 ?? DEFAULT_G2
  const F3 = opts?.F3 ?? DEFAULT_F3

  const F = friisNoiseFactor(F1, G1, F2, G2, F3)
  const NF_dB = noiseFigureDb(F)
  const F_twoStage = friisNoiseFactor(F1, G1, F2)
  const F_highG1 = friisNoiseFactor(F1, 100 * G1, F2, G2, F3)
  const F_badG = friisNoiseFactor(F1, 0, F2)

  const finite =
    Number.isFinite(F) &&
    Number.isFinite(NF_dB) &&
    Number.isFinite(F_twoStage) &&
    Number.isFinite(F_highG1)

  const expected = F1 + (F2 - 1) / G1 + (F3 - 1) / (G1 * G2)
  const formulaOk =
    Math.abs(F - expected) < 1e-12 * Math.max(1, Math.abs(F))
  const twoOk =
    Math.abs(F_twoStage - (F1 + (F2 - 1) / G1)) <
    1e-12 * Math.max(1, Math.abs(F_twoStage))
  const dbOk =
    Math.abs(NF_dB - 10 * Math.log10(F)) < 1e-12 * Math.max(1, Math.abs(NF_dB))
  // higher G1 → F closer to F1 (later stages diluted)
  const highG1Ok = F_highG1 < F && F_highG1 > F1
  const badOk = !Number.isFinite(F_badG)
  const positiveOk = F > 0 && F >= F1

  const ok =
    finite && formulaOk && twoOk && dbOk && highG1Ok && badOk && positiveOk

  return {
    F1,
    G1,
    F2,
    G2,
    F3,
    F,
    NF_dB,
    F_twoStage,
    F_highG1,
    F_badG,
    finite,
    ok,
    methodId: METHOD_ALGO_FRIIS_NF,
    familyId: METHOD_NF,
  }
}
