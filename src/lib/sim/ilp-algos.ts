/**
 * Branch-and-bound ILP toy · 0-1 knapsack (small pure IP).
 * Branch on free binary variables; prune by fractional (LP/greedy) bound;
 * recover optimal integer value for n ≤ 8 teaching instances.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · integer linear programming. */
export const METHOD_ILP = 'method-ilp'

/** Algo · branch-and-bound on 0-1 IP. */
export const METHOD_ALGO_BNB = 'method-algo-bnb'

/** Parent alias (aligns with familyId). */
export const ILP_PARENT = METHOD_ILP

export const ILP_METHOD_IDS = [METHOD_ALGO_BNB] as const

/** 0-1 knapsack: max v·x s.t. w·x ≤ capacity, x_i ∈ {0,1}. */
export type Knapsack01 = {
  values: number[]
  weights: number[]
  capacity: number
}

export type BnbNodeStats = {
  /** nodes expanded (branched or evaluated as leaves) */
  nodes: number
  /** nodes pruned by bound */
  pruned: number
  /** integer-feasible solutions found */
  incumbents: number
}

export type BnbResult = {
  /** optimal objective (max value), or −∞ if infeasible */
  bestValue: number
  /** binary solution (length n); empty if infeasible */
  bestX: number[]
  stats: BnbNodeStats
  /** true if a feasible solution was found */
  feasible: boolean
}

/**
 * Default teaching knapsack (n=6, capacity 12).
 * Optimum value 90 at x = [1,0,1,0,0,0] (items 0+2, weight 11).
 */
export function makeDefaultKnapsack(): Knapsack01 {
  return {
    values: [45, 30, 45, 10, 45, 40],
    weights: [5, 4, 6, 3, 5, 4],
    capacity: 12,
  }
}

/** Validate knapsack dims and nonnegativity; n ≤ 8 for toy BnB. */
export function assertKnapsack01(inst: Knapsack01, maxN = 8): number {
  const n = inst.values.length
  if (n !== inst.weights.length) {
    throw new Error('assertKnapsack01: values/weights length mismatch')
  }
  if (!(n > 0) || n > maxN || !Number.isInteger(n)) {
    throw new Error(`assertKnapsack01: need 1 ≤ n ≤ ${maxN}`)
  }
  if (!(inst.capacity >= 0) || !Number.isFinite(inst.capacity)) {
    throw new Error('assertKnapsack01: capacity must be finite and ≥ 0')
  }
  for (let i = 0; i < n; i++) {
    if (!(inst.values[i]! >= 0) || !Number.isFinite(inst.values[i]!)) {
      throw new Error(`assertKnapsack01: value[${i}] must be finite ≥ 0`)
    }
    if (!(inst.weights[i]! >= 0) || !Number.isFinite(inst.weights[i]!)) {
      throw new Error(`assertKnapsack01: weight[${i}] must be finite ≥ 0`)
    }
  }
  return n
}

/** Objective value of a 0-1 vector (no capacity check). */
export function knapsackValue(
  values: ArrayLike<number>,
  x: ArrayLike<number>,
): number {
  let s = 0
  for (let i = 0; i < values.length; i++) s += values[i]! * (x[i]! ? 1 : 0)
  return s
}

/** Total weight of a 0-1 vector. */
export function knapsackWeight(
  weights: ArrayLike<number>,
  x: ArrayLike<number>,
): number {
  let s = 0
  for (let i = 0; i < weights.length; i++) s += weights[i]! * (x[i]! ? 1 : 0)
  return s
}

/**
 * Fractional knapsack upper bound (LP relaxation of 0-1 knapsack).
 * Free items sorted by value/weight density; fill residual capacity fractionally.
 * Fixed bits in `fixed` (−1 free, 0/1 assigned) already applied; residual capacity
 * and partial value are taken into account.
 *
 * Returns −∞ if fixed assignment already exceeds capacity.
 */
export function fractionalBound(
  inst: Knapsack01,
  fixed: ArrayLike<number>,
): number {
  const n = inst.values.length
  let value = 0
  let rem = inst.capacity
  for (let i = 0; i < n; i++) {
    const f = fixed[i]!
    if (f === 1) {
      value += inst.values[i]!
      rem -= inst.weights[i]!
    } else if (f !== 0 && f !== -1) {
      throw new Error('fractionalBound: fixed entries must be −1, 0, or 1')
    }
  }
  if (rem < -1e-12) return Number.NEGATIVE_INFINITY

  // free indices sorted by density desc
  const free: number[] = []
  for (let i = 0; i < n; i++) {
    if (fixed[i] === -1) free.push(i)
  }
  free.sort((a, b) => {
    const da =
      inst.weights[a]! > 0
        ? inst.values[a]! / inst.weights[a]!
        : inst.values[a]! > 0
          ? Number.POSITIVE_INFINITY
          : 0
    const db =
      inst.weights[b]! > 0
        ? inst.values[b]! / inst.weights[b]!
        : inst.values[b]! > 0
          ? Number.POSITIVE_INFINITY
          : 0
    return db - da
  })

  for (const i of free) {
    if (rem <= 1e-15) break
    const w = inst.weights[i]!
    const v = inst.values[i]!
    if (w <= rem + 1e-15) {
      value += v
      rem -= w
    } else {
      // fractional take
      if (w > 0) value += (v * rem) / w
      rem = 0
      break
    }
  }
  return value
}

