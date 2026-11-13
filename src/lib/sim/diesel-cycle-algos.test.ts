import { describe, it, expect } from 'vitest'
import {
  METHOD_DIESEL,
  METHOD_ALGO_DIESEL_ETA,
  DIESEL_PARENT,
  DIESEL_METHOD_IDS,
  DEFAULT_R,
  DEFAULT_RC,
  DEFAULT_GAMMA,
  dieselEta,
  runDieselEtaSample,
} from './diesel-cycle-algos'

describe('Diesel · η = 1 − r^(1−γ) · (rc^γ − 1)/(γ(rc − 1))', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_DIESEL).toBe('method-diesel')
    expect(METHOD_ALGO_DIESEL_ETA).toBe('method-algo-diesel-eta')
    expect(DIESEL_PARENT).toBe(METHOD_DIESEL)
    expect(DIESEL_METHOD_IDS).toContain(METHOD_ALGO_DIESEL_ETA)
  })

  it('dieselEta: formula and textbook range', () => {
    const r = 18
    const rc = 2
    const gamma = 1.4
    const eta = dieselEta(r, rc, gamma)
    const inv = 1 / Math.pow(r, gamma - 1)
    const expected = 1 - inv * ((Math.pow(rc, gamma) - 1) / (gamma * (rc - 1)))
    expect(eta).toBeCloseTo(expected, 14)
    expect(eta).toBeGreaterThan(0.5)
    expect(eta).toBeLessThan(0.8)
  })

  it('r↑ → η↑; rc↑ → η↓', () => {
    expect(dieselEta(20, 2, 1.4)).toBeGreaterThan(dieselEta(18, 2, 1.4))
    expect(dieselEta(18, 3, 1.4)).toBeLessThan(dieselEta(18, 2, 1.4))
  })

  it('illegal: r≤1, rc≤1, γ≤1, non-finite → NaN', () => {
    expect(Number.isNaN(dieselEta(1, 2, 1.4))).toBe(true)
    expect(Number.isNaN(dieselEta(18, 1, 1.4))).toBe(true)
    expect(Number.isNaN(dieselEta(18, 2, 1))).toBe(true)
    expect(Number.isNaN(dieselEta(NaN, 2, 1.4))).toBe(true)
    expect(Number.isNaN(dieselEta(18, Infinity, 1.4))).toBe(true)
  })

  it('runDieselEtaSample: ok, methodId/familyId, formula', () => {
    const r = runDieselEtaSample()
    expect(r.methodId).toBe(METHOD_ALGO_DIESEL_ETA)
    expect(r.familyId).toBe(METHOD_DIESEL)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.r).toBe(DEFAULT_R)
    expect(r.rc).toBe(DEFAULT_RC)
    expect(r.gamma).toBe(DEFAULT_GAMMA)
    expect(r.etaHigherR).toBeGreaterThan(r.eta)
    expect(r.etaNearOtto).toBeGreaterThan(r.eta)
    expect(Number.isFinite(r.etaBadR)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runDieselEtaSample({ r: 16, rc: 1.5, gamma: 1.35 }).ok).toBe(true)
  })
})
