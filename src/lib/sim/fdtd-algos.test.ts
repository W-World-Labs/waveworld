import { describe, it, expect } from 'vitest'
import {
  FDTD_BND_GROUP,
  FDTD_CHILD_IDS,
  FDTD_PARENT,
  fdtdBoundaryParallelCount,
  fdtdChildCount,
  runBoundaryParallel,
  runFresnelSample,
  runSourceSample,
  runYeeUpdateSample,
} from './fdtd-algos'
import { methodById, parallelGroup } from '../../data/methods/methods'

describe('FDTD 方法族模块化', () => {
  it('父族下有 Yee/源/边界子模块', () => {
    expect(fdtdChildCount()).toBeGreaterThanOrEqual(4)
    for (const id of FDTD_CHILD_IDS) {
      expect(methodById(id)?.parentId).toBe(FDTD_PARENT)
    }
  })

  it('边界并行组 Mur ‖ PEC', () => {
    expect(fdtdBoundaryParallelCount()).toBe(2)
    expect(parallelGroup(FDTD_BND_GROUP).map((m) => m.id).sort()).toEqual(
      ['method-algo-fdtd-bnd-mur', 'method-algo-fdtd-bnd-pec'].sort(),
    )
  })

  it('Yee 更新：能量有限', () => {
    const r = runYeeUpdateSample(30)
    expect(r.finite).toBe(true)
    expect(r.Ef).toBeGreaterThan(0)
  })

  it('软源：注入后能量上升', () => {
    const r = runSourceSample()
    expect(r.after).toBeGreaterThan(r.before)
  })

  it('Mur vs PEC 并行：能量轨迹可区分', () => {
    const r = runBoundaryParallel(60)
    expect(Number.isFinite(r.murE)).toBe(true)
    expect(Number.isFinite(r.pecE)).toBe(true)
    // 开放边界应比腔反射耗散/逃逸更多能量
    expect(r.murE).not.toBeCloseTo(r.pecE, 6)
  })

  it('菲涅耳：eps 1→4 反射 ≈1/3', () => {
    const r = runFresnelSample()
    expect(r.R).toBeCloseTo(1 / 3, 5)
  })
})
