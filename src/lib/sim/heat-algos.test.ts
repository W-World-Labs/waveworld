import { describe, it, expect } from 'vitest'
import {
  HEAT_PARALLEL_GROUP,
  heatParallelCount,
  runErfcProfileSample,
  runHeatFtcsConserve,
} from './heat-algos'
import { methodById, parallelGroup } from '../../data/methods/methods'

describe('热扩散并行求解模块', () => {
  it('FTCS / erfc / 隐式并立于 heat-solver 组', () => {
    expect(heatParallelCount()).toBeGreaterThanOrEqual(3)
    const g = parallelGroup(HEAT_PARALLEL_GROUP)
    const ids = g.map((m) => m.id)
    expect(ids).toContain('method-algo-heat-erfc')
    expect(ids).toContain('method-algo-heat-ftcs-step')
    expect(ids).toContain('method-algo-heat-implicit')
    expect(methodById('method-algo-heat-ftcs-step')?.parentId).toBe('method-heat-ftcs')
  })

  it('FTCS 绝热：总热量近似守恒', () => {
    const r = runHeatFtcsConserve()
    // 浮点累加：绝热 FTCS 应近守恒（相对误差 1e-8 量级）
    expect(Math.abs(r.sumF - r.sum0) / r.sum0).toBeLessThan(1e-7)
  })

  it('erfc 剖面：热侧 > 界面中点 > 冷侧（shipped heatStepSolution）', () => {
    const r = runErfcProfileSample()
    expect(r.Tleft).toBeGreaterThan(r.Tright)
    expect(r.Tmid).toBeGreaterThan(r.Tright)
    expect(r.Tmid).toBeLessThan(r.Tleft)
  })
})
