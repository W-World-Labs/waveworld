import { describe, it, expect } from 'vitest'
import {
  METHOD_BERNOULLI,
  METHOD_ALGO_BERNOULLI,
  BERNOULLI_PARENT,
  BERNOULLI_METHOD_IDS,
  DEFAULT_RHO,
  DEFAULT_V,
  G,
  bernoulliDynamicP,
  bernoulliHead,
  bernoulliEnergy,
  runBernoulliSample,
} from './bernoulli-algos'

describe('Bernoulli · ½ρv² + head form', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_BERNOULLI).toBe('method-bernoulli')
    expect(METHOD_ALGO_BERNOULLI).toBe('method-algo-bernoulli-head')
    expect(BERNOULLI_PARENT).toBe(METHOD_BERNOULLI)
    expect(BERNOULLI_METHOD_IDS).toContain(METHOD_ALGO_BERNOULLI)
  })

  it('bernoulliDynamicP: q = ½ ρ v²', () => {
    expect(bernoulliDynamicP(1000, 2)).toBeCloseTo(2000, 12)
    expect(bernoulliDynamicP(DEFAULT_RHO, DEFAULT_V)).toBeCloseTo(
      0.5 * DEFAULT_RHO * DEFAULT_V * DEFAULT_V,
      12,
    )
  })

  it('∝ v²; zero v; non-finite → NaN', () => {
    const q = bernoulliDynamicP(1000, 3)
    expect(bernoulliDynamicP(1000, 6)).toBeCloseTo(4 * q, 12)
    expect(bernoulliDynamicP(1000, 0)).toBe(0)
    expect(Number.isNaN(bernoulliDynamicP(NaN, 1))).toBe(true)
  })

  it('head and energy forms', () => {
    const p = 1e5
    const rho = 1000
    const v = 2
    const h = 1
    expect(bernoulliEnergy(p, rho, v, h, G)).toBeCloseTo(
      p + 0.5 * rho * v * v + rho * G * h,
      6,
    )
    expect(bernoulliHead(p, rho, v, h, G)).toBeCloseTo(
      p / (rho * G) + (v * v) / (2 * G) + h,
      12,
    )
    expect(Number.isNaN(bernoulliHead(p, 0, v, h))).toBe(true)
  })

  it('runBernoulliSample: ok, formula, quad v, zero', () => {
    const r = runBernoulliSample()
    expect(r.methodId).toBe(METHOD_ALGO_BERNOULLI)
    expect(r.familyId).toBe(METHOD_BERNOULLI)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.dynamicP).toBeCloseTo(0.5 * r.rho * r.v * r.v, 12)
    expect(r.dynamicP_doubleV).toBeCloseTo(4 * r.dynamicP, 12)
    expect(r.dynamicP_zeroV).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runBernoulliSample({ rho: 1.2, v: 10, h: 0 }).ok).toBe(true)
  })
})
