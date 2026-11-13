import { describe, it, expect } from 'vitest'
import {
  METHOD_STOKES,
  METHOD_ALGO_STOKES_F,
  STOKES_PARENT,
  STOKES_METHOD_IDS,
  DEFAULT_MU,
  DEFAULT_R,
  DEFAULT_V,
  stokesForce,
  runStokesForceSample,
} from './stokes-drag-algos'

describe('Stokes · F = 6 π μ r v', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_STOKES).toBe('method-stokes-drag')
    expect(METHOD_ALGO_STOKES_F).toBe('method-algo-stokes-force')
    expect(STOKES_PARENT).toBe(METHOD_STOKES)
    expect(STOKES_METHOD_IDS).toContain(METHOD_ALGO_STOKES_F)
  })

  it('stokesForce: formula', () => {
    const F = stokesForce(DEFAULT_MU, DEFAULT_R, DEFAULT_V)
    expect(F).toBeCloseTo(
      6 * Math.PI * DEFAULT_MU * DEFAULT_R * DEFAULT_V,
      18,
    )
    expect(F).toBeGreaterThan(0)
  })

  it('linear in μ, r, v; zero v; non-finite → NaN', () => {
    const F = stokesForce(1e-3, 1e-6, 1e-3)
    expect(stokesForce(2e-3, 1e-6, 1e-3)).toBeCloseTo(2 * F, 18)
    expect(stokesForce(1e-3, 2e-6, 1e-3)).toBeCloseTo(2 * F, 18)
    expect(stokesForce(1e-3, 1e-6, 2e-3)).toBeCloseTo(2 * F, 18)
    expect(stokesForce(1e-3, 1e-6, 0)).toBe(0)
    expect(Number.isNaN(stokesForce(NaN, 1, 1))).toBe(true)
  })

  it('runStokesForceSample: ok, formula, linear, zero', () => {
    const r = runStokesForceSample()
    expect(r.methodId).toBe(METHOD_ALGO_STOKES_F)
    expect(r.familyId).toBe(METHOD_STOKES)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.F).toBeCloseTo(6 * Math.PI * r.mu * r.r * r.v, 18)
    expect(r.F_doubleV).toBeCloseTo(2 * r.F, 18)
    expect(r.F_doubleR).toBeCloseTo(2 * r.F, 18)
    expect(r.F_zeroV).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runStokesForceSample({ mu: 1.8e-5, r: 1e-5, v: 0.01 }).ok).toBe(
      true,
    )
  })
})
