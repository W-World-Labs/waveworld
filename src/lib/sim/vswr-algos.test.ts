import { describe, it, expect } from 'vitest'
import {
  METHOD_VSWR,
  METHOD_ALGO_VSWR,
  VSWR_PARENT,
  VSWR_METHOD_IDS,
  DEFAULT_GAMMA,
  vswrFromGamma,
  gammaFromVswr,
  runVswrSample,
} from './vswr-algos'

describe('VSWR · (1+|Γ|)/(1−|Γ|)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_VSWR).toBe('method-vswr')
    expect(METHOD_ALGO_VSWR).toBe('method-algo-vswr-from-gamma')
    expect(VSWR_PARENT).toBe(METHOD_VSWR)
    expect(VSWR_METHOD_IDS).toContain(METHOD_ALGO_VSWR)
  })

  it('vswrFromGamma: formula and matched', () => {
    expect(vswrFromGamma(0)).toBeCloseTo(1, 15)
    expect(vswrFromGamma(DEFAULT_GAMMA)).toBeCloseTo(
      (1 + DEFAULT_GAMMA) / (1 - DEFAULT_GAMMA),
      12,
    )
    // |Γ|=1/3 → VSWR=2
    expect(vswrFromGamma(1 / 3)).toBeCloseTo(2, 12)
    expect(vswrFromGamma(-0.2)).toBeCloseTo(vswrFromGamma(0.2), 14)
  })

  it('|Γ|≥1 or non-finite → NaN', () => {
    expect(Number.isNaN(vswrFromGamma(1))).toBe(true)
    expect(Number.isNaN(vswrFromGamma(1.5))).toBe(true)
    expect(Number.isNaN(vswrFromGamma(NaN))).toBe(true)
  })

  it('gammaFromVswr inverse round-trip', () => {
    const g = 0.333
    const s = vswrFromGamma(g)
    expect(gammaFromVswr(s)).toBeCloseTo(g, 12)
    expect(gammaFromVswr(1)).toBeCloseTo(0, 15)
    expect(Number.isNaN(gammaFromVswr(0.5))).toBe(true)
  })

  it('runVswrSample: ok, formula, inverse', () => {
    const r = runVswrSample()
    expect(r.methodId).toBe(METHOD_ALGO_VSWR)
    expect(r.familyId).toBe(METHOD_VSWR)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.vswr).toBeCloseTo(
      (1 + Math.abs(r.gamma)) / (1 - Math.abs(r.gamma)),
      12,
    )
    expect(r.vswr_matched).toBe(1)
    expect(r.gamma_back).toBeCloseTo(Math.abs(r.gamma), 12)
    expect(Number.isFinite(r.vswr_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runVswrSample({ gamma: 0.5 }).ok).toBe(true)
  })
})
