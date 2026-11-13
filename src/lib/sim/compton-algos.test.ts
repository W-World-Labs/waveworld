import { describe, it, expect } from 'vitest'
import {
  METHOD_COMPTON,
  METHOD_ALGO_COMPTON_SHIFT,
  COMPTON_PARENT,
  COMPTON_METHOD_IDS,
  DEFAULT_LAMBDA_C,
  LAMBDA_C,
  comptonShift,
  runComptonShiftSample,
} from './compton-algos'

describe('Compton · Δλ = λ_C (1 − cos θ)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_COMPTON).toBe('method-compton')
    expect(METHOD_ALGO_COMPTON_SHIFT).toBe('method-algo-compton-shift')
    expect(COMPTON_PARENT).toBe(METHOD_COMPTON)
    expect(COMPTON_METHOD_IDS).toContain(METHOD_ALGO_COMPTON_SHIFT)
  })

  it('DEFAULT_LAMBDA_C ≈ 2.426 pm', () => {
    expect(DEFAULT_LAMBDA_C).toBeCloseTo(2.426e-12, 15)
    expect(LAMBDA_C).toBeCloseTo(2.426e-12, 14)
  })

  it('comptonShift: known angles', () => {
    const lc = DEFAULT_LAMBDA_C
    expect(comptonShift(0, lc)).toBeCloseTo(0, 20)
    expect(comptonShift(Math.PI / 2, lc)).toBeCloseTo(lc, 18)
    expect(comptonShift(Math.PI, lc)).toBeCloseTo(2 * lc, 18)
    expect(comptonShift(Math.PI / 3, lc)).toBeCloseTo(lc * (1 - 0.5), 18)
  })

  it('comptonShift: θ↑ in [0,π] → Δλ↑; non-finite → NaN', () => {
    const a = comptonShift(0.5)
    const b = comptonShift(1.0)
    expect(b).toBeGreaterThan(a)
    expect(Number.isNaN(comptonShift(NaN))).toBe(true)
    expect(Number.isNaN(comptonShift(1, Infinity))).toBe(true)
  })

  it('runComptonShiftSample: ok, methodId/familyId, special angles', () => {
    const r = runComptonShiftSample()
    expect(r.methodId).toBe(METHOD_ALGO_COMPTON_SHIFT)
    expect(r.familyId).toBe(METHOD_COMPTON)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.dLambda).toBeCloseTo(r.lambdaC * (1 - Math.cos(r.theta)), 18)
    expect(r.dLambda0).toBe(0)
    expect(r.dLambda90).toBeCloseTo(r.lambdaC, 18)
    expect(r.dLambda180).toBeCloseTo(2 * r.lambdaC, 18)
  })

  it('custom theta still ok', () => {
    const r = runComptonShiftSample({ theta: Math.PI / 2 })
    expect(r.ok).toBe(true)
    expect(r.dLambda).toBeCloseTo(DEFAULT_LAMBDA_C, 18)
  })
})
