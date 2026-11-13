import { describe, it, expect } from 'vitest'
import {
  METHOD_RH,
  METHOD_ALGO_RH_PRESSURE,
  RH_PARENT,
  RH_METHOD_IDS,
  DEFAULT_GAMMA,
  DEFAULT_M,
  rhPressureRatio,
  runRhPressureSample,
} from './rankine-hugoniot-algos'

describe('Rankine–Hugoniot · p2/p1 = (2γM²−(γ−1))/(γ+1)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_RH).toBe('method-rankine-hugoniot')
    expect(METHOD_ALGO_RH_PRESSURE).toBe('method-algo-rh-pressure-ratio')
    expect(RH_PARENT).toBe(METHOD_RH)
    expect(RH_METHOD_IDS).toContain(METHOD_ALGO_RH_PRESSURE)
  })

  it('rhPressureRatio: M=2, γ=1.4 → 4.5; M=1 → 1', () => {
    // (2*1.4*4 - 0.4)/(2.4) = (11.2 - 0.4)/2.4 = 10.8/2.4 = 4.5
    expect(rhPressureRatio(2, 1.4)).toBeCloseTo(4.5, 12)
    expect(rhPressureRatio(1, 1.4)).toBeCloseTo(1, 12)
    expect(rhPressureRatio(DEFAULT_M, DEFAULT_GAMMA)).toBeCloseTo(4.5, 12)
  })

  it('M↑ ⇒ ratio↑; M≤0 or γ≤1 → NaN', () => {
    expect(rhPressureRatio(3, 1.4)).toBeGreaterThan(rhPressureRatio(2, 1.4))
    expect(Number.isNaN(rhPressureRatio(0, 1.4))).toBe(true)
    expect(Number.isNaN(rhPressureRatio(-1, 1.4))).toBe(true)
    expect(Number.isNaN(rhPressureRatio(2, 1))).toBe(true)
    expect(Number.isNaN(rhPressureRatio(2, NaN))).toBe(true)
  })

  it('runRhPressureSample: ok, formula, sonic, mono', () => {
    const r = runRhPressureSample()
    expect(r.methodId).toBe(METHOD_ALGO_RH_PRESSURE)
    expect(r.familyId).toBe(METHOD_RH)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.ratio).toBeCloseTo(4.5, 12)
    expect(r.ratio_sonic).toBeCloseTo(1, 12)
    expect(r.ratio_higherM).toBeGreaterThan(r.ratio)
    expect(Number.isFinite(r.ratio_badM)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runRhPressureSample({ M: 1.5, gamma: 5 / 3 }).ok).toBe(true)
  })
})
