import { describe, it, expect } from 'vitest'
import {
  METHOD_SPARSE,
  METHOD_ALGO_CSR_SPMV,
  METHOD_ALGO_JACOBI_ITER,
  SPARSE_PARENT,
  SPARSE_METHOD_IDS,
  norm2,
  maxAbs,
  denseToCsr,
  makeLaplacian1dCsr,
  csrSpmv,
  csrDiagonal,
  csrResidual,
  jacobiIter,
  makeJacobiToy,
  runCsrSpmvSample,
  runJacobiIterSample,
} from './sparse-algos'

describe('Sparse · CSR SpMV + Jacobi', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SPARSE).toBe('method-sparse')
    expect(METHOD_ALGO_CSR_SPMV).toBe('method-algo-csr-spmv')
    expect(METHOD_ALGO_JACOBI_ITER).toBe('method-algo-jacobi-iter')
    expect(SPARSE_PARENT).toBe(METHOD_SPARSE)
    expect(SPARSE_METHOD_IDS).toContain(METHOD_ALGO_CSR_SPMV)
    expect(SPARSE_METHOD_IDS).toContain(METHOD_ALGO_JACOBI_ITER)
  })

  it('norm2 / maxAbs basics', () => {
    expect(norm2([3, 4])).toBeCloseTo(5, 12)
    expect(maxAbs([-2, 5, -7])).toBeCloseTo(7, 12)
  })

  it('denseToCsr + csrSpmv matches dense matvec', () => {
    const n = 3
    const Adense = [4, 1, 0, 1, 3, 1, 0, 1, 2]
    const A = denseToCsr(Adense, n, n)
    expect(A.rowPtr[n]).toBe(7)
    const x = [1, 2, 3]
    const y = csrSpmv(A, x)
    // [4+2, 1+6+3, 2+6] = [6, 10, 8]
    expect(y[0]).toBeCloseTo(6, 12)
    expect(y[1]).toBeCloseTo(10, 12)
    expect(y[2]).toBeCloseTo(8, 12)
  })

  it('makeLaplacian1dCsr: diagonal 4, off-diag −1', () => {
    const A = makeLaplacian1dCsr(4)
    const d = csrDiagonal(A)
    expect(d[0]).toBeCloseTo(4, 12)
    expect(d[1]).toBeCloseTo(4, 12)
    const x = new Float64Array([1, 1, 1, 1])
    const y = csrSpmv(A, x)
    // row0: 4−1=3; interior: −1+4−1=2; row3: −1+4=3
    expect(y[0]).toBeCloseTo(3, 12)
    expect(y[1]).toBeCloseTo(2, 12)
    expect(y[2]).toBeCloseTo(2, 12)
    expect(y[3]).toBeCloseTo(3, 12)
  })

  it('Jacobi: diagonal system exact in one step', () => {
    const A = denseToCsr([2, 0, 0, 4], 2, 2)
    const b = [4, 8]
    const r = jacobiIter(A, b, { maxIter: 5, tol: 1e-14 })
    expect(r.x[0]).toBeCloseTo(2, 12)
    expect(r.x[1]).toBeCloseTo(2, 12)
    expect(r.converged).toBe(true)
  })

  it('Jacobi on Laplacian: residual drops, approaches x*=1', () => {
    const n = 16
    const toy = makeJacobiToy(n)
    const r0 = csrResidual(toy.A, toy.b, new Float64Array(n))
    expect(norm2(r0)).toBeGreaterThan(0.1)
    const r = jacobiIter(toy.A, toy.b, { maxIter: 200, tol: 1e-10 })
    expect(r.residuals.length).toBeGreaterThan(1)
    expect(r.residuals[r.residuals.length - 1]!).toBeLessThan(
      r.residuals[0]! * 1e-4,
    )
    for (let i = 0; i < n; i++) {
      expect(r.x[i]).toBeCloseTo(1, 5)
    }
  })

  it('runCsrSpmvSample: ok, dense agreement', () => {
    const r = runCsrSpmvSample({ n: 6 })
    expect(r.methodId).toBe(METHOD_ALGO_CSR_SPMV)
    expect(r.familyId).toBe(METHOD_SPARSE)
    expect(r.familyId).toBe('method-sparse')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.denseAgree).toBe(true)
    expect(r.maxDiff).toBeLessThan(1e-14)
    expect(r.laplacianNorm).toBeGreaterThan(0)
  })

  it('runJacobiIterSample: ok, residual drop', () => {
    const r = runJacobiIterSample({ n: 12, tol: 1e-10 })
    expect(r.methodId).toBe(METHOD_ALGO_JACOBI_ITER)
    expect(r.familyId).toBe(METHOD_SPARSE)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.residualDecreased).toBe(true)
    expect(r.residualF).toBeLessThan(r.residual0)
    expect(r.maxErr).toBeLessThan(1e-5)
    expect(r.iterations).toBeGreaterThan(0)
  })
})
