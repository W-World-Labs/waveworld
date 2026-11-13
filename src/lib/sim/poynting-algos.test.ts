import { describe, it, expect } from 'vitest'
import {
  METHOD_POYNTING,
  METHOD_ALGO_POYNTING_S,
  POYNTING_PARENT,
  POYNTING_METHOD_IDS,
  MU0,
  DEFAULT_E,
  DEFAULT_H,
  poyntingS,
  poyntingFromEB,
  runPoyntingSample,
} from './poynting-algos'

describe('Poynting · S = E · H (orthogonal teaching)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_POYNTING).toBe('method-poynting')
    expect(METHOD_ALGO_POYNTING_S).toBe('method-algo-poynting-s')
    expect(POYNTING_PARENT).toBe(METHOD_POYNTING)
    expect(POYNTING_METHOD_IDS).toContain(METHOD_ALGO_POYNTING_S)
  })

  it('poyntingS: S = E · H', () => {
    expect(poyntingS(100, 0.265)).toBeCloseTo(26.5, 12)
    expect(poyntingS(DEFAULT_E, DEFAULT_H)).toBeCloseTo(
      Math.abs(DEFAULT_E) * Math.abs(DEFAULT_H),
      12,
    )
  })

  it('linear in E; magnitude; non-finite → NaN', () => {
    const S = poyntingS(10, 2)
    expect(poyntingS(20, 2)).toBeCloseTo(2 * S, 14)
    expect(poyntingS(-10, 2)).toBeCloseTo(S, 14)
    expect(Number.isNaN(poyntingS(NaN, 1))).toBe(true)
    expect(Number.isNaN(poyntingS(1, Infinity))).toBe(true)
  })

  it('poyntingFromEB: S = E·B/μ₀ agrees with E·H when B=μ₀ H', () => {
    const E = 50
    const H = 0.1
    const B = MU0 * H
    expect(poyntingFromEB(E, B)).toBeCloseTo(poyntingS(E, H), 10)
  })

  it('runPoyntingSample: ok, formula, EB equivalence', () => {
    const r = runPoyntingSample()
    expect(r.methodId).toBe(METHOD_ALGO_POYNTING_S)
    expect(r.familyId).toBe(METHOD_POYNTING)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.S).toBeCloseTo(Math.abs(r.E) * Math.abs(r.H), 12)
    expect(r.S_doubleE).toBeCloseTo(2 * r.S, 12)
    expect(r.S_fromEB).toBeCloseTo(r.S, 10)
  })

  it('custom params still ok', () => {
    expect(runPoyntingSample({ E: 1, H: 1 }).ok).toBe(true)
  })
})
