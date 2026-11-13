import { describe, it, expect } from 'vitest'
import {
  BEM_COLLOCATION_ID,
  BEM_L3_PARENT,
  METHOD_ALGO_BEM_DOUBLE_LAYER,
  METHOD_BEM,
  assembleDoubleLayerMatrix,
  collocationNodes,
  crossMeshResidual,
  doubleLayerCollocationResidual,
  doubleLayerKernel1d,
  manufacturedDensity,
  residualL2,
  runBemDoubleLayerSample,
  sampleDensity,
  solveDense,
} from './bem-l3-algos'
import { methodById } from '../../data/methods/methods'

describe('BEM L3 · 1D 双层密度配点', () => {
  it('方法 id 对齐 BEM 目录（double-layer 为未入库新 id）', () => {
    expect(BEM_L3_PARENT).toBe('method-boundary-element')
    expect(METHOD_BEM).toBe('method-boundary-element')
    expect(METHOD_ALGO_BEM_DOUBLE_LAYER).toBe('method-algo-bem-double-layer')
    expect(BEM_COLLOCATION_ID).toBe('method-algo-bem-collocation')
    expect(methodById(METHOD_BEM)).toBeDefined()
    expect(methodById(BEM_COLLOCATION_ID)?.parentId).toBe(METHOD_BEM)
  })

  it('双层核反对称且对角 PV=0', () => {
    expect(doubleLayerKernel1d(0.3, 0.3)).toBe(0)
    expect(doubleLayerKernel1d(0.7, 0.2)).toBe(0.5)
    expect(doubleLayerKernel1d(0.2, 0.7)).toBe(-0.5)
    expect(doubleLayerKernel1d(0.7, 0.2)).toBe(-doubleLayerKernel1d(0.2, 0.7))
  })

  it('配点节点落在 (0,1) 且均匀', () => {
    const x = collocationNodes(4)
    expect(x[0]).toBeCloseTo(0.125, 12)
    expect(x[3]).toBeCloseTo(0.875, 12)
    for (let i = 0; i < 4; i++) {
      expect(x[i]!).toBeGreaterThan(0)
      expect(x[i]!).toBeLessThan(1)
    }
  })

  it('自洽制造解：求解残差≈0，密度误差≈0', () => {
    const r = doubleLayerCollocationResidual(16)
    expect(r.solveResidual).toBeLessThan(1e-10)
    expect(r.truthInjectResidual).toBeLessThan(1e-12)
    expect(r.densityErr).toBeLessThan(1e-10)
    expect(r.maxAbsMu).toBeGreaterThan(0.5)
  })

  it('稠密求解器复原已知右端', () => {
    const n = 6
    const { A, x } = assembleDoubleLayerMatrix(n)
    const muStar = sampleDensity(x)
    const g = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let j = 0; j < n; j++) s += A[i * n + j]! * muStar[j]!
      g[i] = s
    }
    const mu = solveDense(A, g, n)
    expect(residualL2(A, mu, g, n)).toBeLessThan(1e-10)
    for (let i = 0; i < n; i++) {
      expect(mu[i]).toBeCloseTo(manufacturedDensity(x[i]!), 8)
    }
  })

  it('跨网格配点残差随加密下降', () => {
    const r8 = crossMeshResidual(8, 64)
    const r32 = crossMeshResidual(32, 64)
    expect(r32).toBeLessThan(r8)
    expect(r8).toBeGreaterThan(0)
  })

  it('runBemDoubleLayerSample：残差下降且细网格可解', () => {
    const r = runBemDoubleLayerSample()
    expect(r.methodId).toBe(METHOD_ALGO_BEM_DOUBLE_LAYER)
    expect(r.familyId).toBe(BEM_L3_PARENT)
    expect(r.relatedAlgoId).toBe(BEM_COLLOCATION_ID)
    expect(r.residualDecreased).toBe(true)
    expect(r.residualFine).toBeLessThan(r.residualCoarse)
    expect(r.solveResidualFine).toBeLessThan(1e-9)
    expect(r.densityErrFine).toBeLessThan(1e-9)
  })
})
