import { describe, it, expect } from 'vitest'
import {
  SPM_MODALITY_GROUP,
  SPM_PARENT,
  runAfmForceSample,
  runAfmScanSample,
  runConstCurrentSample,
  runConstHeightSample,
  runTunnelSample,
  spmChildCount,
  spmModalityParallelCount,
} from './spm-algos'
import { methodById, parallelGroup } from '../../data/methods/methods'

describe('SPM 模块化（STM ‖ AFM）', () => {
  it('父族下子模块 ≥4，模态并行 2', () => {
    expect(spmChildCount()).toBeGreaterThanOrEqual(4)
    expect(spmModalityParallelCount()).toBe(2)
    expect(parallelGroup(SPM_MODALITY_GROUP).map((m) => m.id).sort()).toEqual(
      ['method-algo-afm-lj', 'method-algo-stm-tunnel'].sort(),
    )
    expect(methodById('method-algo-stm-tunnel')?.parentId).toBe(SPM_PARENT)
  })

  it('隧穿：远距电流更小', () => {
    const r = runTunnelSample()
    expect(r.Iclose).toBeGreaterThan(r.Ifar)
    expect(r.Ifar).toBeGreaterThan(0)
  })

  it('恒高：表面台阶产生电流对比', () => {
    const r = runConstHeightSample()
    expect(r.contrast).toBeGreaterThan(1.5)
  })

  it('恒流：针高跟踪表面', () => {
    const r = runConstCurrentSample()
    expect(r.trackErr).toBeLessThan(1e-10)
  })

  it('AFM：近距排斥，势阱附近力小', () => {
    const r = runAfmForceSample()
    expect(r.fNear).toBeGreaterThan(0)
    expect(Math.abs(r.fMin)).toBeLessThan(0.2)
  })

  it('AFM 扫描线长度正确', () => {
    const r = runAfmScanSample()
    expect(r.n).toBe(5)
    expect(r.maxDefl).toBeGreaterThan(0)
  })
})
