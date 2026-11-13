import { describe, it, expect } from 'vitest'
import {
  METHOD_CARNOT,
  METHOD_ALGO_CARNOT_ETA,
  METHOD_OTTO,
  METHOD_ALGO_OTTO_ETA,
  CARNOT_PARENT,
  OTTO_PARENT,
  CARNOT_METHOD_IDS,
  OTTO_METHOD_IDS,
  CARNOT_OTTO_METHOD_IDS,
  carnotEta,
  ottoEta,
  runCarnotEtaSample,
  runOttoEtaSample,
} from './carnot-otto-algos'

describe('Carnot + Otto · thermal efficiency teaching stubs', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_CARNOT).toBe('method-carnot')
    expect(METHOD_ALGO_CARNOT_ETA).toBe('method-algo-carnot-eta')
    expect(METHOD_OTTO).toBe('method-otto')
    expect(METHOD_ALGO_OTTO_ETA).toBe('method-algo-otto-eta')
    expect(CARNOT_PARENT).toBe(METHOD_CARNOT)
    expect(OTTO_PARENT).toBe(METHOD_OTTO)
    expect(CARNOT_METHOD_IDS).toContain(METHOD_ALGO_CARNOT_ETA)
    expect(OTTO_METHOD_IDS).toContain(METHOD_ALGO_OTTO_ETA)
    expect(CARNOT_OTTO_METHOD_IDS).toContain(METHOD_ALGO_CARNOT_ETA)
    expect(CARNOT_OTTO_METHOD_IDS).toContain(METHOD_ALGO_OTTO_ETA)
  })

  describe('carnotEta', () => {
    it('η = 1 − Tc/Th', () => {
      expect(carnotEta(600, 300)).toBeCloseTo(0.5, 14)
      expect(carnotEta(800, 300)).toBeCloseTo(1 - 300 / 800, 14)
      expect(carnotEta(800, 300)).toBeCloseTo(0.625, 14)
    })

    it('Th↑ → η↑; Tc↑ → η↓', () => {
      expect(carnotEta(900, 300)).toBeGreaterThan(carnotEta(800, 300))
      expect(carnotEta(800, 350)).toBeLessThan(carnotEta(800, 300))
    })

    it('illegal: Th≤Tc or non-positive → NaN', () => {
      expect(Number.isNaN(carnotEta(300, 300))).toBe(true)
      expect(Number.isNaN(carnotEta(200, 300))).toBe(true)
      expect(Number.isNaN(carnotEta(0, 300))).toBe(true)
      expect(Number.isNaN(carnotEta(800, -1))).toBe(true)
      expect(Number.isNaN(carnotEta(NaN, 300))).toBe(true)
      expect(Number.isNaN(carnotEta(800, Infinity))).toBe(true)
    })
  })

  describe('ottoEta', () => {
    it('η = 1 − r^(1−γ) = 1 − 1/r^(γ−1)', () => {
      const r = 8
      const gamma = 1.4
      const eta = ottoEta(r, gamma)
      expect(eta).toBeCloseTo(1 - Math.pow(r, 1 - gamma), 14)
      expect(eta).toBeCloseTo(1 - 1 / Math.pow(r, gamma - 1), 12)
      // classic textbook ≈ 0.5647
      expect(eta).toBeCloseTo(0.5647, 3)
    })

    it('r↑ → η↑; γ↑ → η↑', () => {
      expect(ottoEta(10, 1.4)).toBeGreaterThan(ottoEta(8, 1.4))
      expect(ottoEta(8, 1.5)).toBeGreaterThan(ottoEta(8, 1.4))
    })

    it('illegal: r≤1 or γ≤1 or non-finite → NaN', () => {
      expect(Number.isNaN(ottoEta(1, 1.4))).toBe(true)
      expect(Number.isNaN(ottoEta(0.5, 1.4))).toBe(true)
      expect(Number.isNaN(ottoEta(8, 1))).toBe(true)
      expect(Number.isNaN(ottoEta(8, 0.9))).toBe(true)
      expect(Number.isNaN(ottoEta(NaN, 1.4))).toBe(true)
      expect(Number.isNaN(ottoEta(8, Infinity))).toBe(true)
    })
  })

  describe('samples', () => {
    it('runCarnotEtaSample: ok, methodId/familyId, formula', () => {
      const r = runCarnotEtaSample()
      expect(r.methodId).toBe(METHOD_ALGO_CARNOT_ETA)
      expect(r.familyId).toBe(METHOD_CARNOT)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.Th).toBe(800)
      expect(r.Tc).toBe(300)
      expect(r.eta).toBeCloseTo(0.625, 14)
      expect(r.etaHotter).toBeGreaterThan(r.eta)
      expect(Number.isFinite(r.etaEqualT)).toBe(false)
    })

    it('runOttoEtaSample: ok, methodId/familyId, formula', () => {
      const r = runOttoEtaSample()
      expect(r.methodId).toBe(METHOD_ALGO_OTTO_ETA)
      expect(r.familyId).toBe(METHOD_OTTO)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.r).toBe(8)
      expect(r.gamma).toBe(1.4)
      expect(r.eta).toBeCloseTo(1 - Math.pow(8, 1 - 1.4), 14)
      expect(r.etaHigherR).toBeGreaterThan(r.eta)
      expect(Number.isFinite(r.etaBadR)).toBe(false)
    })

    it('custom params still ok', () => {
      expect(runCarnotEtaSample({ Th: 1000, Tc: 280 }).ok).toBe(true)
      expect(runOttoEtaSample({ r: 10, gamma: 1.35 }).ok).toBe(true)
    })
  })
})
