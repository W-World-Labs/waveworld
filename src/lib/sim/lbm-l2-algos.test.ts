import { describe, it, expect } from 'vitest'
import {
  LBM_L2_PARENT,
  LBM_L2_D1Q3_ID,
  LBM_L2_BGK_COLLIDE_ID,
  LBM_L2_METHOD_IDS,
  D1Q3_E,
  D1Q3_W,
  createD1q3,
  feqD1q3,
  densityAt,
  totalMass,
  initEquilibrium,
  bgkCollide,
  streamPeriodic,
  stepD1q3,
  gaussianDensity,
  LBM_L2_GUO_FORCE_ID,
  LBM_L2_FORCE_GUO_ID,
  runLbmBkgSample,
  runLbmStreamSample,
  guoForceD1q3,
  guoForceMassSum,
  guoForceMomentumSum,
  runLbmGuoForceSample,
} from './lbm-l2-algos'

describe('LBM L2 · D1Q3 BGK + stream', () => {
  it('方法 id 常量（bgk-collide 为未入库新 id）', () => {
    expect(LBM_L2_PARENT).toBe('method-lattice-boltzmann')
    expect(LBM_L2_D1Q3_ID).toBe('method-algo-lbm-d1q3')
    expect(LBM_L2_BGK_COLLIDE_ID).toBe('method-algo-lbm-bgk-collide')
    expect(LBM_L2_METHOD_IDS).toContain(LBM_L2_BGK_COLLIDE_ID)
    expect(LBM_L2_METHOD_IDS).toContain(LBM_L2_D1Q3_ID)
  })

  it('D1Q3 权重归一且速度集正确', () => {
    expect(D1Q3_E).toEqual([-1, 0, 1])
    const wSum = D1Q3_W[0]! + D1Q3_W[1]! + D1Q3_W[2]!
    expect(wSum).toBeCloseTo(1, 12)
  })

  it('feq：u=0 时 feq = w·ρ；Σ feq = ρ', () => {
    const rho = 1.7
    let s = 0
    for (let q = 0; q < 3; q++) {
      const feq = feqD1q3(rho, 0, q)
      expect(feq).toBeCloseTo(D1Q3_W[q]! * rho, 12)
      s += feq
    }
    expect(s).toBeCloseTo(rho, 12)
  })

  it('bgkCollide：质量守恒且 τ=1 完全松弛到 feq(ρ,u)', () => {
    const f = createD1q3(16)
    for (let i = 0; i < 16; i++) {
      f[0]![i] = 0.1
      f[1]![i] = 0.5
      f[2]![i] = 0.4
    }
    const m0 = totalMass(f)
    // 碰撞前宏观速度（动量非零）
    const u0 = (-f[0]![0]! + f[2]![0]!) / densityAt(f, 0)
    bgkCollide(f, 1)
    expect(Math.abs(totalMass(f) - m0)).toBeLessThan(1e-12)
    // τ=1 完全松弛：应精确等于 feq(ρ, u_local)
    for (let i = 0; i < 16; i++) {
      const rho = densityAt(f, i)
      const u = (-f[0]![i]! + f[2]![i]!) / rho
      expect(u).toBeCloseTo(u0, 10)
      for (let q = 0; q < 3; q++) {
        expect(f[q]![i]).toBeCloseTo(feqD1q3(rho, u, q), 10)
      }
    }
  })

  it('streamPeriodic：周期平移且质量守恒', () => {
    const f = createD1q3(8)
    f[2]![0] = 1 // e=+1 从格点 0 → 1
    f[0]![3] = 2 // e=-1 从格点 3 → 2
    f[1]![5] = 3 // e=0 留在 5
    const m0 = totalMass(f)
    const g = streamPeriodic(f)
    expect(g[2]![1]).toBe(1)
    expect(g[0]![2]).toBe(2)
    expect(g[1]![5]).toBe(3)
    expect(Math.abs(totalMass(g) - m0)).toBeLessThan(1e-15)
  })

  it('runLbmBkgSample：碰撞松弛 + 质量守恒', () => {
    const r = runLbmBkgSample(32, 1)
    expect(r.methodId).toBe(LBM_L2_BGK_COLLIDE_ID)
    expect(r.massErr / r.mass0).toBeLessThan(1e-12)
    expect(r.relaxed).toBe(true)
    expect(r.nonEqF).toBeLessThan(r.nonEq0)
  })

  it('runLbmStreamSample：u=0 质量守恒且尖峰摊平', () => {
    const r = runLbmStreamSample(50, 1, 0, 32)
    expect(r.methodId).toBe(LBM_L2_D1Q3_ID)
    expect(r.massErr / r.mass0).toBeLessThan(1e-10)
    expect(r.peakedFlattened).toBe(true)
    expect(r.rhoMidF).toBeLessThan(r.rhoMid0)
    expect(r.rhoMidF).toBeGreaterThan(1)
  })

  it('runLbmStreamSample：非零 u0 时质心沿 +x 漂移', () => {
    // 短时步：峰尚未摊平，超额密度质心可追踪；长时扩散后 COM 病态
    const r = runLbmStreamSample(8, 1, 0.1, 32)
    expect(r.massErr / r.mass0).toBeLessThan(1e-9)
    expect(r.comDrift).toBeGreaterThan(0.3)
    // 期望漂移量级 ~ u0 * steps
    expect(r.comDrift).toBeLessThan(2)
  })

  it('initEquilibrium + stepD1q3 有限', () => {
    const Nx = 24
    const rho = gaussianDensity(Nx)
    const f0 = createD1q3(Nx)
    initEquilibrium(f0, rho)
    const f1 = stepD1q3(f0, 0.8)
    expect(Number.isFinite(totalMass(f1))).toBe(true)
    expect(Math.abs(totalMass(f1) - totalMass(f0))).toBeLessThan(1e-10)
  })

  it('Guo 力项：Σ F_q≈0 且动量与体力同向', () => {
    expect(LBM_L2_METHOD_IDS).toContain(LBM_L2_GUO_FORCE_ID)
    expect(LBM_L2_METHOD_IDS).toContain(LBM_L2_FORCE_GUO_ID)
    const Fq = guoForceD1q3(1, 0.05, 1e-3, 1)
    expect(Math.abs(guoForceMassSum(Fq))).toBeLessThan(1e-14)
    expect(guoForceMomentumSum(Fq)).toBeGreaterThan(0)
    const r = runLbmGuoForceSample()
    expect(r.methodId).toBe(LBM_L2_GUO_FORCE_ID)
    expect(r.massConserved).toBe(true)
    expect(r.momentumAligned).toBe(true)
  })
})
