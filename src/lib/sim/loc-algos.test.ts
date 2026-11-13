import { describe, it, expect } from 'vitest'
import {
  LOC_GEOMETRY_GROUP,
  LOC_PARENT,
  locChildCount,
  locGeometryParallelCount,
  runTdoaSample,
  runTrilaterationSample,
} from './loc-algos'
import { methodById, parallelGroup } from '../../data/methods/methods'

describe('定位模块化（TDOA ‖ 三角）', () => {
  it('父族下并行几何 2', () => {
    expect(locChildCount()).toBeGreaterThanOrEqual(2)
    expect(locGeometryParallelCount()).toBe(2)
    expect(parallelGroup(LOC_GEOMETRY_GROUP).map((m) => m.id).sort()).toEqual(
      ['method-algo-tdoa-locate', 'method-algo-trilateration'].sort(),
    )
    expect(methodById('method-algo-tdoa-locate')?.parentId).toBe(LOC_PARENT)
  })

  it('三角定位误差小', () => {
    const r = runTrilaterationSample()
    expect(r.err).toBeLessThan(0.05)
  })

  it('TDOA 定位误差小', () => {
    const r = runTdoaSample()
    expect(r.err).toBeLessThan(0.2)
  })
})
