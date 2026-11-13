import { describe, it, expect } from 'vitest'
import {
  METHOD_CAUCHY,
  METHOD_ALGO_CAUCHY_N,
  CAUCHY_PARENT,
  CAUCHY_METHOD_IDS,
  DEFAULT_A,
  DEFAULT_B,
  DEFAULT_LAMBDA,
  cauchyN,
  runCauchyNSample,
} from './cauchy-dispersion-algos'

describe('Cauchy · n = A + B/λ²', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_CAUCHY).toBe('method-cauchy-dispersion')
    expect(METHOD_ALGO_CAUCHY_N).toBe('method-algo-cauchy-n')
    expect(CAUCHY_PARENT).toBe(METHOD_CAUCHY)
    expect(CAUCHY_METHOD_IDS).toContain(METHOD_ALGO_CAUCHY_N)
  })

  it('cauchyN: n = A + B/λ²', () => {
    expect(cauchyN(1, 1, 1)).toBeCloseTo(2, 12)
    expect(cauchyN(DEFAULT_A, DEFAULT_B, DEFAULT_LAMBDA)).toBeCloseTo(
      DEFAULT_A + DEFAULT_B / (DEFAULT_LAMBDA * DEFAULT_LAMBDA),
      12,
    )
  })

  it('shorter λ higher n; λ=0 → NaN', () => {
    const n = cauchyN(DEFAULT_A, DEFAULT_B, 0.6)
    expect(cauchyN(DEFAULT_A, DEFAULT_B, 0.3)).toBeGreaterThan(n)
    expect(Number.isNaN(cauchyN(1, 1, 0))).toBe(true)
    expect(Number.isNaN(cauchyN(NaN, 1, 1))).toBe(true)
  })

  it('runCauchyNSample: ok, formula, half-λ', () => {
    const r = runCauchyNSample()
    expect(r.methodId).toBe(METHOD_ALGO_CAUCHY_N)
    expect(r.familyId).toBe(METHOD_CAUCHY)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.n).toBeCloseTo(r.A + r.B / (r.lambda * r.lambda), 12)
    expect(r.n_halfLambda).toBeCloseTo(r.A + 4 * (r.n - r.A), 12)
    expect(r.n_longWave).toBeCloseTo(r.A, 5)
    expect(Number.isFinite(r.n_badLambda)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runCauchyNSample({ A: 1.5, B: 0.01, lambda: 0.5 }).ok).toBe(true)
  })
})
