import { describe, it, expect } from 'vitest'
import {
  METHOD_PRO,
  METHOD_ALGO_PRO_POWER,
  PRO_PARENT,
  PRO_METHOD_IDS,
  R_GAS,
  DEFAULT_I,
  DEFAULT_C,
  DEFAULT_T,
  DEFAULT_ETA,
  DEFAULT_VOLUME_FLOW,
  vantHoffPi,
  proPower,
  runProPowerSample,
} from './osmotic-power-algos'

describe('PRO · π = i c R T; P = η Δπ Q', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_PRO).toBe('method-osmotic-power')
    expect(METHOD_ALGO_PRO_POWER).toBe('method-algo-pro-power')
    expect(PRO_PARENT).toBe(METHOD_PRO)
    expect(PRO_METHOD_IDS).toContain(METHOD_ALGO_PRO_POWER)
  })

  it('vantHoffPi: π = i c R T', () => {
    const pi = vantHoffPi(2, 600, R_GAS, 298.15)
    expect(pi).toBeCloseTo(2 * 600 * R_GAS * 298.15, 6)
    expect(pi).toBeGreaterThan(1e6) // MPa-class for seawater
  })

  it('proPower: P = η Δπ Q', () => {
    expect(proPower(0.5, 2e6, 0.01)).toBeCloseTo(1e4, 6)
    expect(proPower(0, 1e6, 1)).toBe(0)
  })

  it('illegal: T≤0, c<0, η out of [0,1], non-finite → NaN', () => {
    expect(Number.isNaN(vantHoffPi(2, 600, R_GAS, 0))).toBe(true)
    expect(Number.isNaN(vantHoffPi(2, -1, R_GAS, 300))).toBe(true)
    expect(Number.isNaN(proPower(1.2, 1e6, 1))).toBe(true)
    expect(Number.isNaN(proPower(-0.1, 1e6, 1))).toBe(true)
    expect(Number.isNaN(proPower(NaN, 1e6, 1))).toBe(true)
  })

  it('runProPowerSample: ok, formula, linear in Q', () => {
    const r = runProPowerSample()
    expect(r.methodId).toBe(METHOD_ALGO_PRO_POWER)
    expect(r.familyId).toBe(METHOD_PRO)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.i).toBe(DEFAULT_I)
    expect(r.c).toBe(DEFAULT_C)
    expect(r.T).toBe(DEFAULT_T)
    expect(r.eta).toBe(DEFAULT_ETA)
    expect(r.volumeFlow).toBe(DEFAULT_VOLUME_FLOW)
    expect(r.pi).toBeCloseTo(r.i * r.c * r.R * r.T, 6)
    expect(r.power).toBeCloseTo(r.eta * r.pi * r.volumeFlow, 6)
    expect(r.power_doubleQ).toBeCloseTo(2 * r.power, 6)
    expect(Number.isFinite(r.power_badEta)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(
      runProPowerSample({ c: 500, eta: 0.3, volumeFlow: 2e-3 }).ok,
    ).toBe(true)
  })
})
