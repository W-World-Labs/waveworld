import { describe, it, expect } from 'vitest'
import {
  METHOD_ARRHENIUS,
  METHOD_ALGO_ARRHENIUS_K,
  ARRHENIUS_PARENT,
  ARRHENIUS_METHOD_IDS,
  R_GAS,
  DEFAULT_A,
  DEFAULT_EA,
  DEFAULT_T,
  arrheniusK,
  runArrheniusKSample,
} from './arrhenius-algos'

describe('Arrhenius · k = A exp(−Ea/(R T))', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ARRHENIUS).toBe('method-arrhenius')
    expect(METHOD_ALGO_ARRHENIUS_K).toBe('method-algo-arrhenius-k')
    expect(ARRHENIUS_PARENT).toBe(METHOD_ARRHENIUS)
    expect(ARRHENIUS_METHOD_IDS).toContain(METHOD_ALGO_ARRHENIUS_K)
    expect(R_GAS).toBe(8.314)
  })

  it('arrheniusK: formula', () => {
    const A = 1e13
    const Ea = 5e4
    const T = 300
    const k = arrheniusK(A, Ea, T)
    expect(k).toBeCloseTo(A * Math.exp(-Ea / (R_GAS * T)), 8)
    expect(k).toBeGreaterThan(0)
  })

  it('T↑ ⇒ k↑; Ea↑ ⇒ k↓; T≤0 → NaN', () => {
    const k300 = arrheniusK(DEFAULT_A, DEFAULT_EA, 300)
    const k350 = arrheniusK(DEFAULT_A, DEFAULT_EA, 350)
    const kHighEa = arrheniusK(DEFAULT_A, DEFAULT_EA * 2, 300)
    expect(k350).toBeGreaterThan(k300)
    expect(kHighEa).toBeLessThan(k300)
    expect(Number.isNaN(arrheniusK(1, 1, 0))).toBe(true)
    expect(Number.isNaN(arrheniusK(NaN, 1, 300))).toBe(true)
  })

  it('custom R still works', () => {
    expect(arrheniusK(1, 0, 300, 8.314)).toBeCloseTo(1, 12)
  })

  it('runArrheniusKSample: ok, formula, hotter, higher Ea', () => {
    const r = runArrheniusKSample()
    expect(r.methodId).toBe(METHOD_ALGO_ARRHENIUS_K)
    expect(r.familyId).toBe(METHOD_ARRHENIUS)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.A).toBe(DEFAULT_A)
    expect(r.Ea).toBe(DEFAULT_EA)
    expect(r.T).toBe(DEFAULT_T)
    expect(r.R).toBe(R_GAS)
    expect(r.k).toBeCloseTo(r.A * Math.exp(-r.Ea / (r.R * r.T)), 8)
    expect(r.k_hotter).toBeGreaterThan(r.k)
    expect(r.k_higherEa).toBeLessThan(r.k)
    expect(Number.isFinite(r.k_badT)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runArrheniusKSample({ A: 1e10, Ea: 4e4, T: 400 }).ok).toBe(true)
  })
})
