import { describe, it, expect } from 'vitest'
import {
  METHOD_VLASOV,
  METHOD_ALGO_VLASOV_ACCEL,
  VLASOV_L2_METHOD_IDS,
  createVlasovGrid,
  depositGaussianBlob,
  phaseMass,
  phaseFinite,
  sampleFv,
  accelSemiLagrangian,
  accelUpwind,
  velocityCentroid,
  constantEField,
  velocityAt,
  runVlasovAccelSample,
} from './vlasov-l2-algos'

describe('Vlasov L2 · v 加速半拉格朗日', () => {
  it('方法 id 常量（新 id 未入库）', () => {
    expect(METHOD_VLASOV).toBe('method-vlasov')
    expect(METHOD_ALGO_VLASOV_ACCEL).toBe('method-algo-vlasov-accel')
    expect(VLASOV_L2_METHOD_IDS).toContain(METHOD_ALGO_VLASOV_ACCEL)
  })

  describe('sampleFv', () => {
    it('格点中心精确命中', () => {
      const g = createVlasovGrid(4, 8, 1, -1, 1)
      g.f.fill(0)
      // 在 ix=1, iv=3 放 2
      g.f[1 * 8 + 3] = 2
      const v = velocityAt(g, 3)
      expect(sampleFv(g, 1, v)).toBeCloseTo(2, 10)
      expect(sampleFv(g, 0, v)).toBeCloseTo(0, 10)
    })

    it('域外返回 0', () => {
      const g = createVlasovGrid(4, 8, 1, -1, 1)
      g.f.fill(1)
      expect(sampleFv(g, 0, -2)).toBe(0)
      expect(sampleFv(g, 0, 2)).toBe(0)
    })
  })

  describe('accelSemiLagrangian', () => {
    it('E=0：分布不变', () => {
      const g = createVlasovGrid(16, 32, 1, -1, 1)
      depositGaussianBlob(g, 0.5, 0, 0.08, 0.12, 1)
      const before = new Float64Array(g.f)
      accelSemiLagrangian(g, constantEField(16, 0), 1, 0.05)
      for (let i = 0; i < g.f.length; i++) {
        expect(g.f[i]).toBeCloseTo(before[i]!, 10)
      }
    })

    it('正 a：速度质心增大，质量松守恒', () => {
      const g = createVlasovGrid(20, 48, 1, -1.5, 1.5)
      depositGaussianBlob(g, 0.5, 0, 0.1, 0.1, 1)
      const m0 = phaseMass(g)
      const v0 = velocityCentroid(g)
      const E = constantEField(20, 0.6)
      for (let s = 0; s < 20; s++) accelSemiLagrangian(g, E, 1, 0.012)
      const mF = phaseMass(g)
      const vF = velocityCentroid(g)
      expect(phaseFinite(g)).toBe(true)
      expect(vF).toBeGreaterThan(v0 + 0.05)
      expect(Math.abs(mF - m0) / m0).toBeLessThan(0.1)
    })

    it('负 q/m：速度质心减小', () => {
      const g = createVlasovGrid(16, 40, 1, -1.5, 1.5)
      depositGaussianBlob(g, 0.5, 0.1, 0.1, 0.1, 1)
      const v0 = velocityCentroid(g)
      const E = constantEField(16, 0.5)
      for (let s = 0; s < 15; s++) accelSemiLagrangian(g, E, -1, 0.015)
      expect(velocityCentroid(g)).toBeLessThan(v0 - 0.04)
    })
  })

  describe('accelUpwind', () => {
    it('CFL 内质量不爆、质心漂移', () => {
      const g = createVlasovGrid(12, 32, 1, -1, 1)
      depositGaussianBlob(g, 0.5, 0, 0.1, 0.12, 1)
      const m0 = phaseMass(g)
      const v0 = velocityCentroid(g)
      // |a|=0.4, dv≈2/32 → dt ≤ dv/|a| ≈ 0.156
      const E = constantEField(12, 0.4)
      const dt = 0.04
      for (let s = 0; s < 10; s++) accelUpwind(g, E, 1, dt)
      expect(phaseFinite(g)).toBe(true)
      expect(phaseMass(g)).toBeGreaterThan(0.5 * m0)
      expect(phaseMass(g)).toBeLessThan(1.5 * m0)
      expect(velocityCentroid(g)).toBeGreaterThan(v0)
    })
  })

  describe('样例入口', () => {
    it('runVlasovAccelSample：ok、质量松守恒、加速方向正确', () => {
      const r = runVlasovAccelSample()
      expect(r.methodId).toBe(METHOD_ALGO_VLASOV_ACCEL)
      expect(r.familyId).toBe(METHOD_VLASOV)
      expect(r.finite).toBe(true)
      expect(r.ok).toBe(true)
      expect(r.massRelErr).toBeLessThan(0.12)
      expect(r.accelerated).toBe(true)
      expect(r.vShift).toBeGreaterThan(0)
      expect(Math.abs(r.vShift - r.expectedShift)).toBeLessThan(
        0.5 * Math.abs(r.expectedShift) + 0.05,
      )
    })
  })
})
