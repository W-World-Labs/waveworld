import { describe, it, expect } from 'vitest'
import {
  METHOD_NA,
  METHOD_ALGO_NA,
  NA_PARENT,
  NA_METHOD_IDS,
  DEFAULT_N,
  DEFAULT_THETA,
  DEFAULT_N_CORE,
  DEFAULT_N_CLAD,
  numericalAperture,
  fiberNA,
  acceptanceAngle,
  runNaSample,
} from './numerical-aperture-algos'

describe('Numerical aperture · NA = n sin θ; fiber √(n_c²−n_clad²)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_NA).toBe('method-numerical-aperture')
    expect(METHOD_ALGO_NA).toBe('method-algo-na')
    expect(NA_PARENT).toBe(METHOD_NA)
    expect(NA_METHOD_IDS).toContain(METHOD_ALGO_NA)
  })

  it('numericalAperture: NA = n sin θ', () => {
    expect(numericalAperture(1, Math.PI / 2)).toBeCloseTo(1, 12)
    expect(numericalAperture(DEFAULT_N, DEFAULT_THETA)).toBeCloseTo(
      Math.sin(DEFAULT_THETA),
      12,
    )
  })

  it('fiber NA; acceptance inverse; bad → NaN', () => {
    const na = fiberNA(DEFAULT_N_CORE, DEFAULT_N_CLAD)
    expect(na).toBeCloseTo(
      Math.sqrt(DEFAULT_N_CORE ** 2 - DEFAULT_N_CLAD ** 2),
      12,
    )
    const th = acceptanceAngle(na, 1)
    expect(numericalAperture(1, th)).toBeCloseTo(na, 12)
    expect(Number.isNaN(fiberNA(1.4, 1.5))).toBe(true)
    expect(Number.isNaN(fiberNA(1.5, 1.5))).toBe(true)
    expect(Number.isNaN(numericalAperture(-1, 0.1))).toBe(true)
    expect(Number.isNaN(acceptanceAngle(2, 1))).toBe(true)
  })

  it('runNaSample: ok, both forms, inverse', () => {
    const r = runNaSample()
    expect(r.methodId).toBe(METHOD_ALGO_NA)
    expect(r.familyId).toBe(METHOD_NA)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.NA).toBeCloseTo(r.n * Math.sin(r.thetaMax), 12)
    expect(r.NA_fiber).toBeCloseTo(
      Math.sqrt(r.nCore ** 2 - r.nClad ** 2),
      12,
    )
    expect(numericalAperture(r.n, r.theta_from_fiber)).toBeCloseTo(
      r.NA_fiber,
      12,
    )
    expect(Number.isFinite(r.NA_badFiber)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(
      runNaSample({ n: 1.33, thetaMax: 0.5, nCore: 1.5, nClad: 1.45 }).ok,
    ).toBe(true)
  })
})
