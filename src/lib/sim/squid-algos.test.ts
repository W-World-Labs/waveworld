import { describe, it, expect } from 'vitest'
import {
  METHOD_SQUID,
  METHOD_ALGO_SQUID_PHI,
  SQUID_PARENT,
  SQUID_METHOD_IDS,
  PHI0,
  DEFAULT_PHI,
  fluxQuanta,
  runSquidFluxSample,
} from './squid-algos'

describe('SQUID · n = Φ / Φ₀', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SQUID).toBe('method-squid')
    expect(METHOD_ALGO_SQUID_PHI).toBe('method-algo-squid-flux')
    expect(SQUID_PARENT).toBe(METHOD_SQUID)
    expect(SQUID_METHOD_IDS).toContain(METHOD_ALGO_SQUID_PHI)
  })

  it('PHI0 constant and fluxQuanta formula', () => {
    expect(PHI0).toBe(2.067833848e-15)
    expect(fluxQuanta(PHI0)).toBeCloseTo(1, 12)
    expect(fluxQuanta(DEFAULT_PHI, PHI0)).toBeCloseTo(1, 12)
    expect(fluxQuanta(2 * PHI0)).toBeCloseTo(2, 12)
    expect(fluxQuanta(0)).toBe(0)
  })

  it('∝ Φ; phi0≤0 / non-finite → NaN', () => {
    const n = fluxQuanta(3 * PHI0)
    expect(fluxQuanta(6 * PHI0)).toBeCloseTo(2 * n, 12)
    expect(Number.isNaN(fluxQuanta(PHI0, 0))).toBe(true)
    expect(Number.isNaN(fluxQuanta(PHI0, -1))).toBe(true)
    expect(Number.isNaN(fluxQuanta(NaN))).toBe(true)
  })

  it('runSquidFluxSample: ok, n=1 for one quantum', () => {
    const r = runSquidFluxSample()
    expect(r.methodId).toBe(METHOD_ALGO_SQUID_PHI)
    expect(r.familyId).toBe(METHOD_SQUID)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.n).toBeCloseTo(r.Phi / r.phi0, 12)
    expect(r.n_doublePhi).toBeCloseTo(2 * r.n, 12)
    expect(r.n_zero).toBe(0)
    expect(r.n_oneQuantum).toBeCloseTo(1, 12)
    expect(Number.isFinite(r.n_badPhi0)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runSquidFluxSample({ Phi: 5 * PHI0 }).ok).toBe(true)
  })
})
