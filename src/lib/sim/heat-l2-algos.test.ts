import { describe, it, expect } from 'vitest'
import {
  HEAT_L2_FTCS_ID,
  HEAT_L2_IMPLICIT_ID,
  HEAT_L2_METHOD_IDS,
  HEAT_L2_PARENT,
  STABLE_R,
  ftcsStep1D,
  gaussianIC,
  implicitStep1D,
  runImplicitHeatSample,
  solveTridiagThomas,
} from './heat-l2-algos'

describe('热扩散 L2 · 1D 隐式 BTCS（Thomas）', () => {
  it('方法 id 常量（implicit 为未入库新 id）', () => {
    expect(HEAT_L2_PARENT).toBe('method-heat-ftcs')
    expect(HEAT_L2_FTCS_ID).toBe('method-algo-heat-ftcs-step')
    expect(HEAT_L2_IMPLICIT_ID).toBe('method-algo-heat-implicit')
    expect(HEAT_L2_METHOD_IDS).toContain(HEAT_L2_IMPLICIT_ID)
    expect(STABLE_R).toBe(0.25)
  })

  it('solveTridiagThomas：对角系统精确', () => {
    // 2x = 4 → x=2；简单 2×2： [2 1; 1 2][x;y]=[4;5] → x=1,y=2
    const x = solveTridiagThomas(
      [0, 1],
      [2, 2],
      [1, 0],
      [4, 5],
    )
    expect(x[0]).toBeCloseTo(1, 10)
    expect(x[1]).toBeCloseTo(2, 10)
  })

  it('小 r 下 FTCS 与 BTCS 单步都有限且峰值不增', () => {
    const u0 = gaussianIC(32)
    const r = 0.2
    const f = ftcsStep1D(u0, r)
    const b = implicitStep1D(u0, r)
    const max0 = Math.max(...u0)
    expect(Math.max(...f)).toBeLessThanOrEqual(max0 + 1e-12)
    expect(Math.max(...b)).toBeLessThanOrEqual(max0 + 1e-12)
    expect(f.every(Number.isFinite)).toBe(true)
    expect(b.every(Number.isFinite)).toBe(true)
  })

  it('runImplicitHeatSample：大 r 下隐式稳定，显式发散', () => {
    const r = runImplicitHeatSample(48, 2.0, 20)
    expect(r.methodId).toBe(HEAT_L2_IMPLICIT_ID)
    expect(r.r).toBeGreaterThan(r.stableR)
    // 隐式：有限、峰值下降（扩散）
    expect(r.implicit.finite).toBe(true)
    expect(r.implicit.maxDropped).toBe(true)
    expect(r.implicit.maxAbs).toBeLessThan(1)
    expect(r.implicit.maxAbs).toBeGreaterThan(0)
    // 显式大 r：应爆炸（非有限，或 maxAbs 极大）
    const ftcsExploded = !r.ftcs.finite || r.ftcs.maxAbs > 1e6
    expect(ftcsExploded).toBe(true)
  })
})
