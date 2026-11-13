import { describe, it, expect } from 'vitest'
import {
  METHOD_WIND,
  METHOD_ALGO_BETZ,
  METHOD_ALGO_WIND_POWER,
  WIND_PARENT,
  WIND_METHOD_IDS,
  BETZ_LIMIT,
  RHO_AIR,
  windPower,
  windPowerExtracted,
  windPowerBetzMax,
  rotorArea,
  windPowerSweep,
  runBetzSample,
  runWindPowerSample,
} from './wind-algos'

describe('Wind · kinetic power + Betz limit', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_WIND).toBe('method-wind-power')
    expect(METHOD_ALGO_BETZ).toBe('method-algo-betz-limit')
    expect(METHOD_ALGO_WIND_POWER).toBe('method-algo-wind-power')
    expect(WIND_PARENT).toBe(METHOD_WIND)
    expect(WIND_METHOD_IDS).toContain(METHOD_ALGO_BETZ)
    expect(WIND_METHOD_IDS).toContain(METHOD_ALGO_WIND_POWER)
  })

  it('BETZ_LIMIT = 16/27 ≈ 0.5926', () => {
    expect(BETZ_LIMIT).toBeCloseTo(16 / 27, 15)
    expect(BETZ_LIMIT).toBeCloseTo(0.5925925925, 8)
  })

  it('windPower: P = ½ ρ A v³', () => {
    const P = windPower(1.225, 100, 10)
    expect(P).toBeCloseTo(0.5 * 1.225 * 100 * 1000, 10)
    expect(P).toBeCloseTo(61250, 6)
  })

  it('windPower: cubic in v; linear in A; v=0 → 0', () => {
    const rho = RHO_AIR
    const A = 50
    expect(windPower(rho, A, 20)).toBeCloseTo(8 * windPower(rho, A, 10), 10)
    expect(windPower(rho, 200, 8)).toBeCloseTo(2 * windPower(rho, 100, 8), 10)
    expect(windPower(rho, A, 0)).toBe(0)
  })

  it('windPower: invalid ρ/A → NaN', () => {
    expect(Number.isNaN(windPower(-1, 10, 5))).toBe(true)
    expect(Number.isNaN(windPower(1, -1, 5))).toBe(true)
    expect(Number.isNaN(windPower(NaN, 10, 5))).toBe(true)
  })

  it('windPowerExtracted / Betz max', () => {
    const P = windPower(1.2, 80, 12)
    expect(windPowerExtracted(1.2, 80, 12, 0.4)).toBeCloseTo(0.4 * P, 10)
    expect(windPowerBetzMax(1.2, 80, 12)).toBeCloseTo(BETZ_LIMIT * P, 10)
  })

  it('rotorArea: π R²', () => {
    expect(rotorArea(10)).toBeCloseTo(Math.PI * 100, 12)
    expect(Number.isNaN(rotorArea(-1))).toBe(true)
  })

  it('windPowerSweep: Float64Array cubic endpoints', () => {
    const { v, P } = windPowerSweep(1, 2, 4, 5)
    expect(v).toBeInstanceOf(Float64Array)
    expect(P).toBeInstanceOf(Float64Array)
    expect(v.length).toBe(5)
    expect(v[0]).toBe(0)
    expect(v[4]).toBeCloseTo(4, 12)
    expect(P[0]).toBe(0)
    expect(P[4]).toBeCloseTo(0.5 * 1 * 2 * 64, 12)
  })

  it('runBetzSample: ok, Cp_max, practical below Betz', () => {
    const r = runBetzSample()
    expect(r.methodId).toBe(METHOD_ALGO_BETZ)
    expect(r.familyId).toBe(METHOD_WIND)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.betz).toBe(BETZ_LIMIT)
    expect(r.P_max).toBeCloseTo(r.betz * r.P_avail, 9)
    expect(r.P_practical).toBeLessThan(r.P_max)
    expect(r.CpPractical).toBeLessThan(r.betz)
  })

  it('runWindPowerSample: ok, cubic / linear checks', () => {
    const r = runWindPowerSample()
    expect(r.methodId).toBe(METHOD_ALGO_WIND_POWER)
    expect(r.familyId).toBe(METHOD_WIND)
    expect(r.familyId).toBe('method-wind-power')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.P).toBeCloseTo(0.5 * r.rho * r.area * r.v ** 3, 9)
    expect(r.P_doubleV).toBeCloseTo(8 * r.P, 9)
    expect(r.P_doubleA).toBeCloseTo(2 * r.P, 9)
    expect(r.P_zeroV).toBe(0)
  })
})
