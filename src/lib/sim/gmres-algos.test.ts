import { describe, it, expect } from 'vitest'
import {
  METHOD_GMRES,
  METHOD_ALGO_GMRES,
  GMRES_PARENT,
  GMRES_METHOD_IDS,
  norm2,
  dot,
  denseMatVec,
  tridiagMatVec,
  makeDenseMatVec,
  makeTridiagMatVec,
  makeNonsymTridiagSystem,
  makeDenseNonsym3x3,
  gmres,
  runGmresSample,
} from './gmres-algos'

describe('GMRES · 重启 GMRES(m) 非对称 Ax=b', () => {
  it('方法 id 常量（新 id 未入库，勿 methodById）', () => {
    expect(METHOD_GMRES).toBe('method-gmres')
    expect(METHOD_ALGO_GMRES).toBe('method-algo-gmres')
    expect(GMRES_PARENT).toBe(METHOD_GMRES)
    expect(GMRES_METHOD_IDS).toContain(METHOD_ALGO_GMRES)
  })

  it('norm2 / dot / denseMatVec 基础', () => {
    expect(norm2([3, 4])).toBeCloseTo(5, 12)
    expect(dot([1, 2], [3, 4])).toBeCloseTo(11, 12)
    const A = [2, 0, 0, 3]
    const y = new Float64Array(2)
    denseMatVec(A, 2, [1, 1], y)
    expect(y[0]).toBeCloseTo(2, 12)
    expect(y[1]).toBeCloseTo(3, 12)
  })

  it('tridiagMatVec 非对称', () => {
    const a = [0, 2]
    const b = [1, 1]
    const c = [3, 0]
    const y = new Float64Array(2)
    tridiagMatVec(a, b, c, [1, 1], y)
    // 行0: 1*1 + 3*1 = 4; 行1: 2*1 + 1*1 = 3
    expect(y[0]).toBeCloseTo(4, 12)
    expect(y[1]).toBeCloseTo(3, 12)
  })

  it('GMRES：对角系统精确解', () => {
    const A = [2, 0, 0, 4]
    const b = [4, 8]
    const r = gmres(makeDenseMatVec(A, 2), b, { m: 2, tol: 1e-14 })
    expect(r.converged).toBe(true)
    expect(r.x[0]).toBeCloseTo(2, 10)
    expect(r.x[1]).toBeCloseTo(2, 10)
    expect(r.residuals[r.residuals.length - 1]!).toBeLessThan(1e-10)
  })

  it('GMRES：稠密非对称 3×3，残差下降且逼近真解', () => {
    const d = makeDenseNonsym3x3()
    const r = gmres(makeDenseMatVec(d.A, d.n), d.rhs, {
      m: 3,
      maxRestarts: 4,
      tol: 1e-14,
    })
    expect(r.residuals.length).toBeGreaterThan(1)
    expect(r.residuals[r.residuals.length - 1]!).toBeLessThan(
      r.residuals[0]! * 1e-8,
    )
    for (let i = 0; i < 3; i++) {
      expect(r.x[i]).toBeCloseTo(d.xTrue[i]!, 8)
    }
    expect(r.converged).toBe(true)
  })

  it('GMRES：非对称三对角，重启 m < n 仍残差大幅下降', () => {
    const n = 16
    const sys = makeNonsymTridiagSystem(n, 0.4)
    const r = gmres(makeTridiagMatVec(sys.a, sys.b, sys.c), sys.rhs, {
      m: 8,
      maxRestarts: 30,
      tol: 1e-9,
    })
    expect(r.residuals[r.residuals.length - 1]!).toBeLessThan(
      r.residuals[0]! * 1e-5,
    )
    for (let i = 0; i < n; i++) {
      expect(r.x[i]).toBeCloseTo(1, 5)
    }
  })

  it('runGmresSample：ok、残差下降、methodId/familyId', () => {
    const r = runGmresSample({ n: 12, m: 12, tol: 1e-10 })
    expect(r.methodId).toBe(METHOD_ALGO_GMRES)
    expect(r.familyId).toBe(METHOD_GMRES)
    expect(r.familyId).toBe('method-gmres')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.residualDecreased).toBe(true)
    expect(r.residualF).toBeLessThan(r.residual0)
    expect(r.maxErr).toBeLessThan(1e-6)
    expect(r.denseMaxErr).toBeLessThan(1e-8)
    expect(r.iterations).toBeGreaterThan(0)
  })
})
