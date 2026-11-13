import { describe, it, expect } from 'vitest'
import {
  METHOD_AIRMASS,
  METHOD_ALGO_AIRMASS,
  METHOD_LAMBERT,
  METHOD_ALGO_LAMBERT_E,
  AIRMASS_PARENT,
  LAMBERT_PARENT,
  AIRMASS_METHOD_IDS,
  LAMBERT_METHOD_IDS,
  DEFAULT_E0,
  airMass,
  lambertIrradiance,
  runAirMassSample,
  runLambertIrradianceSample,
} from './air-mass-lambert-algos'

describe('Air mass · AM ≈ 1/cos(z)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_AIRMASS).toBe('method-air-mass')
    expect(METHOD_ALGO_AIRMASS).toBe('method-algo-air-mass-am')
    expect(AIRMASS_PARENT).toBe(METHOD_AIRMASS)
    expect(AIRMASS_METHOD_IDS).toContain(METHOD_ALGO_AIRMASS)
  })

  it('airMass: formula', () => {
    expect(airMass(0)).toBeCloseTo(1, 15)
    const z = Math.acos(1 / 1.5)
    expect(airMass(z)).toBeCloseTo(1.5, 12)
    expect(airMass(Math.PI / 3)).toBeCloseTo(2, 12)
  })

  it('z≥π/2 or non-finite → NaN', () => {
    expect(Number.isNaN(airMass(Math.PI / 2))).toBe(true)
    expect(Number.isNaN(airMass(Math.PI))).toBe(true)
    expect(Number.isNaN(airMass(NaN))).toBe(true)
  })

  it('runAirMassSample: ok, AM1.5-class, overhead', () => {
    const r = runAirMassSample()
    expect(r.methodId).toBe(METHOD_ALGO_AIRMASS)
    expect(r.familyId).toBe(METHOD_AIRMASS)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.AM).toBeCloseTo(1 / Math.cos(r.z), 12)
    expect(r.AM_overhead).toBe(1)
    expect(r.AM).toBeCloseTo(1.5, 10)
    expect(Number.isFinite(r.AM_bad)).toBe(false)
  })
})

describe('Lambert · E = E0 cos(θ)', () => {
  it('method id constants', () => {
    expect(METHOD_LAMBERT).toBe('method-lambert-cosine')
    expect(METHOD_ALGO_LAMBERT_E).toBe('method-algo-lambert-irradiance')
    expect(LAMBERT_PARENT).toBe(METHOD_LAMBERT)
    expect(LAMBERT_METHOD_IDS).toContain(METHOD_ALGO_LAMBERT_E)
  })

  it('lambertIrradiance: formula', () => {
    expect(lambertIrradiance(DEFAULT_E0, 0)).toBeCloseTo(DEFAULT_E0, 12)
    expect(lambertIrradiance(DEFAULT_E0, Math.PI / 2)).toBeCloseTo(0, 12)
    expect(lambertIrradiance(1000, Math.PI / 3)).toBeCloseTo(500, 10)
  })

  it('outside [0,π/2] → 0; non-finite → NaN', () => {
    expect(lambertIrradiance(1000, Math.PI)).toBe(0)
    expect(lambertIrradiance(1000, -0.1)).toBe(0)
    expect(Number.isNaN(lambertIrradiance(NaN, 0))).toBe(true)
  })

  it('runLambertIrradianceSample: ok, normal/grazing/back', () => {
    const r = runLambertIrradianceSample()
    expect(r.methodId).toBe(METHOD_ALGO_LAMBERT_E)
    expect(r.familyId).toBe(METHOD_LAMBERT)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.E).toBeCloseTo(r.E0 * Math.cos(r.theta), 12)
    expect(r.E_normal).toBeCloseTo(r.E0, 12)
    expect(r.E_grazing).toBeCloseTo(0, 12)
    expect(r.E_back).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runAirMassSample({ z: 0 }).ok).toBe(true)
    expect(runLambertIrradianceSample({ E0: 500, theta: 0 }).ok).toBe(true)
  })
})
