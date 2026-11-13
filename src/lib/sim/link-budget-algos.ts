/**
 * RF link budget · pure teaching stubs.
 * Pr_dBm = Pt_dBm + Gt_dB + Gr_dB − FSPL_dB − L_other_dB
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · link budget. */
export const METHOD_LINK = 'method-link-budget'

/** Algo · received power in dBm. */
export const METHOD_ALGO_LINK_RX = 'method-algo-link-rx-dbm'

/** Parent alias (aligns with familyId). */
export const LINK_PARENT = METHOD_LINK

export const LINK_METHOD_IDS = [METHOD_ALGO_LINK_RX] as const

/** Default transmit power (dBm). */
export const DEFAULT_PT_DBM = 30

/** Default transmit antenna gain (dB). */
export const DEFAULT_GT_DB = 10

/** Default receive antenna gain (dB). */
export const DEFAULT_GR_DB = 5

/** Default free-space path loss (dB). */
export const DEFAULT_FSPL_DB = 100

/** Default other losses (dB): cables, misc. */
export const DEFAULT_L_OTHER_DB = 2

/**
 * Link-budget received power (dBm):
 *   Pr_dBm = Pt_dBm + Gt_dB + Gr_dB − FSPL_dB − L_other_dB
 *
 * All terms finite; else NaN.
 */
export function linkRxDbm(
  Pt_dBm: number,
  Gt_dB: number,
  Gr_dB: number,
  FSPL_dB: number,
  L_other_dB: number = 0,
): number {
  if (
    !Number.isFinite(Pt_dBm) ||
    !Number.isFinite(Gt_dB) ||
    !Number.isFinite(Gr_dB) ||
    !Number.isFinite(FSPL_dB) ||
    !Number.isFinite(L_other_dB)
  ) {
    return NaN
  }
  return Pt_dBm + Gt_dB + Gr_dB - FSPL_dB - L_other_dB
}

/**
 * Link-budget sample: sum/diff formula; +1 dB Pt ⇒ +1 dB Pr; bad → NaN.
 */
export function runLinkRxSample(opts?: {
  Pt_dBm?: number
  Gt_dB?: number
  Gr_dB?: number
  FSPL_dB?: number
  L_other_dB?: number
}): {
  Pt_dBm: number
  Gt_dB: number
  Gr_dB: number
  FSPL_dB: number
  L_other_dB: number
  Pr_dBm: number
  Pr_plus1Pt: number
  Pr_zeroLoss: number
  Pr_bad: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_LINK_RX
  familyId: typeof METHOD_LINK
} {
  const Pt_dBm = opts?.Pt_dBm ?? DEFAULT_PT_DBM
  const Gt_dB = opts?.Gt_dB ?? DEFAULT_GT_DB
  const Gr_dB = opts?.Gr_dB ?? DEFAULT_GR_DB
  const FSPL_dB = opts?.FSPL_dB ?? DEFAULT_FSPL_DB
  const L_other_dB = opts?.L_other_dB ?? DEFAULT_L_OTHER_DB

  const Pr_dBm = linkRxDbm(Pt_dBm, Gt_dB, Gr_dB, FSPL_dB, L_other_dB)
  const Pr_plus1Pt = linkRxDbm(Pt_dBm + 1, Gt_dB, Gr_dB, FSPL_dB, L_other_dB)
  const Pr_zeroLoss = linkRxDbm(Pt_dBm, Gt_dB, Gr_dB, 0, 0)
  const Pr_bad = linkRxDbm(NaN, Gt_dB, Gr_dB, FSPL_dB, L_other_dB)

  const finite =
    Number.isFinite(Pr_dBm) &&
    Number.isFinite(Pr_plus1Pt) &&
    Number.isFinite(Pr_zeroLoss)

  const expected = Pt_dBm + Gt_dB + Gr_dB - FSPL_dB - L_other_dB
  const formulaOk = Math.abs(Pr_dBm - expected) < 1e-12
  const plus1Ok = Math.abs(Pr_plus1Pt - (Pr_dBm + 1)) < 1e-12
  const zeroLossOk =
    Math.abs(Pr_zeroLoss - (Pt_dBm + Gt_dB + Gr_dB)) < 1e-12
  const badOk = !Number.isFinite(Pr_bad)

  const ok = finite && formulaOk && plus1Ok && zeroLossOk && badOk

  return {
    Pt_dBm,
    Gt_dB,
    Gr_dB,
    FSPL_dB,
    L_other_dB,
    Pr_dBm,
    Pr_plus1Pt,
    Pr_zeroLoss,
    Pr_bad,
    finite,
    ok,
    methodId: METHOD_ALGO_LINK_RX,
    familyId: METHOD_LINK,
  }
}
