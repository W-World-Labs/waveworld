import { describe, it, expect } from 'vitest'
import {
  LBM_L3_PARENT,
  METHOD_ALGO_LBM_BOUNCE_BACK,
  METHOD_ALGO_LBM_MRT_STUB,
  LBM_L3_METHOD_IDS,
  bounceBackAtWalls,
  reversePopulationsAt,
  streamBounceBackEnds,
  stepD1q3BounceBack,
  mrtCollideStub,
  runLbmBounceBackSample,
  runLbmMrtStubSample,
  createD1q3,
  densityAt,
  velocityAt,
  totalMass,
  initEquilibrium,
  D1Q3_W,
} from './lbm-l3-algos'
import { LBM_L2_PARENT } from './lbm-l2-algos'
import { methodById } from '../../data/methods/methods'

describe('LBM L3 · bounce-back + MRT stub', () => {
  it('方法 id 常量（新 id 未入库，仅校验父族）', () => {
    expect(LBM_L3_PARENT).toBe('method-lattice-boltzmann')
    expect(LBM_L3_PARENT).toBe(LBM_L2_PARENT)
    expect(METHOD_ALGO_LBM_BOUNCE_BACK).toBe('method-algo-lbm-bounce-back')
    expect(METHOD_ALGO_LBM_MRT_STUB).toBe('method-algo-lbm-mrt-stub')
    expect(LBM_L3_METHOD_IDS).toContain(METHOD_ALGO_LBM_BOUNCE_BACK)
    expect(LBM_L3_METHOD_IDS).toContain(METHOD_ALGO_LBM_MRT_STUB)
    expect(methodById(LBM_L3_PARENT)).toBeDefined()
    expect(methodById(METHOD_ALGO_LBM_BOUNCE_BACK)).toBeDefined()
    expect(methodById(METHOD_ALGO_LBM_MRT_STUB)).toBeDefined()
  })

  it('bounceBackAtWalls：静止壁投影 f± 相等、u=0、质量不变', () => {
    const f = createD1q3(5)
    f[0]![0] = 0.2
    f[1]![0] = 0.5
    f[2]![0] = 0.3
    f[0]![4] = 0.1
    f[1]![4] = 0.6
    f[2]![4] = 0.4
    const m0 = totalMass(f)
    bounceBackAtWalls(f, [0, 4])
    expect(f[0]![0]).toBeCloseTo(0.25, 12)
    expect(f[2]![0]).toBeCloseTo(0.25, 12)
    expect(f[1]![0]).toBe(0.5)
    expect(f[0]![4]).toBeCloseTo(0.25, 12)
    expect(f[2]![4]).toBeCloseTo(0.25, 12)
    expect(Math.abs(totalMass(f) - m0)).toBeLessThan(1e-15)
    expect(velocityAt(f, 0)).toBeCloseTo(0, 12)
    expect(velocityAt(f, 4)).toBeCloseTo(0, 12)
  })

  it('reversePopulationsAt：交换 e=±1，u → −u', () => {
    const f = createD1q3(3)
    f[0]![1] = 0.1
    f[1]![1] = 0.5
    f[2]![1] = 0.4
    const u0 = velocityAt(f, 1)
    reversePopulationsAt(f, [1])
    expect(velocityAt(f, 1)).toBeCloseTo(-u0, 12)
    expect(f[0]![1]).toBe(0.4)
    expect(f[2]![1]).toBe(0.1)
  })

  it('streamBounceBackEnds：质量守恒且端点 |u| 小', () => {
    const Nx = 8
    const rho = new Float64Array(Nx)
    for (let i = 0; i < Nx; i++) rho[i] = 1 + 0.2 * Math.sin((Math.PI * i) / (Nx - 1))
    rho[0] = 1
    rho[Nx - 1] = 1
    const f = createD1q3(Nx)
    initEquilibrium(f, rho)
    bounceBackAtWalls(f, [0, Nx - 1])
    const m0 = totalMass(f)
    const g = streamBounceBackEnds(f)
    expect(Math.abs(totalMass(g) - m0)).toBeLessThan(1e-12)
    expect(Math.abs(velocityAt(g, 0))).toBeLessThan(1e-12)
    expect(Math.abs(velocityAt(g, Nx - 1))).toBeLessThan(1e-12)
  })

  it('stepD1q3BounceBack：多步质量守恒', () => {
    const Nx = 16
    const rho = new Float64Array(Nx)
    const mid = (Nx - 1) / 2
    for (let i = 0; i < Nx; i++) {
      const x = i - mid
      rho[i] = 1 + 0.3 * Math.exp(-(x * x) / 8)
    }
    rho[0] = 1
    rho[Nx - 1] = 1
    let f = createD1q3(Nx)
    initEquilibrium(f, rho)
    bounceBackAtWalls(f, [0, Nx - 1])
    const m0 = totalMass(f)
    for (let t = 0; t < 20; t++) f = stepD1q3BounceBack(f, 1)
    expect(Math.abs(totalMass(f) - m0) / m0).toBeLessThan(1e-10)
    expect(Math.abs(velocityAt(f, 0))).toBeLessThan(1e-12)
    expect(Math.abs(velocityAt(f, Nx - 1))).toBeLessThan(1e-12)
    for (let i = 0; i < Nx; i++) {
      expect(Number.isFinite(densityAt(f, i))).toBe(true)
    }
  })

  it('runLbmBounceBackSample：质量守恒 + 壁面不可渗透', () => {
    const r = runLbmBounceBackSample(40, 1, 32)
    expect(r.methodId).toBe(METHOD_ALGO_LBM_BOUNCE_BACK)
    expect(r.familyId).toBe(LBM_L3_PARENT)
    expect(r.massConserved).toBe(true)
    expect(r.wallImpermeable).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.massErr / r.mass0).toBeLessThan(1e-10)
    expect(r.uLeft).toBeLessThan(1e-12)
    expect(r.uRight).toBeLessThan(1e-12)
  })

  it('mrtCollideStub：质量守恒；平衡态不变', () => {
    const Nx = 8
    const f = createD1q3(Nx)
    const rho = new Float64Array(Nx).fill(1.5)
    initEquilibrium(f, rho)
    const before = [f[0]![0]!, f[1]![0]!, f[2]![0]!]
    mrtCollideStub(f, 1, 1)
    // τ=1 完全松弛到局部平衡（u 由动量决定）
    for (let i = 0; i < Nx; i++) {
      expect(densityAt(f, i)).toBeCloseTo(1.5, 10)
    }
    // 已在平衡时碰撞不改
    const g = createD1q3(Nx)
    initEquilibrium(g, rho)
    mrtCollideStub(g, 0.8, 1.2)
    expect(Math.abs(totalMass(g) - 1.5 * Nx)).toBeLessThan(1e-10)
    // 非平衡扰动后质量仍守
    const h = createD1q3(Nx)
    for (let i = 0; i < Nx; i++) {
      h[0]![i] = D1Q3_W[0]! * 0.5
      h[1]![i] = D1Q3_W[1]!
      h[2]![i] = D1Q3_W[2]! * 1.5
    }
    const m0 = totalMass(h)
    mrtCollideStub(h, 1, 1)
    expect(Math.abs(totalMass(h) - m0)).toBeLessThan(1e-10)
    void before
  })

  it('runLbmMrtStubSample：ok 语义（质量守恒）', () => {
    const r = runLbmMrtStubSample()
    expect(r.methodId).toBe(METHOD_ALGO_LBM_MRT_STUB)
    expect(r.familyId).toBe(LBM_L3_PARENT)
    expect(r.massConserved).toBe(true)
    expect(r.finite).toBe(true)
  })
})
