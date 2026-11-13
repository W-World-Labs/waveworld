import { describe, it, expect } from 'vitest'
import {
  METHOD_HYDRO,
  METHOD_ALGO_HYDRO_POWER,
  METHOD_ALGO_HYDRO_HEAD,
  HYDRO_PARENT,
  HYDRO_METHOD_IDS,
  DEFAULT_RHO,
  DEFAULT_G,
  hydroPower,
  hydroHeadFromPotential,
  runHydroPowerSample,
  runHydroHeadSample,
} from './hydro-algos'

describe('Hydro · P = ρ g Q H η + head energy', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_HYDRO).toBe('method-hydro-power')
    expect(METHOD_ALGO_HYDRO_POWER).toBe('method-algo-hydro-power')
    expect(METHOD_ALGO_HYDRO_HEAD).toBe('method-algo-hydro-head')
    expect(HYDRO_PARENT).toBe(METHOD_HYDRO)
    expect(HYDRO_METHOD_IDS).toContain(METHOD_ALGO_HYDRO_POWER)
    expect(HYDRO_METHOD_IDS).toContain(METHOD_ALGO_HYDRO_HEAD)
  })

  it('defaults: ρ=1000, g=9.81', () => {
    expect(DEFAULT_RHO).toBe(1000)
    expect(DEFAULT_G).toBeCloseTo(9.81, 10)
  })

  describe('hydroPower', () => {
    it('P = ρ g Q H η', () => {
      const P = hydroPower(1000, 9.81, 50, 20, 0.85)
      expect(P).toBeCloseTo(1000 * 9.81 * 50 * 20 * 0.85, 6)
      // ~8.34 MW
      expect(P).toBeGreaterThan(8e6)
      expect(P).toBeLessThan(9e6)
    })

    it('linear in Q, H, η; Q=0 → 0', () => {
      const base = hydroPower(1000, 9.81, 10, 15, 0.9)
      expect(hydroPower(1000, 9.81, 20, 15, 0.9)).toBeCloseTo(2 * base, 8)
      expect(hydroPower(1000, 9.81, 10, 30, 0.9)).toBeCloseTo(2 * base, 8)
      expect(hydroPower(1000, 9.81, 10, 15, 0.45)).toBeCloseTo(0.5 * base, 8)
      expect(hydroPower(1000, 9.81, 0, 15, 0.9)).toBe(0)
    })

    it('invalid ρ/g/Q/H/η → NaN', () => {
      expect(Number.isNaN(hydroPower(-1, 9.81, 1, 1, 1))).toBe(true)
      expect(Number.isNaN(hydroPower(1000, 0, 1, 1, 1))).toBe(true)
      expect(Number.isNaN(hydroPower(1000, 9.81, -1, 1, 1))).toBe(true)
      expect(Number.isNaN(hydroPower(1000, 9.81, 1, -1, 1))).toBe(true)
      expect(Number.isNaN(hydroPower(1000, 9.81, 1, 1, -0.1))).toBe(true)
      expect(Number.isNaN(hydroPower(NaN, 9.81, 1, 1, 1))).toBe(true)
    })
  })

  describe('hydroHeadFromPotential', () => {
    it('e = g h (J/kg)', () => {
      expect(hydroHeadFromPotential(9.81, 20)).toBeCloseTo(196.2, 10)
      expect(hydroHeadFromPotential(9.81, 0)).toBe(0)
    })

    it('illegal g/h → NaN', () => {
      expect(Number.isNaN(hydroHeadFromPotential(0, 10))).toBe(true)
      expect(Number.isNaN(hydroHeadFromPotential(9.81, -1))).toBe(true)
      expect(Number.isNaN(hydroHeadFromPotential(NaN, 10))).toBe(true)
    })
  })

  describe('samples', () => {
    it('runHydroPowerSample: ok, formula, linear', () => {
      const r = runHydroPowerSample()
      expect(r.methodId).toBe(METHOD_ALGO_HYDRO_POWER)
      expect(r.familyId).toBe(METHOD_HYDRO)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.P).toBeCloseTo(r.rho * r.g * r.Q * r.H * r.eta, 6)
      expect(r.P_doubleQ).toBeCloseTo(2 * r.P, 6)
      expect(r.P_doubleH).toBeCloseTo(2 * r.P, 6)
      expect(r.P_zeroQ).toBe(0)
    })

    it('runHydroHeadSample: ok, e = g h', () => {
      const r = runHydroHeadSample()
      expect(r.methodId).toBe(METHOD_ALGO_HYDRO_HEAD)
      expect(r.familyId).toBe(METHOD_HYDRO)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.e).toBeCloseTo(r.g * r.h, 12)
      expect(r.e_doubleH).toBeCloseTo(2 * r.e, 12)
      expect(r.e_zero).toBe(0)
    })
  })
})
