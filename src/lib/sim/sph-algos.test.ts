import { describe, it, expect } from 'vitest'
import {
  METHOD_SPH,
  METHOD_ALGO_SPH_CUBIC_SPLINE,
  METHOD_ALGO_SPH_DENSITY_SUM,
  SPH_METHOD_IDS,
  cubicSplineW,
  cubicSplineWFromR,
  cubicSplineGradW,
  sphDensitySum,
  sphDensityAll,
  integrateCubicSplineW,
  runSphCubicSplineSample,
  runSphDensitySumSample,
} from './sph-algos'

describe('SPH · 三次样条核 + 密度求和', () => {
  it('方法 id 常量字符串（新 id 未入库，仅字符串相等）', () => {
    expect(METHOD_SPH).toBe('method-sph')
    expect(METHOD_ALGO_SPH_CUBIC_SPLINE).toBe('method-algo-sph-cubic-spline')
    expect(METHOD_ALGO_SPH_DENSITY_SUM).toBe('method-algo-sph-density-sum')
    expect(SPH_METHOD_IDS).toContain(METHOD_ALGO_SPH_CUBIC_SPLINE)
    expect(SPH_METHOD_IDS).toContain(METHOD_ALGO_SPH_DENSITY_SUM)
    // 勿 methodById：catalog 尚未接线
  })

  describe('cubicSplineW', () => {
    it('W(0) > 0，大 q = 0', () => {
      const h = 1.2
      expect(cubicSplineW(0, h)).toBeGreaterThan(0)
      expect(cubicSplineW(0, h)).toBeCloseTo(2 / (3 * h), 12)
      expect(cubicSplineW(2, h)).toBe(0)
      expect(cubicSplineW(2.5, h)).toBe(0)
      expect(cubicSplineW(10, h)).toBe(0)
      expect(cubicSplineWFromR(3 * h, h)).toBe(0)
    })

    it('q=1 处两支连续', () => {
      const h = 0.8
      // 左支极限 q→1⁻ 与右支 q→1⁺ 及函数值
      const w1 = cubicSplineW(1, h)
      const wLeft = cubicSplineW(1 - 1e-9, h)
      const wRight = cubicSplineW(1 + 1e-9, h)
      expect(Math.abs(w1 - wLeft)).toBeLessThan(1e-8)
      expect(Math.abs(w1 - wRight)).toBeLessThan(1e-8)
      // 解析：W(1)=(2/(3h))*0.25
      expect(w1).toBeCloseTo((2 / (3 * h)) * 0.25, 12)
    })

    it('负 q 与正 q 对称（用 |q|）', () => {
      const h = 1
      expect(cubicSplineW(-0.5, h)).toBeCloseTo(cubicSplineW(0.5, h), 14)
      expect(cubicSplineW(-1.3, h)).toBeCloseTo(cubicSplineW(1.3, h), 14)
    })

    it('数值积分 ∫W dr ≈ 1', () => {
      for (const h of [0.5, 1, 2]) {
        const I = integrateCubicSplineW(h)
        expect(Math.abs(I - 1)).toBeLessThan(0.01)
      }
    })

    it('cubicSplineGradW：中心处 ≈0，支撑外 =0', () => {
      const h = 1
      expect(Math.abs(cubicSplineGradW(0, h))).toBeLessThan(1e-14)
      expect(cubicSplineGradW(2.1, h)).toBe(0)
      // q∈(0,2) 时 dW/dr ≤ 0（核随 r 衰减）
      expect(cubicSplineGradW(0.5, h)).toBeLessThan(0)
      expect(cubicSplineGradW(1.2, h)).toBeLessThan(0)
    })
  })

  describe('sphDensitySum', () => {
    it('均匀晶格内部密度大致平坦且 ≈ ρ0', () => {
      const n = 48
      const dx = 1
      const rho0 = 1.5
      const h = 1.5 * dx
      const x = new Float64Array(n)
      const m = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        x[i] = i * dx
        m[i] = rho0 * dx
      }
      const rho = sphDensityAll(x, m, h)
      const margin = Math.ceil((2 * h) / dx) + 1
      const interior: number[] = []
      for (let i = margin; i < n - margin; i++) interior.push(rho[i]!)
      expect(interior.length).toBeGreaterThan(4)
      const mean =
        interior.reduce((a, b) => a + b, 0) / interior.length
      const maxDev = Math.max(...interior.map((r) => Math.abs(r - mean)))
      expect(Math.abs(mean - rho0) / rho0).toBeLessThan(0.08)
      expect(maxDev / mean).toBeLessThan(0.05)
    })

    it('单粒子自贡献 = m W(0,h)', () => {
      const x = new Float64Array([0])
      const m = new Float64Array([2])
      const h = 1
      const rho = sphDensitySum(x, m, h, 0)
      expect(rho).toBeCloseTo(2 * cubicSplineW(0, h), 12)
    })
  })

  it('runSphCubicSplineSample：ok 且 methodId/familyId 对齐', () => {
    const r = runSphCubicSplineSample({ h: 1.1 })
    expect(r.methodId).toBe(METHOD_ALGO_SPH_CUBIC_SPLINE)
    expect(r.familyId).toBe(METHOD_SPH)
    expect(r.ok).toBe(true)
    expect(r.w0).toBeGreaterThan(0)
    expect(r.wOutside).toBe(0)
    expect(r.integralErr).toBeLessThan(0.02)
    expect(r.contErrAt1).toBeLessThan(1e-12)
  })

  it('runSphDensitySumSample：ok 且密度平坦', () => {
    const r = runSphDensitySumSample({ n: 64, dx: 1, rho0: 1, kappa: 1.5 })
    expect(r.methodId).toBe(METHOD_ALGO_SPH_DENSITY_SUM)
    expect(r.familyId).toBe(METHOD_SPH)
    expect(r.ok).toBe(true)
    expect(r.maxRelErrInterior).toBeLessThan(0.08)
    expect(r.relSpread).toBeLessThan(0.05)
    expect(r.meanRhoInterior).toBeCloseTo(r.rho0, 1)
  })
})
