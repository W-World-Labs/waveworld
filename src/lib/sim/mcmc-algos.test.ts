import { describe, it, expect } from 'vitest'
import {
  METHOD_MCMC,
  METHOD_ALGO_MH,
  MCMC_PARENT,
  MCMC_METHOD_IDS,
  mulberry32,
  sampleStandardNormal,
  standardNormalLogDensity,
  standardNormalDensity,
  mhAcceptProb,
  mhAccept,
  mhStep1d,
  sampleMoments,
  runMhChain,
  runMhSample,
} from './mcmc-algos'

describe('MCMC · Metropolis–Hastings random-walk on N(0,1)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_MCMC).toBe('method-mcmc')
    expect(METHOD_ALGO_MH).toBe('method-algo-mh')
    expect(MCMC_PARENT).toBe(METHOD_MCMC)
    expect(MCMC_METHOD_IDS).toContain(METHOD_ALGO_MH)
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

  it('standardNormalDensity: peak and log consistency', () => {
    const peak = 1 / Math.sqrt(2 * Math.PI)
    expect(standardNormalDensity(0)).toBeCloseTo(peak, 12)
    expect(standardNormalLogDensity(0)).toBeCloseTo(Math.log(peak), 12)
    // ratio via logs matches exp(−Δ(x²)/2)
    const x = 1.5
    const y = -0.5
    const ratio = standardNormalDensity(y) / standardNormalDensity(x)
    const logRatio =
      standardNormalLogDensity(y) - standardNormalLogDensity(x)
    expect(Math.exp(logRatio)).toBeCloseTo(ratio, 10)
  })

  it('mhAcceptProb: always 1 if prop better; exp(Δlog) if worse', () => {
    expect(mhAcceptProb(-2, -1)).toBe(1)
    expect(mhAcceptProb(0, 0)).toBe(1)
    expect(mhAcceptProb(0, -1)).toBeCloseTo(Math.exp(-1), 12)
  })

  it('mhAccept uses threshold u < P', () => {
    expect(mhAccept(-2, -1, 0.99)).toBe(true)
    expect(mhAccept(0, -1, 0)).toBe(true)
    expect(mhAccept(0, -1, 0.999)).toBe(false)
  })

  it('mhStep1d: structure and finite; better prop often accepted', () => {
    const rand = mulberry32(5)
    const s = mhStep1d(2, 0.8, rand)
    expect(Number.isFinite(s.x)).toBe(true)
    expect(Number.isFinite(s.xProp)).toBe(true)
    expect(Number.isFinite(s.logPi)).toBe(true)
    if (s.accepted) {
      expect(s.x).toBe(s.xProp)
    } else {
      expect(s.x).toBe(2)
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

  it('runMhChain: post-burn mean≈0, var≈1 loosely', () => {
    const chain = runMhChain(20_000, {
      x0: 4,
      sigma: 1.0,
      burnIn: 4_000,
      seed: 3,
    })
    expect(Math.abs(chain.mean)).toBeLessThan(0.2)
    expect(chain.variance).toBeGreaterThan(0.6)
    expect(chain.variance).toBeLessThan(1.5)
    expect(chain.acceptRate).toBeGreaterThan(0.15)
    expect(chain.acceptRate).toBeLessThan(0.9)
    expect(chain.samples.length).toBe(16_000)
  })

  it('runMhSample: ok, familyId method-mcmc, mean~0 var~1', () => {
    const r = runMhSample()
    expect(r.methodId).toBe(METHOD_ALGO_MH)
    expect(r.familyId).toBe(METHOD_MCMC)
    expect(r.familyId).toBe('method-mcmc')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(Math.abs(r.mean)).toBeLessThan(0.15)
    expect(Math.abs(r.variance - 1)).toBeLessThan(0.25)
    expect(r.acceptRate).toBeGreaterThan(0.1)
  })
})
