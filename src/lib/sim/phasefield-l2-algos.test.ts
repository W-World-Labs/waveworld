import { describe, it, expect } from 'vitest'
import {
  METHOD_PHASEFIELD,
  METHOD_ALGO_PF_MOBILITY,
  PHASEFIELD_L2_METHOD_IDS,
  mobilityDegenerate,
  projectDoubleObstacle,
  allenCahnMobilityStep1d,
  mobilityField,
  meanMobility,
  runPfMobilitySample,
  initTanhInterface1d,
  interfaceEnergy1d,
  fieldAllFinite,
  fieldMinMax,
} from './phasefield-l2-algos'

describe('Phase-field L2 · 退化迁移率 M(φ)', () => {
  it('方法 id 常量（新 id 未入库，仅字符串）', () => {
    expect(METHOD_PHASEFIELD).toBe('method-phasefield')
    expect(METHOD_ALGO_PF_MOBILITY).toBe('method-algo-pf-mobility')
    expect(PHASEFIELD_L2_METHOD_IDS).toContain(METHOD_ALGO_PF_MOBILITY)
  })

  describe('mobilityDegenerate', () => {
    it('M(φ)=M0(1−φ²)_+：阱底为零，φ=0 最大', () => {
      expect(mobilityDegenerate(0, 2)).toBeCloseTo(2, 12)
      expect(mobilityDegenerate(1, 2)).toBeCloseTo(0, 12)
      expect(mobilityDegenerate(-1, 2)).toBeCloseTo(0, 12)
      expect(mobilityDegenerate(0.5, 1)).toBeCloseTo(0.75, 12)
      // |φ|>1 截断为 0
      expect(mobilityDegenerate(1.5, 1)).toBe(0)
      expect(mobilityDegenerate(-2, 1)).toBe(0)
    })
  })

  describe('projectDoubleObstacle', () => {
    it('投影到 [−1,1]', () => {
      const phi = new Float64Array([-1.5, -1, 0, 1, 2.3])
      const p = projectDoubleObstacle(phi)
      expect(p[0]).toBe(-1)
      expect(p[1]).toBe(-1)
      expect(p[2]).toBe(0)
      expect(p[3]).toBe(1)
      expect(p[4]).toBe(1)
    })
  })

  describe('allenCahnMobilityStep1d', () => {
    it('均匀 φ=1：M=0，场不变', () => {
      const n = 16
      const phi = new Float64Array(n)
      phi.fill(1)
      const next = allenCahnMobilityStep1d(phi, 0.1, 1e-3, 1, 0.1)
      for (let i = 0; i < n; i++) expect(next[i]).toBeCloseTo(1, 12)
    })

    it('扰动界面：能量下降且 φ 有界', () => {
      const n = 96
      const L = 6
      const eps = 0.15
      const dx = L / (n - 1)
      const M0 = 1
      const dt = Math.min(3e-4, 0.12 * (dx * dx) / (2 * M0 * eps * eps))
      const phi = initTanhInterface1d(n, L, eps)
      for (let i = 0; i < n; i++) {
        phi[i]! += 0.1 * Math.sin((2 * Math.PI * i) / n)
      }
      const E0 = interfaceEnergy1d(phi, dx, eps)
      const meanM = meanMobility(phi, M0)
      expect(meanM).toBeGreaterThan(0)
      const buf = new Float64Array(n)
      for (let s = 0; s < 100; s++) {
        allenCahnMobilityStep1d(phi, dx, dt, M0, eps, buf)
        for (let i = 0; i < n; i++) phi[i] = buf[i]!
      }
      const Ef = interfaceEnergy1d(phi, dx, eps)
      expect(fieldAllFinite(phi)).toBe(true)
      expect(Ef).toBeLessThanOrEqual(E0 + 1e-6)
      const { min, max } = fieldMinMax(phi)
      expect(min).toBeGreaterThanOrEqual(-1.6)
      expect(max).toBeLessThanOrEqual(1.6)
    })

    it('带投影：φ 严格 ∈[−1,1]', () => {
      const n = 32
      const L = 4
      const eps = 0.2
      const dx = L / (n - 1)
      const phi = initTanhInterface1d(n, L, eps)
      for (let i = 0; i < n; i++) phi[i]! += 0.3 * Math.sin((2 * Math.PI * i) / n)
      const buf = new Float64Array(n)
      for (let s = 0; s < 40; s++) {
        allenCahnMobilityStep1d(phi, dx, 2e-4, 1, eps, buf, true)
        for (let i = 0; i < n; i++) phi[i] = buf[i]!
      }
      const { min, max } = fieldMinMax(phi)
      expect(min).toBeGreaterThanOrEqual(-1 - 1e-12)
      expect(max).toBeLessThanOrEqual(1 + 1e-12)
    })
  })

  describe('mobilityField', () => {
    it('体相 M≈0，界面中心 M 大', () => {
      const n = 101
      const L = 8
      const eps = 0.25
      const phi = initTanhInterface1d(n, L, eps)
      const M = mobilityField(phi, 1)
      // 端点近 ±1
      expect(M[0]!).toBeLessThan(0.05)
      expect(M[n - 1]!).toBeLessThan(0.05)
      // 中点 φ≈0 → M≈1
      expect(M[Math.floor(n / 2)]!).toBeGreaterThan(0.8)
    })
  })

  describe('样例入口', () => {
    it('runPfMobilitySample：ok、能量下降、familyId 对齐', () => {
      const r = runPfMobilitySample()
      expect(r.methodId).toBe(METHOD_ALGO_PF_MOBILITY)
      expect(r.familyId).toBe(METHOD_PHASEFIELD)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.energyDrop).toBeGreaterThanOrEqual(-1e-6)
      expect(r.energyF).toBeLessThanOrEqual(r.energy0 + 1e-6)
      expect(r.energyDrop).toBeGreaterThan(0)
      expect(r.meanM0).toBeGreaterThan(0)
      expect(r.phiMin).toBeGreaterThanOrEqual(-1.6)
      expect(r.phiMax).toBeLessThanOrEqual(1.6)
    })

    it('runPfMobilitySample(project)：仍 ok', () => {
      const r = runPfMobilitySample({ project: true, steps: 80 })
      expect(r.ok).toBe(true)
      expect(r.phiMin).toBeGreaterThanOrEqual(-1 - 1e-9)
      expect(r.phiMax).toBeLessThanOrEqual(1 + 1e-9)
    })
  })
})
