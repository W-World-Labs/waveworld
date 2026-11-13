import { describe, it, expect } from 'vitest'
import {
  METHOD_FIBER,
  METHOD_ALGO_FIBER_ATTEN,
  METHOD_ALGO_FIBER_DISPERSION,
  FIBER_METHOD_IDS,
  fiberPowerAtten,
  fiberTransmittance,
  fiberLossDb,
  fiberGroupDelay,
  fiberDispersionBroaden,
  runFiberAttenSample,
  runFiberDispersionSample,
} from './fiber-algos'

describe('光纤 · Beer-Lambert 衰减与色散 stub', () => {
  it('方法 id 常量字符串（新 id 未入库，仅字符串相等）', () => {
    expect(METHOD_FIBER).toBe('method-fiber-optic')
    expect(METHOD_ALGO_FIBER_ATTEN).toBe('method-algo-fiber-atten')
    expect(METHOD_ALGO_FIBER_DISPERSION).toBe('method-algo-fiber-dispersion-stub')
    expect(FIBER_METHOD_IDS).toContain(METHOD_ALGO_FIBER_ATTEN)
    expect(FIBER_METHOD_IDS).toContain(METHOD_ALGO_FIBER_DISPERSION)
  })

  describe('fiberPowerAtten / transmittance', () => {
    it('P = P0 exp(−α L)', () => {
      const P0 = 2
      const alpha = 0.1
      const L = 5
      expect(fiberPowerAtten(P0, alpha, L)).toBeCloseTo(P0 * Math.exp(-alpha * L), 12)
      expect(fiberTransmittance(alpha, L)).toBeCloseTo(Math.exp(-alpha * L), 12)
    })

    it('L=0 → P=P0；α=0 → P=P0', () => {
      expect(fiberPowerAtten(3, 0.2, 0)).toBeCloseTo(3, 14)
      expect(fiberPowerAtten(3, 0, 100)).toBeCloseTo(3, 14)
    })

    it('加倍 L → 透射平方', () => {
      const T = fiberTransmittance(0.05, 10)
      expect(fiberTransmittance(0.05, 20)).toBeCloseTo(T * T, 12)
    })

    it('dB 损耗 = −10 log10(T)', () => {
      const alpha = 0.02
      const L = 50
      const T = fiberTransmittance(alpha, L)
      expect(fiberLossDb(alpha, L)).toBeCloseTo(-10 * Math.log10(T), 12)
    })

    it('非法参数 → NaN', () => {
      expect(Number.isNaN(fiberPowerAtten(-1, 0.1, 1))).toBe(true)
      expect(Number.isNaN(fiberPowerAtten(1, -0.1, 1))).toBe(true)
      expect(Number.isNaN(fiberTransmittance(0.1, -1))).toBe(true)
    })
  })

  describe('group delay / dispersion', () => {
    it('τ_g = L n_g / c 且 ∝ L', () => {
      const n = 1.5
      const c = 3e8
      const t1 = fiberGroupDelay(300, n, c)
      expect(t1).toBeCloseTo((300 * n) / c, 14)
      expect(fiberGroupDelay(600, n, c)).toBeCloseTo(2 * t1, 14)
    })

    it('Δτ = |D| L Δλ', () => {
      expect(fiberDispersionBroaden(2, 100, 0.5)).toBeCloseTo(100, 12)
      expect(fiberDispersionBroaden(-2, 100, 0.5)).toBeCloseTo(100, 12)
    })
  })

  describe('样例入口', () => {
    it('runFiberAttenSample：ok 且 methodId/familyId 对齐', () => {
      const r = runFiberAttenSample()
      expect(r.methodId).toBe(METHOD_ALGO_FIBER_ATTEN)
      expect(r.familyId).toBe(METHOD_FIBER)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.P).toBeCloseTo(r.P0 * Math.exp(-r.alpha * r.length), 12)
      expect(r.P_zeroL).toBeCloseTo(r.P0, 14)
      expect(r.T_double).toBeCloseTo(r.T * r.T, 12)
    })

    it('runFiberDispersionSample：ok 且线性缩放', () => {
      const r = runFiberDispersionSample()
      expect(r.methodId).toBe(METHOD_ALGO_FIBER_DISPERSION)
      expect(r.familyId).toBe(METHOD_FIBER)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.tauG_double).toBeCloseTo(2 * r.tauG, 10)
      expect(r.deltaTau_doubleL).toBeCloseTo(2 * r.deltaTau, 10)
      expect(r.tauG).toBeGreaterThan(0)
      expect(r.deltaTau).toBeGreaterThan(0)
    })
  })
})
