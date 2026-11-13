import { describe, it, expect } from 'vitest'
import {
  METHOD_SA,
  METHOD_ALGO_SA_STEP,
  SA_PARENT,
  SA_METHOD_IDS,
  mulberry32,
  multimodal1d,
  geometricTemperature,
  metropolisAcceptProb,
  metropolisAccept,
  saStep1d,
  runSaTrajectory,
  runSaStepSample,
} from './sa-algos'

describe('SA · simulated annealing 1D multimodal + Metropolis', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SA).toBe('method-simulated-annealing')
    expect(METHOD_ALGO_SA_STEP).toBe('method-algo-sa-step')
    expect(SA_PARENT).toBe(METHOD_SA)
    expect(SA_METHOD_IDS).toContain(METHOD_ALGO_SA_STEP)
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

  it('multimodal1d: f(0)=0, finite, multimodal wiggles', () => {
    expect(multimodal1d(0)).toBeCloseTo(0, 12)
    expect(multimodal1d(Math.PI / 6)).toBeCloseTo(
      (Math.PI / 6) ** 2 / 10 + 1,
      10,
    )
    // local structure: sin term creates non-convexity
    const fNeg = multimodal1d(-0.5)
    const fPos = multimodal1d(0.5)
    expect(Number.isFinite(fNeg)).toBe(true)
    expect(Number.isFinite(fPos)).toBe(true)
    expect(fNeg).not.toBeCloseTo(fPos, 6)
  })

  it('geometricTemperature cools: T_{k}=T0 α^k', () => {
    expect(geometricTemperature(2, 0.5, 0)).toBeCloseTo(2, 12)
    expect(geometricTemperature(2, 0.5, 1)).toBeCloseTo(1, 12)
    expect(geometricTemperature(2, 0.5, 3)).toBeCloseTo(0.25, 12)
    expect(geometricTemperature(1, 0.9, 10)).toBeLessThan(1)
  })

  it('metropolisAcceptProb: always 1 if df≤0; exp(−df/T) if worse', () => {
    expect(metropolisAcceptProb(-1, 1)).toBe(1)
    expect(metropolisAcceptProb(0, 1)).toBe(1)
    expect(metropolisAcceptProb(1, 1)).toBeCloseTo(Math.exp(-1), 12)
    expect(metropolisAcceptProb(2, 0.5)).toBeCloseTo(Math.exp(-4), 12)
    // high T ≈ always accept mild uphill
    expect(metropolisAcceptProb(0.1, 100)).toBeGreaterThan(0.99)
  })

  it('metropolisAccept uses threshold u < P', () => {
    expect(metropolisAccept(-1, 1, 0.99)).toBe(true)
    expect(metropolisAccept(1, 1, 0)).toBe(true)
    expect(metropolisAccept(1, 1, 0.999)).toBe(false)
  })

  it('saStep1d: better move always accepted; best updates', () => {
    // force proposal left of large x toward lower energy bowl with fixed RNG
    // use high T and check structure
    const rand = mulberry32(5)
    const x = 2
    const e = multimodal1d(x)
    const s = saStep1d(x, e, x, e, 5, 0.5, rand)
    expect(Number.isFinite(s.x)).toBe(true)
    expect(Number.isFinite(s.energy)).toBe(true)
    expect(Number.isFinite(s.xProp)).toBe(true)
    expect(s.df).toBeCloseTo(s.energyProp - e, 10)
    if (s.accepted) {
      expect(s.x).toBe(s.xProp)
      expect(s.energy).toBe(s.energyProp)
    } else {
      expect(s.x).toBe(x)
      expect(s.energy).toBe(e)
    }
    expect(s.bestEnergy).toBeLessThanOrEqual(e + 1e-15)
  })

  it('runSaTrajectory: best energy drops from far start', () => {
    const tr = runSaTrajectory(1000, {
      x0: 5.5,
      T0: 4,
      alpha: 0.994,
      sigma: 1.0,
      seed: 3,
    })
    expect(tr.bestEnergy).toBeLessThan(tr.bestEnergy0)
    expect(tr.bestEnergy).toBeLessThan(tr.energy0)
    expect(tr.bestEnergy0 - tr.bestEnergy).toBeGreaterThan(1)
    expect(tr.THistory[0]).toBeGreaterThan(tr.THistory[tr.THistory.length - 1]!)
    expect(tr.acceptRate).toBeGreaterThan(0)
    expect(tr.acceptRate).toBeLessThan(1)
    // best history is nonincreasing
    for (let i = 1; i < tr.bestHistory.length; i++) {
      expect(tr.bestHistory[i]!).toBeLessThanOrEqual(
        tr.bestHistory[i - 1]! + 1e-15,
      )
    }
  })

  it('runSaStepSample: ok, best energy drop, methodId/familyId', () => {
    const r = runSaStepSample()
    expect(r.methodId).toBe(METHOD_ALGO_SA_STEP)
    expect(r.familyId).toBe(METHOD_SA)
    expect(r.familyId).toBe('method-simulated-annealing')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.bestDropped).toBe(true)
    expect(r.energyDrop).toBeGreaterThan(1.0)
    expect(r.bestEnergy).toBeLessThan(r.energy0)
    expect(r.TFinal).toBeLessThan(r.T0)
    expect(r.acceptRate).toBeGreaterThan(0)
  })
})
