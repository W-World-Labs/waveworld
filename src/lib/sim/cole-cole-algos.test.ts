import { describe, it, expect } from 'vitest'
import {
  METHOD_COLE,
  METHOD_ALGO_COLE_EPS,
  COLE_PARENT,
  COLE_METHOD_IDS,
  DEFAULT_EPS_S,
  DEFAULT_EPS_INF,
  DEFAULT_OMEGA,
  DEFAULT_TAU,
  debyeRealEps,
  runColeEpsSample,
} from './cole-cole-algos'

describe('Cole–Cole / Debye · real permittivity', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_COLE).toBe('method-cole-cole')
    expect(METHOD_ALGO_COLE_EPS).toBe('method-algo-cole-eps')
    expect(COLE_PARENT).toBe(METHOD_COLE)
    expect(COLE_METHOD_IDS).toContain(METHOD_ALGO_COLE_EPS)
  })

  it('debyeRealEps: ε′ = ε∞ + (εs−ε∞)/(1+(ωτ)²)', () => {
    const epsS = DEFAULT_EPS_S
    const epsInf = DEFAULT_EPS_INF
    const omega = DEFAULT_OMEGA
    const tau = DEFAULT_TAU
    const wt = omega * tau
    const expected = epsInf + (epsS - epsInf) / (1 + wt * wt)
    expect(debyeRealEps(epsS, epsInf, omega, tau)).toBeCloseTo(expected, 12)
  })

  it('static ω=0 → εs; large ω → ε∞; bad → NaN', () => {
    expect(debyeRealEps(80, 5, 0, 1e-9)).toBeCloseTo(80, 12)
    expect(debyeRealEps(80, 5, 1e15, 1e-9)).toBeCloseTo(5, 4)
    expect(Number.isNaN(debyeRealEps(80, 5, NaN, 1))).toBe(true)
    expect(Number.isNaN(debyeRealEps(Infinity, 5, 1, 1))).toBe(true)
  })

  it('runColeEpsSample: ok, limits, formula', () => {
    const r = runColeEpsSample()
    expect(r.methodId).toBe(METHOD_ALGO_COLE_EPS)
    expect(r.familyId).toBe(METHOD_COLE)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    const wt = r.omega * r.tau
    expect(r.eps).toBeCloseTo(
      r.epsInf + (r.epsS - r.epsInf) / (1 + wt * wt),
      12,
    )
    expect(r.eps_static).toBeCloseTo(r.epsS, 12)
    expect(r.eps_hf).toBeCloseTo(r.epsInf, 5)
    expect(Number.isFinite(r.eps_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(
      runColeEpsSample({ epsS: 40, epsInf: 2, omega: 1e8, tau: 1e-8 }).ok,
    ).toBe(true)
  })
})
