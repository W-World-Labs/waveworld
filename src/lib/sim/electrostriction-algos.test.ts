import { describe, it, expect } from 'vitest'
import {
  METHOD_ELECTROSTRICT,
  METHOD_ALGO_ELECTROSTRICT_STRAIN,
  ELECTROSTRICT_PARENT,
  ELECTROSTRICT_METHOD_IDS,
  DEFAULT_Q,
  DEFAULT_E,
  electrostrictStrain,
  runElectrostrictStrainSample,
} from './electrostriction-algos'

describe('Electrostriction · strain = Q · E²', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ELECTROSTRICT).toBe('method-electrostriction')
    expect(METHOD_ALGO_ELECTROSTRICT_STRAIN).toBe(
      'method-algo-electrostrict-strain',
    )
    expect(ELECTROSTRICT_PARENT).toBe(METHOD_ELECTROSTRICT)
    expect(ELECTROSTRICT_METHOD_IDS).toContain(METHOD_ALGO_ELECTROSTRICT_STRAIN)
  })

  it('electrostrictStrain: s = Q E²', () => {
    expect(electrostrictStrain(1e-18, 1e6)).toBeCloseTo(1e-6, 18)
    expect(electrostrictStrain(DEFAULT_Q, 0)).toBe(0)
  })

  it('even in E; scales as E²; non-finite → NaN', () => {
    const s = electrostrictStrain(2e-18, 5e5)
    expect(electrostrictStrain(2e-18, -5e5)).toBeCloseTo(s, 18)
    expect(electrostrictStrain(2e-18, 1e6)).toBeCloseTo(4 * s, 18)
    expect(Number.isNaN(electrostrictStrain(NaN, 1))).toBe(true)
    expect(Number.isNaN(electrostrictStrain(1e-18, Infinity))).toBe(true)
  })

  it('runElectrostrictStrainSample: ok, even, quadratic', () => {
    const r = runElectrostrictStrainSample()
    expect(r.methodId).toBe(METHOD_ALGO_ELECTROSTRICT_STRAIN)
    expect(r.familyId).toBe(METHOD_ELECTROSTRICT)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Q).toBe(DEFAULT_Q)
    expect(r.E).toBe(DEFAULT_E)
    expect(r.strain).toBeCloseTo(r.Q * r.E * r.E, 18)
    expect(r.strain_negE).toBeCloseTo(r.strain, 18)
    expect(r.strain_doubleE).toBeCloseTo(4 * r.strain, 18)
    expect(r.strain_zero).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runElectrostrictStrainSample({ Q: 2e-18, E: 5e5 }).ok).toBe(true)
  })
})
