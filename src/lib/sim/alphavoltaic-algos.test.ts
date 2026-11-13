import { describe, it, expect } from 'vitest'
import {
  METHOD_ALPHAVOLTAIC,
  METHOD_ALGO_AV_POWER,
  AV_PARENT,
  AV_METHOD_IDS,
  DEFAULT_ETA,
  DEFAULT_ACTIVITY,
  DEFAULT_E_ALPHA,
  avPower,
  runAvPowerSample,
} from './alphavoltaic-algos'

describe('Alphavoltaic · P = η · A · E_α', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ALPHAVOLTAIC).toBe('method-alphavoltaic')
    expect(METHOD_ALGO_AV_POWER).toBe('method-algo-av-power')
    expect(AV_PARENT).toBe(METHOD_ALPHAVOLTAIC)
    expect(AV_METHOD_IDS).toContain(METHOD_ALGO_AV_POWER)
  })

  it('avPower: P = η A E', () => {
    expect(avPower(0.05, 1e9, 8.01e-13)).toBeCloseTo(0.05 * 1e9 * 8.01e-13, 18)
    expect(
      avPower(DEFAULT_ETA, DEFAULT_ACTIVITY, DEFAULT_E_ALPHA),
    ).toBeCloseTo(DEFAULT_ETA * DEFAULT_ACTIVITY * DEFAULT_E_ALPHA, 18)
  })

  it('linear in η, activity, E; zero η; non-finite → NaN', () => {
    const P = avPower(0.1, 1e8, 1e-12)
    expect(avPower(0.2, 1e8, 1e-12)).toBeCloseTo(2 * P, 18)
    expect(avPower(0.1, 2e8, 1e-12)).toBeCloseTo(2 * P, 18)
    expect(avPower(0.1, 1e8, 2e-12)).toBeCloseTo(2 * P, 18)
    expect(avPower(0, 1e8, 1e-12)).toBe(0)
    expect(Number.isNaN(avPower(NaN, 1, 1))).toBe(true)
    expect(Number.isNaN(avPower(0.1, Infinity, 1))).toBe(true)
  })

  it('runAvPowerSample: ok, formula, double η, zero η', () => {
    const r = runAvPowerSample()
    expect(r.methodId).toBe(METHOD_ALGO_AV_POWER)
    expect(r.familyId).toBe(METHOD_ALPHAVOLTAIC)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.eta).toBe(DEFAULT_ETA)
    expect(r.activityBq).toBe(DEFAULT_ACTIVITY)
    expect(r.E_alpha_J).toBe(DEFAULT_E_ALPHA)
    expect(r.P).toBeCloseTo(r.eta * r.activityBq * r.E_alpha_J, 18)
    expect(r.P).toBeGreaterThan(0)
    expect(r.P_doubleEta).toBeCloseTo(2 * r.P, 18)
    expect(r.P_zeroEta).toBe(0)
  })

  it('custom params still ok', () => {
    expect(
      runAvPowerSample({ eta: 0.1, activityBq: 1e6, E_alpha_J: 1e-12 }).ok,
    ).toBe(true)
  })
})
