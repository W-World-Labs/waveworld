import { describe, it, expect } from 'vitest'
import {
  METHOD_ILP,
  METHOD_ALGO_BNB,
  ILP_PARENT,
  ILP_METHOD_IDS,
  makeDefaultKnapsack,
  assertKnapsack01,
  knapsackValue,
  knapsackWeight,
  fractionalBound,
  bruteForce01,
  branchAndBound01,
  runBnbSample,
} from './ilp-algos'

describe('ILP · branch-and-bound 0-1 knapsack', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ILP).toBe('method-ilp')
    expect(METHOD_ALGO_BNB).toBe('method-algo-bnb')
    expect(ILP_PARENT).toBe(METHOD_ILP)
    expect(ILP_METHOD_IDS).toContain(METHOD_ALGO_BNB)
  })

  it('assertKnapsack01 / makeDefaultKnapsack dims', () => {
    const inst = makeDefaultKnapsack()
    expect(assertKnapsack01(inst)).toBe(6)
    expect(inst.capacity).toBe(12)
    expect(() =>
      assertKnapsack01({ values: [1], weights: [1, 2], capacity: 1 }),
    ).toThrow()
  })

  it('fractionalBound: free root ≥ integer opt; fixed overload → −∞', () => {
    const inst = makeDefaultKnapsack()
    const free = new Array(inst.values.length).fill(-1)
    const ub = fractionalBound(inst, free)
    const brute = bruteForce01(inst)
    expect(ub).toBeGreaterThanOrEqual(brute.bestValue - 1e-9)
    expect(Number.isFinite(ub)).toBe(true)

    // force both heavy items that exceed capacity
    const fixed = free.slice()
    fixed[0] = 1
    fixed[2] = 1
    fixed[4] = 1 // 5+6+5=16 > 12
    expect(fractionalBound(inst, fixed)).toBe(Number.NEGATIVE_INFINITY)
  })

  it('fractionalBound: all fixed feasible equals integer value', () => {
    const inst = makeDefaultKnapsack()
    // [1,0,1,0,0,0] value 90, weight 11 — fully fixed, bound = value
    const fixed = [1, 0, 1, 0, 0, 0]
    expect(fractionalBound(inst, fixed)).toBeCloseTo(90, 10)
  })

  it('bruteForce01 finds feasible optimum for default instance', () => {
    const inst = makeDefaultKnapsack()
    const r = bruteForce01(inst)
    expect(r.feasible).toBe(true)
    expect(r.bestValue).toBe(95)
    expect(knapsackWeight(inst.weights, r.bestX)).toBeLessThanOrEqual(
      inst.capacity,
    )
    expect(knapsackValue(inst.values, r.bestX)).toBe(95)
  })

  it('branchAndBound01 matches brute force on default', () => {
    const inst = makeDefaultKnapsack()
    const bnb = branchAndBound01(inst)
    const brute = bruteForce01(inst)
    expect(bnb.feasible).toBe(true)
    expect(bnb.bestValue).toBe(brute.bestValue)
    expect(knapsackValue(inst.values, bnb.bestX)).toBe(bnb.bestValue)
    expect(knapsackWeight(inst.weights, bnb.bestX)).toBeLessThanOrEqual(
      inst.capacity,
    )
    expect(bnb.stats.nodes).toBeGreaterThan(1)
    expect(bnb.stats.pruned).toBeGreaterThan(0)
  })

  it('branchAndBound01: tiny n=3 exact', () => {
    const inst = {
      values: [6, 5, 8],
      weights: [2, 3, 4],
      capacity: 5,
    }
    // feasible: {0,1} w=5 v=11; {0} v=6; {1} v=5; {2} v=8; {} v=0 → opt 11
    const bnb = branchAndBound01(inst)
    const brute = bruteForce01(inst)
    expect(bnb.bestValue).toBe(11)
    expect(bnb.bestValue).toBe(brute.bestValue)
    expect(bnb.bestX).toEqual([1, 1, 0])
  })

  it('branchAndBound01: empty capacity still feasible with zeros', () => {
    const inst = { values: [3, 4], weights: [1, 2], capacity: 0 }
    const bnb = branchAndBound01(inst)
    expect(bnb.feasible).toBe(true)
    expect(bnb.bestValue).toBe(0)
    expect(bnb.bestX).toEqual([0, 0])
  })

  it('runBnbSample: ok, familyId method-ilp', () => {
    const r = runBnbSample()
    expect(r.methodId).toBe(METHOD_ALGO_BNB)
    expect(r.familyId).toBe(METHOD_ILP)
    expect(r.familyId).toBe('method-ilp')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.matchesBrute).toBe(true)
    expect(r.bestValue).toBe(r.bruteValue)
    expect(r.bestValue).toBe(95)
    expect(r.weight).toBeLessThanOrEqual(r.capacity)
    expect(r.pruned).toBeGreaterThan(0)
    expect(r.nodes).toBeGreaterThan(0)
  })
})
