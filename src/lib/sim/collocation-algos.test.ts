import { describe, it, expect } from 'vitest'
import {
  METHOD_COLLOCATION,
  METHOD_ALGO_CHEB_COLLOC,
  COLLOCATION_PARENT,
  COLLOCATION_METHOD_IDS,
  DEFAULT_N,
  DEFAULT_Y_LEFT,
  DEFAULT_Y_RIGHT,
  chebyshevLobattoNodes,
  chebyshevDiffMatrix,
  matMul,
  matVec,
  chebyshevD2,
  solveDenseGauss,
  exactCoeff,
  exactY,
  solveChebCollocBvp,
  runChebCollocSample,
} from './collocation-algos'

describe('Collocation · Chebyshev spectral BVP y″=y', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_COLLOCATION).toBe('method-collocation')
    expect(METHOD_ALGO_CHEB_COLLOC).toBe('method-algo-cheb-colloc')
    expect(COLLOCATION_PARENT).toBe(METHOD_COLLOCATION)
    expect(COLLOCATION_METHOD_IDS).toContain(METHOD_ALGO_CHEB_COLLOC)
    expect(DEFAULT_N).toBeGreaterThanOrEqual(4)
    expect(DEFAULT_Y_LEFT).toBeCloseTo(Math.cosh(1), 12)
    expect(DEFAULT_Y_RIGHT).toBeCloseTo(Math.cosh(1), 12)
  })

  it('chebyshevLobattoNodes: endpoints ±1, ordered cos', () => {
    const N = 4
    const x = chebyshevLobattoNodes(N)
    expect(x.length).toBe(N + 1)
    expect(x[0]).toBeCloseTo(1, 12)
    expect(x[N]).toBeCloseTo(-1, 12)
    expect(x[2]).toBeCloseTo(0, 12)
    // monotone decreasing
    for (let i = 0; i < N; i++) {
      expect(x[i]!).toBeGreaterThan(x[i + 1]!)
    }
  })

  it('diff matrix: D·1 ≈ 0, D·x ≈ 1 (constant and linear modes)', () => {
    const N = 6
    const { x, D, n } = chebyshevD2(N)
    const ones = new Float64Array(n).fill(1)
    const dOnes = matVec(D, ones, n)
    for (let i = 0; i < n; i++) {
      expect(Math.abs(dOnes[i]!)).toBeLessThan(1e-10)
    }
    const dx = matVec(D, x, n)
    for (let i = 0; i < n; i++) {
      expect(Math.abs(dx[i]! - 1)).toBeLessThan(1e-10)
    }
  })

  it('D2 of cosh is close to cosh (spectral accuracy on smooth)', () => {
    const N = 16
    const { x, D2, n } = chebyshevD2(N)
    const u = new Float64Array(n)
    for (let i = 0; i < n; i++) u[i] = Math.cosh(x[i]!)
    const d2u = matVec(D2, u, n)
    let maxE = 0
    for (let i = 0; i < n; i++) {
      const e = Math.abs(d2u[i]! - Math.cosh(x[i]!))
      if (e > maxE) maxE = e
    }
    expect(maxE).toBeLessThan(1e-10)
  })

  it('solveDenseGauss: 2×2', () => {
    // [[2,1],[1,3]] [x,y]=[5,5] → x=2,y=1
    const A = new Float64Array([2, 1, 1, 3])
    const b = new Float64Array([5, 5])
    const z = solveDenseGauss(A, b, 2)
    expect(z[0]).toBeCloseTo(2, 10)
    expect(z[1]).toBeCloseTo(1, 10)
  })

  it('exactY: cosh when BC = cosh(1); general A,B fit', () => {
    const yL = Math.cosh(1)
    const yR = Math.cosh(1)
    expect(exactY(0, yL, yR)).toBeCloseTo(1, 12)
    expect(exactY(1, yL, yR)).toBeCloseTo(yR, 12)
    expect(exactY(-1, yL, yR)).toBeCloseTo(yL, 12)
    // pure sinh: y(±1)=±sinh(1) → A=0, B=1
    const { A, B } = exactCoeff(-Math.sinh(1), Math.sinh(1))
    expect(A).toBeCloseTo(0, 10)
    expect(B).toBeCloseTo(1, 10)
  })

  it('solveChebCollocBvp: residual and error tiny for y=cosh', () => {
    const r = solveChebCollocBvp({ N: 12 })
    expect(r.methodId).toBe(METHOD_ALGO_CHEB_COLLOC)
    expect(r.familyId).toBe(METHOD_COLLOCATION)
    expect(r.finite).toBe(true)
    expect(r.y[0]).toBeCloseTo(r.yRight, 12)
    expect(r.y[r.N]).toBeCloseTo(r.yLeft, 12)
    expect(r.residualMax).toBeLessThan(1e-8)
    expect(r.maxErr).toBeLessThan(1e-8)
  })

  it('asymmetric BC still accurate', () => {
    const yL = 0.5
    const yR = 2.0
    const r = solveChebCollocBvp({ N: 14, yLeft: yL, yRight: yR })
    expect(r.finite).toBe(true)
    expect(r.residualMax).toBeLessThan(1e-8)
    expect(r.maxErr).toBeLessThan(1e-8)
    expect(r.y[0]).toBeCloseTo(yR, 12)
    expect(r.y[r.N]).toBeCloseTo(yL, 12)
  })

  it('matMul identity and chebyshevDiffMatrix length', () => {
    const N = 3
    const D = chebyshevDiffMatrix(N)
    expect(D.length).toBe((N + 1) * (N + 1))
    const I = new Float64Array((N + 1) * (N + 1))
    for (let i = 0; i <= N; i++) I[i * (N + 1) + i] = 1
    const DI = matMul(D, I, N + 1)
    for (let i = 0; i < D.length; i++) {
      expect(DI[i]).toBeCloseTo(D[i]!, 12)
    }
  })

  it('runChebCollocSample: ok, methodId, familyId', () => {
    const r = runChebCollocSample()
    expect(r.methodId).toBe(METHOD_ALGO_CHEB_COLLOC)
    expect(r.familyId).toBe(METHOD_COLLOCATION)
    expect(r.familyId).toBe('method-collocation')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.bcOk).toBe(true)
    expect(r.residualMax).toBeLessThan(1e-8)
    expect(r.maxErr).toBeLessThan(1e-8)
  })
})
