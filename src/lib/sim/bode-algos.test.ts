import { describe, it, expect } from 'vitest'
import {
  METHOD_BODE,
  METHOD_ALGO_BODE_MAG,
  BODE_PARENT,
  BODE_METHOD_IDS,
  DEFAULT_F0,
  bodeMagDb,
  lowPassMag,
  lowPassMagDb,
  runBodeMagSample,
} from './bode-algos'

describe('Bode · mag_dB = 20 log10(|H|); low-pass H', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_BODE).toBe('method-bode-plot')
    expect(METHOD_ALGO_BODE_MAG).toBe('method-algo-bode-mag-db')
    expect(BODE_PARENT).toBe(METHOD_BODE)
    expect(BODE_METHOD_IDS).toContain(METHOD_ALGO_BODE_MAG)
  })

  it('bodeMagDb: 20 log10(|H|)', () => {
    expect(bodeMagDb(1)).toBeCloseTo(0, 14)
    expect(bodeMagDb(10)).toBeCloseTo(20, 12)
    expect(bodeMagDb(0.1)).toBeCloseTo(-20, 12)
    expect(Number.isNaN(bodeMagDb(0))).toBe(true)
    expect(Number.isNaN(bodeMagDb(-1))).toBe(true)
  })

  it('lowPassMag: 1/√(1+(f/f0)²)', () => {
    expect(lowPassMag(0, DEFAULT_F0)).toBeCloseTo(1, 14)
    expect(lowPassMag(DEFAULT_F0, DEFAULT_F0)).toBeCloseTo(
      1 / Math.SQRT2,
      12,
    )
    expect(lowPassMag(DEFAULT_F0, DEFAULT_F0)).toBeCloseTo(
      1 / Math.sqrt(1 + 1),
      14,
    )
    expect(Number.isNaN(lowPassMag(-1, 1))).toBe(true)
    expect(Number.isNaN(lowPassMag(1, 0))).toBe(true)
  })

  it('lowPassMagDb: DC 0 dB; corner ≈ −3 dB', () => {
    expect(lowPassMagDb(0, 1e3)).toBeCloseTo(0, 12)
    expect(lowPassMagDb(1e3, 1e3)).toBeCloseTo(
      20 * Math.log10(1 / Math.SQRT2),
      10,
    )
    expect(lowPassMagDb(1e3, 1e3)).toBeCloseTo(-3.0103, 3)
  })

  it('runBodeMagSample: ok, DC, corner, roll-off', () => {
    const r = runBodeMagSample()
    expect(r.methodId).toBe(METHOD_ALGO_BODE_MAG)
    expect(r.familyId).toBe(METHOD_BODE)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Hmag).toBeCloseTo(
      1 / Math.sqrt(1 + (r.f / r.f0) ** 2),
      12,
    )
    expect(r.magDb).toBeCloseTo(20 * Math.log10(r.Hmag), 10)
    expect(r.magDb_dc).toBeCloseTo(0, 12)
    expect(r.magDb_f0).toBeCloseTo(-3.0103, 3)
    expect(r.magDb_10f0).toBeLessThan(r.magDb_f0 - 15)
  })

  it('custom params still ok', () => {
    expect(runBodeMagSample({ f: 500, f0: 1e3 }).ok).toBe(true)
  })
})
