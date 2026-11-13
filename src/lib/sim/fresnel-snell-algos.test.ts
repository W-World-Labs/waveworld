import { describe, it, expect } from 'vitest'
import {
  METHOD_FRESNEL,
  METHOD_ALGO_SNELL,
  METHOD_ALGO_FRESNEL_R,
  FRESNEL_PARENT,
  FRESNEL_METHOD_IDS,
  snellTheta2,
  fresnelRNormal,
  runSnellSample,
  runFresnelRSample,
} from './fresnel-snell-algos'

describe('Fresnel / Snell · refraction + normal R', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_FRESNEL).toBe('method-fresnel-snell')
    expect(METHOD_ALGO_SNELL).toBe('method-algo-snell')
    expect(METHOD_ALGO_FRESNEL_R).toBe('method-algo-fresnel-r')
    expect(FRESNEL_PARENT).toBe(METHOD_FRESNEL)
    expect(FRESNEL_METHOD_IDS).toContain(METHOD_ALGO_SNELL)
    expect(FRESNEL_METHOD_IDS).toContain(METHOD_ALGO_FRESNEL_R)
  })

  describe('snellTheta2', () => {
    it('n1 sin θ1 = n2 sin θ2', () => {
      const n1 = 1
      const n2 = 1.5
      const theta1 = Math.PI / 6
      const theta2 = snellTheta2(n1, n2, theta1)
      expect(theta2).toBeCloseTo(Math.asin((n1 / n2) * Math.sin(theta1)), 14)
      expect(n1 * Math.sin(theta1)).toBeCloseTo(n2 * Math.sin(theta2!), 12)
      expect(theta2!).toBeLessThan(theta1)
    })

    it('normal incidence → θ2 = 0', () => {
      expect(snellTheta2(1, 1.5, 0)).toBeCloseTo(0, 15)
    })

    it('TIR / domain → NaN', () => {
      // glass → air at 60° exceeds critical ~41.8°
      expect(Number.isNaN(snellTheta2(1.5, 1.0, Math.PI / 3))).toBe(true)
      expect(Number.isNaN(snellTheta2(0, 1.5, 0.1))).toBe(true)
      expect(Number.isNaN(snellTheta2(1, 0, 0.1))).toBe(true)
      expect(Number.isNaN(snellTheta2(NaN, 1.5, 0.1))).toBe(true)
    })
  })

  describe('fresnelRNormal', () => {
    it('R = ((n1−n2)/(n1+n2))²; air–glass ≈ 0.04', () => {
      const R = fresnelRNormal(1, 1.5)
      expect(R).toBeCloseTo(((1 - 1.5) / (1 + 1.5)) ** 2, 14)
      expect(R).toBeCloseTo(0.04, 3)
    })

    it('swap n1↔n2 same R; matched → 0', () => {
      expect(fresnelRNormal(1.5, 1)).toBeCloseTo(fresnelRNormal(1, 1.5), 14)
      expect(fresnelRNormal(1.33, 1.33)).toBe(0)
    })

    it('invalid n → NaN', () => {
      expect(Number.isNaN(fresnelRNormal(0, 1.5))).toBe(true)
      expect(Number.isNaN(fresnelRNormal(-1, 1.5))).toBe(true)
      expect(Number.isNaN(fresnelRNormal(1, NaN))).toBe(true)
    })
  })

  describe('samples', () => {
    it('runSnellSample: ok, formula, TIR flag', () => {
      const r = runSnellSample()
      expect(r.methodId).toBe(METHOD_ALGO_SNELL)
      expect(r.familyId).toBe(METHOD_FRESNEL)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.theta2).toBeCloseTo(
        Math.asin((r.n1 / r.n2) * Math.sin(r.theta1)),
        14,
      )
      expect(r.theta2Normal).toBeCloseTo(0, 15)
      expect(Number.isFinite(r.theta2Tir)).toBe(false)
    })

    it('runFresnelRSample: ok, air–glass, symmetry', () => {
      const r = runFresnelRSample()
      expect(r.methodId).toBe(METHOD_ALGO_FRESNEL_R)
      expect(r.familyId).toBe(METHOD_FRESNEL)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.R).toBeCloseTo(((r.n1 - r.n2) / (r.n1 + r.n2)) ** 2, 14)
      expect(r.R_swap).toBeCloseTo(r.R, 14)
      expect(r.R_matched).toBe(0)
      expect(r.R_airGlass).toBeCloseTo(0.04, 3)
    })
  })
})
