import { describe, it, expect } from 'vitest'
import {
  FEM_L3_PARENT,
  METHOD_ALGO_FEM_CG,
  FEM_L3_METHOD_IDS,
  tridiagMatVec,
  norm2,
  dot,
  conjugateGradientTridiag,
  solvePoisson1dCg,
  runFemCgSample,
  assemblePoisson1d,
  solveTridiag,
  analyticPoisson1d,
} from './fem-l3-algos'
import { FEM_L2_PARENT } from './fem-l2-algos'
import { methodById } from '../../data/methods/methods'

describe('FEM L3 · 共轭梯度 Poisson', () => {
  it('方法 id 常量（新 id 未入库，仅校验父族）', () => {
    expect(FEM_L3_PARENT).toBe('method-fem')
    expect(FEM_L3_PARENT).toBe(FEM_L2_PARENT)
    expect(METHOD_ALGO_FEM_CG).toBe('method-algo-fem-cg')
    expect(FEM_L3_METHOD_IDS).toContain(METHOD_ALGO_FEM_CG)
    expect(methodById(FEM_L3_PARENT)).toBeDefined()
    // 子 id 尚未入库 — 勿 methodById 新 id
    expect(methodById(METHOD_ALGO_FEM_CG)).toBeDefined()
  })

  it('tridiagMatVec / norm2 / dot 基础', () => {
    const a = [0, 1, 1]
    const b = [2, 2, 2]
    const c = [1, 1, 0]
    const x = [1, 1, 1]
    const y = new Float64Array(3)
    tridiagMatVec(a, b, c, x, y)
    // 行0: 2+1=3; 行1: 1+2+1=4; 行2: 1+2=3
    expect(y[0]).toBeCloseTo(3, 12)
    expect(y[1]).toBeCloseTo(4, 12)
    expect(y[2]).toBeCloseTo(3, 12)
    expect(norm2([3, 4])).toBeCloseTo(5, 12)
    expect(dot([1, 2], [3, 4])).toBeCloseTo(11, 12)
  })

  it('CG：对角 SPD 精确解', () => {
    // diag(2,2) x = (4,6) → (2,3)
    const a = [0, 0]
    const b = [2, 2]
    const c = [0, 0]
    const d = [4, 6]
    const r = conjugateGradientTridiag(a, b, c, d, { tol: 1e-14 })
    expect(r.converged).toBe(true)
    expect(r.x[0]).toBeCloseTo(2, 10)
    expect(r.x[1]).toBeCloseTo(3, 10)
    expect(r.residuals[r.residuals.length - 1]!).toBeLessThan(1e-10)
  })

  it('CG：三对角 Poisson 残差下降并逼近 Thomas', () => {
    const M = 16
    const sys = assemblePoisson1d(M, 1)
    const cg = conjugateGradientTridiag(sys.a, sys.b, sys.c, sys.d, {
      tol: 1e-12,
    })
    const th = solveTridiag(sys.a, sys.b, sys.c, sys.d)
    expect(cg.residuals.length).toBeGreaterThan(1)
    expect(cg.residuals[cg.residuals.length - 1]!).toBeLessThan(
      cg.residuals[0]! * 1e-6,
    )
    for (let i = 0; i < M; i++) {
      expect(cg.x[i]).toBeCloseTo(th[i]!, 8)
    }
  })

  it('solvePoisson1dCg：中点逼近解析解', () => {
    const { u, h, cg } = solvePoisson1dCg(32, 1)
    expect(cg.converged).toBe(true)
    const midIdx = Math.floor(32 / 2)
    const x = (midIdx + 1) * h
    expect(u[midIdx]).toBeCloseTo(analyticPoisson1d(x, 1), 3)
  })

  it('runFemCgSample：ok、残差下降、methodId/familyId', () => {
    const r = runFemCgSample(32, 1)
    expect(r.methodId).toBe(METHOD_ALGO_FEM_CG)
    expect(r.familyId).toBe(FEM_L3_PARENT)
    expect(r.familyId).toBe('method-fem')
    expect(r.ok).toBe(true)
    expect(r.converged).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.residualDecreased).toBe(true)
    expect(r.residualF).toBeLessThan(r.residual0)
    expect(r.vsThomasMax).toBeLessThan(1e-8)
    expect(r.errMid).toBeLessThan(1e-2)
    expect(r.midU).toBeCloseTo(0.125, 2)
    expect(r.iterations).toBeGreaterThan(0)
  })
})
