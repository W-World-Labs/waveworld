import { describe, it, expect } from 'vitest'
import {
  METHOD_UQ,
  METHOD_ALGO_UQ_MC,
  UQ_PARENT,
  UQ_METHOD_IDS,
  mulberry32,
  sampleStandardNormal,
  sampleInput,
  sampleMoments,
  analyticLinearMoments,
  uqMcPropagate,
  runUqMcSample,
} from './uq-algos'

describe('UQ · Monte Carlo input uncertainty propagation', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_UQ).toBe('method-uq')
    expect(METHOD_ALGO_UQ_MC).toBe('method-algo-uq-mc')
    expect(UQ_PARENT).toBe(METHOD_UQ)
    expect(UQ_METHOD_IDS).toContain(METHOD_ALGO_UQ_MC)
  })

  it('mulberry32 reproducible and in [0,1)', () => {
    const a = mulberry32(99)
    const b = mulberry32(99)
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
    for (const u of seqA) {
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThan(1)
    }
  })

  it('sampleStandardNormal: empirical mean≈0, var≈1', () => {
    const rand = mulberry32(7)
    const N = 30_000
    const xs = new Float64Array(N)
    for (let i = 0; i < N; i++) xs[i] = sampleStandardNormal(rand)
    const m = sampleMoments(xs)
    expect(m.mean).toBeCloseTo(0, 1)
    expect(m.variance).toBeCloseTo(1, 1)
  })

  it('sampleInput: normal / uniform moments', () => {
    const N = 25_000
    const randN = mulberry32(3)
    const xs = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      xs[i] = sampleInput({ kind: 'normal', mu: 2, sigma: 0.5 }, randN)
    }
    const mn = sampleMoments(xs)
    expect(mn.mean).toBeCloseTo(2, 1)
    expect(mn.variance).toBeCloseTo(0.25, 1)

    const randU = mulberry32(5)
    for (let i = 0; i < N; i++) {
      xs[i] = sampleInput({ kind: 'uniform', lo: 0, hi: 6 }, randU)
    }
    const mu = sampleMoments(xs)
    expect(mu.mean).toBeCloseTo(3, 1)
    expect(mu.variance).toBeCloseTo(3, 1) // 36/12
  })

  it('analyticLinearMoments: normal and uniform', () => {
    const a = 3
    const b = 1
    const n = analyticLinearMoments(a, b, { kind: 'normal', mu: 1, sigma: 2 })
    expect(n.mean).toBeCloseTo(3 * 1 + 1, 12)
    expect(n.variance).toBeCloseTo(9 * 4, 12)

    const u = analyticLinearMoments(a, b, { kind: 'uniform', lo: 0, hi: 2 })
    expect(u.mean).toBeCloseTo(3 * 1 + 1, 12)
    expect(u.variance).toBeCloseTo(9 * (4 / 12), 12)
  })

  it('uqMcPropagate linear g matches analytic (normal)', () => {
    const a = 2
    const b = -0.5
    const dist = { kind: 'normal' as const, mu: 0.5, sigma: 0.3 }
    const analytic = analyticLinearMoments(a, b, dist)
    const mc = uqMcPropagate((x) => a * x + b, dist, 40_000, 11)
    expect(mc.mean).toBeCloseTo(analytic.mean, 1)
    expect(Math.abs(mc.mean - analytic.mean)).toBeLessThan(0.02)
    expect(Math.abs(mc.variance - analytic.variance)).toBeLessThan(0.02)
    expect(mc.std).toBeCloseTo(Math.sqrt(mc.variance), 12)
  })

  it('uqMcPropagate linear g matches analytic (uniform)', () => {
    const a = -1.5
    const b = 4
    const dist = { kind: 'uniform' as const, lo: -2, hi: 2 }
    const analytic = analyticLinearMoments(a, b, dist)
    const mc = uqMcPropagate((x) => a * x + b, dist, 40_000, 19)
    expect(Math.abs(mc.mean - analytic.mean)).toBeLessThan(0.02)
    expect(Math.abs(mc.variance - analytic.variance)).toBeLessThan(0.03)
  })

  it('nonlinear g: mean/var finite and samples length = n', () => {
    const mc = uqMcPropagate((x) => x * x, { kind: 'normal', mu: 0, sigma: 1 }, 5000, 2)
    // E[x²]=1, Var(x²)=2 for standard normal
    expect(mc.n).toBe(5000)
    expect(mc.samples.length).toBe(5000)
    expect(mc.mean).toBeCloseTo(1, 1)
    expect(mc.variance).toBeCloseTo(2, 0)
    expect(Number.isFinite(mc.mean)).toBe(true)
  })

  it('runUqMcSample: ok, familyId method-uq, analytic match', () => {
    const r = runUqMcSample()
    expect(r.methodId).toBe(METHOD_ALGO_UQ_MC)
    expect(r.familyId).toBe(METHOD_UQ)
    expect(r.familyId).toBe('method-uq')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.normalMeanErr).toBeLessThan(0.03)
    expect(r.normalVarErr).toBeLessThan(0.05)
    expect(r.uniformMeanErr).toBeLessThan(0.03)
    expect(r.uniformVarErr).toBeLessThan(0.05)
    expect(r.normalAnalyticMean).toBeCloseTo(2.5 * 1 - 1, 12)
    expect(r.normalAnalyticVar).toBeCloseTo(2.5 * 2.5 * 0.4 * 0.4, 12)
  })
})
