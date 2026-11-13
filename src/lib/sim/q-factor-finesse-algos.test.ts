import { describe, it, expect } from 'vitest'
import {
  METHOD_Q,
  METHOD_ALGO_Q,
  METHOD_FINESSE,
  METHOD_ALGO_FINESSE,
  Q_PARENT,
  FINESSE_PARENT,
  Q_METHOD_IDS,
  FINESSE_METHOD_IDS,
  DEFAULT_F0,
  DEFAULT_DELTA_F,
  DEFAULT_R,
  qualityFactor,
  finesseFromR,
  runQFactorSample,
  runFinesseSample,
} from './q-factor-finesse-algos'

describe('Q-factor + Fabry–Pérot finesse', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_Q).toBe('method-q-factor')
    expect(METHOD_ALGO_Q).toBe('method-algo-q-factor')
    expect(METHOD_FINESSE).toBe('method-finesse')
    expect(METHOD_ALGO_FINESSE).toBe('method-algo-finesse')
    expect(Q_PARENT).toBe(METHOD_Q)
    expect(FINESSE_PARENT).toBe(METHOD_FINESSE)
    expect(Q_METHOD_IDS).toContain(METHOD_ALGO_Q)
    expect(FINESSE_METHOD_IDS).toContain(METHOD_ALGO_FINESSE)
  })

  it('qualityFactor: Q = f0 / Δf', () => {
    expect(qualityFactor(1e9, 1e6)).toBeCloseTo(1000, 12)
    expect(qualityFactor(DEFAULT_F0, DEFAULT_DELTA_F)).toBeCloseTo(
      DEFAULT_F0 / DEFAULT_DELTA_F,
      12,
    )
    expect(qualityFactor(0, 1)).toBe(0)
  })

  it('qualityFactor: ∝ f0, 1/Δf; bad → NaN', () => {
    const Q = qualityFactor(1e9, 1e6)
    expect(qualityFactor(2e9, 1e6)).toBeCloseTo(2 * Q, 12)
    expect(qualityFactor(1e9, 2e6)).toBeCloseTo(Q / 2, 12)
    expect(Number.isNaN(qualityFactor(1, 0))).toBe(true)
    expect(Number.isNaN(qualityFactor(-1, 1))).toBe(true)
    expect(Number.isNaN(qualityFactor(NaN, 1))).toBe(true)
  })

  it('finesseFromR: F = π √R / (1−R)', () => {
    const R = 0.99
    expect(finesseFromR(R)).toBeCloseTo(
      (Math.PI * Math.sqrt(R)) / (1 - R),
      12,
    )
    expect(finesseFromR(DEFAULT_R)).toBeGreaterThan(100)
  })

  it('finesseFromR: higher R → higher F; R∉(0,1) → NaN', () => {
    expect(finesseFromR(0.999)).toBeGreaterThan(finesseFromR(0.99))
    expect(Number.isNaN(finesseFromR(0))).toBe(true)
    expect(Number.isNaN(finesseFromR(1))).toBe(true)
    expect(Number.isNaN(finesseFromR(-0.1))).toBe(true)
    expect(Number.isNaN(finesseFromR(NaN))).toBe(true)
  })

  it('runQFactorSample: ok, formula, scalings', () => {
    const r = runQFactorSample()
    expect(r.methodId).toBe(METHOD_ALGO_Q)
    expect(r.familyId).toBe(METHOD_Q)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Q).toBeCloseTo(r.f0 / r.deltaF, 12)
    expect(r.Q_doubleF0).toBeCloseTo(2 * r.Q, 12)
    expect(r.Q_doubleDeltaF).toBeCloseTo(r.Q / 2, 12)
    expect(Number.isFinite(r.Q_badDeltaF)).toBe(false)
  })

  it('runFinesseSample: ok, formula, higher-R', () => {
    const r = runFinesseSample()
    expect(r.methodId).toBe(METHOD_ALGO_FINESSE)
    expect(r.familyId).toBe(METHOD_FINESSE)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.F).toBeCloseTo(
      (Math.PI * Math.sqrt(r.R)) / (1 - r.R),
      12,
    )
    expect(r.F_higherR).toBeGreaterThan(r.F)
    expect(Number.isFinite(r.F_badR)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runQFactorSample({ f0: 5e8, deltaF: 5e5 }).ok).toBe(true)
    expect(runFinesseSample({ R: 0.95 }).ok).toBe(true)
  })
})
