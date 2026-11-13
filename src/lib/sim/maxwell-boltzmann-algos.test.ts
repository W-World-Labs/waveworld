import { describe, it, expect } from 'vitest'
import {
  METHOD_MB,
  METHOD_ALGO_MB_RMS,
  MB_PARENT,
  MB_METHOD_IDS,
  KB,
  DEFAULT_T,
  DEFAULT_M,
  mbVrms,
  runMbVrmsSample,
} from './maxwell-boltzmann-algos'

describe('Maxwell–Boltzmann · v_rms = √(3 k T / m)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_MB).toBe('method-maxwell-boltzmann')
    expect(METHOD_ALGO_MB_RMS).toBe('method-algo-mb-vrms')
    expect(MB_PARENT).toBe(METHOD_MB)
    expect(MB_METHOD_IDS).toContain(METHOD_ALGO_MB_RMS)
  })

  it('mbVrms: formula; T=0 ⇒ 0', () => {
    expect(mbVrms(0, DEFAULT_M)).toBe(0)
    expect(mbVrms(DEFAULT_T, DEFAULT_M)).toBeCloseTo(
      Math.sqrt((3 * KB * DEFAULT_T) / DEFAULT_M),
      8,
    )
  })

  it('∝ √T; ∝ 1/√m; bad → NaN', () => {
    const v = mbVrms(300, 1e-26)
    expect(mbVrms(600, 1e-26) / v).toBeCloseTo(Math.SQRT2, 10)
    expect(mbVrms(300, 4e-26) / v).toBeCloseTo(0.5, 10)
    expect(Number.isNaN(mbVrms(-1, 1e-26))).toBe(true)
    expect(Number.isNaN(mbVrms(300, 0))).toBe(true)
    expect(Number.isNaN(mbVrms(NaN, 1e-26))).toBe(true)
  })

  it('runMbVrmsSample: ok, formula, methodId/familyId', () => {
    const r = runMbVrmsSample()
    expect(r.methodId).toBe(METHOD_ALGO_MB_RMS)
    expect(r.familyId).toBe(METHOD_MB)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.vRms).toBeCloseTo(Math.sqrt((3 * r.k * r.T) / r.m), 8)
    expect(r.vRms_doubleT / r.vRms).toBeCloseTo(Math.SQRT2, 10)
    expect(r.vRms_zero).toBe(0)
  })

  it('custom params still ok', () => {
    // H2-class mass
    expect(runMbVrmsSample({ T: 300, m: 3.34e-27 }).ok).toBe(true)
  })
})
