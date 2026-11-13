import { describe, it, expect } from 'vitest'
import {
  NLJD_L2_CLASSIFY_ID,
  NLJD_L2_METHOD_IDS,
  NLJD_L2_PARENT,
  NLJD_L2_POLY_ID,
  NLJD_L2_TARGET_KINDS_ID,
  NLJD_TARGET_KINDS,
  analyzeTarget,
  runAllTargetsSample,
} from './nljd-l2-algos'
import { junctionCoefficients } from './nljd'

describe('NLJD L2 · 三类目标种类判读', () => {
  it('方法 id 常量对齐（target-kinds 为未入库新 id）', () => {
    expect(NLJD_L2_PARENT).toBe('method-nljd')
    expect(NLJD_L2_POLY_ID).toBe('method-algo-nljd-poly')
    expect(NLJD_L2_CLASSIFY_ID).toBe('method-algo-nljd-classify')
    expect(NLJD_L2_TARGET_KINDS_ID).toBe('method-algo-nljd-target-kinds')
    expect(NLJD_L2_METHOD_IDS).toContain(NLJD_L2_TARGET_KINDS_ID)
    expect(NLJD_TARGET_KINDS).toHaveLength(3)
  })

  it('analyzeTarget 委托 junctionCoefficients', () => {
    for (const kind of NLJD_TARGET_KINDS) {
      const r = analyzeTarget(kind)
      const c = junctionCoefficients(kind)
      expect(r.a2).toBe(c.a2)
      expect(r.a3).toBe(c.a3)
      expect(r.ok).toBe(true)
    }
  })

  it('runAllTargetsSample：三类全部 classify 正确', () => {
    const r = runAllTargetsSample()
    expect(r.methodId).toBe(NLJD_L2_TARGET_KINDS_ID)
    expect(r.allOk).toBe(true)
    expect(r.semi).toBe('semiconductor')
    expect(r.corrosion).toBe('corrosion')
    expect(r.metal).toBe('metal')
    expect(r.results).toHaveLength(3)
    for (const row of r.results) {
      expect(row.classified).toBe(row.kind)
      expect(row.ok).toBe(true)
    }
  })
})
