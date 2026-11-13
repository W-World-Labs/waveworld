import { describe, it, expect } from 'vitest'
import {
  METHOD_DEM,
  METHOD_ALGO_DEM_HERTZ,
  METHOD_ALGO_DEM_LINEAR_SPRING,
  DEM_METHOD_IDS,
  contactOverlap,
  contactOverlap2d,
  linearSpringDashpot1d,
  linearSpringDashpot2d,
  hertzNormal1d,
  hertzNormal2d,
  linearSpringPotential,
  hertzPotential,
  demHeadOnStepLinear,
  demHeadOnStepHertz,
  demHeadOnIntegrateLinear,
  runDemLinearSpringSample,
  runDemHertzSample,
  type DemParticle1d,
} from './dem-algos'

describe('DEM · 法向接触（线性弹簧-阻尼 + 简化 Hertz）', () => {
  it('方法 id 常量（全未入库新 id — 勿 methodById）', () => {
    expect(METHOD_DEM).toBe('method-dem')
    expect(METHOD_ALGO_DEM_HERTZ).toBe('method-algo-dem-hertz')
    expect(METHOD_ALGO_DEM_LINEAR_SPRING).toBe('method-algo-dem-linear-spring')
    expect(DEM_METHOD_IDS).toContain(METHOD_ALGO_DEM_HERTZ)
    expect(DEM_METHOD_IDS).toContain(METHOD_ALGO_DEM_LINEAR_SPRING)
    // 父族/子 id 均未入库 — 勿 methodById(METHOD_DEM) 等
  })

  describe('重叠与零力（分离）', () => {
    it('contactOverlap：分离 δ≤0，重叠 δ>0', () => {
      expect(contactOverlap(0, 2, 0.5, 0.5)).toBeLessThanOrEqual(0)
      expect(contactOverlap(0, 0.8, 0.5, 0.5)).toBeCloseTo(0.2, 12)
    })

    it('分离：线性弹簧-阻尼力为 0', () => {
      const r = linearSpringDashpot1d(0, 3, 1, -1, 0.5, 0.5, 100, 1)
      expect(r.active).toBe(false)
      expect(r.Fi).toBe(0)
      expect(r.delta).toBeLessThanOrEqual(0)
    })

    it('分离：Hertz 力为 0', () => {
      const r = hertzNormal1d(0, 3, 0.5, 0.5, 200)
      expect(r.active).toBe(false)
      expect(r.Fi).toBe(0)
    })

    it('2D 分离：两模型力为零', () => {
      const pi = { x: 0, y: 0 }
      const pj = { x: 5, y: 0 }
      const vi = { x: 1, y: 0 }
      const vj = { x: -1, y: 0 }
      const ls = linearSpringDashpot2d(pi, pj, vi, vj, 1, 1, 50, 1)
      const hz = hertzNormal2d(pi, pj, 1, 1, 50)
      expect(ls.active).toBe(false)
      expect(ls.Fi.x).toBe(0)
      expect(ls.Fi.y).toBe(0)
      expect(hz.active).toBe(false)
      expect(hz.Fi.x).toBe(0)
      expect(contactOverlap2d(pi, pj, 1, 1)).toBeLessThan(0)
    })
  })

  describe('力随重叠增大', () => {
    it('线性弹簧：静接触 |F| = kδ 且随 δ 增大', () => {
      // i 在左、j 在右；重叠时 F_i 向左（负）— 排斥
      const r1 = linearSpringDashpot1d(0, 0.9, 0, 0, 0.5, 0.5, 100, 0)
      const r2 = linearSpringDashpot1d(0, 0.8, 0, 0, 0.5, 0.5, 100, 0)
      expect(r1.active).toBe(true)
      expect(r2.active).toBe(true)
      expect(r1.delta).toBeCloseTo(0.1, 12)
      expect(r2.delta).toBeCloseTo(0.2, 12)
      expect(Math.abs(r1.Fi)).toBeCloseTo(100 * 0.1, 10)
      expect(Math.abs(r2.Fi)).toBeGreaterThan(Math.abs(r1.Fi))
      // i 在左侧被向左推（远离 j）
      expect(r1.Fi).toBeLessThan(0)
    })

    it('Hertz：|F| = k_h δ^{1.5} 且随 δ 增大', () => {
      const kh = 80
      const r1 = hertzNormal1d(0, 0.95, 0.5, 0.5, kh)
      const r2 = hertzNormal1d(0, 0.9, 0.5, 0.5, kh)
      expect(r1.delta).toBeCloseTo(0.05, 12)
      expect(r2.delta).toBeCloseTo(0.1, 12)
      expect(Math.abs(r1.Fi)).toBeCloseTo(kh * Math.pow(0.05, 1.5), 10)
      expect(Math.abs(r2.Fi)).toBeGreaterThan(Math.abs(r1.Fi))
    })

    it('2D 线性：重叠越大 |F| 越大', () => {
      const vi = { x: 0, y: 0 }
      const vj = { x: 0, y: 0 }
      const f1 = linearSpringDashpot2d(
        { x: 0, y: 0 },
        { x: 0.95, y: 0 },
        vi,
        vj,
        0.5,
        0.5,
        40,
        0,
      )
      const f2 = linearSpringDashpot2d(
        { x: 0, y: 0 },
        { x: 0.85, y: 0 },
        vi,
        vj,
        0.5,
        0.5,
        40,
        0,
      )
      const m1 = Math.hypot(f1.Fi.x, f1.Fi.y)
      const m2 = Math.hypot(f2.Fi.x, f2.Fi.y)
      expect(m2).toBeGreaterThan(m1)
      expect(m1).toBeGreaterThan(0)
    })
  })

  describe('对心碰撞步进', () => {
    it('半隐式一步：接触时速度变化', () => {
      const a: DemParticle1d = { x: 0, v: 0.2, r: 0.5, m: 1 }
      const b: DemParticle1d = { x: 0.9, v: -0.2, r: 0.5, m: 1 }
      const r = demHeadOnStepLinear(a, b, 100, 0, 1e-3)
      expect(r.active).toBe(true)
      expect(r.a.v).not.toBeCloseTo(a.v, 10)
      expect(r.b.v).not.toBeCloseTo(b.v, 10)
    })

    it('γ=0：机械能近似守恒', () => {
      const a0: DemParticle1d = { x: 0, v: 0.5, r: 0.5, m: 1 }
      const b0: DemParticle1d = { x: 1.2, v: -0.5, r: 0.5, m: 1 }
      const r = demHeadOnIntegrateLinear(a0, b0, 200, 0, 2e-4, 10_000)
      expect(r.finite).toBe(true)
      expect(r.maxDelta).toBeGreaterThan(0)
      const rel = Math.abs(r.eF - r.e0) / Math.max(Math.abs(r.e0), 1e-30)
      expect(rel).toBeLessThan(0.05)
    })

    it('γ>0：机械能耗散', () => {
      const a0: DemParticle1d = { x: 0, v: 0.5, r: 0.5, m: 1 }
      const b0: DemParticle1d = { x: 1.2, v: -0.5, r: 0.5, m: 1 }
      const soft = demHeadOnIntegrateLinear(a0, b0, 200, 0, 2e-4, 10_000)
      const damp = demHeadOnIntegrateLinear(a0, b0, 200, 3, 2e-4, 10_000)
      expect(damp.finite).toBe(true)
      expect(damp.eF).toBeLessThan(damp.e0)
      expect(damp.eF).toBeLessThan(soft.eF)
    })

    it('Hertz 一步：接触激活', () => {
      const a: DemParticle1d = { x: 0, v: 0.1, r: 0.5, m: 1 }
      const b: DemParticle1d = { x: 0.92, v: -0.1, r: 0.5, m: 1 }
      const r = demHeadOnStepHertz(a, b, 150, 1e-3)
      expect(r.active).toBe(true)
      expect(r.delta).toBeGreaterThan(0)
    })

    it('势能与力一致（线性 ½kδ²，Hertz 2/5 k δ^{5/2}）', () => {
      expect(linearSpringPotential(0.2, 50)).toBeCloseTo(0.5 * 50 * 0.04, 12)
      expect(linearSpringPotential(-0.1, 50)).toBe(0)
      expect(hertzPotential(0.1, 80)).toBeCloseTo(
        (2 / 5) * 80 * Math.pow(0.1, 2.5),
        12,
      )
    })
  })

  describe('样例入口', () => {
    it('runDemLinearSpringSample：ok 且 methodId/familyId 对齐', () => {
      const r = runDemLinearSpringSample()
      expect(r.methodId).toBe(METHOD_ALGO_DEM_LINEAR_SPRING)
      expect(r.familyId).toBe(METHOD_DEM)
      expect(r.finite).toBe(true)
      expect(r.ok).toBe(true)
      expect(r.maxDelta).toBeGreaterThan(0)
      expect(r.eRelErr).toBeLessThan(0.05)
    })

    it('runDemHertzSample：ok 且力随重叠增大', () => {
      const r = runDemHertzSample()
      expect(r.methodId).toBe(METHOD_ALGO_DEM_HERTZ)
      expect(r.familyId).toBe(METHOD_DEM)
      expect(r.finite).toBe(true)
      expect(r.ok).toBe(true)
      expect(r.forceLarge).toBeGreaterThan(r.forceSmall)
      expect(r.maxDelta).toBeGreaterThan(0)
      expect(r.eRelErr).toBeLessThan(0.08)
    })
  })
})
