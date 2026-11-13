import { describe, it, expect } from 'vitest'
import { US_PARENT, runAlineSample, runReflectionSample, usChildCount } from './us-algos'
import { methodById } from '../../data/methods/methods'

describe('超声 B 超模块化', () => {
  it('父族下有反射 + A 线', () => {
    expect(usChildCount()).toBeGreaterThanOrEqual(2)
    expect(methodById('method-algo-us-reflection')?.parentId).toBe(US_PARENT)
    expect(methodById('method-algo-us-aline')?.parentId).toBe(US_PARENT)
  })

  it('反射系数：匹配 0，硬界面更大', () => {
    const r = runReflectionSample()
    expect(r.match).toBe(0)
    expect(Math.abs(r.hard)).toBeGreaterThan(Math.abs(r.soft))
  })

  it('A 线：近峰强于远峰（衰减）', () => {
    const r = runAlineSample()
    expect(r.peaks).toBeGreaterThanOrEqual(2)
    expect(r.ampNear).toBeGreaterThan(r.ampFar)
  })
})
