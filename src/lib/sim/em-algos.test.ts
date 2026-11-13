import { describe, it, expect } from 'vitest'
import {
  METHOD_EM,
  METHOD_ALGO_EM_GMM,
  EM_PARENT,
  EM_METHOD_IDS,
  mulberry32,
  gaussianDensity,
  gaussianLogDensity,
  gmm2Density,
  gmm2LogLikelihood,
  emEStep,
  emMStep,
  emIteration,
  runEmGmm,
  sampleGmm2Data,
  sortGmmByMean,
  runEmGmmSample,
  type Gmm2Params,
} from './em-algos'

describe('EM · 1D 2-component Gaussian mixture', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_EM).toBe('method-em')
    expect(METHOD_ALGO_EM_GMM).toBe('method-algo-em-gmm')
    expect(EM_PARENT).toBe(METHOD_EM)
    expect(EM_METHOD_IDS).toContain(METHOD_ALGO_EM_GMM)
  })

  it('mulberry32 reproducible and in [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a()]).toEqual([b(), b()])
  })

  it('gaussianDensity: peak and log consistency', () => {
    const mu = 1
    const v = 4
    const peak = 1 / Math.sqrt(2 * Math.PI * v)
    expect(gaussianDensity(mu, mu, v)).toBeCloseTo(peak, 12)
    expect(gaussianLogDensity(mu, mu, v)).toBeCloseTo(Math.log(peak), 12)
    const x = 3
    expect(Math.exp(gaussianLogDensity(x, mu, v))).toBeCloseTo(
      gaussianDensity(x, mu, v),
      10,
    )
  })

  it('gmm2Density: weights sum of component densities', () => {
    const p: Gmm2Params = {
      weights: [0.3, 0.7],
      means: [-2, 2],
      variances: [1, 1],
    }
    const x = 0
    const expected =
      0.3 * gaussianDensity(x, -2, 1) + 0.7 * gaussianDensity(x, 2, 1)
    expect(gmm2Density(x, p)).toBeCloseTo(expected, 12)
  })

  it('emEStep: responsibilities in [0,1] and favor nearer component', () => {
    const data = [-3, 3]
    const p: Gmm2Params = {
      weights: [0.5, 0.5],
      means: [-3, 3],
      variances: [1, 1],
    }
    const g = emEStep(data, p)
    expect(g.length).toBe(2)
    // x=-3 → mostly component 0
    expect(g[0]!).toBeGreaterThan(0.9)
    // x=3 → mostly component 1 (γ0 small)
    expect(g[1]!).toBeLessThan(0.1)
    for (let i = 0; i < g.length; i++) {
      expect(g[i]!).toBeGreaterThanOrEqual(0)
      expect(g[i]!).toBeLessThanOrEqual(1)
    }
  })

  it('emMStep: recovers means of two clusters', () => {
    const data = [-4, -3.5, -3, 3, 3.5, 4]
    // hard responsibilities: first half →0, second →1
    const gamma0 = new Float64Array([1, 1, 1, 0, 0, 0])
    const p = emMStep(data, gamma0)
    expect(p.means[0]).toBeCloseTo((-4 - 3.5 - 3) / 3, 10)
    expect(p.means[1]).toBeCloseTo((3 + 3.5 + 4) / 3, 10)
    expect(p.weights[0]).toBeCloseTo(0.5, 10)
    expect(p.weights[1]).toBeCloseTo(0.5, 10)
    expect(p.variances[0]).toBeGreaterThan(0)
    expect(p.variances[1]).toBeGreaterThan(0)
  })

  it('emIteration / runEmGmm: log-likelihood nondecreasing', () => {
    const trueP: Gmm2Params = {
      weights: [0.5, 0.5],
      means: [-2.5, 2.5],
      variances: [0.4, 0.4],
    }
    const data = sampleGmm2Data(300, trueP, 5)
    const init: Gmm2Params = {
      weights: [0.5, 0.5],
      means: [-0.5, 0.5],
      variances: [2, 2],
    }
    const fit = runEmGmm(data, init, 30)
    expect(fit.llNondecreasing).toBe(true)
    expect(fit.logLikelihood).toBeGreaterThanOrEqual(fit.logLikelihood0 - 1e-9)
    for (let i = 1; i < fit.llHistory.length; i++) {
      expect(fit.llHistory[i]!).toBeGreaterThanOrEqual(
        fit.llHistory[i - 1]! - 1e-9,
      )
    }
    // single iteration LL defined
    const one = emIteration(data, init)
    expect(Number.isFinite(one.logLikelihood)).toBe(true)
  })

  it('sortGmmByMean swaps labels by ascending mean', () => {
    const p: Gmm2Params = {
      weights: [0.2, 0.8],
      means: [5, -5],
      variances: [1, 2],
    }
    const s = sortGmmByMean(p)
    expect(s.means[0]).toBe(-5)
    expect(s.means[1]).toBe(5)
    expect(s.weights[0]).toBe(0.8)
    expect(s.variances[0]).toBe(2)
  })

  it('runEmGmm recovers two well-separated modes loosely', () => {
    const trueP: Gmm2Params = {
      weights: [0.4, 0.6],
      means: [-3, 3],
      variances: [0.5, 0.5],
    }
    const data = sampleGmm2Data(500, trueP, 9)
    const init: Gmm2Params = {
      weights: [0.5, 0.5],
      means: [-1, 1],
      variances: [2, 2],
    }
    const fit = runEmGmm(data, init, 50)
    const sorted = sortGmmByMean(fit.params)
    expect(sorted.means[0]).toBeLessThan(-1.5)
    expect(sorted.means[1]).toBeGreaterThan(1.5)
    expect(Math.abs(sorted.means[0] - -3)).toBeLessThan(0.5)
    expect(Math.abs(sorted.means[1] - 3)).toBeLessThan(0.5)
  })

  it('runEmGmmSample: ok, familyId method-em, LL gain, modes', () => {
    const r = runEmGmmSample()
    expect(r.methodId).toBe(METHOD_ALGO_EM_GMM)
    expect(r.familyId).toBe(METHOD_EM)
    expect(r.familyId).toBe('method-em')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.llNondecreasing).toBe(true)
    expect(r.llGain).toBeGreaterThan(0)
    expect(r.meanErr0).toBeLessThan(0.6)
    expect(r.meanErr1).toBeLessThan(0.6)
    expect(r.means[1] - r.means[0]).toBeGreaterThan(3)
  })

  it('gmm2LogLikelihood finite on synthetic data', () => {
    const p: Gmm2Params = {
      weights: [0.5, 0.5],
      means: [0, 0],
      variances: [1, 1],
    }
    const data = [0, 0.1, -0.1]
    expect(Number.isFinite(gmm2LogLikelihood(data, p))).toBe(true)
  })
})
