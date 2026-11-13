import { describe, it, expect } from 'vitest'
import {
  FLUID_CHILD_IDS,
  FLUID_PARENT,
  fluidChildCount,
  runAdvectSample,
  runDiffuseSample,
  runProjectSample,
} from './fluid-algos'
import { methodById } from '../../data/methods/methods'

describe('Stable Fluids 方法族模块化', () => {
  it('父族下扩散/平流/投影/管线', () => {
    expect(fluidChildCount()).toBeGreaterThanOrEqual(4)
    for (const id of FLUID_CHILD_IDS) {
      expect(methodById(id)?.parentId).toBe(FLUID_PARENT)
    }
  })

  it('投影：平均散度大幅下降（趋于无散）', () => {
    const r = runProjectSample()
    expect(r.div0).toBeGreaterThan(0.01)
    expect(r.divF).toBeLessThan(r.div0 * 0.25)
  })

  it('平流：染料总量近似守恒', () => {
    const r = runAdvectSample()
    expect(Math.abs(r.sumF - r.sum0) / r.sum0).toBeLessThan(0.15)
  })

  it('扩散：峰值下降、总量近守恒', () => {
    const r = runDiffuseSample()
    expect(r.peakF).toBeLessThan(r.peak0)
    expect(r.sumRatio).toBeGreaterThan(0.85)
    expect(r.sumRatio).toBeLessThan(1.15)
  })
})
