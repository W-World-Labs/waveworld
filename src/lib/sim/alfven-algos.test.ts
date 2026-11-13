import { describe, it, expect } from 'vitest'
import {
  METHOD_ALFVEN,
  METHOD_ALGO_ALFVEN_V,
  ALFVEN_PARENT,
  ALFVEN_METHOD_IDS,
  MU0,
  DEFAULT_B,
  DEFAULT_RHO,
  alfvenSpeed,
  runAlfvenVSample,
} from './alfven-algos'

describe('Alfvén · vA = B / √(μ0 ρ)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ALFVEN).toBe('method-alfven-speed')
    expect(METHOD_ALGO_ALFVEN_V).toBe('method-algo-alfven-v')
    expect(ALFVEN_PARENT).toBe(METHOD_ALFVEN)
    expect(ALFVEN_METHOD_IDS).toContain(METHOD_ALGO_ALFVEN_V)
  })

  it('alfvenSpeed: formula', () => {
    expect(alfvenSpeed(DEFAULT_B, DEFAULT_RHO)).toBeCloseTo(
      Math.abs(DEFAULT_B) / Math.sqrt(MU0 * DEFAULT_RHO),
      8,
    )
    expect(alfvenSpeed(0, 1)).toBe(0)
  })

  it('∝ B; ∝ 1/√ρ; bad → NaN', () => {
    const v = alfvenSpeed(1e-4, 1e-12)
    expect(alfvenSpeed(2e-4, 1e-12)).toBeCloseTo(2 * v, 10)
    expect(alfvenSpeed(1e-4, 4e-12) / v).toBeCloseTo(0.5, 10)
    expect(Number.isNaN(alfvenSpeed(1, 0))).toBe(true)
    expect(Number.isNaN(alfvenSpeed(NaN, 1))).toBe(true)
  })

  it('runAlfvenVSample: ok, formula, methodId/familyId', () => {
    const r = runAlfvenVSample()
    expect(r.methodId).toBe(METHOD_ALGO_ALFVEN_V)
    expect(r.familyId).toBe(METHOD_ALFVEN)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.vA).toBeCloseTo(Math.abs(r.B) / Math.sqrt(r.mu0 * r.rho), 8)
    expect(r.vA_doubleB).toBeCloseTo(2 * r.vA, 10)
    expect(Number.isFinite(r.vA_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runAlfvenVSample({ B: 5e-5, rho: 1e-10 }).ok).toBe(true)
  })
})
