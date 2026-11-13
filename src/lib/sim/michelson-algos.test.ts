import { describe, it, expect } from 'vitest'
import {
  METHOD_MICHELSON,
  METHOD_ALGO_MICHELSON_FRINGE,
  MICHELSON_PARENT,
  MICHELSON_METHOD_IDS,
  DEFAULT_D,
  DEFAULT_LAMBDA,
  DEFAULT_I0,
  michelsonOrder,
  michelsonIntensity,
  michelsonPhase,
  runMichelsonFringeSample,
} from './michelson-algos'

describe('Michelson · m = 2d/λ; I = I0 cos²(2π d/λ)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_MICHELSON).toBe('method-michelson')
    expect(METHOD_ALGO_MICHELSON_FRINGE).toBe('method-algo-michelson-order')
    expect(MICHELSON_PARENT).toBe(METHOD_MICHELSON)
    expect(MICHELSON_METHOD_IDS).toContain(METHOD_ALGO_MICHELSON_FRINGE)
  })

  it('michelsonOrder: m = 2d/λ', () => {
    expect(michelsonOrder(DEFAULT_D, DEFAULT_LAMBDA)).toBeCloseTo(
      (2 * DEFAULT_D) / DEFAULT_LAMBDA,
      12,
    )
    expect(michelsonOrder(DEFAULT_LAMBDA / 2, DEFAULT_LAMBDA)).toBeCloseTo(
      1,
      12,
    )
  })

  it('intensity constructive/destructive; phase form; λ≤0 → NaN', () => {
    expect(michelsonIntensity(0, DEFAULT_LAMBDA, 1)).toBeCloseTo(1, 12)
    expect(michelsonIntensity(DEFAULT_LAMBDA / 4, DEFAULT_LAMBDA, 1)).toBeCloseTo(
      0,
      12,
    )
    const d = DEFAULT_D
    const I = michelsonIntensity(d, DEFAULT_LAMBDA, DEFAULT_I0)
    const delta = michelsonPhase(d, DEFAULT_LAMBDA)
    expect(I).toBeCloseTo(DEFAULT_I0 * Math.cos(delta / 2) ** 2, 10)
    expect(Number.isNaN(michelsonOrder(1e-6, 0))).toBe(true)
    expect(Number.isNaN(michelsonIntensity(1e-6, NaN))).toBe(true)
  })

  it('runMichelsonFringeSample: ok, order, extrema, phase', () => {
    const r = runMichelsonFringeSample()
    expect(r.methodId).toBe(METHOD_ALGO_MICHELSON_FRINGE)
    expect(r.familyId).toBe(METHOD_MICHELSON)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.m).toBeCloseTo((2 * r.d) / r.lambda, 12)
    expect(r.I_constructive).toBeCloseTo(r.I0, 12)
    expect(r.I_destructive).toBeCloseTo(0, 12)
    expect(r.I).toBeCloseTo(r.I0 * Math.cos(r.delta / 2) ** 2, 10)
    expect(Number.isFinite(r.m_badLam)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(
      runMichelsonFringeSample({ d: 1e-6, lambda: 500e-9, I0: 2 }).ok,
    ).toBe(true)
  })
})
