import { describe, it, expect } from 'vitest'
import {
  NLJD_PARENT,
  nljdChildCount,
  runClassifySample,
  runHarmonicRatioSample,
  runPolySample,
} from './nljd-algos'
import { methodById } from '../../data/methods/methods'

describe('NLJD 模块化', () => {
  it('父族下多项式 + 分类', () => {
    expect(nljdChildCount()).toBeGreaterThanOrEqual(2)
    expect(methodById('method-algo-nljd-poly')?.parentId).toBe(NLJD_PARENT)
    expect(methodById('method-algo-nljd-classify')?.parentId).toBe(NLJD_PARENT)
  })

  it('Shockley 结响应有限且参数为真实饱和电流', () => {
    const r = runPolySample()
    expect(Number.isFinite(r.y)).toBe(true)
    // a2 = Is（饱和电流），半导体结典型值在 nA~µA 量级，而非编造的多项式系数。
    expect(r.a2).toBeGreaterThan(0)
    expect(r.a2).toBeLessThan(1e-3)
  })

  it('三类结分类正确', () => {
    const r = runClassifySample()
    expect(r.semi).toBe('semiconductor')
    expect(r.corrosion).toBe('corrosion')
    expect(r.metal).toBe('metal')
  })

  it('半导体 2f 占优，锈蚀 3f 相对更强', () => {
    const r = runHarmonicRatioSample()
    expect(r.semiF2).toBeGreaterThan(r.semiF3)
    expect(r.corrF3 / (r.corrF2 + 1e-12)).toBeGreaterThan(r.semiF3 / (r.semiF2 + 1e-12))
  })
})
