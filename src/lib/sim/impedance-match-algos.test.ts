import { describe, it, expect } from 'vitest'
import {
  METHOD_ZMATCH,
  METHOD_ALGO_REFLECTION_GAMMA,
  ZMATCH_PARENT,
  ZMATCH_METHOD_IDS,
  cReal,
  cAbs,
  cAbs2,
  reflectionGamma,
  reflectionGammaReal,
  powerReflection,
  powerTransmission,
  returnLossDb,
  vswr,
  loadPowerReal,
  conjugateMatchError,
  sampleGammaVsLoad,
  runReflectionGammaSample,
} from './impedance-match-algos'

describe('Impedance match · Γ = (ZL−Z0)/(ZL+Z0) teaching stub', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ZMATCH).toBe('method-impedance-match')
    expect(METHOD_ALGO_REFLECTION_GAMMA).toBe('method-algo-reflection-gamma')
    expect(ZMATCH_PARENT).toBe(METHOD_ZMATCH)
    expect(ZMATCH_METHOD_IDS).toContain(METHOD_ALGO_REFLECTION_GAMMA)
  })

  describe('reflectionGamma', () => {
    it('matched ZL=Z0 → Γ=0; short → −1; open → +1', () => {
      const Z0 = cReal(50)
      const g0 = reflectionGamma(cReal(50), Z0)
      expect(g0.re).toBeCloseTo(0, 14)
      expect(g0.im).toBeCloseTo(0, 14)

      const gs = reflectionGamma(cReal(0), Z0)
      expect(gs.re).toBeCloseTo(-1, 14)
      expect(gs.im).toBeCloseTo(0, 14)

      const go = reflectionGammaReal(1e15, 50)
      expect(go).toBeCloseTo(1, 10)
    })

    it('Γ = (ZL−Z0)/(ZL+Z0) real formula', () => {
      expect(reflectionGammaReal(100, 50)).toBeCloseTo((100 - 50) / (100 + 50), 14)
      expect(reflectionGammaReal(25, 50)).toBeCloseTo((25 - 50) / (25 + 50), 14)
    })

    it('complex ZL', () => {
      const g = reflectionGamma({ re: 50, im: 25 }, cReal(50))
      const expected = reflectionGamma({ re: 50, im: 25 }, { re: 50, im: 0 })
      expect(g.re).toBeCloseTo(expected.re, 14)
      expect(cAbs(g)).toBeLessThan(1)
    })
  })

  describe('power / VSWR', () => {
    it('power = |Γ|²; transmit = 1−|Γ|²; match VSWR=1', () => {
      const g = reflectionGamma(cReal(100), cReal(50))
      const pr = powerReflection(g)
      expect(pr).toBeCloseTo(cAbs2(g), 14)
      expect(powerTransmission(g)).toBeCloseTo(1 - pr, 14)
      expect(vswr(reflectionGamma(cReal(50), cReal(50)))).toBeCloseTo(1, 12)
      expect(returnLossDb(reflectionGamma(cReal(50), cReal(50)))).toBe(Infinity)
    })
  })

  describe('max power transfer', () => {
    it('P max when RL = RS; conjugate match error 0', () => {
      const Vth = 2
      const RS = 50
      const Pmatch = loadPowerReal(Vth, RS, RS)
      expect(Pmatch).toBeGreaterThan(loadPowerReal(Vth, RS, RS / 2))
      expect(Pmatch).toBeGreaterThan(loadPowerReal(Vth, RS, RS * 2))
      // Vth=2, RS=RL=50 → I=2/100=0.02, P=I²R=0.02
      expect(Pmatch).toBeCloseTo(0.02, 14)

      const err = conjugateMatchError({ re: 40, im: -10 }, { re: 40, im: 10 })
      expect(err).toBeCloseTo(0, 14)
    })
  })

  describe('sampleGammaVsLoad', () => {
    it('minimum |Γ| near Z0', () => {
      const s = sampleGammaVsLoad({ Z0: 50, ZLmin: 10, ZLmax: 200, nPoints: 39 })
      expect(s.finite).toBe(true)
      expect(Math.abs(s.ZL[s.matchedIndex]! - 50)).toBeLessThan(6)
      expect(Math.abs(s.gamma[s.matchedIndex]!)).toBeLessThan(0.15)
    })
  })

  describe('runReflectionGammaSample', () => {
    it('ok, methodId/familyId, match short open power', () => {
      const r = runReflectionGammaSample()
      expect(r.methodId).toBe(METHOD_ALGO_REFLECTION_GAMMA)
      expect(r.familyId).toBe(METHOD_ZMATCH)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.powerMatch).toBeLessThan(1e-20)
      expect(r.gammaShort.re).toBeCloseTo(-1, 12)
      expect(r.P_matched).toBeGreaterThan(r.P_half)
      expect(r.P_matched).toBeGreaterThan(r.P_double)
      expect(r.conjErr).toBeCloseTo(0, 14)
      expect(r.sweepFinite).toBe(true)
    })

    it('custom Z0 still ok', () => {
      const r = runReflectionGammaSample({ Z0: 75, ZL_mismatch: 150, RS: 75 })
      expect(r.ok).toBe(true)
      expect(r.Z0).toBe(75)
    })
  })
})
