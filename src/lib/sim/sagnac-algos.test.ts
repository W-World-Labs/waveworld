import { describe, it, expect } from 'vitest'
import {
  METHOD_SAGNAC,
  METHOD_ALGO_SAGNAC_PHASE,
  SAGNAC_PARENT,
  SAGNAC_METHOD_IDS,
  C,
  DEFAULT_A,
  DEFAULT_OMEGA,
  DEFAULT_LAMBDA,
  sagnacPhase,
  runSagnacPhaseSample,
} from './sagnac-algos'

describe('Sagnac · δφ = 8π A Ω /(λ c)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SAGNAC).toBe('method-sagnac')
    expect(METHOD_ALGO_SAGNAC_PHASE).toBe('method-algo-sagnac-phase')
    expect(SAGNAC_PARENT).toBe(METHOD_SAGNAC)
    expect(SAGNAC_METHOD_IDS).toContain(METHOD_ALGO_SAGNAC_PHASE)
  })

  it('sagnacPhase: formula', () => {
    const expected =
      (8 * Math.PI * DEFAULT_A * DEFAULT_OMEGA) / (DEFAULT_LAMBDA * C)
    expect(sagnacPhase(DEFAULT_A, DEFAULT_OMEGA, DEFAULT_LAMBDA)).toBeCloseTo(
      expected,
      10,
    )
    expect(sagnacPhase(1, 0, 1e-6)).toBe(0)
  })

  it('∝ A, Ω; ∝ 1/λ; bad → NaN', () => {
    const d = sagnacPhase(1, 1e-4, 1e-6)
    expect(sagnacPhase(2, 1e-4, 1e-6)).toBeCloseTo(2 * d, 12)
    expect(sagnacPhase(1, 2e-4, 1e-6)).toBeCloseTo(2 * d, 12)
    expect(sagnacPhase(1, 1e-4, 2e-6)).toBeCloseTo(d / 2, 12)
    expect(Number.isNaN(sagnacPhase(1, 1, 0))).toBe(true)
    expect(Number.isNaN(sagnacPhase(NaN, 1, 1e-6))).toBe(true)
  })

  it('runSagnacPhaseSample: ok, formula, methodId/familyId', () => {
    const r = runSagnacPhaseSample()
    expect(r.methodId).toBe(METHOD_ALGO_SAGNAC_PHASE)
    expect(r.familyId).toBe(METHOD_SAGNAC)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.deltaPhi).toBeCloseTo(
      (8 * Math.PI * r.A * r.Omega) / (r.lambda * r.c),
      10,
    )
    expect(r.deltaPhi_doubleA).toBeCloseTo(2 * r.deltaPhi, 10)
    expect(r.deltaPhi_zero).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runSagnacPhaseSample({ A: 0.1, Omega: 1e-3, lambda: 633e-9 }).ok).toBe(
      true,
    )
  })
})
