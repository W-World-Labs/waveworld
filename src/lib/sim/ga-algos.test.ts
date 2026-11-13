import { describe, it, expect } from 'vitest'
import {
  METHOD_GA,
  METHOD_ALGO_GA_GENERATION,
  GA_PARENT,
  GA_METHOD_IDS,
  mulberry32,
  oneMaxFitness,
  randomBitstring,
  tournamentSelect,
  onePointCrossover,
  bitFlipMutate,
  evaluateOneMax,
  gaGenerationBits,
  runOneMaxGa,
  targetProximityFitness,
  randomRealVector,
  blendCrossover,
  gaussianMutate,
  evaluateTargetProximity,
  gaGenerationReal,
  runGaGenerationSample,
} from './ga-algos'

describe('GA · genetic algorithm OneMax + real-vector proximity', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_GA).toBe('method-genetic-algorithm')
    expect(METHOD_ALGO_GA_GENERATION).toBe('method-algo-ga-generation')
    expect(GA_PARENT).toBe(METHOD_GA)
    expect(GA_METHOD_IDS).toContain(METHOD_ALGO_GA_GENERATION)
  })

  it('mulberry32 reproducible and in [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a()]).toEqual([b(), b()])
  })

  it('oneMaxFitness counts ones', () => {
    expect(oneMaxFitness([0, 0, 0])).toBe(0)
    expect(oneMaxFitness([1, 0, 1, 1])).toBe(3)
    expect(oneMaxFitness(new Uint8Array([1, 1, 1, 1]))).toBe(4)
  })

  it('randomBitstring length and bits in {0,1}', () => {
    const rand = mulberry32(1)
    const g = randomBitstring(16, rand)
    expect(g.length).toBe(16)
    for (let i = 0; i < g.length; i++) {
      expect(g[i] === 0 || g[i] === 1).toBe(true)
    }
  })

  it('tournamentSelect picks highest among tour draws', () => {
    const fit = [1, 5, 2, 0]
    // with tour=n and enough draws, best of pop can be selected;
    // fixed seed: just check index is valid and fitness is max among candidates path
    const rand = mulberry32(9)
    const idx = tournamentSelect(fit, 4, rand)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(4)
    // many tournaments → mode is argmax
    const counts = [0, 0, 0, 0]
    const r2 = mulberry32(2)
    for (let i = 0; i < 200; i++) counts[tournamentSelect(fit, 3, r2)]!++
    const mode = counts.indexOf(Math.max(...counts))
    expect(mode).toBe(1) // fitness 5
  })

  it('onePointCrossover preserves alleles from parents', () => {
    const a = new Uint8Array([0, 0, 0, 0])
    const b = new Uint8Array([1, 1, 1, 1])
    const rand = () => 0.0 // cut = 1 + floor(0*(3)) = 1
    const [c1, c2] = onePointCrossover(a, b, rand)
    expect(c1[0]).toBe(0)
    expect(c1[1]).toBe(1)
    expect(c2[0]).toBe(1)
    expect(c2[1]).toBe(0)
  })

  it('bitFlipMutate with pMut=1 flips all; pMut=0 keeps', () => {
    const g = new Uint8Array([0, 1, 0, 1])
    bitFlipMutate(g, 0, mulberry32(1))
    expect([...g]).toEqual([0, 1, 0, 1])
    bitFlipMutate(g, 1, mulberry32(1))
    expect([...g]).toEqual([1, 0, 1, 0])
  })

  it('gaGenerationBits: best fitness nondecreasing with elitism', () => {
    const rand = mulberry32(5)
    const pop: Uint8Array[] = []
    for (let i = 0; i < 20; i++) pop.push(randomBitstring(12, rand))
    const before = evaluateOneMax(pop)
    const after = gaGenerationBits(before.pop, {
      tour: 3,
      pCross: 0.9,
      pMut: 1 / 12,
      elitism: true,
      rand,
    })
    expect(after.bestFitness).toBeGreaterThanOrEqual(before.bestFitness)
    expect(after.pop.length).toBe(20)
  })

  it('runOneMaxGa: max fitness increases over generations', () => {
    const r = runOneMaxGa(40, {
      popSize: 40,
      L: 20,
      seed: 13,
      pMut: 1 / 20,
    })
    expect(r.bestFitness).toBeGreaterThan(r.bestFitness0)
    expect(r.bestHistory[r.bestHistory.length - 1]).toBe(r.bestFitness)
    // elitism: best history nondecreasing
    for (let i = 1; i < r.bestHistory.length; i++) {
      expect(r.bestHistory[i]!).toBeGreaterThanOrEqual(r.bestHistory[i - 1]!)
    }
  })

  it('targetProximityFitness: 0 at target, negative elsewhere', () => {
    const t = [1, 2, 3]
    expect(targetProximityFitness(t, t)).toBeCloseTo(0, 12)
    expect(targetProximityFitness([1, 2, 4], t)).toBeCloseTo(-1, 12)
  })

  it('blendCrossover convex combination', () => {
    const a = [0, 0]
    const b = [2, 4]
    const [c1, c2] = blendCrossover(a, b, () => 0.25)
    expect(c1[0]).toBeCloseTo(0.25 * 0 + 0.75 * 2, 12)
    expect(c1[1]).toBeCloseTo(0.25 * 0 + 0.75 * 4, 12)
    expect(c2[0]).toBeCloseTo(0.75 * 0 + 0.25 * 2, 12)
  })

  it('gaussianMutate changes vector with sigma>0', () => {
    const x = new Float64Array([0, 0, 0])
    const copy = new Float64Array(x)
    gaussianMutate(x, 0.5, mulberry32(8))
    let diff = 0
    for (let i = 0; i < 3; i++) diff += Math.abs(x[i]! - copy[i]!)
    expect(diff).toBeGreaterThan(0)
  })

  it('gaGenerationReal: best fitness improves toward target', () => {
    const target = new Float64Array([1, 1, 1])
    const rand = mulberry32(21)
    let pop: Float64Array[] = []
    for (let i = 0; i < 24; i++) pop.push(randomRealVector(3, -2, 2, rand))
    let st = evaluateTargetProximity(pop, target)
    const f0 = st.bestFitness
    for (let g = 0; g < 30; g++) {
      st = gaGenerationReal(st.pop, target, {
        tour: 3,
        sigma: 0.2,
        elitism: true,
        rand,
      })
    }
    expect(st.bestFitness).toBeGreaterThan(f0)
    expect(st.bestFitness).toBeGreaterThan(-0.8)
  })

  it('runGaGenerationSample: ok, fitness up, methodId/familyId', () => {
    const r = runGaGenerationSample()
    expect(r.methodId).toBe(METHOD_ALGO_GA_GENERATION)
    expect(r.familyId).toBe(METHOD_GA)
    expect(r.familyId).toBe('method-genetic-algorithm')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.fitnessIncreased).toBe(true)
    expect(r.bestFitness).toBeGreaterThan(r.bestFitness0)
    expect(r.bestFitness).toBeGreaterThanOrEqual(r.bestFitness0 + 2)
    expect(r.realImproved).toBe(true)
    expect(r.realBest).toBeGreaterThan(r.realBest0)
    expect(r.realBest).toBeGreaterThan(-0.6)
  })
})
