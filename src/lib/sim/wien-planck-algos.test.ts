import { describe, it, expect } from 'vitest'
import {
  METHOD_WIEN,
  METHOD_ALGO_WIEN_PEAK,
  METHOD_PLANCK,
  METHOD_ALGO_PLANCK_B,
  WIEN_PARENT,
  PLANCK_PARENT,
  WIEN_METHOD_IDS,
  PLANCK_METHOD_IDS,
  WIEN_B,
  H,
  KB,
  C,
  DEFAULT_T,
  DEFAULT_NU,
  wienLambdaMax,
  planckBnu,
  planckBprop,
  runWienPeakSample,
  runPlanckBSample,
} from './wien-planck-algos'

describe('Wien · λ_max = b/T', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_WIEN).toBe('method-wien-displacement')
    expect(METHOD_ALGO_WIEN_PEAK).toBe('method-algo-wien-peak')
    expect(WIEN_PARENT).toBe(METHOD_WIEN)
    expect(WIEN_METHOD_IDS).toContain(METHOD_ALGO_WIEN_PEAK)
  })

  it('wienLambdaMax: λ_max = b/T', () => {
    expect(wienLambdaMax(300)).toBeCloseTo(WIEN_B / 300, 14)
    expect(wienLambdaMax(5800)).toBeCloseTo(WIEN_B / 5800, 14)
    // Sun-class peak ~500 nm order
    expect(wienLambdaMax(5800)).toBeGreaterThan(4e-7)
    expect(wienLambdaMax(5800)).toBeLessThan(6e-7)
  })

  it('T doubles → λ halves; T≤0 → NaN', () => {
    const l = wienLambdaMax(1000)
    expect(wienLambdaMax(2000)).toBeCloseTo(l / 2, 14)
    expect(Number.isNaN(wienLambdaMax(0))).toBe(true)
    expect(Number.isNaN(wienLambdaMax(-10))).toBe(true)
  })

  it('runWienPeakSample: ok, formula, half on 2T', () => {
    const r = runWienPeakSample()
    expect(r.methodId).toBe(METHOD_ALGO_WIEN_PEAK)
    expect(r.familyId).toBe(METHOD_WIEN)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.T).toBe(DEFAULT_T)
    expect(r.lambdaMax).toBeCloseTo(r.b / r.T, 14)
    expect(r.lambdaMax_hotter).toBeCloseTo(r.lambdaMax / 2, 14)
    expect(Number.isFinite(r.lambdaMax_badT)).toBe(false)
  })
})

describe('Planck · B_ν = (2hν³/c²)/(exp(hν/kT)−1)', () => {
  it('method id constants', () => {
    expect(METHOD_PLANCK).toBe('method-planck-law')
    expect(METHOD_ALGO_PLANCK_B).toBe('method-algo-planck-spectral')
    expect(PLANCK_PARENT).toBe(METHOD_PLANCK)
    expect(PLANCK_METHOD_IDS).toContain(METHOD_ALGO_PLANCK_B)
  })

  it('planckBnu: formula and positivity', () => {
    const nu = DEFAULT_NU
    const T = DEFAULT_T
    const B = planckBnu(nu, T)
    const x = (H * nu) / (KB * T)
    const expected =
      ((2 * H * nu * nu * nu) / (C * C)) / (Math.exp(x) - 1)
    expect(B).toBeCloseTo(expected, 8)
    expect(B).toBeGreaterThan(0)
  })

  it('planckBprop: ν³/(exp(x)−1); linked to B_ν', () => {
    const nu = 5e14
    const T = 3000
    const Bp = planckBprop(nu, T)
    const B = planckBnu(nu, T)
    expect(Bp).toBeGreaterThan(0)
    expect(B).toBeCloseTo(((2 * H) / (C * C)) * Bp, 8)
  })

  it('T↑ ⇒ B↑; illegal → NaN', () => {
    const B = planckBnu(5e14, 3000)
    expect(planckBnu(5e14, 6000)).toBeGreaterThan(B)
    expect(Number.isNaN(planckBnu(0, 3000))).toBe(true)
    expect(Number.isNaN(planckBnu(5e14, 0))).toBe(true)
    expect(Number.isNaN(planckBnu(NaN, 3000))).toBe(true)
  })

  it('runPlanckBSample: ok, formula, hotter, link', () => {
    const r = runPlanckBSample()
    expect(r.methodId).toBe(METHOD_ALGO_PLANCK_B)
    expect(r.familyId).toBe(METHOD_PLANCK)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.B).toBeGreaterThan(0)
    expect(r.B_hotter).toBeGreaterThan(r.B)
    expect(Number.isFinite(r.B_badT)).toBe(false)
    expect(r.B).toBeCloseTo(((2 * H) / (C * C)) * r.Bprop, 8)
  })

  it('custom params still ok', () => {
    expect(runWienPeakSample({ T: 300 }).ok).toBe(true)
    expect(runPlanckBSample({ nu: 1e13, T: 1000 }).ok).toBe(true)
  })
})
