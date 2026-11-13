import { describe, it, expect } from 'vitest'
import {
  METHOD_SAHA,
  METHOD_ALGO_SAHA_K,
  SAHA_PARENT,
  SAHA_METHOD_IDS,
  K_EV,
  DEFAULT_T,
  DEFAULT_I_EV,
  sahaKRel,
  runSahaKSample,
} from './saha-algos'

describe('Saha · K_rel = T^{3/2} exp(−I/(kT))', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SAHA).toBe('method-saha-ionization')
    expect(METHOD_ALGO_SAHA_K).toBe('method-algo-saha-k')
    expect(SAHA_PARENT).toBe(METHOD_SAHA)
    expect(SAHA_METHOD_IDS).toContain(METHOD_ALGO_SAHA_K)
    expect(K_EV).toBe(8.617e-5)
  })

  it('sahaKRel: formula', () => {
    const T = DEFAULT_T
    const I = DEFAULT_I_EV
    const K = sahaKRel(T, I)
    expect(K).toBeCloseTo(T ** 1.5 * Math.exp(-I / (K_EV * T)), 8)
    expect(K).toBeGreaterThan(0)
  })

  it('T↑ ⇒ K↑; I↑ ⇒ K↓; T≤0 → NaN', () => {
    const K = sahaKRel(10000, 13.6)
    expect(sahaKRel(12000, 13.6)).toBeGreaterThan(K)
    expect(sahaKRel(10000, 20)).toBeLessThan(K)
    expect(Number.isNaN(sahaKRel(0, 13.6))).toBe(true)
    expect(Number.isNaN(sahaKRel(NaN, 13.6))).toBe(true)
  })

  it('runSahaKSample: ok, formula, hotter, higher I', () => {
    const r = runSahaKSample()
    expect(r.methodId).toBe(METHOD_ALGO_SAHA_K)
    expect(r.familyId).toBe(METHOD_SAHA)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.T).toBe(DEFAULT_T)
    expect(r.I_eV).toBe(DEFAULT_I_EV)
    expect(r.k_eV).toBe(K_EV)
    expect(r.K).toBeCloseTo(
      r.T ** 1.5 * Math.exp(-r.I_eV / (r.k_eV * r.T)),
      8,
    )
    expect(r.K_hotter).toBeGreaterThan(r.K)
    expect(r.K_higherI).toBeLessThan(r.K)
    expect(Number.isFinite(r.K_badT)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runSahaKSample({ T: 5000, I_eV: 10 }).ok).toBe(true)
  })
})
