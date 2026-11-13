import { describe, it, expect } from 'vitest'
import {
  METHOD_MCE,
  METHOD_ALGO_MCE_DT,
  MCE_PARENT,
  MCE_METHOD_IDS,
  adiabaticDeltaT,
  mceDeltaT,
  runMceDeltaTSample,
} from './magnetocaloric-algos'

describe('Magnetocaloric · ΔT_ad = −(T/C)(∂M/∂T) μ0 dH', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_MCE).toBe('method-magnetocaloric')
    expect(METHOD_ALGO_MCE_DT).toBe('method-algo-mce-delta-t')
    expect(MCE_PARENT).toBe(METHOD_MCE)
    expect(MCE_METHOD_IDS).toContain(METHOD_ALGO_MCE_DT)
  })

  it('adiabaticDeltaT / mceDeltaT: formula', () => {
    const T = 300
    const C = 3e6
    const dMdT = -1e5
    const mu0_dH = 1
    const dT = adiabaticDeltaT(T, C, dMdT, mu0_dH)
    expect(dT).toBeCloseTo(-(T / C) * dMdT * mu0_dH, 12)
    expect(mceDeltaT(T, C, dMdT, mu0_dH)).toBe(dT)
    // dMdT<0 ⇒ positive heating on +field
    expect(dT).toBeGreaterThan(0)
  })

  it('linear in μ0 dH; antisymmetric under field reverse', () => {
    const base = adiabaticDeltaT(280, 2e6, -5e4, 0.5)
    expect(adiabaticDeltaT(280, 2e6, -5e4, 1)).toBeCloseTo(2 * base, 12)
    expect(adiabaticDeltaT(280, 2e6, -5e4, -0.5)).toBeCloseTo(-base, 12)
  })

  it('illegal: T≤0, C=0, non-finite → NaN', () => {
    expect(Number.isNaN(adiabaticDeltaT(0, 1e6, -1, 1))).toBe(true)
    expect(Number.isNaN(adiabaticDeltaT(-10, 1e6, -1, 1))).toBe(true)
    expect(Number.isNaN(adiabaticDeltaT(300, 0, -1, 1))).toBe(true)
    expect(Number.isNaN(adiabaticDeltaT(NaN, 1e6, -1, 1))).toBe(true)
    expect(Number.isNaN(adiabaticDeltaT(300, 1e6, Infinity, 1))).toBe(true)
  })

  it('runMceDeltaTSample: ok, methodId/familyId, heating on magnetize', () => {
    const r = runMceDeltaTSample()
    expect(r.methodId).toBe(METHOD_ALGO_MCE_DT)
    expect(r.familyId).toBe(METHOD_MCE)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.dT).toBeCloseTo(-(r.T / r.C) * r.dMdT * r.mu0_dH, 12)
    expect(r.dT).toBeGreaterThan(0)
    expect(r.dT_doubleField).toBeCloseTo(2 * r.dT, 12)
    expect(r.dT_reverseField).toBeCloseTo(-r.dT, 12)
    expect(Number.isFinite(r.dT_badC)).toBe(false)
  })
})
