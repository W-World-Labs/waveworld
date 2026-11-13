import { describe, it, expect } from 'vitest'
import {
  METHOD_FARADAY_ROT,
  METHOD_ALGO_FARADAY_THETA,
  FARADAY_ROT_PARENT,
  FARADAY_ROT_METHOD_IDS,
  DEFAULT_VERDET,
  DEFAULT_B,
  DEFAULT_L,
  faradayTheta,
  runFaradayThetaSample,
} from './faraday-rotation-algos'

describe('Faraday rotation · θ = V · B · L', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_FARADAY_ROT).toBe('method-faraday-rotation')
    expect(METHOD_ALGO_FARADAY_THETA).toBe('method-algo-faraday-theta')
    expect(FARADAY_ROT_PARENT).toBe(METHOD_FARADAY_ROT)
    expect(FARADAY_ROT_METHOD_IDS).toContain(METHOD_ALGO_FARADAY_THETA)
  })

  it('faradayTheta: θ = V B L', () => {
    expect(faradayTheta(10, 0.5, 0.1)).toBeCloseTo(0.5, 12)
    expect(faradayTheta(DEFAULT_VERDET, 0, DEFAULT_L)).toBe(0)
  })

  it('linear in B,L; antisym in B; non-finite → NaN', () => {
    const base = faradayTheta(5, 1, 0.2)
    expect(faradayTheta(5, 2, 0.2)).toBeCloseTo(2 * base, 18)
    expect(faradayTheta(5, -1, 0.2)).toBeCloseTo(-base, 18)
    expect(Number.isNaN(faradayTheta(NaN, 1, 1))).toBe(true)
    expect(Number.isNaN(faradayTheta(1, Infinity, 1))).toBe(true)
  })

  it('runFaradayThetaSample: ok, formula, linear, antisym', () => {
    const r = runFaradayThetaSample()
    expect(r.methodId).toBe(METHOD_ALGO_FARADAY_THETA)
    expect(r.familyId).toBe(METHOD_FARADAY_ROT)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.V).toBe(DEFAULT_VERDET)
    expect(r.B).toBe(DEFAULT_B)
    expect(r.L).toBe(DEFAULT_L)
    expect(r.theta).toBeCloseTo(r.V * r.B * r.L, 18)
    expect(r.theta_doubleB).toBeCloseTo(2 * r.theta, 18)
    expect(r.theta_negB).toBeCloseTo(-r.theta, 18)
    expect(r.theta_zeroL).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runFaradayThetaSample({ V: 20, B: 1, L: 0.05 }).ok).toBe(true)
  })
})
