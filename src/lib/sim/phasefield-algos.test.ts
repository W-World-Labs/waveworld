import { describe, it, expect } from 'vitest'
import {
  METHOD_PHASEFIELD,
  METHOD_ALGO_ALLEN_CAHN,
  METHOD_ALGO_CAHN_HILLIARD_CHEM,
  PHASEFIELD_METHOD_IDS,
  doubleWellFp,
  doubleWellF,
  laplacian1d,
  interfaceEnergy1d,
  chemicalPotential1d,
  allenCahnStep1d,
  cahnHilliardStep1d,
  fieldAllFinite,
  fieldMinMax,
  initTanhInterface1d,
  runAllenCahnSample,
  runCahnHilliardChemSample,
} from './phasefield-algos'

describe('Phase-field · Allen–Cahn / Cahn–Hilliard 教学 stub', () => {
  it('方法 id 常量字符串（新 id 未入库，仅字符串相等）', () => {
    expect(METHOD_PHASEFIELD).toBe('method-phasefield')
    expect(METHOD_ALGO_ALLEN_CAHN).toBe('method-algo-allen-cahn')
    expect(METHOD_ALGO_CAHN_HILLIARD_CHEM).toBe(
      'method-algo-cahn-hilliard-chem',
    )
    expect(PHASEFIELD_METHOD_IDS).toContain(METHOD_ALGO_ALLEN_CAHN)
    expect(PHASEFIELD_METHOD_IDS).toContain(
      METHOD_ALGO_CAHN_HILLIARD_CHEM,
    )
    // 勿 methodById：catalog 尚未接线
  })

  describe('doubleWellFp / doubleWellF', () => {
    it("f'(φ)=φ³−φ，阱底 φ=±1 处导数为 0", () => {
      expect(doubleWellFp(0)).toBe(0)
      expect(doubleWellFp(1)).toBeCloseTo(0, 12)
      expect(doubleWellFp(-1)).toBeCloseTo(0, 12)
      expect(doubleWellFp(0.5)).toBeCloseTo(0.125 - 0.5, 12)
      expect(doubleWellFp(2)).toBeCloseTo(8 - 2, 12)
    })

    it('f(φ)=(1/4)(φ²−1)² 在 ±1 为 0，φ=0 为 1/4', () => {
      expect(doubleWellF(1)).toBeCloseTo(0, 12)
      expect(doubleWellF(-1)).toBeCloseTo(0, 12)
      expect(doubleWellF(0)).toBeCloseTo(0.25, 12)
      expect(doubleWellF(0)).toBeGreaterThan(doubleWellF(1))
    })
  })

  describe('laplacian1d', () => {
    it('二次多项式 φ=x²：φ_xx = 2（内部）', () => {
      const n = 11
      const dx = 0.1
      const phi = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        const x = i * dx
        phi[i] = x * x
      }
      const lap = laplacian1d(phi, dx)
      for (let i = 1; i < n - 1; i++) {
        expect(lap[i]).toBeCloseTo(2, 8)
      }
    })

    it('常数场 Laplacian = 0', () => {
      const phi = new Float64Array(8)
      phi.fill(3)
      const lap = laplacian1d(phi, 0.25)
      for (let i = 0; i < 8; i++) expect(lap[i]).toBeCloseTo(0, 12)
    })
  })

  describe('Allen–Cahn FTCS', () => {
    it('均匀 φ=1 稳态：一步几乎不变', () => {
      const n = 16
      const phi = new Float64Array(n)
      phi.fill(1)
      const next = allenCahnStep1d(phi, 0.1, 1e-4, 1, 0.1)
      for (let i = 0; i < n; i++) {
        expect(next[i]).toBeCloseTo(1, 8)
      }
    })

    it('扰动界面：能量下降且 φ 有界', () => {
      const n = 96
      const L = 6
      const eps = 0.15
      const dx = L / (n - 1)
      const M = 1
      const dt = Math.min(2e-4, 0.15 * (dx * dx) / (2 * M * eps * eps))
      const phi = initTanhInterface1d(n, L, eps)
      for (let i = 0; i < n; i++) {
        phi[i]! += 0.08 * Math.sin((2 * Math.PI * i) / n)
      }
      const E0 = interfaceEnergy1d(phi, dx, eps)
      const buf = new Float64Array(n)
      for (let s = 0; s < 120; s++) {
        allenCahnStep1d(phi, dx, dt, M, eps, buf)
        for (let i = 0; i < n; i++) phi[i] = buf[i]!
      }
      const Ef = interfaceEnergy1d(phi, dx, eps)
      expect(fieldAllFinite(phi)).toBe(true)
      expect(Ef).toBeLessThanOrEqual(E0 + 1e-6)
      const { min, max } = fieldMinMax(phi)
      expect(min).toBeGreaterThanOrEqual(-1.5)
      expect(max).toBeLessThanOrEqual(1.5)
    })
  })

  describe('Cahn–Hilliard chemical potential', () => {
    it('平衡 tanh：μ ≈ 0', () => {
      const n = 161
      const L = 8
      const eps = 0.25
      const dx = L / (n - 1)
      const phi = initTanhInterface1d(n, L, eps)
      const mu = chemicalPotential1d(phi, dx, eps)
      let maxAbs = 0
      for (let i = 0; i < n; i++) {
        const a = Math.abs(mu[i]!)
        if (a > maxAbs) maxAbs = a
      }
      // 解析 μ≡0；二阶差分残差随界面分辨率变小
      expect(maxAbs).toBeLessThan(0.08)
    })

    it('CH 一步：质量近似守恒、场有限', () => {
      const n = 96
      const L = 6
      const eps = 0.2
      const dx = L / (n - 1)
      const M = 1
      const dt = 0.01 * Math.pow(dx, 4) / (M * eps * eps)
      const phi = initTanhInterface1d(n, L, eps)
      let mass0 = 0
      for (let i = 0; i < n; i++) mass0 += phi[i]!
      const next = cahnHilliardStep1d(phi, dx, dt, M, eps)
      let mass1 = 0
      for (let i = 0; i < n; i++) mass1 += next[i]!
      expect(fieldAllFinite(next)).toBe(true)
      expect(Math.abs(mass1 - mass0) * dx).toBeLessThan(1e-6)
      const { min, max } = fieldMinMax(next)
      expect(min).toBeGreaterThanOrEqual(-1.5)
      expect(max).toBeLessThanOrEqual(1.5)
    })
  })

  describe('样例入口', () => {
    it('runAllenCahnSample：ok 且 methodId/familyId 对齐，能量下降', () => {
      const r = runAllenCahnSample()
      expect(r.methodId).toBe(METHOD_ALGO_ALLEN_CAHN)
      expect(r.familyId).toBe(METHOD_PHASEFIELD)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.energyDrop).toBeGreaterThanOrEqual(-1e-6)
      expect(r.energyF).toBeLessThanOrEqual(r.energy0 + 1e-6)
      expect(r.phiMin).toBeGreaterThanOrEqual(-1.5)
      expect(r.phiMax).toBeLessThanOrEqual(1.5)
    })

    it('runCahnHilliardChemSample：ok 且 μ 小、质量守恒', () => {
      const r = runCahnHilliardChemSample()
      expect(r.methodId).toBe(METHOD_ALGO_CAHN_HILLIARD_CHEM)
      expect(r.familyId).toBe(METHOD_PHASEFIELD)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.maxAbsMu).toBeLessThan(0.12)
      expect(r.massErr).toBeLessThan(1e-5)
      expect(r.phiMin).toBeGreaterThanOrEqual(-1.5)
      expect(r.phiMax).toBeLessThanOrEqual(1.5)
    })
  })
})
