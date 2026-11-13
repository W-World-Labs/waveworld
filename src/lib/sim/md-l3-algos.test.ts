import { describe, it, expect } from 'vitest'
import {
  MD_L3_PARENT,
  METHOD_ALGO_NOSE_HOOVER,
  METHOD_ALGO_CELL_LIST,
  MD_L3_METHOD_IDS,
  noseHooverStep,
  noseHooverIntegrate,
  runNoseHooverSample,
  minImage1D,
  buildCellList,
  countPairsWithin,
  countPairsBruteForce,
  runCellListSample,
} from './md-l3-algos'
import { MD_L2_PARENT } from './md-l2-algos'
import { methodById } from '../../data/methods/methods'

describe('MD L3 · Nose–Hoover + 元胞链表', () => {
  it('方法 id 常量（新 id 未入库，仅校验父族）', () => {
    expect(MD_L3_PARENT).toBe('method-md-lj')
    expect(MD_L3_PARENT).toBe(MD_L2_PARENT)
    expect(METHOD_ALGO_NOSE_HOOVER).toBe('method-algo-nose-hoover')
    expect(METHOD_ALGO_CELL_LIST).toBe('method-algo-cell-list')
    expect(MD_L3_METHOD_IDS).toContain(METHOD_ALGO_NOSE_HOOVER)
    expect(MD_L3_METHOD_IDS).toContain(METHOD_ALGO_CELL_LIST)
    // 父族已在目录；子 id 尚未入库 — 勿 methodById 新 id
    expect(methodById(MD_L3_PARENT)).toBeDefined()
  })

  describe('Nose–Hoover 1D 谐振子', () => {
    it('noseHooverStep：有限且改变状态', () => {
      const s0 = { x: 1, v: 0.5, xi: 0 }
      const s1 = noseHooverStep(s0, 0.01, 1, 1, 1)
      expect(Number.isFinite(s1.x)).toBe(true)
      expect(Number.isFinite(s1.v)).toBe(true)
      expect(Number.isFinite(s1.xi)).toBe(true)
      // 有力/速度 ⇒ 位置或速度应变化
      expect(Math.abs(s1.x - s0.x) + Math.abs(s1.v - s0.v)).toBeGreaterThan(0)
    })

    it('高动能时 dξ/dt > 0：摩擦应增大', () => {
      // v² = 4 > T=1 ⇒ ξ 上升（算子分裂首末半步更新 ξ）
      const s0 = { x: 0, v: 2, xi: 0 }
      const s1 = noseHooverStep(s0, 0.01, 1, 1, 1)
      expect(s1.xi).toBeGreaterThan(s0.xi)
    })

    it('低动能时 dξ/dt < 0：摩擦应减小', () => {
      const s0 = { x: 0, v: 0.1, xi: 0 }
      const s1 = noseHooverStep(s0, 0.01, 1, 1, 1)
      expect(s1.xi).toBeLessThan(s0.xi)
    })

    it('长积分：后半程 ⟨v²⟩ 靠近 T_target（宽松）', () => {
      const Ttarget = 1
      // 初动能贴近目标，降低非遍历偏差
      const r = noseHooverIntegrate(
        { x: 0.5, v: Math.sqrt(Ttarget), xi: 0 },
        40_000,
        0.002,
        1,
        Ttarget,
        0.5,
      )
      expect(r.finite).toBe(true)
      expect(Math.abs(r.meanV2 - Ttarget) / Ttarget).toBeLessThan(0.45)
    })

    it('runNoseHooverSample：ok 且 methodId/familyId 对齐', () => {
      const r = runNoseHooverSample()
      expect(r.methodId).toBe(METHOD_ALGO_NOSE_HOOVER)
      expect(r.familyId).toBe(MD_L3_PARENT)
      expect(r.finite).toBe(true)
      expect(r.ok).toBe(true)
      expect(r.relErr).toBeLessThan(0.4)
      expect(Number.isFinite(r.meanV2)).toBe(true)
      expect(r.meanV2).toBeGreaterThan(0)
    })
  })

  describe('1D 元胞链表', () => {
    it('minImage1D：周期最小镜像', () => {
      expect(minImage1D(0.1, 10)).toBeCloseTo(0.1, 12)
      expect(minImage1D(9.5, 10)).toBeCloseTo(-0.5, 12)
      expect(minImage1D(-9.5, 10)).toBeCloseTo(0.5, 12)
    })

    it('buildCellList：邻居在 rCut 内且互逆', () => {
      const L = 10
      const rCut = 1.2
      // 0—1 近邻，2 远离
      const pos = new Float64Array([0.5, 1.0, 5.0])
      const lists = buildCellList(pos, L, rCut)
      expect(lists[0]).toContain(1)
      expect(lists[1]).toContain(0)
      expect(lists[0]).not.toContain(2)
      expect(lists[2]!.length).toBe(0)
    })

    it('周期边界：盒端粒子互为邻居', () => {
      const L = 10
      const rCut = 1.0
      const pos = new Float64Array([0.2, 9.5])
      // min image |0.2−9.5| = 0.7 ≤ 1
      const lists = buildCellList(pos, L, rCut)
      expect(lists[0]).toContain(1)
      expect(lists[1]).toContain(0)
      expect(countPairsWithin(pos, L, rCut)).toBe(1)
      expect(countPairsBruteForce(pos, L, rCut)).toBe(1)
    })

    it('countPairsWithin ≡ 暴力（多构型）', () => {
      const cases: { pos: Float64Array; L: number; rCut: number }[] = [
        { pos: new Float64Array([0, 0.5, 1.1, 3]), L: 8, rCut: 1 },
        { pos: new Float64Array([0.1, 7.9, 4, 4.5, 4.6]), L: 8, rCut: 0.8 },
        { pos: new Float64Array([1, 2, 3, 4, 5]), L: 6, rCut: 1.5 },
      ]
      for (const c of cases) {
        expect(countPairsWithin(c.pos, c.L, c.rCut)).toBe(
          countPairsBruteForce(c.pos, c.L, c.rCut),
        )
      }
    })

    it('空/单粒子：0 对', () => {
      expect(countPairsWithin(new Float64Array(0), 5, 1)).toBe(0)
      expect(countPairsWithin(new Float64Array([1.2]), 5, 1)).toBe(0)
      expect(buildCellList(new Float64Array([1.2]), 5, 1)[0]!.length).toBe(0)
    })

    it('runCellListSample：与暴力一致且 ok', () => {
      const r = runCellListSample()
      expect(r.methodId).toBe(METHOD_ALGO_CELL_LIST)
      expect(r.familyId).toBe(MD_L3_PARENT)
      expect(r.match).toBe(true)
      expect(r.ok).toBe(true)
      expect(r.pairsCell).toBe(r.pairsBrute)
      expect(r.pairsCell).toBeGreaterThanOrEqual(0)
    })
  })
})
