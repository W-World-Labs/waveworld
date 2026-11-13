import { describe, it, expect } from 'vitest'
import {
  METHOD_MEISSNER,
  METHOD_ALGO_MEISSNER_B,
  METHOD_BCS,
  METHOD_ALGO_BCS_GAP,
  MEISSNER_PARENT,
  BCS_PARENT,
  MEISSNER_METHOD_IDS,
  BCS_METHOD_IDS,
  MEISSNER_BCS_METHOD_IDS,
  DEFAULT_B0,
  DEFAULT_X,
  DEFAULT_LAMBDA,
  DEFAULT_DELTA0,
  DEFAULT_T,
  DEFAULT_TC,
  meissnerField,
  bcsGap,
  runMeissnerBSample,
  runBcsGapSample,
} from './meissner-bcs-algos'

describe('Meissner + BCS · expulsion and gap', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_MEISSNER).toBe('method-meissner')
    expect(METHOD_ALGO_MEISSNER_B).toBe('method-algo-meissner-expel')
    expect(METHOD_BCS).toBe('method-bcs-gap')
    expect(METHOD_ALGO_BCS_GAP).toBe('method-algo-bcs-gap')
    expect(MEISSNER_PARENT).toBe(METHOD_MEISSNER)
    expect(BCS_PARENT).toBe(METHOD_BCS)
    expect(MEISSNER_METHOD_IDS).toContain(METHOD_ALGO_MEISSNER_B)
    expect(BCS_METHOD_IDS).toContain(METHOD_ALGO_BCS_GAP)
    expect(MEISSNER_BCS_METHOD_IDS).toContain(METHOD_ALGO_MEISSNER_B)
    expect(MEISSNER_BCS_METHOD_IDS).toContain(METHOD_ALGO_BCS_GAP)
  })

  it('meissnerField: B_in = B0 exp(−x/λ)', () => {
    expect(meissnerField(1, 0, 1)).toBeCloseTo(1, 12)
    expect(meissnerField(1, 1, 1)).toBeCloseTo(Math.E ** -1, 12)
    expect(meissnerField(DEFAULT_B0, DEFAULT_X, DEFAULT_LAMBDA)).toBeCloseTo(
      DEFAULT_B0 * Math.exp(-DEFAULT_X / DEFAULT_LAMBDA),
      12,
    )
  })

  it('meissnerField: deeper smaller; λ≤0 → NaN', () => {
    const b = meissnerField(1, 1, 1)
    expect(meissnerField(1, 2, 1)).toBeLessThan(b)
    expect(Number.isNaN(meissnerField(1, 1, 0))).toBe(true)
    expect(Number.isNaN(meissnerField(NaN, 1, 1))).toBe(true)
  })

  it('bcsGap: Δ ≈ Δ0 √(1−(T/Tc)²)', () => {
    expect(bcsGap(1, 0, 1)).toBeCloseTo(1, 12)
    expect(bcsGap(1, 1, 1)).toBeCloseTo(0, 12)
    const d = bcsGap(DEFAULT_DELTA0, DEFAULT_T, DEFAULT_TC)
    const r = DEFAULT_T / DEFAULT_TC
    expect(d).toBeCloseTo(DEFAULT_DELTA0 * Math.sqrt(1 - r * r), 12)
  })

  it('bcsGap: T>Tc or bad → NaN', () => {
    expect(Number.isNaN(bcsGap(1, 2, 1))).toBe(true)
    expect(Number.isNaN(bcsGap(1, -1, 1))).toBe(true)
    expect(Number.isNaN(bcsGap(1, 0, 0))).toBe(true)
  })

  it('runMeissnerBSample: ok, formula, surface', () => {
    const r = runMeissnerBSample()
    expect(r.methodId).toBe(METHOD_ALGO_MEISSNER_B)
    expect(r.familyId).toBe(METHOD_MEISSNER)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Bin).toBeCloseTo(r.B0 * Math.exp(-r.x / r.lambda), 12)
    expect(r.Bin_surface).toBeCloseTo(r.B0, 12)
    expect(Number.isFinite(r.Bin_badLambda)).toBe(false)
  })

  it('runBcsGapSample: ok, endpoints, formula', () => {
    const r = runBcsGapSample()
    expect(r.methodId).toBe(METHOD_ALGO_BCS_GAP)
    expect(r.familyId).toBe(METHOD_BCS)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Delta_T0).toBeCloseTo(r.delta0, 12)
    expect(r.Delta_Tc).toBe(0)
    expect(Number.isFinite(r.Delta_bad)).toBe(false)
  })
})
