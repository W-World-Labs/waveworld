import { describe, it, expect } from 'vitest'
import {
  METHOD_JOHNSON,
  METHOD_ALGO_JOHNSON_VRMS,
  JOHNSON_PARENT,
  JOHNSON_METHOD_IDS,
  KB,
  DEFAULT_T,
  DEFAULT_R,
  DEFAULT_DELTA_F,
  johnsonVrms,
  runJohnsonVrmsSample,
} from './johnson-nyquist-algos'

describe('Johnson–Nyquist · V_rms = √(4 k_B T R Δf)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_JOHNSON).toBe('method-johnson-nyquist')
    expect(METHOD_ALGO_JOHNSON_VRMS).toBe('method-algo-johnson-vrms')
    expect(JOHNSON_PARENT).toBe(METHOD_JOHNSON)
    expect(JOHNSON_METHOD_IDS).toContain(METHOD_ALGO_JOHNSON_VRMS)
    expect(KB).toBe(1.380649e-23)
  })

  it('johnsonVrms: formula', () => {
    const T = 300
    const R = 1000
    const df = 1e6
    const V = johnsonVrms(T, R, df)
    expect(V).toBeCloseTo(Math.sqrt(4 * KB * T * R * df), 18)
    // ~4 µV order for 1 kΩ, 1 MHz, 300 K
    expect(V).toBeGreaterThan(1e-6)
    expect(V).toBeLessThan(1e-4)
  })

  it('∝ √T, √R, √Δf; T=0 ⇒ 0; illegal → NaN', () => {
    const V = johnsonVrms(DEFAULT_T, DEFAULT_R, DEFAULT_DELTA_F)
    expect(johnsonVrms(2 * DEFAULT_T, DEFAULT_R, DEFAULT_DELTA_F)).toBeCloseTo(
      V * Math.SQRT2,
      12,
    )
    expect(johnsonVrms(DEFAULT_T, 2 * DEFAULT_R, DEFAULT_DELTA_F)).toBeCloseTo(
      V * Math.SQRT2,
      12,
    )
    expect(
      johnsonVrms(DEFAULT_T, DEFAULT_R, 2 * DEFAULT_DELTA_F),
    ).toBeCloseTo(V * Math.SQRT2, 12)
    expect(johnsonVrms(0, DEFAULT_R, DEFAULT_DELTA_F)).toBe(0)
    expect(Number.isNaN(johnsonVrms(-1, 1, 1))).toBe(true)
    expect(Number.isNaN(johnsonVrms(300, -1, 1))).toBe(true)
    expect(Number.isNaN(johnsonVrms(NaN, 1, 1))).toBe(true)
  })

  it('runJohnsonVrmsSample: ok, formula, sqrt scalings', () => {
    const r = runJohnsonVrmsSample()
    expect(r.methodId).toBe(METHOD_ALGO_JOHNSON_VRMS)
    expect(r.familyId).toBe(METHOD_JOHNSON)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.T).toBe(DEFAULT_T)
    expect(r.R).toBe(DEFAULT_R)
    expect(r.deltaF).toBe(DEFAULT_DELTA_F)
    expect(r.kB).toBe(KB)
    expect(r.Vrms).toBeCloseTo(
      Math.sqrt(4 * r.kB * r.T * r.R * r.deltaF),
      18,
    )
    expect(r.Vrms_doubleT).toBeCloseTo(r.Vrms * Math.SQRT2, 12)
    expect(r.Vrms_doubleR).toBeCloseTo(r.Vrms * Math.SQRT2, 12)
    expect(r.Vrms_zeroT).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runJohnsonVrmsSample({ T: 77, R: 50, deltaF: 1e4 }).ok).toBe(true)
  })
})
