import { describe, it, expect } from 'vitest'
import {
  METHOD_LINK,
  METHOD_ALGO_LINK_RX,
  LINK_PARENT,
  LINK_METHOD_IDS,
  DEFAULT_PT_DBM,
  DEFAULT_GT_DB,
  DEFAULT_GR_DB,
  DEFAULT_FSPL_DB,
  DEFAULT_L_OTHER_DB,
  linkRxDbm,
  runLinkRxSample,
} from './link-budget-algos'

describe('Link budget · Pr_dBm = Pt + Gt + Gr − FSPL − L', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_LINK).toBe('method-link-budget')
    expect(METHOD_ALGO_LINK_RX).toBe('method-algo-link-rx-dbm')
    expect(LINK_PARENT).toBe(METHOD_LINK)
    expect(LINK_METHOD_IDS).toContain(METHOD_ALGO_LINK_RX)
  })

  it('linkRxDbm: formula', () => {
    expect(linkRxDbm(30, 10, 5, 100, 2)).toBeCloseTo(-57, 12)
    expect(
      linkRxDbm(
        DEFAULT_PT_DBM,
        DEFAULT_GT_DB,
        DEFAULT_GR_DB,
        DEFAULT_FSPL_DB,
        DEFAULT_L_OTHER_DB,
      ),
    ).toBeCloseTo(
      DEFAULT_PT_DBM +
        DEFAULT_GT_DB +
        DEFAULT_GR_DB -
        DEFAULT_FSPL_DB -
        DEFAULT_L_OTHER_DB,
      12,
    )
  })

  it('+1 dB Pt ⇒ +1 dB Pr; non-finite → NaN', () => {
    const p = linkRxDbm(20, 0, 0, 50, 0)
    expect(linkRxDbm(21, 0, 0, 50, 0)).toBeCloseTo(p + 1, 12)
    expect(Number.isNaN(linkRxDbm(NaN, 0, 0, 0, 0))).toBe(true)
    expect(Number.isNaN(linkRxDbm(0, Infinity, 0, 0, 0))).toBe(true)
  })

  it('runLinkRxSample: ok, formula, +1 Pt', () => {
    const r = runLinkRxSample()
    expect(r.methodId).toBe(METHOD_ALGO_LINK_RX)
    expect(r.familyId).toBe(METHOD_LINK)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Pr_dBm).toBeCloseTo(
      r.Pt_dBm + r.Gt_dB + r.Gr_dB - r.FSPL_dB - r.L_other_dB,
      12,
    )
    expect(r.Pr_plus1Pt).toBeCloseTo(r.Pr_dBm + 1, 12)
    expect(Number.isFinite(r.Pr_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runLinkRxSample({ Pt_dBm: 0, FSPL_dB: 80 }).ok).toBe(true)
  })
})
