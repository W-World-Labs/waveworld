import { describe, it, expect } from 'vitest'
import {
  METHOD_BRILLOUIN,
  METHOD_ALGO_BRILLOUIN_SHIFT,
  BRILLOUIN_PARENT,
  BRILLOUIN_METHOD_IDS,
  DEFAULT_V_SOUND,
  DEFAULT_N,
  DEFAULT_LAMBDA,
  DEFAULT_THETA,
  brillouinShiftHz,
  runBrillouinShiftSample,
} from './brillouin-algos'

describe('Brillouin · Δν ≈ (2 n v / λ) sin(θ/2)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_BRILLOUIN).toBe('method-brillouin')
    expect(METHOD_ALGO_BRILLOUIN_SHIFT).toBe('method-algo-brillouin-shift')
    expect(BRILLOUIN_PARENT).toBe(METHOD_BRILLOUIN)
    expect(BRILLOUIN_METHOD_IDS).toContain(METHOD_ALGO_BRILLOUIN_SHIFT)
  })

  it('brillouinShiftHz: formula and backscattering', () => {
    const dNu = brillouinShiftHz(1480, 1.33, 532e-9, Math.PI)
    const expected = ((2 * 1.33 * 1480) / 532e-9) * Math.sin(Math.PI / 2)
    expect(dNu).toBeCloseTo(expected, 6)
    expect(dNu).toBeGreaterThan(0)
    // θ=0 → zero shift
    expect(brillouinShiftHz(1480, 1.33, 532e-9, 0)).toBeCloseTo(0, 30)
  })

  it('linear in n and v_sound; 1/λ; non-finite / λ≤0 → NaN', () => {
    const base = brillouinShiftHz(1000, 1, 1e-6, Math.PI)
    expect(brillouinShiftHz(1000, 2, 1e-6, Math.PI)).toBeCloseTo(2 * base, 12)
    expect(brillouinShiftHz(2000, 1, 1e-6, Math.PI)).toBeCloseTo(2 * base, 12)
    expect(brillouinShiftHz(1000, 1, 5e-7, Math.PI)).toBeCloseTo(2 * base, 12)
    expect(Number.isNaN(brillouinShiftHz(NaN, 1, 1e-6, 1))).toBe(true)
    expect(Number.isNaN(brillouinShiftHz(1, 1, 0, 1))).toBe(true)
  })

  it('runBrillouinShiftSample: ok, formula, half-n, forward zero', () => {
    const r = runBrillouinShiftSample()
    expect(r.methodId).toBe(METHOD_ALGO_BRILLOUIN_SHIFT)
    expect(r.familyId).toBe(METHOD_BRILLOUIN)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.v_sound).toBe(DEFAULT_V_SOUND)
    expect(r.n).toBe(DEFAULT_N)
    expect(r.lambda).toBe(DEFAULT_LAMBDA)
    expect(r.theta).toBe(DEFAULT_THETA)
    expect(r.dNu).toBeCloseTo(
      ((2 * r.n * r.v_sound) / r.lambda) * Math.sin(r.theta / 2),
      6,
    )
    expect(r.dNu_halfN).toBeCloseTo(r.dNu / 2, 6)
    expect(r.dNu_forward).toBe(0)
  })

  it('custom params still ok', () => {
    expect(
      runBrillouinShiftSample({
        v_sound: 5000,
        n: 1.5,
        lambda: 633e-9,
        theta: Math.PI / 2,
      }).ok,
    ).toBe(true)
  })
})
