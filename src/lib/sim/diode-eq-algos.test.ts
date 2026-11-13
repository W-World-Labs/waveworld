import { describe, it, expect } from 'vitest'
import {
  METHOD_DIODE,
  METHOD_ALGO_SHOCKLEY_DIODE,
  DIODE_PARENT,
  DIODE_METHOD_IDS,
  QE,
  KB,
  T_DEFAULT,
  thermalVoltage,
  shockleyCurrent,
  sampleShockleyIv,
  runShockleyDiodeSample,
} from './diode-eq-algos'

describe('Diode · Shockley equation teaching stub', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_DIODE).toBe('method-diode-equation')
    expect(METHOD_ALGO_SHOCKLEY_DIODE).toBe('method-algo-shockley-diode')
    expect(DIODE_PARENT).toBe(METHOD_DIODE)
    expect(DIODE_METHOD_IDS).toContain(METHOD_ALGO_SHOCKLEY_DIODE)
  })

  it('thermalVoltage ≈ 25.85 mV at 300 K', () => {
    const VT = thermalVoltage(300)
    expect(VT).toBeCloseTo((KB * 300) / QE, 14)
    expect(VT).toBeGreaterThan(0.025)
    expect(VT).toBeLessThan(0.027)
  })

  describe('shockleyCurrent', () => {
    it('I = Is (exp(qV/nkT) − 1); V=0 → 0', () => {
      const Is = 1e-12
      expect(shockleyCurrent(0, Is)).toBeCloseTo(0, 20)
      const V = 0.5
      const VT = thermalVoltage(T_DEFAULT)
      const expected = Is * Math.expm1(V / VT)
      expect(shockleyCurrent(V, Is)).toBeCloseTo(expected, 12)
    })

    it('reverse bias → near −Is; forward grows with V', () => {
      const Is = 2e-12
      const Irev = shockleyCurrent(-0.5, Is)
      expect(Irev).toBeLessThan(0)
      expect(Irev).toBeGreaterThan(-Is * 1.001)
      expect(Irev).toBeCloseTo(-Is, 5)
      expect(shockleyCurrent(0.65, Is)).toBeGreaterThan(shockleyCurrent(0.55, Is))
    })

    it('illegal params → NaN', () => {
      expect(Number.isNaN(shockleyCurrent(0.5, -1e-12))).toBe(true)
      expect(Number.isNaN(shockleyCurrent(0.5, 1e-12, 0))).toBe(true)
      expect(Number.isNaN(shockleyCurrent(0.5, 1e-12, 1, 0))).toBe(true)
    })
  })

  describe('sampleShockleyIv', () => {
    it('produces finite IV curve with rising forward branch', () => {
      const c = sampleShockleyIv({
        Is: 1e-12,
        Vmin: -0.2,
        Vmax: 0.7,
        nPoints: 41,
      })
      expect(c.points.length).toBe(41)
      expect(c.V.length).toBe(41)
      expect(c.I.length).toBe(41)
      expect(c.finite).toBe(true)
      // last point more positive V than first → larger I
      expect(c.I[c.I.length - 1]!).toBeGreaterThan(c.I[0]!)
      // exact V=0 point via direct sample endpoint / formula
      const I0 = shockleyCurrent(0, c.Is, c.n, c.T)
      expect(Math.abs(I0)).toBeLessThan(1e-30)
      // grid is monotone in I for Shockley (strict for finite ΔV)
      for (let i = 1; i < c.I.length; i++) {
        expect(c.I[i]!).toBeGreaterThan(c.I[i - 1]!)
      }
    })
  })

  describe('runShockleyDiodeSample', () => {
    it('ok, methodId/familyId, formula and IV sample', () => {
      const r = runShockleyDiodeSample()
      expect(r.methodId).toBe(METHOD_ALGO_SHOCKLEY_DIODE)
      expect(r.familyId).toBe(METHOD_DIODE)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.curveFinite).toBe(true)
      expect(r.curveLen).toBeGreaterThanOrEqual(2)
      expect(Math.abs(r.I_zero)).toBeLessThan(1e-30)
      expect(r.I_fwd).toBeGreaterThan(0)
      expect(r.I_fwd_higher).toBeGreaterThan(r.I_fwd)
      expect(r.I_fwd).toBeCloseTo(r.formulaI, 10)
    })

    it('custom Is/n still ok', () => {
      const r = runShockleyDiodeSample({ Is: 5e-13, n: 1.5, Vfwd: 0.55 })
      expect(r.ok).toBe(true)
      expect(r.Is).toBe(5e-13)
      expect(r.n).toBe(1.5)
    })
  })
})
