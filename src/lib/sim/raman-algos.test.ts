import { describe, it, expect } from 'vitest'
import {
  METHOD_RAMAN,
  METHOD_ALGO_RAMAN_SHIFT,
  RAMAN_PARENT,
  RAMAN_METHOD_IDS,
  DEFAULT_NU0,
  DEFAULT_NU_VIB,
  ramanStokesNu,
  ramanAntiStokesNu,
  ramanIntensityStub,
  runRamanShiftSample,
} from './raman-algos'

describe('Raman · Stokes ν_s = ν_0 − ν_vib', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_RAMAN).toBe('method-raman')
    expect(METHOD_ALGO_RAMAN_SHIFT).toBe('method-algo-raman-shift')
    expect(RAMAN_PARENT).toBe(METHOD_RAMAN)
    expect(RAMAN_METHOD_IDS).toContain(METHOD_ALGO_RAMAN_SHIFT)
  })

  it('ramanStokesNu: ν_s = ν_0 − ν_vib', () => {
    expect(ramanStokesNu(18797, 2900)).toBeCloseTo(15897, 12)
    expect(ramanStokesNu(DEFAULT_NU0, DEFAULT_NU_VIB)).toBeCloseTo(
      DEFAULT_NU0 - DEFAULT_NU_VIB,
      12,
    )
  })

  it('ramanAntiStokesNu: ν_as = ν_0 + ν_vib', () => {
    expect(ramanAntiStokesNu(10000, 500)).toBeCloseTo(10500, 12)
  })

  it('ramanIntensityStub: I ∝ n_mol σ I0', () => {
    expect(ramanIntensityStub(2, 3, 4)).toBeCloseTo(24, 12)
    const base = ramanIntensityStub(1e24, 1e-30, 100)
    expect(ramanIntensityStub(1e24, 1e-30, 200)).toBeCloseTo(2 * base, 18)
  })

  it('non-finite → NaN', () => {
    expect(Number.isNaN(ramanStokesNu(NaN, 1))).toBe(true)
    expect(Number.isNaN(ramanStokesNu(1, Infinity))).toBe(true)
    expect(Number.isNaN(ramanIntensityStub(1, NaN, 1))).toBe(true)
  })

  it('runRamanShiftSample: ok, Stokes lower, intensity linear', () => {
    const r = runRamanShiftSample()
    expect(r.methodId).toBe(METHOD_ALGO_RAMAN_SHIFT)
    expect(r.familyId).toBe(METHOD_RAMAN)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.nuS).toBeCloseTo(r.nu0 - r.nuVib, 12)
    expect(r.nuAS).toBeCloseTo(r.nu0 + r.nuVib, 12)
    expect(r.nuS).toBeLessThan(r.nu0)
    expect(r.nuAS).toBeGreaterThan(r.nu0)
    expect(r.I_doubleI0).toBeCloseTo(2 * r.I, 18)
  })

  it('custom params still ok', () => {
    expect(runRamanShiftSample({ nu0: 20000, nuVib: 1000 }).ok).toBe(true)
  })
})
