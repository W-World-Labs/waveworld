import { describe, it, expect } from 'vitest'
import {
  METHOD_ABBE,
  METHOD_ALGO_ABBE_V,
  ABBE_PARENT,
  ABBE_METHOD_IDS,
  DEFAULT_ND,
  DEFAULT_NF,
  DEFAULT_NC,
  abbeNumber,
  runAbbeVSample,
} from './abbe-number-algos'

describe('Abbe number · Vd = (nd − 1)/(nF − nC)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ABBE).toBe('method-abbe-number')
    expect(METHOD_ALGO_ABBE_V).toBe('method-algo-abbe-v')
    expect(ABBE_PARENT).toBe(METHOD_ABBE)
    expect(ABBE_METHOD_IDS).toContain(METHOD_ALGO_ABBE_V)
  })

  it('abbeNumber: formula', () => {
    expect(abbeNumber(1.5, 1.51, 1.49)).toBeCloseTo(0.5 / 0.02, 12)
    expect(abbeNumber(DEFAULT_ND, DEFAULT_NF, DEFAULT_NC)).toBeCloseTo(
      (DEFAULT_ND - 1) / (DEFAULT_NF - DEFAULT_NC),
      10,
    )
  })

  it('higher dispersion → lower Vd; bad → NaN', () => {
    const V = abbeNumber(1.5, 1.51, 1.49)
    expect(abbeNumber(1.5, 1.52, 1.49)).toBeLessThan(V)
    expect(Number.isNaN(abbeNumber(1.5, 1.5, 1.5))).toBe(true)
    expect(Number.isNaN(abbeNumber(NaN, 1.51, 1.49))).toBe(true)
  })

  it('runAbbeVSample: ok, formula, methodId/familyId', () => {
    const r = runAbbeVSample()
    expect(r.methodId).toBe(METHOD_ALGO_ABBE_V)
    expect(r.familyId).toBe(METHOD_ABBE)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Vd).toBeCloseTo((r.nd - 1) / (r.nF - r.nC), 10)
    expect(r.Vd_highDisp).toBeLessThan(r.Vd)
  })

  it('custom params still ok', () => {
    expect(runAbbeVSample({ nd: 1.62, nF: 1.64, nC: 1.61 }).ok).toBe(true)
  })
})
