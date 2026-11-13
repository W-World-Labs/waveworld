import { describe, it, expect } from 'vitest'
import {
  METHOD_BICGSTAB,
  METHOD_ALGO_BICGSTAB,
  BICGSTAB_PARENT,
  BICGSTAB_METHOD_IDS,
  norm2,
  dot,
  denseMatVec,
  tridiagMatVec,
  makeDenseMatVec,
  makeTridiagMatVec,
  makeNonsymTridiagSystem,
  makeDenseNonsym3x3,
  bicgstab,
  runBicgstabSample,
} from './bicgstab-algos'

describe('BiCGSTAB · nonsymmetric Ax=b', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_BICGSTAB).toBe('method-bicgstab')
    expect(METHOD_ALGO_BICGSTAB).toBe('method-algo-bicgstab')
    expect(BICGSTAB_PARENT).toBe(METHOD_BICGSTAB)
    expect(BICGSTAB_METHOD_IDS).toContain(METHOD_ALGO_BICGSTAB)
  })

  it('norm2 / dot / denseMatVec basics', () => {
    expect(norm2([3, 4])).toBeCloseTo(5, 12)
    expect(dot([1, 2], [3, 4])).toBeCloseTo(11, 12)
    const A = [2, 0, 0, 3]
    const y = new Float64Array(2)
    denseMatVec(A, 2, [1, 1], y)
    expect(y[0]).toBeCloseTo(2, 12)
    expect(y[1]).toBeCloseTo(3, 12)
  })

  it('tridiagMatVec nonsymmetric', () => {
    const a = [0, 2]
    const b = [1, 1]
    const c = [3, 0]
    const y = new Float64Array(2)
    tridiagMatVec(a, b, c, [1, 1], y)
    expect(y[0]).toBeCloseTo(4, 12)
    expect(y[1]).toBeCloseTo(3, 12)
  })

  it('BiCGSTAB: diagonal system exact solution', () => {
    const A = [2, 0, 0, 4]
    const b = [4, 8]
    const r = bicgstab(makeDenseMatVec(A, 2), b, { maxIter: 10, tol: 1e-14 })
    expect(r.converged).toBe(true)
    expect(r.x[0]).toBeCloseTo(2, 10)
    expect(r.x[1]).toBeCloseTo(2, 10)
    expect(r.residuals[r.residuals.length - 1]!).toBeLessThan(1e-10)
  })

  it('BiCGSTAB: dense nonsym 3×3, residual drops and matches truth', () => {
    const d = makeDenseNonsym3x3()
    const r = bicgstab(makeDenseMatVec(d.A, d.n), d.rhs, {
      maxIter: 20,
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

  it('BiCGSTAB: nonsym tridiag residual drops substantially', () => {
    const n = 16
    const sys = makeNonsymTridiagSystem(n, 0.4)
    const r = bicgstab(makeTridiagMatVec(sys.a, sys.b, sys.c), sys.rhs, {
      maxIter: 80,
      tol: 1e-9,
    })
    expect(r.residuals[r.residuals.length - 1]!).toBeLessThan(
      r.residuals[0]! * 1e-5,
    )
    for (let i = 0; i < n; i++) {
      expect(r.x[i]).toBeCloseTo(1, 5)
    }
  })

  it('runBicgstabSample: ok, residual drop, methodId/familyId', () => {
    const r = runBicgstabSample({ n: 12, tol: 1e-10 })
    expect(r.methodId).toBe(METHOD_ALGO_BICGSTAB)
    expect(r.familyId).toBe(METHOD_BICGSTAB)
    expect(r.familyId).toBe('method-bicgstab')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.residualDecreased).toBe(true)
    expect(r.residualF).toBeLessThan(r.residual0)
    expect(r.maxErr).toBeLessThan(1e-6)
    expect(r.denseMaxErr).toBeLessThan(1e-8)
    expect(r.iterations).toBeGreaterThan(0)
  })
})
