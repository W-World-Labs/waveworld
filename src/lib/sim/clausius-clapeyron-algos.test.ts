import { describe, it, expect } from 'vitest'
import {
  METHOD_CC,
  METHOD_ALGO_CC_DP_DT,
  CC_PARENT,
  CC_METHOD_IDS,
  DEFAULT_L,
  DEFAULT_T,
  DEFAULT_DELTA_V,
  clausiusClapeyronSlope,
  runCcSlopeSample,
} from './clausius-clapeyron-algos'

describe('Clausius–Clapeyron · dP/dT = L / (T ΔV)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_CC).toBe('method-clausius-clapeyron')
    expect(METHOD_ALGO_CC_DP_DT).toBe('method-algo-cc-slope')
    expect(CC_PARENT).toBe(METHOD_CC)
    expect(CC_METHOD_IDS).toContain(METHOD_ALGO_CC_DP_DT)
  })

  it('clausiusClapeyronSlope: formula', () => {
    const s = clausiusClapeyronSlope(DEFAULT_L, DEFAULT_T, DEFAULT_DELTA_V)
    expect(s).toBeCloseTo(DEFAULT_L / (DEFAULT_T * DEFAULT_DELTA_V), 12)
    expect(s).toBeGreaterThan(0)
  })

  it('∝ L; 1/T; T=0 or ΔV=0 → NaN', () => {
    const s = clausiusClapeyronSlope(1e6, 300, 1)
    expect(clausiusClapeyronSlope(2e6, 300, 1)).toBeCloseTo(2 * s, 12)
    expect(clausiusClapeyronSlope(1e6, 600, 1)).toBeCloseTo(s / 2, 12)
    expect(Number.isNaN(clausiusClapeyronSlope(1, 0, 1))).toBe(true)
    expect(Number.isNaN(clausiusClapeyronSlope(1, 300, 0))).toBe(true)
    expect(Number.isNaN(clausiusClapeyronSlope(NaN, 300, 1))).toBe(true)
  })

  it('runCcSlopeSample: ok, formula, double L, half at 2T', () => {
    const r = runCcSlopeSample()
    expect(r.methodId).toBe(METHOD_ALGO_CC_DP_DT)
    expect(r.familyId).toBe(METHOD_CC)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.dPdT).toBeCloseTo(r.L / (r.T * r.deltaV), 12)
    expect(r.dPdT_doubleL).toBeCloseTo(2 * r.dPdT, 12)
    expect(r.dPdT_doubleT).toBeCloseTo(r.dPdT / 2, 12)
    expect(Number.isFinite(r.dPdT_badT)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runCcSlopeSample({ L: 1e5, T: 273, deltaV: 0.1 }).ok).toBe(true)
  })
})
