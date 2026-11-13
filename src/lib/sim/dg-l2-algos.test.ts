import { describe, it, expect } from 'vitest'
import {
  METHOD_DG,
  METHOD_ALGO_DG_SLOPE_LIMIT,
  DG_L2_METHOD_IDS,
  minmod,
  minmod3,
  minmodTvb,
  nodalToModal,
  modalToNodal,
  limitModalSlopeP1,
  limitNodalSlopeP1,
  limitModalFieldP1,
  limitNodalFieldP1,
  slopeUnchanged,
  runDgSlopeLimitSample,
} from './dg-l2-algos'

describe('DG L2 · P1 TVB/minmod 斜率限制', () => {
  it('方法 id 常量（新 id 未入库 — 勿 methodById）', () => {
    expect(METHOD_DG).toBe('method-dg')
    expect(METHOD_ALGO_DG_SLOPE_LIMIT).toBe('method-algo-dg-slope-limit')
    expect(DG_L2_METHOD_IDS).toContain(METHOD_ALGO_DG_SLOPE_LIMIT)
  })

  describe('minmod / TVB', () => {
    it('同号取小绝对值，异号为 0', () => {
      expect(minmod(2, 3)).toBe(2)
      expect(minmod(-4, -1)).toBe(-1)
      expect(minmod(2, -3)).toBe(0)
      expect(minmod(0, 5)).toBe(0)
      expect(minmod3(3, 2, 4)).toBe(2)
      expect(minmod3(-3, -1, -4)).toBe(-1)
      expect(minmod3(3, -1, 2)).toBe(0)
    })

    it('TVB：|a|≤M h² 时保留 a，否则 minmod', () => {
      const h = 0.5
      const M = 10
      // M h² = 10 * 0.25 = 2.5
      expect(minmodTvb(1, 0.1, 0.1, M, h)).toBe(1)
      // |a|=3 > 2.5 → minmod(3,1,1)=1
      expect(minmodTvb(3, 1, 1, M, h)).toBe(1)
      // M=0 经典 minmod
      expect(minmodTvb(1, 0.1, 0.1, 0, h)).toBeCloseTo(0.1, 12)
    })
  })

  describe('节点/模态互转', () => {
    it('往返一致', () => {
      const n = { uL: 1, uR: 3 }
      const m = nodalToModal(n)
      expect(m.mean).toBeCloseTo(2, 12)
      expect(m.slope).toBeCloseTo(1, 12)
      const back = modalToNodal(m)
      expect(back.uL).toBeCloseTo(1, 12)
      expect(back.uR).toBeCloseTo(3, 12)
    })
  })

  describe('单单元限制', () => {
    it('光滑线性：斜率 = 邻接均值差 → 不变', () => {
      // ūL=0, ū=1, ūR=2 → ΔL=ΔR=1；û=1
      const r = limitModalSlopeP1({ mean: 1, slope: 1 }, 0, 2)
      expect(r.mean).toBe(1)
      expect(r.slope).toBeCloseTo(1, 12)
      expect(slopeUnchanged(1, r.slope)).toBe(true)
    })

    it('阶跃：过大斜率被压到邻接差', () => {
      // ūL=1, ū=1, ūR=0 → ΔL=0, ΔR=-1；û=2 → minmod(2,0,-1)=0
      const r = limitModalSlopeP1({ mean: 1, slope: 2 }, 1, 0)
      expect(r.slope).toBe(0)
      // ūL=1, ū=0, ūR=0 → ΔL=-1, ΔR=0；û=-2 → 0
      const r2 = limitModalSlopeP1({ mean: 0, slope: -2 }, 1, 0)
      expect(r2.slope).toBe(0)
    })

    it('节点形式与模态一致', () => {
      const nodal = limitNodalSlopeP1({ uL: -1, uR: 3 }, 0, 2)
      // mean=1, slope=2；ΔL=1, ΔR=1 → minmod(2,1,1)=1 → uL=0, uR=2
      expect(nodal.uL).toBeCloseTo(0, 12)
      expect(nodal.uR).toBeCloseTo(2, 12)
    })
  })

  describe('场限制', () => {
    it('全局线性（非周期内部）斜率保持', () => {
      const h = 1
      const a = 0.5
      const n = 8
      const cells = Array.from({ length: n }, (_, i) => ({
        mean: a * (i + 0.5) * h,
        slope: a * (h / 2),
      }))
      const lim = limitModalFieldP1(cells, { M: 0, h, periodic: false })
      for (let i = 1; i < n - 1; i++) {
        expect(lim[i]!.slope).toBeCloseTo(cells[i]!.slope, 12)
        expect(lim[i]!.mean).toBeCloseTo(cells[i]!.mean, 12)
      }
      // 端点斜率清零
      expect(lim[0]!.slope).toBe(0)
      expect(lim[n - 1]!.slope).toBe(0)
    })

    it('节点场限制可调用', () => {
      const cells = [
        { uL: 1, uR: 1 },
        { uL: 1, uR: 0 },
        { uL: 0, uR: 0 },
      ]
      const lim = limitNodalFieldP1(cells, { periodic: false })
      expect(lim).toHaveLength(3)
      expect(Number.isFinite(lim[1]!.uL)).toBe(true)
    })
  })

  describe('样例入口', () => {
    it('runDgSlopeLimitSample：ok，光滑不变、阶跃被限', () => {
      const r = runDgSlopeLimitSample()
      expect(r.methodId).toBe(METHOD_ALGO_DG_SLOPE_LIMIT)
      expect(r.familyId).toBe(METHOD_DG)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.smoothSlopeErr).toBeLessThan(1e-12)
      expect(r.smoothMeanErr).toBeLessThan(1e-12)
      expect(r.stepLimited).toBe(true)
      expect(r.stepBoundOk).toBe(true)
      expect(r.stepMaxAbsSlope).toBeLessThanOrEqual(1 + 1e-12)
    })
  })
})
