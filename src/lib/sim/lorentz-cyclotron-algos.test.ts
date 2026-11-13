import { describe, it, expect } from 'vitest'
import {
  METHOD_LORENTZ,
  METHOD_ALGO_LORENTZ_F,
  METHOD_CYCLOTRON,
  METHOD_ALGO_CYCLOTRON_W,
  LORENTZ_PARENT,
  CYCLOTRON_PARENT,
  LORENTZ_METHOD_IDS,
  CYCLOTRON_METHOD_IDS,
  DEFAULT_Q,
  DEFAULT_V,
  DEFAULT_B,
  DEFAULT_M,
  lorentzForceMag,
  cyclotronOmega,
  runLorentzForceSample,
  runCyclotronOmegaSample,
} from './lorentz-cyclotron-algos'

describe('Lorentz · F = |q| v B', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_LORENTZ).toBe('method-lorentz-force')
    expect(METHOD_ALGO_LORENTZ_F).toBe('method-algo-lorentz-force')
    expect(LORENTZ_PARENT).toBe(METHOD_LORENTZ)
    expect(LORENTZ_METHOD_IDS).toContain(METHOD_ALGO_LORENTZ_F)
  })

  it('lorentzForceMag: formula', () => {
    expect(lorentzForceMag(DEFAULT_Q, DEFAULT_V, DEFAULT_B)).toBeCloseTo(
      Math.abs(DEFAULT_Q) * DEFAULT_V * DEFAULT_B,
      18,
    )
  })

  it('linear in q,v,B; zero B; non-finite → NaN', () => {
    const F = lorentzForceMag(1e-19, 1e6, 0.1)
    expect(lorentzForceMag(2e-19, 1e6, 0.1)).toBeCloseTo(2 * F, 18)
    expect(lorentzForceMag(1e-19, 2e6, 0.1)).toBeCloseTo(2 * F, 18)
    expect(lorentzForceMag(1e-19, 1e6, 0.2)).toBeCloseTo(2 * F, 18)
    expect(lorentzForceMag(1e-19, 1e6, 0)).toBe(0)
    expect(Number.isNaN(lorentzForceMag(NaN, 1, 1))).toBe(true)
  })

  it('runLorentzForceSample: ok, formula, linear, zero', () => {
    const r = runLorentzForceSample()
    expect(r.methodId).toBe(METHOD_ALGO_LORENTZ_F)
    expect(r.familyId).toBe(METHOD_LORENTZ)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.F).toBeCloseTo(Math.abs(r.q) * Math.abs(r.v) * Math.abs(r.B), 18)
    expect(r.F_doubleB).toBeCloseTo(2 * r.F, 18)
    expect(r.F_doubleV).toBeCloseTo(2 * r.F, 18)
    expect(r.F_zeroB).toBe(0)
  })
})

describe('Cyclotron · ω = |q| B / m', () => {
  it('method id constants', () => {
    expect(METHOD_CYCLOTRON).toBe('method-cyclotron')
    expect(METHOD_ALGO_CYCLOTRON_W).toBe('method-algo-cyclotron-omega')
    expect(CYCLOTRON_PARENT).toBe(METHOD_CYCLOTRON)
    expect(CYCLOTRON_METHOD_IDS).toContain(METHOD_ALGO_CYCLOTRON_W)
  })

  it('cyclotronOmega: formula', () => {
    expect(cyclotronOmega(DEFAULT_Q, DEFAULT_B, DEFAULT_M)).toBeCloseTo(
      (Math.abs(DEFAULT_Q) * DEFAULT_B) / DEFAULT_M,
      6,
    )
  })

  it('∝ B, 1/m; m=0 → NaN', () => {
    const w = cyclotronOmega(1.6e-19, 0.1, 9.1e-31)
    expect(cyclotronOmega(1.6e-19, 0.2, 9.1e-31)).toBeCloseTo(2 * w, 12)
    expect(cyclotronOmega(1.6e-19, 0.1, 1.82e-30)).toBeCloseTo(w / 2, 12)
    expect(Number.isNaN(cyclotronOmega(1, 1, 0))).toBe(true)
  })

  it('runCyclotronOmegaSample: ok, formula, scalings', () => {
    const r = runCyclotronOmegaSample()
    expect(r.methodId).toBe(METHOD_ALGO_CYCLOTRON_W)
    expect(r.familyId).toBe(METHOD_CYCLOTRON)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.omega).toBeCloseTo(
      (Math.abs(r.q) * Math.abs(r.B)) / r.m,
      6,
    )
    expect(r.omega_doubleB).toBeCloseTo(2 * r.omega, 12)
    expect(r.omega_doubleM).toBeCloseTo(r.omega / 2, 12)
    expect(Number.isFinite(r.omega_badM)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runCyclotronOmegaSample({ B: 1, m: 1.67e-27 }).ok).toBe(true)
  })
})
