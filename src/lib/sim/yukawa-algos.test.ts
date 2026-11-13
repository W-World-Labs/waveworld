import { describe, it, expect } from 'vitest'
import {
  METHOD_YUKAWA,
  METHOD_ALGO_YUKAWA_V,
  YUKAWA_PARENT,
  YUKAWA_METHOD_IDS,
  DEFAULT_A,
  DEFAULT_LAMBDA,
  DEFAULT_R,
  yukawaPotential,
  runYukawaVSample,
} from './yukawa-algos'

describe('Yukawa · V = −A exp(−r/λ) / r', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_YUKAWA).toBe('method-yukawa-potential')
    expect(METHOD_ALGO_YUKAWA_V).toBe('method-algo-yukawa-v')
    expect(YUKAWA_PARENT).toBe(METHOD_YUKAWA)
    expect(YUKAWA_METHOD_IDS).toContain(METHOD_ALGO_YUKAWA_V)
  })

  it('yukawaPotential: formula', () => {
    const r = DEFAULT_R
    const A = DEFAULT_A
    const lambda = DEFAULT_LAMBDA
    expect(yukawaPotential(r, A, lambda)).toBeCloseTo(
      (-A * Math.exp(-r / lambda)) / r,
      12,
    )
  })

  it('attractive for A>0; large λ → −A/r; bad → NaN', () => {
    expect(yukawaPotential(1, 1, 1)).toBeLessThan(0)
    expect(yukawaPotential(2, 1, 1e12)).toBeCloseTo(-0.5, 6)
    expect(Number.isNaN(yukawaPotential(0, 1, 1))).toBe(true)
    expect(Number.isNaN(yukawaPotential(-1, 1, 1))).toBe(true)
    expect(Number.isNaN(yukawaPotential(1, 1, 0))).toBe(true)
    expect(Number.isNaN(yukawaPotential(NaN, 1, 1))).toBe(true)
  })

  it('runYukawaVSample: ok, formula, decay', () => {
    const r = runYukawaVSample()
    expect(r.methodId).toBe(METHOD_ALGO_YUKAWA_V)
    expect(r.familyId).toBe(METHOD_YUKAWA)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.V).toBeCloseTo(
      (-r.A * Math.exp(-r.r / r.lambda)) / r.r,
      12,
    )
    expect(r.V).toBeLessThan(0)
    expect(r.V_doubleR).toBeGreaterThan(r.V)
    expect(r.V_coulombLike).toBeCloseTo(-r.A / r.r, 5)
    expect(Number.isFinite(r.V_badR)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runYukawaVSample({ r: 2, A: 2, lambda: 0.5 }).ok).toBe(true)
  })
})
