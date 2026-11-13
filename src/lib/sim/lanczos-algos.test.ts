import { describe, it, expect } from 'vitest'
import {
  METHOD_LANCZOS,
  METHOD_ALGO_LANCZOS_EIG,
  LANCZOS_PARENT,
  LANCZOS_METHOD_IDS,
  norm2,
  dot,
  denseMatVec,
  tridiagSymMatVec,
  makeDenseMatVec,
  makeTridiagSymMatVec,
  tridiagEigenvalues,
  lanczos,
  makeDiagonalSpd,
  makeTridiagSpd,
  makeDenseDiagDominantSpd,
  jacobiEigenvalues,
  runLanczosEigSample,
} from './lanczos-algos'

describe('Lanczos · SPD Ritz eigenvalues', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_LANCZOS).toBe('method-lanczos')
    expect(METHOD_ALGO_LANCZOS_EIG).toBe('method-algo-lanczos-eig')
    expect(LANCZOS_PARENT).toBe(METHOD_LANCZOS)
    expect(LANCZOS_METHOD_IDS).toContain(METHOD_ALGO_LANCZOS_EIG)
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

  it('tridiagSymMatVec', () => {
    // [[2,1],[1,2]] * [1,1] = [3,3]
    const a = [1]
    const b = [2, 2]
    const y = new Float64Array(2)
    tridiagSymMatVec(a, b, [1, 1], y)
    expect(y[0]).toBeCloseTo(3, 12)
    expect(y[1]).toBeCloseTo(3, 12)
  })

  it('tridiagEigenvalues: 2×2 known', () => {
    // [[2,1],[1,2]] → eigenvalues 1, 3
    const ev = tridiagEigenvalues([2, 2], [1])
    expect(ev[0]).toBeCloseTo(1, 10)
    expect(ev[1]).toBeCloseTo(3, 10)
  })

  it('Lanczos on diagonal SPD recovers eigenvalues', () => {
    const n = 6
    const { A, eigenvalues } = makeDiagonalSpd(n)
    const L = lanczos(makeDenseMatVec(A, n), n, { m: n })
    expect(L.m).toBe(n)
    expect(L.ritzValues.length).toBe(n)
    for (let i = 0; i < n; i++) {
      expect(L.ritzValues[i]).toBeCloseTo(eigenvalues[i]!, 6)
    }
  })

  it('Lanczos Ritz values approximate extremal eigenvalues of dense SPD', () => {
    const n = 10
    const { A } = makeDenseDiagDominantSpd(n)
    const exact = jacobiEigenvalues(A, n)
    const L = lanczos(makeDenseMatVec(A, n), n, {
      m: 8,
      v0: Float64Array.from({ length: n }, (_, i) => 1 + 0.02 * i),
    })
    const rMin = L.ritzValues[0]!
    const rMax = L.ritzValues[L.ritzValues.length - 1]!
    // Extremal Ritz values approach min/max of spectrum
    expect(Math.abs(rMin - exact[0]!)).toBeLessThan(0.3)
    expect(Math.abs(rMax - exact[n - 1]!)).toBeLessThan(0.3)
    // All Ritz values in [min, max] range (with small slack)
    for (let i = 0; i < L.ritzValues.length; i++) {
      expect(L.ritzValues[i]!).toBeGreaterThan(exact[0]! - 1)
      expect(L.ritzValues[i]!).toBeLessThan(exact[n - 1]! + 1)
    }
  })

  it('Lanczos on tridiagonal SPD produces finite positive Ritz values', () => {
    const n = 16
    const tri = makeTridiagSpd(n)
    const L = lanczos(makeTridiagSymMatVec(tri.a, tri.b), n, { m: 10 })
    expect(L.ritzValues.length).toBe(L.m)
    for (let i = 0; i < L.ritzValues.length; i++) {
      expect(Number.isFinite(L.ritzValues[i]!)).toBe(true)
      expect(L.ritzValues[i]!).toBeGreaterThan(0)
    }
    // Sorted
    for (let i = 1; i < L.ritzValues.length; i++) {
      expect(L.ritzValues[i]!).toBeGreaterThanOrEqual(L.ritzValues[i - 1]! - 1e-12)
    }
  })

  it('runLanczosEigSample: ok, methodId/familyId', () => {
    const r = runLanczosEigSample({ n: 12, m: 12 })
    expect(r.methodId).toBe(METHOD_ALGO_LANCZOS_EIG)
    expect(r.familyId).toBe(METHOD_LANCZOS)
    expect(r.familyId).toBe('method-lanczos')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.absErrMin).toBeLessThan(1e-8)
    expect(r.absErrMax).toBeLessThan(1e-8)
    expect(r.ritzMin).toBeCloseTo(1, 6)
    expect(r.ritzMax).toBeCloseTo(12, 6)
    expect(r.tridiagRitzMax).toBeGreaterThan(0)
  })
})
