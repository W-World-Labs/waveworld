import { describe, it, expect } from 'vitest'
import {
  METHOD_LANGMUIR,
  METHOD_ALGO_LANGMUIR_THETA,
  LANGMUIR_PARENT,
  LANGMUIR_METHOD_IDS,
  DEFAULT_K,
  DEFAULT_P,
  langmuirTheta,
  runLangmuirThetaSample,
} from './langmuir-algos'

describe('Langmuir · θ = KP / (1 + KP)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_LANGMUIR).toBe('method-langmuir-isotherm')
    expect(METHOD_ALGO_LANGMUIR_THETA).toBe('method-algo-langmuir-theta')
    expect(LANGMUIR_PARENT).toBe(METHOD_LANGMUIR)
    expect(LANGMUIR_METHOD_IDS).toContain(METHOD_ALGO_LANGMUIR_THETA)
  })

  it('langmuirTheta: formula', () => {
    expect(langmuirTheta(1, 1)).toBeCloseTo(0.5, 12)
    expect(langmuirTheta(DEFAULT_K, DEFAULT_P)).toBeCloseTo(
      (DEFAULT_K * DEFAULT_P) / (1 + DEFAULT_K * DEFAULT_P),
      12,
    )
  })

  it('P=0 ⇒ 0; high P → 1; mono in P; non-finite → NaN', () => {
    expect(langmuirTheta(2, 0)).toBe(0)
    expect(langmuirTheta(1, 1e9)).toBeCloseTo(1, 6)
    expect(langmuirTheta(1, 2)).toBeGreaterThan(langmuirTheta(1, 1))
    expect(Number.isNaN(langmuirTheta(NaN, 1))).toBe(true)
  })

  it('runLangmuirThetaSample: ok, formula, bounds, mono', () => {
    const r = runLangmuirThetaSample()
    expect(r.methodId).toBe(METHOD_ALGO_LANGMUIR_THETA)
    expect(r.familyId).toBe(METHOD_LANGMUIR)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.theta).toBeCloseTo((r.K * r.P) / (1 + r.K * r.P), 12)
    expect(r.theta_zeroP).toBe(0)
    expect(r.theta_highP).toBeGreaterThan(0.99)
    expect(r.theta_doubleP).toBeGreaterThan(r.theta)
    expect(r.theta).toBeLessThan(1)
  })

  it('custom params still ok', () => {
    expect(runLangmuirThetaSample({ K: 0.5, P: 2 }).ok).toBe(true)
  })
})
