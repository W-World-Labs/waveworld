import { describe, it, expect } from 'vitest'
import {
  METHOD_BATTERY,
  METHOD_ALGO_BATTERY_OCV,
  METHOD_ALGO_BATTERY_RINT,
  BATTERY_PARENT,
  BATTERY_METHOD_IDS,
  DEFAULT_LINEAR_OCV,
  DEFAULT_OCV_KNOTS,
  clampSoc,
  ocvLinear,
  ocvPiecewise,
  rintVoltage,
  socStep,
  simulateRintDischarge,
  runBatteryOcvSample,
  runBatteryRintSample,
} from './battery-algos'

describe('Battery · OCV(SOC) + Rint ECM toy', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_BATTERY).toBe('method-battery-ecm')
    expect(METHOD_ALGO_BATTERY_OCV).toBe('method-algo-battery-ocv')
    expect(METHOD_ALGO_BATTERY_RINT).toBe('method-algo-battery-rint')
    expect(BATTERY_PARENT).toBe(METHOD_BATTERY)
    expect(BATTERY_METHOD_IDS).toContain(METHOD_ALGO_BATTERY_OCV)
    expect(BATTERY_METHOD_IDS).toContain(METHOD_ALGO_BATTERY_RINT)
  })

  it('clampSoc bounds to [0,1]', () => {
    expect(clampSoc(-0.5)).toBe(0)
    expect(clampSoc(0.3)).toBe(0.3)
    expect(clampSoc(1.5)).toBe(1)
  })

  it('ocvLinear: endpoints and mid', () => {
    const p = DEFAULT_LINEAR_OCV
    expect(ocvLinear(0, p)).toBeCloseTo(3.0, 12)
    expect(ocvLinear(1, p)).toBeCloseTo(4.2, 12)
    expect(ocvLinear(0.5, p)).toBeCloseTo(3.6, 12)
    expect(ocvLinear(2, p)).toBeCloseTo(4.2, 12)
  })

  it('ocvPiecewise interpolates knots', () => {
    const V = ocvPiecewise(0.5, DEFAULT_OCV_KNOTS)
    expect(V).toBeCloseTo(3.7, 12)
    expect(ocvPiecewise(0, DEFAULT_OCV_KNOTS)).toBeCloseTo(3.0, 12)
    expect(ocvPiecewise(1, DEFAULT_OCV_KNOTS)).toBeCloseTo(4.2, 12)
  })

  it('rintVoltage: V = OCV − I R', () => {
    expect(rintVoltage(3.7, 2, 0.05)).toBeCloseTo(3.6, 12)
    expect(rintVoltage(4.0, 0, 0.1)).toBeCloseTo(4.0, 12)
    // charge (I < 0) raises terminal voltage above OCV
    expect(rintVoltage(3.7, -1, 0.1)).toBeCloseTo(3.8, 12)
  })

  it('socStep: discharge lowers SOC; empty clamps', () => {
    const Q = 100
    expect(socStep(1, 10, 1, Q)).toBeCloseTo(0.9, 12)
    expect(socStep(0.05, 10, 1, Q)).toBe(0)
  })

  it('simulateRintDischarge: finite, SOC drops, V < OCV', () => {
    const r = simulateRintDischarge({
      soc0: 1,
      I: 5,
      R: 0.02,
      Q_As: 3600,
      dt: 60,
      nSteps: 20,
    })
    expect(r.finite).toBe(true)
    expect(r.socFinal).toBeLessThan(1)
    expect(r.VFinal).toBeLessThan(r.ocvFinal)
    expect(r.V[0]).toBeCloseTo(r.ocv[0]! - 5 * 0.02, 12)
  })

  it('runBatteryOcvSample: ok, linear endpoints', () => {
    const r = runBatteryOcvSample()
    expect(r.methodId).toBe(METHOD_ALGO_BATTERY_OCV)
    expect(r.familyId).toBe(METHOD_BATTERY)
    expect(r.ok).toBe(true)
    expect(r.endpoints).toBe(true)
    expect(r.monotone).toBe(true)
    expect(r.V0).toBeCloseTo(3.0, 12)
    expect(r.V1).toBeCloseTo(4.2, 12)
  })

  it('runBatteryRintSample: ok, ohmic drop, SOC discharge', () => {
    const r = runBatteryRintSample()
    expect(r.methodId).toBe(METHOD_ALGO_BATTERY_RINT)
    expect(r.familyId).toBe(METHOD_BATTERY)
    expect(r.familyId).toBe('method-battery-ecm')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.ohmicOk).toBe(true)
    expect(r.socDrops).toBe(true)
    expect(r.VBelowOcv).toBe(true)
    expect(r.irDrop).toBeCloseTo(r.I * r.R, 12)
    expect(r.V0).toBeCloseTo(r.ocv0 - r.irDrop, 12)
  })
})
