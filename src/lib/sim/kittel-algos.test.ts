import { describe, it, expect } from 'vitest'
import {
  METHOD_KITTEL,
  METHOD_ALGO_KITTEL_F,
  KITTEL_PARENT,
  KITTEL_METHOD_IDS,
  MU0,
  GAMMA,
  DEFAULT_B,
  DEFAULT_MS,
  kittelOmega,
  kittelFreq,
  kittelFreqSimple,
  runKittelFSample,
} from './kittel-algos'

describe('Kittel · ω = γ √(B(B+μ₀ Ms))', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_KITTEL).toBe('method-kittel')
    expect(METHOD_ALGO_KITTEL_F).toBe('method-algo-kittel-f')
    expect(KITTEL_PARENT).toBe(METHOD_KITTEL)
    expect(KITTEL_METHOD_IDS).toContain(METHOD_ALGO_KITTEL_F)
  })

  it('kittelOmega: formula', () => {
    const B = 0.1
    const Ms = 8e5
    const expected = GAMMA * Math.sqrt(B * (B + MU0 * Ms))
    expect(kittelOmega(B, Ms)).toBeCloseTo(expected, 6)
    expect(kittelOmega(DEFAULT_B, DEFAULT_MS)).toBeCloseTo(
      GAMMA * Math.sqrt(DEFAULT_B * (DEFAULT_B + MU0 * DEFAULT_MS)),
      6,
    )
  })

  it('kittelFreqSimple: f = (γ/2π) B', () => {
    expect(kittelFreqSimple(1)).toBeCloseTo(GAMMA / (2 * Math.PI), 4)
    expect(kittelFreqSimple(0)).toBe(0)
  })

  it('kittelFreq = omega/2π; mono in B; bad → NaN', () => {
    const omega = kittelOmega(0.1, 8e5)
    expect(kittelFreq(0.1, 8e5)).toBeCloseTo(omega / (2 * Math.PI), 6)
    expect(kittelOmega(0.2, 8e5)).toBeGreaterThan(omega)
    expect(kittelOmega(0, 8e5)).toBe(0)
    expect(Number.isNaN(kittelOmega(-1, 8e5))).toBe(true)
    expect(Number.isNaN(kittelOmega(0.1, -1))).toBe(true)
    expect(Number.isNaN(kittelOmega(NaN, 8e5))).toBe(true)
    expect(Number.isNaN(kittelFreqSimple(-1))).toBe(true)
  })

  it('runKittelFSample: ok, formula, mono, B=0 ⇒ 0', () => {
    const r = runKittelFSample()
    expect(r.methodId).toBe(METHOD_ALGO_KITTEL_F)
    expect(r.familyId).toBe(METHOD_KITTEL)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.omega).toBeCloseTo(
      GAMMA * Math.sqrt(r.B * (r.B + MU0 * r.Ms)),
      6,
    )
    expect(r.f).toBeCloseTo(r.omega / (2 * Math.PI), 6)
    expect(r.f_simple).toBeCloseTo((GAMMA / (2 * Math.PI)) * r.B, 4)
    expect(r.omega_doubleB_approx).toBeGreaterThan(r.omega)
    expect(r.omega_zero).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runKittelFSample({ B: 0.05, Ms: 1e6 }).ok).toBe(true)
  })
})
