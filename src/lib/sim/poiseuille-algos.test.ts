import { describe, it, expect } from 'vitest'
import {
  METHOD_POISEUILLE,
  METHOD_ALGO_POISEUILLE_Q,
  POISEUILLE_PARENT,
  POISEUILLE_METHOD_IDS,
  DEFAULT_R,
  DEFAULT_DELTA_P,
  DEFAULT_MU,
  DEFAULT_L,
  poiseuilleQ,
  runPoiseuilleQSample,
} from './poiseuille-algos'

describe('Poiseuille · Q = π r⁴ ΔP / (8 μ L)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_POISEUILLE).toBe('method-poiseuille')
    expect(METHOD_ALGO_POISEUILLE_Q).toBe('method-algo-poiseuille-q')
    expect(POISEUILLE_PARENT).toBe(METHOD_POISEUILLE)
    expect(POISEUILLE_METHOD_IDS).toContain(METHOD_ALGO_POISEUILLE_Q)
  })

  it('poiseuilleQ: formula', () => {
    const r = DEFAULT_R
    const dP = DEFAULT_DELTA_P
    const mu = DEFAULT_MU
    const L = DEFAULT_L
    const Q = poiseuilleQ(r, dP, mu, L)
    expect(Q).toBeCloseTo((Math.PI * r ** 4 * dP) / (8 * mu * L), 18)
    expect(Q).toBeGreaterThan(0)
  })

  it('∝ r⁴, ΔP; μ=0 or L=0 → NaN', () => {
    const Q = poiseuilleQ(1e-3, 1000, 1e-3, 0.1)
    expect(poiseuilleQ(2e-3, 1000, 1e-3, 0.1)).toBeCloseTo(16 * Q, 12)
    expect(poiseuilleQ(1e-3, 2000, 1e-3, 0.1)).toBeCloseTo(2 * Q, 12)
    expect(Number.isNaN(poiseuilleQ(1e-3, 1000, 0, 0.1))).toBe(true)
    expect(Number.isNaN(poiseuilleQ(1e-3, 1000, 1e-3, 0))).toBe(true)
    expect(Number.isNaN(poiseuilleQ(NaN, 1, 1, 1))).toBe(true)
  })

  it('runPoiseuilleQSample: ok, formula, r⁴, double ΔP', () => {
    const r = runPoiseuilleQSample()
    expect(r.methodId).toBe(METHOD_ALGO_POISEUILLE_Q)
    expect(r.familyId).toBe(METHOD_POISEUILLE)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Q).toBeCloseTo(
      (Math.PI * r.r ** 4 * r.deltaP) / (8 * r.mu * r.L),
      18,
    )
    expect(r.Q_doubleR).toBeCloseTo(16 * r.Q, 12)
    expect(r.Q_doubleDeltaP).toBeCloseTo(2 * r.Q, 12)
    expect(Number.isFinite(r.Q_badMu)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runPoiseuilleQSample({ r: 2e-3, deltaP: 500, L: 0.2 }).ok).toBe(
      true,
    )
  })
})