/**
 * Exhaustive 0-1 search (2^n); for n ≤ 8 teaching verification only.
 * Returns best value and one optimal bitstring.
 */
export function bruteForce01(inst: Knapsack01): {
  bestValue: number
  bestX: number[]
  feasible: boolean
} {
  const n = assertKnapsack01(inst)
  let bestValue = Number.NEGATIVE_INFINITY
  let bestX: number[] = []
  const total = 1 << n
  for (let mask = 0; mask < total; mask++) {
    let w = 0
    let v = 0
    const x = new Array<number>(n)
    for (let i = 0; i < n; i++) {
      const b = (mask >> i) & 1
      x[i] = b
      if (b) {
        w += inst.weights[i]!
        v += inst.values[i]!
      }
    }
    if (w <= inst.capacity + 1e-12 && v > bestValue) {
      bestValue = v
      bestX = x
    }
  }
  if (!Number.isFinite(bestValue)) {
    return { bestValue: Number.NEGATIVE_INFINITY, bestX: [], feasible: false }
  }
  return { bestValue, bestX, feasible: true }
}

/**
 * Branch-and-bound 0-1 knapsack.
 * DFS branch on first free variable; prune when fractional bound ≤ incumbent.
 * At leaves (all fixed), accept if capacity-feasible.
 */
export function branchAndBound01(inst: Knapsack01): BnbResult {
  const n = assertKnapsack01(inst)
  const fixed = new Array<number>(n).fill(-1)
  let bestValue = Number.NEGATIVE_INFINITY
  let bestX: number[] = []
  let nodes = 0
  let pruned = 0
  let incumbents = 0

  const recurse = (): void => {
    nodes++
    // residual capacity check from fixed-1s
    let used = 0
    let partial = 0
    let freeCount = 0
    let firstFree = -1
    for (let i = 0; i < n; i++) {
      if (fixed[i] === 1) {
        used += inst.weights[i]!
        partial += inst.values[i]!
      } else if (fixed[i] === -1) {
        if (firstFree < 0) firstFree = i
        freeCount++
      }
    }
    if (used > inst.capacity + 1e-12) {
      pruned++
      return
    }

    const ub = fractionalBound(inst, fixed)
    if (!(ub > bestValue + 1e-12)) {
      pruned++
      return
    }

    if (freeCount === 0) {
      // integer leaf
      if (partial > bestValue) {
        bestValue = partial
        bestX = fixed.slice()
        incumbents++
      }
      return
    }

    // branch: x_j = 1 then x_j = 0 (try include first for better incumbents)
    const j = firstFree
    fixed[j] = 1
    recurse()
    fixed[j] = 0
    recurse()
    fixed[j] = -1
  }

  recurse()

  const feasible = Number.isFinite(bestValue) && bestX.length === n
  return {
    bestValue: feasible ? bestValue : Number.NEGATIVE_INFINITY,
    bestX: feasible ? bestX : [],
    stats: { nodes, pruned, incumbents },
    feasible,
  }
}

/**
 * Representative sample: BnB on default knapsack vs brute force.
 * ok when optimum matches exhaustive search and pruning occurred.
 */
export function runBnbSample(
  opts: { inst?: Knapsack01 } = {},
): {
  n: number
  capacity: number
  bestValue: number
  bruteValue: number
  matchesBrute: boolean
  weight: number
  feasible: boolean
  nodes: number
  pruned: number
  incumbents: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BNB
  familyId: typeof METHOD_ILP
} {
  const inst = opts.inst ?? makeDefaultKnapsack()
  const n = assertKnapsack01(inst)
  const bnb = branchAndBound01(inst)
  const brute = bruteForce01(inst)

  const matchesBrute =
    bnb.feasible === brute.feasible &&
    Math.abs(bnb.bestValue - brute.bestValue) < 1e-9

  let weight = 0
  if (bnb.feasible) weight = knapsackWeight(inst.weights, bnb.bestX)

  const finite =
    Number.isFinite(bnb.bestValue) &&
    Number.isFinite(brute.bestValue) &&
    Number.isFinite(weight) &&
    bnb.stats.nodes > 0

  const ok =
    finite &&
    bnb.feasible &&
    matchesBrute &&
    weight <= inst.capacity + 1e-9 &&
    bnb.stats.pruned > 0 &&
    bnb.bestValue > 0

  return {
    n,
    capacity: inst.capacity,
    bestValue: bnb.bestValue,
    bruteValue: brute.bestValue,
    matchesBrute,
    weight,
    feasible: bnb.feasible,
    nodes: bnb.stats.nodes,
    pruned: bnb.stats.pruned,
    incumbents: bnb.stats.incumbents,
    finite,
    ok,
    methodId: METHOD_ALGO_BNB,
    familyId: METHOD_ILP,
  }
}
