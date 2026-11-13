import { describe, it, expect } from 'vitest'
import {
  METHOD_DEM,
  METHOD_ALGO_DEM_COULOMB,
  DEM_L2_METHOD_IDS,
  DEM_L2_PARENT,
  coulombFriction,
  tangentialTrialForce,
  decomposeContact2d,
  demContactCoulomb2d,
  stickSlipStep,
  stickSlipIntegrate,
  demPairTangentialStep,
  runDemCoulombSample,
} from './dem-l2-algos'

describe('DEM L2 · 库仑切向摩擦', () => {
  it('方法 id 常量（新 id 未入库 — 勿 methodById）', () => {
    expect(METHOD_DEM).toBe('method-dem')
    expect(DEM_L2_PARENT).toBe(METHOD_DEM)
    expect(METHOD_ALGO_DEM_COULOMB).toBe('method-algo-dem-coulomb')
    expect(DEM_L2_METHOD_IDS).toContain(METHOD_ALGO_DEM_COULOMB)
  })

  describe('coulombFriction 投影', () => {
    it('stick：|FtTrial| ≤ μ Fn 保留试探力', () => {
      const r = coulombFriction(0.2, 1, 0.5)
      expect(r.stick).toBe(true)
      expect(r.Ft).toBeCloseTo(0.2, 12)
      expect(r.limit).toBeCloseTo(0.5, 12)
    })

    it('slip：截断到 μ Fn', () => {
      const r = coulombFriction(2, 1, 0.3)
      expect(r.stick).toBe(false)
      expect(r.Ft).toBeCloseTo(0.3, 12)
      expect(Math.abs(r.Ft)).toBeLessThanOrEqual(0.3 + 1e-15)
    })

    it('负试探力 slip 保留符号', () => {
      const r = coulombFriction(-5, 2, 0.4)
      expect(r.stick).toBe(false)
      expect(r.Ft).toBeCloseTo(-0.8, 12)
    })

    it('Fn≤0 或 μ=0 → Ft=0', () => {
      expect(coulombFriction(1, 0, 0.5).Ft).toBe(0)
      expect(coulombFriction(1, -1, 0.5).Ft).toBe(0)
      expect(coulombFriction(1, 2, 0).Ft).toBe(0)
    })
  })

  describe('切向试探与 2D 分解', () => {
    it('tangentialTrialForce：−kt ut − γ vt', () => {
      expect(tangentialTrialForce(0.1, 0.2, 10, 1)).toBeCloseTo(-1 - 0.2, 12)
    })

    it('decomposeContact2d：对心相对速度只有 vn', () => {
      const d = decomposeContact2d(
        { x: 1, y: 0 },
        { x: 0, y: 0 },
        { x: -0.5, y: 0 },
        { x: 0.5, y: 0 },
      )
      expect(d.active).toBe(true)
      expect(d.nx).toBeCloseTo(1, 12)
      expect(d.vn).toBeCloseTo(-1, 12)
      expect(Math.abs(d.vt)).toBeLessThan(1e-12)
    })

    it('demContactCoulomb2d：分离无接触', () => {
      const r = demContactCoulomb2d(
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        0.5,
        0.5,
        100,
        0,
        50,
        0,
        0.4,
        0,
        1e-3,
      )
      expect(r.active).toBe(false)
      expect(r.Ft).toBe(0)
    })

    it('demContactCoulomb2d：接触 |Ft| ≤ μ Fn', () => {
      const r = demContactCoulomb2d(
        { x: 0, y: 0 },
        { x: 0.9, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
        0.5,
        0.5,
        200,
        0,
        80,
        0,
        0.3,
        0.05,
        1e-3,
      )
      expect(r.active).toBe(true)
      expect(r.Fn).toBeGreaterThan(0)
      expect(Math.abs(r.Ft)).toBeLessThanOrEqual(0.3 * r.Fn + 1e-9)
    })
  })

  describe('stick–slip 玩具', () => {
    it('静摩擦内保持 stick', () => {
      let st = { x: 0, v: 0, t: 0, stick: true, lastSlipDrive: 0 }
      // 极慢驱动、大 μ：短时间仍 stick
      st = stickSlipStep({
        state: st,
        Fn: 10,
        mu: 1,
        kDrive: 1,
        vDrive: 0.001,
        m: 1,
        dt: 1e-3,
      })
      expect(st.stick).toBe(true)
      expect(st.v).toBe(0)
    })

    it('积分：出现 slip 事件且 max|Ft| ≲ μ Fn', () => {
      const r = stickSlipIntegrate({
        Fn: 1,
        mu: 0.4,
        kDrive: 30,
        vDrive: 0.05,
        m: 1,
        dt: 1e-3,
        steps: 5000,
      })
      expect(r.finite).toBe(true)
      expect(r.slipEvents).toBeGreaterThanOrEqual(1)
      expect(r.maxAbsFt).toBeLessThanOrEqual(0.4 * 1 * 1.05 + 1e-9)
    })
  })

  describe('双粒子切向', () => {
    it('接触步进 |Ft|/Fn ≤ μ', () => {
      let a = { x: 0, v: 0, r: 0.5, m: 1, y: 0, vy: 0.4 }
      let b = { x: 0.92, v: 0, r: 0.5, m: 1, y: 0, vy: -0.2 }
      let ut = 0
      const mu = 0.25
      let maxRatio = 0
      for (let s = 0; s < 200; s++) {
        const r = demPairTangentialStep(a, b, 150, 0.2, 40, mu, ut, 5e-4)
        a = r.a
        b = r.b
        ut = r.utNew
        if (r.active && r.Fn > 1e-9) {
          maxRatio = Math.max(maxRatio, Math.abs(r.Ft) / r.Fn)
        }
      }
      expect(maxRatio).toBeLessThanOrEqual(mu + 1e-6)
    })
  })

  describe('样例入口', () => {
    it('runDemCoulombSample：ok 且 methodId/familyId', () => {
      const r = runDemCoulombSample()
      expect(r.methodId).toBe(METHOD_ALGO_DEM_COULOMB)
      expect(r.familyId).toBe(METHOD_DEM)
      expect(r.finite).toBe(true)
      expect(r.ok).toBe(true)
      expect(r.stickOk).toBe(true)
      expect(r.slipOk).toBe(true)
      expect(r.slipEvents).toBeGreaterThanOrEqual(1)
      expect(r.pairMaxRatio).toBeLessThanOrEqual(r.mu + 0.05)
    })
  })
})
