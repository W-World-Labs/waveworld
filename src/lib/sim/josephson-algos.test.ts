import { describe, it, expect } from 'vitest'
import {
  METHOD_JOSEPHSON,
  METHOD_ALGO_JOSEPHSON_F,
  JOSEPHSON_PARENT,
  JOSEPHSON_METHOD_IDS,
  PHI0,
  E_CHARGE,
  H_PLANCK,
  DEFAULT_V,
  josephsonFreq,
  josephsonFreqFromEH,
  runJosephsonFreqSample,
} from './josephson-algos'

describe('Josephson · f = V / Φ₀', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_JOSEPHSON).toBe('method-josephson')
    expect(METHOD_ALGO_JOSEPHSON_F).toBe('method-algo-josephson-freq')
    expect(JOSEPHSON_PARENT).toBe(METHOD_JOSEPHSON)
    expect(JOSEPHSON_METHOD_IDS).toContain(METHOD_ALGO_JOSEPHSON_F)
    expect(PHI0).toBe(2.067833848e-15)
  })

  it('josephsonFreq: formula', () => {
    const f = josephsonFreq(DEFAULT_V)
    expect(f).toBeCloseTo(DEFAULT_V / PHI0, 6)
    // ~483.6 GHz per mV
    expect(f).toBeGreaterThan(4e11)
    expect(f).toBeLessThan(5e11)
  })

  it('linear in V; V=0 ⇒ 0; agrees with 2eV/h', () => {
    const f = josephsonFreq(1e-3)
    expect(josephsonFreq(2e-3)).toBeCloseTo(2 * f, 6)
    expect(josephsonFreq(0)).toBe(0)
    const fEh = josephsonFreqFromEH(1e-3)
    expect(fEh).toBeCloseTo((2 * E_CHARGE * 1e-3) / H_PLANCK, 6)
    // relative agreement (CODATA-consistent Φ₀ ≈ h/2e)
    expect(Math.abs(fEh - f) / f).toBeLessThan(1e-6)
    expect(Number.isNaN(josephsonFreq(NaN))).toBe(true)
  })

  it('runJosephsonFreqSample: ok, formula, lin, EH', () => {
    const r = runJosephsonFreqSample()
    expect(r.methodId).toBe(METHOD_ALGO_JOSEPHSON_F)
    expect(r.familyId).toBe(METHOD_JOSEPHSON)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.f).toBeCloseTo(Math.abs(r.V) / r.phi0, 6)
    expect(r.f_doubleV).toBeCloseTo(2 * r.f, 6)
    expect(r.f_zero).toBe(0)
    expect(Math.abs(r.f_eh - r.f) / r.f).toBeLessThan(1e-6)
  })

  it('custom params still ok', () => {
    expect(runJosephsonFreqSample({ V: 1e-6 }).ok).toBe(true)
  })
})
