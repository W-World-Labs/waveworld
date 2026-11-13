import { describe, it, expect } from 'vitest'
import {
  METHOD_LONDON,
  METHOD_ALGO_LONDON_LAMBDA,
  LONDON_PARENT,
  LONDON_METHOD_IDS,
  MU0,
  E_CHARGE,
  M_E,
  DEFAULT_N,
  londonLambda,
  runLondonLambdaSample,
} from './london-algos'

describe('London · penetration depth λ_L', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_LONDON).toBe('method-london-penetration')
    expect(METHOD_ALGO_LONDON_LAMBDA).toBe('method-algo-london-lambda')
    expect(LONDON_PARENT).toBe(METHOD_LONDON)
    expect(LONDON_METHOD_IDS).toContain(METHOD_ALGO_LONDON_LAMBDA)
  })

  it('londonLambda: λ_L = √(m / (μ0 n e²))', () => {
    const n = DEFAULT_N
    const expected = Math.sqrt(M_E / (MU0 * n * E_CHARGE * E_CHARGE))
    expect(londonLambda(n)).toBeCloseTo(expected, 12)
    expect(londonLambda(n)).toBeGreaterThan(0)
  })

  it('∝ 1/√n, √m; bad → NaN', () => {
    const L = londonLambda(DEFAULT_N)
    expect(londonLambda(2 * DEFAULT_N)).toBeCloseTo(L / Math.SQRT2, 12)
    expect(londonLambda(DEFAULT_N, 2 * M_E)).toBeCloseTo(L * Math.SQRT2, 12)
    expect(Number.isNaN(londonLambda(0))).toBe(true)
    expect(Number.isNaN(londonLambda(-1))).toBe(true)
    expect(Number.isNaN(londonLambda(DEFAULT_N, 0))).toBe(true)
    expect(Number.isNaN(londonLambda(NaN))).toBe(true)
  })

  it('runLondonLambdaSample: ok, formula, scalings', () => {
    const r = runLondonLambdaSample()
    expect(r.methodId).toBe(METHOD_ALGO_LONDON_LAMBDA)
    expect(r.familyId).toBe(METHOD_LONDON)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.lambdaL).toBeCloseTo(
      Math.sqrt(r.m / (MU0 * r.n * E_CHARGE * E_CHARGE)),
      12,
    )
    expect(r.lambdaL_doubleN).toBeCloseTo(r.lambdaL / Math.SQRT2, 12)
    expect(r.lambdaL_doubleM).toBeCloseTo(r.lambdaL * Math.SQRT2, 12)
    expect(Number.isFinite(r.lambdaL_badN)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runLondonLambdaSample({ n: 5e27 }).ok).toBe(true)
  })
})
