import { describe, it, expect } from 'vitest'
import {
  METHOD_JT,
  METHOD_ALGO_JT_MU,
  JT_PARENT,
  JT_METHOD_IDS,
  DEFAULT_MU_JT,
  DEFAULT_DELTA_P,
  jtDeltaT,
  runJtMuSample,
} from './joule-thomson-algos'

describe('Joule–Thomson · ΔT = μ · ΔP', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_JT).toBe('method-joule-thomson')
    expect(METHOD_ALGO_JT_MU).toBe('method-algo-jt-mu')
    expect(JT_PARENT).toBe(METHOD_JT)
    expect(JT_METHOD_IDS).toContain(METHOD_ALGO_JT_MU)
  })

  it('jtDeltaT: ΔT = μ · ΔP', () => {
    expect(jtDeltaT(0.25e-5, -1e5)).toBeCloseTo(-0.25, 12)
    expect(jtDeltaT(DEFAULT_MU_JT, 0)).toBe(0)
    expect(jtDeltaT(1e-5, 2e5)).toBeCloseTo(2, 12)
  })

  it('jtDeltaT: linear in ΔP; non-finite → NaN', () => {
    const mu = 1e-5
    expect(jtDeltaT(mu, -4e5)).toBeCloseTo(2 * jtDeltaT(mu, -2e5), 18)
    expect(Number.isNaN(jtDeltaT(NaN, 1))).toBe(true)
    expect(Number.isNaN(jtDeltaT(1e-5, Infinity))).toBe(true)
  })

  it('runJtMuSample: ok, formula, cool on expand, zero', () => {
    const r = runJtMuSample()
    expect(r.methodId).toBe(METHOD_ALGO_JT_MU)
    expect(r.familyId).toBe(METHOD_JT)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.mu).toBe(DEFAULT_MU_JT)
    expect(r.deltaP).toBe(-DEFAULT_DELTA_P)
    expect(r.dT).toBeCloseTo(r.mu * r.deltaP, 18)
    expect(r.dT).toBeCloseTo(-0.25, 12)
    expect(r.dT).toBeLessThan(0)
    expect(r.dT_double).toBeCloseTo(2 * r.dT, 18)
    expect(r.dT_zero).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runJtMuSample({ mu: 1e-5, deltaP: -5e4 }).ok).toBe(true)
  })
})
