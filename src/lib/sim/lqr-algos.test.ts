import { describe, it, expect } from 'vitest'
import {
  METHOD_LQR,
  METHOD_ALGO_LQR_RICCATI,
  LQR_PARENT,
  LQR_METHOD_IDS,
  matVec,
  matMul,
  matTranspose,
  invSmall,
  spectralRadius,
  frobenius,
  riccatiStep,
  dareIterate,
  finiteHorizonLqr,
  closedLoopA,
  makeLqrToy1d,
  makeLqrToy2d,
  runLqrRiccatiSample,
} from './lqr-algos'

describe('Discrete LQR · Riccati / DARE', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_LQR).toBe('method-lqr')
    expect(METHOD_ALGO_LQR_RICCATI).toBe('method-algo-lqr-riccati')
    expect(LQR_PARENT).toBe(METHOD_LQR)
    expect(LQR_METHOD_IDS).toContain(METHOD_ALGO_LQR_RICCATI)
  })

  it('mat helpers: mul, transpose, inv, spectral radius', () => {
    const A = new Float64Array([1, 2, 3, 4])
    const At = matTranspose(A, 2, 2)
    expect(At[0]).toBeCloseTo(1, 12)
    expect(At[1]).toBeCloseTo(3, 12)
    expect(At[2]).toBeCloseTo(2, 12)
    expect(At[3]).toBeCloseTo(4, 12)
    const I = matMul(A, invSmall(A, 2), 2, 2, 2)
    expect(I[0]).toBeCloseTo(1, 10)
    expect(I[1]).toBeCloseTo(0, 10)
    expect(I[2]).toBeCloseTo(0, 10)
    expect(I[3]).toBeCloseTo(1, 10)
    const y = new Float64Array(2)
    matVec([2, 0, 0, 3], 2, [1, 1], y)
    expect(y[0]).toBeCloseTo(2, 12)
    expect(y[1]).toBeCloseTo(3, 12)
    expect(spectralRadius([0.5], 1)).toBeCloseTo(0.5, 12)
    // rotation-scale: ρ = 0.9
    const c = 0.9 * Math.cos(0.3)
    const s = 0.9 * Math.sin(0.3)
    expect(spectralRadius([c, -s, s, c], 2)).toBeCloseTo(0.9, 10)
    expect(frobenius([3, 4])).toBeCloseTo(5, 12)
  })

  it('1D Riccati step: scalar closed form', () => {
    const sys = makeLqrToy1d()
    // A=1.2, B=1, Q=1, R=1, P=1
    // S = 1 + 1*1*1 = 2
    // K = (1/2)*1*1*1.2 = 0.6
    // P' = 1.2*1*(1.2−0.6) + 1 = 1.2*0.6 + 1 = 1.72
    const { Pnext, K } = riccatiStep(sys, [1])
    expect(K[0]).toBeCloseTo(0.6, 12)
    expect(Pnext[0]).toBeCloseTo(1.72, 12)
  })

  it('dareIterate 1D: stabilizes unstable open-loop', () => {
    const sys = makeLqrToy1d()
    const r = dareIterate(sys, { maxIter: 100, tol: 1e-14 })
    expect(r.converged).toBe(true)
    expect(r.P[0]!).toBeGreaterThan(0)
    const Acl = closedLoopA(sys, r.K)
    const rhoOpen = spectralRadius(sys.A, 1)
    const rhoCl = spectralRadius(Acl, 1)
    expect(rhoOpen).toBeGreaterThan(1)
    expect(rhoCl).toBeLessThan(1)
    expect(rhoCl).toBeLessThan(rhoOpen)
  })

  it('dareIterate 2D: closed-loop spectral radius shrinks', () => {
    const sys = makeLqrToy2d()
    const r = dareIterate(sys, { maxIter: 200, tol: 1e-12 })
    expect(r.iterations).toBeGreaterThan(0)
    const Acl = closedLoopA(sys, r.K)
    const rhoOpen = spectralRadius(sys.A, 2)
    const rhoCl = spectralRadius(Acl, 2)
    expect(rhoOpen).toBeGreaterThan(1)
    expect(rhoCl).toBeLessThan(rhoOpen)
    expect(rhoCl).toBeLessThan(1)
  })

  it('finiteHorizonLqr: N steps produce N gains, P0 finite SPD-ish', () => {
    const sys = makeLqrToy1d()
    const fh = finiteHorizonLqr(sys, 20)
    expect(fh.gains.length).toBe(20)
    expect(fh.Pseq.length).toBe(21)
    expect(Number.isFinite(fh.P0[0]!)).toBe(true)
    expect(fh.P0[0]!).toBeGreaterThan(0)
    // long horizon gain near infinite-horizon
    const inf = dareIterate(sys, { maxIter: 200, tol: 1e-14 })
    const Klast = fh.gains[0]!
    expect(Math.abs(Klast[0]! - inf.K[0]!)).toBeLessThan(0.05)
  })

  it('runLqrRiccatiSample: ok, closed-loop ρ < open-loop', () => {
    const r = runLqrRiccatiSample()
    expect(r.methodId).toBe(METHOD_ALGO_LQR_RICCATI)
    expect(r.familyId).toBe(METHOD_LQR)
    expect(r.familyId).toBe('method-lqr')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.stabilized1d).toBe(true)
    expect(r.stabilized2d).toBe(true)
    expect(r.rhoCl1d).toBeLessThan(r.rhoOpen1d)
    expect(r.rhoCl2d).toBeLessThan(r.rhoOpen2d)
    expect(r.rhoCl1d).toBeLessThan(1)
    expect(r.rhoCl2d).toBeLessThan(1)
  })
})
