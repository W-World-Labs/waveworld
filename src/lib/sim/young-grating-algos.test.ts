import { describe, it, expect } from 'vitest'
import {
  METHOD_YOUNG,
  METHOD_ALGO_YOUNG_FRINGE,
  METHOD_GRATING,
  METHOD_ALGO_GRATING_ORDER,
  YOUNG_PARENT,
  GRATING_PARENT,
  YOUNG_METHOD_IDS,
  GRATING_METHOD_IDS,
  DEFAULT_LAMBDA,
  DEFAULT_L,
  DEFAULT_D_SLIT,
  DEFAULT_D_GRATING,
  youngFringeSpacing,
  gratingSinTheta,
  gratingTheta,
  runYoungFringeSample,
  runGratingOrderSample,
} from './young-grating-algos'

describe('Young · δy = λ L / d', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_YOUNG).toBe('method-young-double-slit')
    expect(METHOD_ALGO_YOUNG_FRINGE).toBe('method-algo-young-fringe')
    expect(YOUNG_PARENT).toBe(METHOD_YOUNG)
    expect(YOUNG_METHOD_IDS).toContain(METHOD_ALGO_YOUNG_FRINGE)
  })

  it('youngFringeSpacing: formula', () => {
    const dy = youngFringeSpacing(DEFAULT_LAMBDA, DEFAULT_L, DEFAULT_D_SLIT)
    expect(dy).toBeCloseTo(
      (DEFAULT_LAMBDA * DEFAULT_L) / DEFAULT_D_SLIT,
      14,
    )
    // ~2.53 mm for 632.8 nm, 1 m, 0.25 mm
    expect(dy).toBeGreaterThan(0.002)
    expect(dy).toBeLessThan(0.003)
  })

  it('∝ λ, L; ∝ 1/d; illegal → NaN', () => {
    const dy = youngFringeSpacing(500e-9, 2, 1e-3)
    expect(youngFringeSpacing(1e-6, 2, 1e-3)).toBeCloseTo(2 * dy, 14)
    expect(youngFringeSpacing(500e-9, 4, 1e-3)).toBeCloseTo(2 * dy, 14)
    expect(youngFringeSpacing(500e-9, 2, 2e-3)).toBeCloseTo(dy / 2, 14)
    expect(Number.isNaN(youngFringeSpacing(0, 1, 1))).toBe(true)
    expect(Number.isNaN(youngFringeSpacing(1e-6, 1, 0))).toBe(true)
  })

  it('runYoungFringeSample: ok, formula, scalings', () => {
    const r = runYoungFringeSample()
    expect(r.methodId).toBe(METHOD_ALGO_YOUNG_FRINGE)
    expect(r.familyId).toBe(METHOD_YOUNG)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.deltaY).toBeCloseTo((r.lambda * r.L) / r.d, 14)
    expect(r.deltaY_doubleLambda).toBeCloseTo(2 * r.deltaY, 14)
    expect(r.deltaY_doubleD).toBeCloseTo(r.deltaY / 2, 14)
    expect(Number.isFinite(r.deltaY_bad)).toBe(false)
  })
})

describe('Grating · d sinθ = m λ', () => {
  it('method id constants', () => {
    expect(METHOD_GRATING).toBe('method-diffraction-grating')
    expect(METHOD_ALGO_GRATING_ORDER).toBe('method-algo-grating-order')
    expect(GRATING_PARENT).toBe(METHOD_GRATING)
    expect(GRATING_METHOD_IDS).toContain(METHOD_ALGO_GRATING_ORDER)
  })

  it('gratingSinTheta / gratingTheta: formula', () => {
    const m = 1
    const s = gratingSinTheta(m, DEFAULT_LAMBDA, DEFAULT_D_GRATING)
    expect(s).toBeCloseTo((m * DEFAULT_LAMBDA) / DEFAULT_D_GRATING, 14)
    expect(gratingTheta(m, DEFAULT_LAMBDA, DEFAULT_D_GRATING)).toBeCloseTo(
      Math.asin(s),
      14,
    )
    expect(gratingSinTheta(0, DEFAULT_LAMBDA, DEFAULT_D_GRATING)).toBe(0)
  })

  it('|mλ/d|>1 or non-integer m → NaN', () => {
    expect(Number.isNaN(gratingSinTheta(1_000_000, 500e-9, 1e-6))).toBe(true)
    expect(Number.isNaN(gratingSinTheta(1.5, 500e-9, 1e-6))).toBe(true)
    expect(Number.isNaN(gratingSinTheta(1, 0, 1e-6))).toBe(true)
  })

  it('runGratingOrderSample: ok, formula, m=0, bad order', () => {
    const r = runGratingOrderSample()
    expect(r.methodId).toBe(METHOD_ALGO_GRATING_ORDER)
    expect(r.familyId).toBe(METHOD_GRATING)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.sinTheta).toBeCloseTo((r.m * r.lambda) / r.d, 14)
    expect(r.theta).toBeCloseTo(Math.asin(r.sinTheta), 14)
    expect(r.sinTheta_m0).toBe(0)
    expect(Number.isFinite(r.sinTheta_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runYoungFringeSample({ lambda: 500e-9, L: 2, d: 1e-3 }).ok).toBe(
      true,
    )
    expect(
      runGratingOrderSample({ m: 2, lambda: 500e-9, d: 2e-6 }).ok,
    ).toBe(true)
  })
})
