import { describe, it, expect } from 'vitest'
import {
  METHOD_VLASOV,
  METHOD_ALGO_VLASOV_STREAM,
  METHOD_ALGO_VLASOV_POISSON_1D,
  VLASOV_METHOD_IDS,
  createVlasovGrid,
  depositGaussianBlob,
  phaseMass,
  phaseFinite,
  streamSemiLagrangian,
  streamUpwind,
  densityFromF,
  chargeDensity,
  poissonPeriodicFd1d,
  vlasovPoissonFields,
  fieldL2,
  densityCentroid,
  velocityAt,
  runVlasovStreamSample,
  runVlasovPoisson1dSample,
} from './vlasov-algos'

describe('Vlasov · 1D 相空间流 + Poisson', () => {
  it('方法 id 常量（全未入库 — 勿 methodById）', () => {
    expect(METHOD_VLASOV).toBe('method-vlasov')
    expect(METHOD_ALGO_VLASOV_STREAM).toBe('method-algo-vlasov-stream')
    expect(METHOD_ALGO_VLASOV_POISSON_1D).toBe('method-algo-vlasov-poisson-1d')
    expect(VLASOV_METHOD_IDS).toContain(METHOD_ALGO_VLASOV_STREAM)
    expect(VLASOV_METHOD_IDS).toContain(METHOD_ALGO_VLASOV_POISSON_1D)
  })

  describe('网格与质量', () => {
    it('高斯 blob 质量归一且有限', () => {
      const g = createVlasovGrid(40, 28, 1, -1, 1)
      depositGaussianBlob(g, 0.5, 0, 0.08, 0.15, 1)
      expect(phaseMass(g)).toBeCloseTo(1, 2)
      expect(phaseFinite(g)).toBe(true)
    })

    it('velocityAt 在 [vmin,vmax) 中心', () => {
      const g = createVlasovGrid(4, 4, 1, -1, 1)
      expect(velocityAt(g, 0)).toBeCloseTo(-0.75, 12)
      expect(velocityAt(g, 3)).toBeCloseTo(0.75, 12)
    })
  })

  describe('流 advect', () => {
    it('半拉格朗日：质量近似守恒', () => {
      const g = createVlasovGrid(48, 32, 1, -1, 1)
      depositGaussianBlob(g, 0.25, 0.3, 0.06, 0.12, 1)
      const m0 = phaseMass(g)
      for (let s = 0; s < 25; s++) streamSemiLagrangian(g, 0.02)
      const mF = phaseMass(g)
      expect(Math.abs(mF - m0) / m0).toBeLessThan(0.05)
      expect(phaseFinite(g)).toBe(true)
    })

    it('半拉格朗日：正 v 质心向 +x', () => {
      const g = createVlasovGrid(48, 32, 1, -1, 1)
      depositGaussianBlob(g, 0.3, 0.5, 0.05, 0.1, 1)
      const x0 = densityCentroid(g)
      for (let s = 0; s < 15; s++) streamSemiLagrangian(g, 0.02)
      const xF = densityCentroid(g)
      let d = xF - x0
      if (d < -0.5) d += 1
      expect(d).toBeGreaterThan(0.05)
    })

    it('迎风：CFL 内质量不爆', () => {
      const g = createVlasovGrid(32, 16, 1, -0.5, 0.5)
      depositGaussianBlob(g, 0.4, 0.2, 0.08, 0.1, 1)
      const m0 = phaseMass(g)
      // max |v|=0.5, dx=1/32 → dt ≤ dx/|v| = 1/16
      const dt = 0.02
      for (let s = 0; s < 10; s++) streamUpwind(g, dt)
      expect(phaseFinite(g)).toBe(true)
      expect(phaseMass(g)).toBeGreaterThan(0.5 * m0)
      expect(phaseMass(g)).toBeLessThan(1.5 * m0)
    })
  })

  describe('密度与泊松', () => {
    it('均匀 n → ρ≈0 → E≈0', () => {
      const g = createVlasovGrid(32, 16, 1, -1, 1)
      // 均匀填充
      g.f.fill(1)
      const n = densityFromF(g)
      const { rho } = chargeDensity(n)
      let maxR = 0
      for (let i = 0; i < rho.length; i++) maxR = Math.max(maxR, Math.abs(rho[i]!))
      expect(maxR).toBeLessThan(1e-12)
      const { E } = poissonPeriodicFd1d(rho, g.dx)
      let maxE = 0
      for (let i = 0; i < E.length; i++) maxE = Math.max(maxE, Math.abs(E[i]!))
      expect(maxE).toBeLessThan(1e-10)
    })

    it('局域密度峰 → 非零 E 与 φ', () => {
      const g = createVlasovGrid(48, 24, 1, -1, 1)
      depositGaussianBlob(g, 0.5, 0, 0.08, 0.2, 1)
      const { rho, phi, E } = vlasovPoissonFields(g)
      expect(fieldL2(E, g.dx)).toBeGreaterThan(1e-5)
      let phiMax = 0
      let rhoMax = 0
      for (let i = 0; i < rho.length; i++) {
        phiMax = Math.max(phiMax, Math.abs(phi[i]!))
        rhoMax = Math.max(rhoMax, Math.abs(rho[i]!))
      }
      expect(rhoMax).toBeGreaterThan(0)
      expect(phiMax).toBeGreaterThan(0)
      expect(phi.every(Number.isFinite)).toBe(true)
      expect(E.every(Number.isFinite)).toBe(true)
    })

    it('ρ 去直流：⟨ρ⟩≈0', () => {
      const n = new Float64Array([1, 2, 3, 2])
      const { rho } = chargeDensity(n)
      let s = 0
      for (let i = 0; i < rho.length; i++) s += rho[i]!
      expect(s / rho.length).toBeCloseTo(0, 12)
    })
  })

  describe('样例入口', () => {
    it('runVlasovStreamSample：ok、质量松守恒、methodId', () => {
      const r = runVlasovStreamSample()
      expect(r.methodId).toBe(METHOD_ALGO_VLASOV_STREAM)
      expect(r.familyId).toBe(METHOD_VLASOV)
      expect(r.finite).toBe(true)
      expect(r.ok).toBe(true)
      expect(r.massRelErr).toBeLessThan(0.08)
      expect(r.drifted).toBe(true)
    })

    it('runVlasovPoisson1dSample：ok、E 非零、质量松守恒', () => {
      const r = runVlasovPoisson1dSample()
      expect(r.methodId).toBe(METHOD_ALGO_VLASOV_POISSON_1D)
      expect(r.familyId).toBe(METHOD_VLASOV)
      expect(r.finite).toBe(true)
      expect(r.ok).toBe(true)
      expect(r.eL2).toBeGreaterThan(1e-6)
      expect(r.massRelErr).toBeLessThan(0.1)
    })
  })
})
