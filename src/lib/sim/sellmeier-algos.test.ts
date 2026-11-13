import { describe, it, expect } from 'vitest'
import {
  METHOD_SELLMEIER,
  METHOD_ALGO_SELLMEIER_N,
  SELLMEIER_PARENT,
  SELLMEIER_METHOD_IDS,
  DEFAULT_B,
  DEFAULT_C,
  DEFAULT_LAM,
  sellmeierN,
  sellmeierNMulti,
  runSellmeierNSample,
} from './sellmeier-algos'

describe('Sellmeier · n² = 1 + B λ²/(λ²−C)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SELLMEIER).toBe('method-sellmeier')
    expect(METHOD_ALGO_SELLMEIER_N).toBe('method-algo-sellmeier-n')
    expect(SELLMEIER_PARENT).toBe(METHOD_SELLMEIER)
    expect(SELLMEIER_METHOD_IDS).toContain(METHOD_ALGO_SELLMEIER_N)
  })

  it('sellmeierN: one-term formula', () => {
    const n = sellmeierN(DEFAULT_LAM, DEFAULT_B, DEFAULT_C)
    const lam2 = DEFAULT_LAM * DEFAULT_LAM
    const n2 = 1 + (DEFAULT_B * lam2) / (lam2 - DEFAULT_C)
    expect(n).toBeCloseTo(Math.sqrt(n2), 12)
    expect(n).toBeGreaterThan(1)
  })

  it('multi-term matches one-term; pole → NaN', () => {
    const n = sellmeierN(DEFAULT_LAM, DEFAULT_B, DEFAULT_C)
    expect(
      sellmeierNMulti(DEFAULT_LAM, [{ B: DEFAULT_B, C: DEFAULT_C }]),
    ).toBeCloseTo(n, 12)
    expect(
      Number.isNaN(sellmeierN(Math.sqrt(DEFAULT_C) * 0.5, DEFAULT_B, DEFAULT_C)),
    ).toBe(true)
    expect(Number.isNaN(sellmeierN(0, DEFAULT_B, DEFAULT_C))).toBe(true)
    expect(Number.isNaN(sellmeierN(NaN, DEFAULT_B, DEFAULT_C))).toBe(true)
  })

  it('runSellmeierNSample: ok, n>1, pole NaN', () => {
    const r = runSellmeierNSample()
    expect(r.methodId).toBe(METHOD_ALGO_SELLMEIER_N)
    expect(r.familyId).toBe(METHOD_SELLMEIER)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.n).toBeCloseTo(Math.sqrt(r.n2), 12)
    expect(r.n).toBeGreaterThan(1)
    expect(Number.isFinite(r.n_nearPole)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runSellmeierNSample({ lam_um: 1.55, B: 0.7, C: 0.01 }).ok).toBe(
      true,
    )
  })
})
