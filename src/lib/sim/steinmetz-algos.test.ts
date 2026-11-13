import { describe, it, expect } from 'vitest'
import {
  METHOD_STEINMETZ,
  METHOD_ALGO_STEINMETZ_P,
  STEINMETZ_PARENT,
  STEINMETZ_METHOD_IDS,
  DEFAULT_ETA,
  DEFAULT_B,
  DEFAULT_F,
  DEFAULT_ALPHA,
  DEFAULT_BETA,
  steinmetzP,
  runSteinmetzPSample,
} from './steinmetz-algos'

describe('Steinmetz · P = η B^β f^α', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_STEINMETZ).toBe('method-steinmetz')
    expect(METHOD_ALGO_STEINMETZ_P).toBe('method-algo-steinmetz-p')
    expect(STEINMETZ_PARENT).toBe(METHOD_STEINMETZ)
    expect(STEINMETZ_METHOD_IDS).toContain(METHOD_ALGO_STEINMETZ_P)
    expect(DEFAULT_ALPHA).toBe(1.6)
    expect(DEFAULT_BETA).toBe(1.6)
  })

  it('steinmetzP: formula', () => {
    const P = steinmetzP(DEFAULT_ETA, DEFAULT_B, DEFAULT_F)
    expect(P).toBeCloseTo(
      DEFAULT_ETA * DEFAULT_B ** DEFAULT_BETA * DEFAULT_F ** DEFAULT_ALPHA,
      8,
    )
    expect(P).toBeGreaterThan(0)
  })

  it('scales with B^β, f^α; B=0 ⇒ 0; bad → NaN', () => {
    const P = steinmetzP(DEFAULT_ETA, DEFAULT_B, DEFAULT_F, 1.6, 1.6)
    expect(steinmetzP(DEFAULT_ETA, 2 * DEFAULT_B, DEFAULT_F, 1.6, 1.6)).toBeCloseTo(
      P * 2 ** 1.6,
      8,
    )
    expect(steinmetzP(DEFAULT_ETA, DEFAULT_B, 2 * DEFAULT_F, 1.6, 1.6)).toBeCloseTo(
      P * 2 ** 1.6,
      8,
    )
    expect(steinmetzP(DEFAULT_ETA, 0, DEFAULT_F)).toBe(0)
    expect(Number.isNaN(steinmetzP(-1, 0.5, 50))).toBe(true)
    expect(Number.isNaN(steinmetzP(1, -0.1, 50))).toBe(true)
    expect(Number.isNaN(steinmetzP(NaN, 0.5, 50))).toBe(true)
  })

  it('runSteinmetzPSample: ok, formula, scaling', () => {
    const r = runSteinmetzPSample()
    expect(r.methodId).toBe(METHOD_ALGO_STEINMETZ_P)
    expect(r.familyId).toBe(METHOD_STEINMETZ)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.P).toBeCloseTo(r.eta * r.B ** r.beta * r.f ** r.alpha, 8)
    expect(r.P_doubleB).toBeCloseTo(r.P * 2 ** r.beta, 8)
    expect(r.P_doubleF).toBeCloseTo(r.P * 2 ** r.alpha, 8)
    expect(r.P_zeroB).toBe(0)
  })

  it('custom params still ok', () => {
    expect(
      runSteinmetzPSample({ eta: 50, B: 1, f: 400, alpha: 1.5, beta: 1.8 }).ok,
    ).toBe(true)
  })
})
