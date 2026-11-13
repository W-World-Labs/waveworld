import { describe, it, expect } from 'vitest'
import {
  METHOD_SPH,
  METHOD_ALGO_SPH_WCSPH_DAMBREAK,
  SPH_L3_METHOD_IDS,
  cubicSplineW2d,
  cubicSplineGradW2d,
  solveSphDamBreak2d,
  runSphDamBreakSample,
} from './sph-l3-algos'

describe('SPH L3 · 2D WCSPH 溃坝', () => {
  it('方法 id 常量字符串（新 id 未入库，仅字符串相等）', () => {
    expect(METHOD_SPH).toBe('method-sph')
    expect(METHOD_ALGO_SPH_WCSPH_DAMBREAK).toBe('method-algo-sph-wcsph-dambreak')
    expect(SPH_L3_METHOD_IDS).toContain(METHOD_ALGO_SPH_WCSPH_DAMBREAK)
    // 勿 methodById：catalog 尚未接线
  })

  it('2D 三次样条核：紧支、峰值在原点、圆域积分 ≈ 1', () => {
    const h = 0.01
    expect(cubicSplineW2d(0, h)).toBeGreaterThan(0)
    expect(cubicSplineW2d(2.01 * h, h)).toBe(0)
    expect(cubicSplineW2d(3 * h, h)).toBe(0)
    // 极坐标数值积分 ∫ W dA = ∫₀^{2h} W(r)·2πr dr ≈ 1
    const nR = 4000
    const dr = (2 * h) / nR
    let s = 0
    for (let k = 0; k <= nR; k++) {
      const r = k * dr
      const w = k === 0 || k === nR ? 0.5 : 1
      s += w * cubicSplineW2d(r, h) * 2 * Math.PI * r
    }
    expect(Math.abs(s * dr - 1)).toBeLessThan(1e-3)
  })

  it('2D 核梯度：方向沿 r_ij、支撑外为零、反对称', () => {
    const h = 0.01
    const g = cubicSplineGradW2d(0.5 * h, 0, h)
    // dW/dr < 0 → ∇_i W_ij 指向 −x（r_ij = +x）
    expect(g.gx).toBeLessThan(0)
    expect(g.gy).toBe(0)
    expect(cubicSplineGradW2d(3 * h, 0, h)).toEqual({ gx: 0, gy: 0 })
    const g1 = cubicSplineGradW2d(0.3 * h, 0.4 * h, h)
    const g2 = cubicSplineGradW2d(-0.3 * h, -0.4 * h, h)
    expect(g1.gx).toBeCloseTo(-g2.gx, 15)
    expect(g1.gy).toBeCloseTo(-g2.gy, 15)
    expect(cubicSplineGradW2d(0, 0, h)).toEqual({ gx: 0, gy: 0 })
  })

  it('溃坝物理：能量只耗散、前锋推进、柱顶下降、粒子不出箱', () => {
    const r = solveSphDamBreak2d({
      tankWidth: 0.584,
      tankHeight: 0.584,
      columnWidth: 0.1461,
      columnHeight: 0.292,
      rho0: 1000,
      gravity: 9.81,
      kinematicViscosity: 1e-6,
      dx: 0.1461 / 16,
      tEnd: 0.15,
    })
    expect(r.finite).toBe(true)
    expect(r.escaped).toBe(0)
    // 机械能只减不增（人工粘性 + 壁面摩擦耗散）
    expect(r.energyMaxRatio).toBeLessThanOrEqual(1.001)
    expect(r.energyF).toBeLessThan(r.energy0)
    // 前锋推进超过一个柱宽，柱顶明显下降
    expect(r.frontMonotone).toBe(true)
    expect(r.frontNondimX).toBeGreaterThan(1.5)
    expect(r.yTopF).toBeLessThan(0.8 * r.yTop0)
    // 密度有界：可压缩 WCSPH 不超过 ~10% 过压
    expect(r.rhoMax).toBeLessThan(1.15 * 1000)
    expect(r.rhoMin).toBeGreaterThan(0)
  }, 60_000)

  it('runSphDamBreakSample ok', () => {
    const s = runSphDamBreakSample({ tEnd: 0.12 })
    expect(s.methodId).toBe(METHOD_ALGO_SPH_WCSPH_DAMBREAK)
    expect(s.familyId).toBe(METHOD_SPH)
    expect(s.ok).toBe(true)
  }, 60_000)
})
