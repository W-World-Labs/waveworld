import { describe, it, expect } from 'vitest'
import {
  ARRAY_LINK_GROUP,
  ARRAY_PARENT,
  arrayChildCount,
  arrayLinkParallelCount,
  runArrayFactorSample,
  runBeamwidthSample,
  runFriisSample,
  runGratingSample,
  runPatternSample,
} from './array-algos'
import { methodById, parallelGroup } from '../../data/methods/methods'

describe('相控阵 / 链路 模块化', () => {
  it('父族下子模块 ≥3，并行组 array-link-view', () => {
    expect(arrayChildCount()).toBeGreaterThanOrEqual(3)
    expect(methodById('method-algo-array-factor')?.parentId).toBe(ARRAY_PARENT)
    expect(arrayLinkParallelCount()).toBe(2)
    expect(parallelGroup(ARRAY_LINK_GROUP).length).toBe(2)
  })

  it('阵列因子：指向峰 ≈1，偏轴更小', () => {
    const r = runArrayFactorSample()
    expect(r.peak).toBeCloseTo(1, 5)
    expect(r.offAxis).toBeLessThan(r.peak)
  })

  it('波束宽随 N 收窄', () => {
    const r = runBeamwidthSample()
    expect(r.bw16).toBeLessThan(r.bw8)
    expect(r.bw8).toBeGreaterThan(0)
  })

  it('栅瓣：d/λ=0.5 无，1.2 有', () => {
    const r = runGratingSample()
    expect(r.lobesHalf.length).toBe(0)
    expect(r.lobesWide.length).toBeGreaterThan(0)
  })

  it('Friis：距离加倍路径损耗 +6dB 量级', () => {
    const r = runFriisSample()
    expect(r.fspl2 - r.fspl1).toBeCloseTo(6, 0)
    expect(r.dPr).toBeCloseTo(6, 0)
  })

  it('方向图采样有效', () => {
    const r = runPatternSample()
    expect(r.n).toBe(181)
    expect(r.maxG).toBeCloseTo(1, 5)
  })
})
