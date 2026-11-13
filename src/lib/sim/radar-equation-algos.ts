import { radarReceivedPower } from './radar-algos'

/**
 * Radar equation (received power) · pure teaching stubs.
 * Pr = (Pt · Gt · Gr · λ² · σ) / ((4π)³ · R⁴)
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · radar equation. */
export const METHOD_RADAR = 'method-radar-equation'

/** Algo · received echo power Pr. */
export const METHOD_ALGO_RADAR_PR = 'method-algo-radar-pr'

/** Parent alias (aligns with familyId). */
export const RADAR_EQ_PARENT = METHOD_RADAR

export const RADAR_EQ_METHOD_IDS = [METHOD_ALGO_RADAR_PR] as const

const FOUR_PI = 4 * Math.PI

/** Default transmit power Pt (W). */
export const DEFAULT_PT = 1000

/** Default transmit gain Gt (linear). */
export const DEFAULT_GT = 100

/** Default receive gain Gr (linear). */
export const DEFAULT_GR = 100

/** Default wavelength λ (m) — ~3 GHz. */
export const DEFAULT_LAMBDA = 0.1

/** Default RCS σ (m²). */
export const DEFAULT_SIGMA = 1

/** Default range R (m). */
export const DEFAULT_R = 1000

/**
 * Monostatic / bistatic radar received power (W):
 *   Pr = (Pt · Gt · Gr · λ² · σ) / ((4π)³ · R⁴)
 *
 * Pt: transmit power (W), Gt/Gr: antenna gains (linear),
 * λ: wavelength (m), σ: RCS (m²), R: range (m).
 * Requires all positive and finite; else NaN.
 */
export function radarPr(
  Pt: number,
  Gt: number,
  Gr: number,
  lambda: number,
  sigma: number,
  R: number,
): number {
  if (
    !Number.isFinite(Pt) ||
    !Number.isFinite(Gt) ||
    !Number.isFinite(Gr) ||
    !Number.isFinite(lambda) ||
    !Number.isFinite(sigma) ||
    !Number.isFinite(R) ||
    !(Pt > 0) ||
    !(Gt > 0) ||
    !(Gr > 0) ||
    !(lambda > 0) ||
    !(sigma > 0) ||
    !(R > 0)
  ) {
    return NaN
  }
  return radarReceivedPower({ pt: Pt, gt: Gt, gr: Gr, lambda, sigma }, R)
}

/**
 * Radar Pr sample: formula; R→2R ⇒ Pr/16; R≤0 illegal.
 */
export function runRadarPrSample(opts?: {
  Pt?: number
  Gt?: number
  Gr?: number
  lambda?: number
  sigma?: number
  R?: number
}): {
  Pt: number
  Gt: number
  Gr: number
  lambda: number
  sigma: number
  R: number
  Pr: number
  Pr_doubleR: number
  Pr_doublePt: number
  Pr_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_RADAR_PR
  familyId: typeof METHOD_RADAR
} {
  const Pt = opts?.Pt ?? DEFAULT_PT
  const Gt = opts?.Gt ?? DEFAULT_GT
  const Gr = opts?.Gr ?? DEFAULT_GR
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA
  const sigma = opts?.sigma ?? DEFAULT_SIGMA
  const R = opts?.R ?? DEFAULT_R

  const Pr = radarPr(Pt, Gt, Gr, lambda, sigma, R)
  const Pr_doubleR = radarPr(Pt, Gt, Gr, lambda, sigma, 2 * R)
  const Pr_doublePt = radarPr(2 * Pt, Gt, Gr, lambda, sigma, R)
  const Pr_bad = radarPr(Pt, Gt, Gr, lambda, sigma, 0)

  const finite =
    Number.isFinite(Pr) &&
    Number.isFinite(Pr_doubleR) &&
    Number.isFinite(Pr_doublePt)

  const expected =
    (Pt * Gt * Gr * lambda * lambda * sigma) / (FOUR_PI ** 3 * R ** 4)
  const formulaOk =
    Math.abs(Pr - expected) < 1e-12 * Math.max(1e-30, Math.abs(Pr))
  // R⁴ ⇒ double range ⇒ 1/16 power
  const doubleROk =
    Math.abs(Pr_doubleR - Pr / 16) < 1e-12 * Math.max(1e-30, Math.abs(Pr))
  const doublePtOk =
    Math.abs(Pr_doublePt - 2 * Pr) < 1e-12 * Math.max(1e-30, Math.abs(Pr))
  const badOk = !Number.isFinite(Pr_bad)
  const positiveOk = Pr > 0

  const ok =
    finite && formulaOk && doubleROk && doublePtOk && badOk && positiveOk

  return {
    Pt,
    Gt,
    Gr,
    lambda,
    sigma,
    R,
    Pr,
    Pr_doubleR,
    Pr_doublePt,
    Pr_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_RADAR_PR,
    familyId: METHOD_RADAR,
  }
}
