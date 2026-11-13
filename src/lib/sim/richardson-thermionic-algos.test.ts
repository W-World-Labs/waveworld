import { describe, it, expect } from 'vitest'
import {
  METHOD_THERMIONIC,
  METHOD_ALGO_RICHARDSON,
  THERMIONIC_PARENT,
  THERMIONIC_METHOD_IDS,
  K_EV,
  DEFAULT_A,
  DEFAULT_T,
  DEFAULT_W,
  richardsonJ,
  runRichardsonSample,
} from './richardson-thermionic-algos'

describe('Richardson · J = A T² exp(−W/(kT))', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_THERMIONIC).toBe('method-thermionic-emission')
    expect(METHOD_ALGO_RICHARDSON).toBe('method-algo-richardson-current')
    expect(THERMIONIC_PARENT).toBe(METHOD_THERMIONIC)
    expect(THERMIONIC_METHOD_IDS).toContain(METHOD_ALGO_RICHARDSON)
  })

  it('K_EV ≈ 8.617e-5 eV/K', () => {
    expect(K_EV).toBeCloseTo(8.617e-5, 10)
  })

  it('richardsonJ: formula', () => {
    const A = 1.2e6
    const T = 2000
    const W = 4.5
    const J = richardsonJ(A, T, W)
    const expected = A * T * T * Math.exp(-W / (K_EV * T))
    expect(J).toBeCloseTo(expected, 6)
    expect(J).toBeGreaterThan(0)
  })

  it('T↑ → J↑; W↑ → J↓; illegal T≤0 → NaN', () => {
    const base = richardsonJ(1e6, 1800, 4.0)
    expect(richardsonJ(1e6, 2000, 4.0)).toBeGreaterThan(base)
    expect(richardsonJ(1e6, 1800, 4.5)).toBeLessThan(base)
    expect(Number.isNaN(richardsonJ(1e6, 0, 4))).toBe(true)
    expect(Number.isNaN(richardsonJ(1e6, -10, 4))).toBe(true)
    expect(Number.isNaN(richardsonJ(NaN, 2000, 4))).toBe(true)
  })

  it('runRichardsonSample: ok, formula, mono T and W', () => {
    const r = runRichardsonSample()
    expect(r.methodId).toBe(METHOD_ALGO_RICHARDSON)
    expect(r.familyId).toBe(METHOD_THERMIONIC)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.A).toBe(DEFAULT_A)
    expect(r.T).toBe(DEFAULT_T)
    expect(r.W).toBe(DEFAULT_W)
    expect(r.k).toBe(K_EV)
    expect(r.J).toBeCloseTo(
      r.A * r.T * r.T * Math.exp(-r.W / (r.k * r.T)),
      6,
    )
    expect(r.J_hotter).toBeGreaterThan(r.J)
    expect(r.J_higherW).toBeLessThan(r.J)
    expect(Number.isFinite(r.J_badT)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runRichardsonSample({ T: 2200, W: 4.0 }).ok).toBe(true)
  })
})
