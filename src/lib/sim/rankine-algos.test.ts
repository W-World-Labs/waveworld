import { describe, it, expect } from 'vitest'
import {
  METHOD_RANKINE,
  METHOD_ALGO_RANKINE_ETA,
  RANKINE_METHOD_IDS,
  rankineIdealEta,
  rankineSuperheatTh,
  rankineEtaWithSuperheat,
  runRankineEtaSample,
} from './rankine-algos'

describe('朗肯 · 理想热效率教学 stub', () => {
  it('方法 id 常量字符串（新 id 未入库，仅字符串相等）', () => {
    expect(METHOD_RANKINE).toBe('method-rankine')
    expect(METHOD_ALGO_RANKINE_ETA).toBe('method-algo-rankine-eta')
    expect(RANKINE_METHOD_IDS).toContain(METHOD_ALGO_RANKINE_ETA)
  })

  describe('rankineIdealEta', () => {
    it('η = 1 − T_c/T_h', () => {
      expect(rankineIdealEta(600, 300)).toBeCloseTo(0.5, 14)
      expect(rankineIdealEta(800, 300)).toBeCloseTo(1 - 300 / 800, 14)
    })

    it('T_h↑ → η↑；T_c↑ → η↓', () => {
      expect(rankineIdealEta(900, 300)).toBeGreaterThan(rankineIdealEta(800, 300))
      expect(rankineIdealEta(800, 350)).toBeLessThan(rankineIdealEta(800, 300))
    })

    it('非法：T_h≤T_c 或非正 → NaN', () => {
      expect(Number.isNaN(rankineIdealEta(300, 300))).toBe(true)
      expect(Number.isNaN(rankineIdealEta(200, 300))).toBe(true)
      expect(Number.isNaN(rankineIdealEta(0, 300))).toBe(true)
      expect(Number.isNaN(rankineIdealEta(800, -1))).toBe(true)
    })
  })

  describe('superheat', () => {
    it('T_h_eff = T_h (1+s)；s=0 退化为理想', () => {
      expect(rankineSuperheatTh(800, 0.1)).toBeCloseTo(880, 12)
      expect(rankineEtaWithSuperheat(800, 300, 0)).toBeCloseTo(
        rankineIdealEta(800, 300),
        14,
      )
    })

    it('过热抬升效率', () => {
      const base = rankineIdealEta(800, 300)
      const superE = rankineEtaWithSuperheat(800, 300, 0.2)
      expect(superE).toBeGreaterThan(base)
      expect(superE).toBeCloseTo(1 - 300 / (800 * 1.2), 14)
    })

    it('负过热因子 → NaN', () => {
      expect(Number.isNaN(rankineSuperheatTh(800, -0.1))).toBe(true)
      expect(Number.isNaN(rankineEtaWithSuperheat(800, 300, -0.1))).toBe(true)
    })
  })

  describe('样例入口', () => {
    it('runRankineEtaSample：ok 且 methodId/familyId 对齐', () => {
      const r = runRankineEtaSample()
      expect(r.methodId).toBe(METHOD_ALGO_RANKINE_ETA)
      expect(r.familyId).toBe(METHOD_RANKINE)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.etaIdeal).toBeCloseTo(1 - r.T_c / r.T_h, 14)
      expect(r.etaSuper).toBeGreaterThan(r.etaIdeal)
      expect(r.etaSuper).toBeLessThan(1)
      expect(Number.isFinite(r.etaEqualT)).toBe(false)
    })

    it('自定义温区仍 ok', () => {
      const r = runRankineEtaSample({ T_h: 1000, T_c: 280, superheatFactor: 0.05 })
      expect(r.ok).toBe(true)
      expect(r.etaIdeal).toBeCloseTo(1 - 280 / 1000, 14)
    })
  })
})
