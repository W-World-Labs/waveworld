/**
 * Genetic algorithm pure teaching stubs.
 * Bitstring OneMax and real-vector maximize −‖x−target‖;
 * tournament select, one-point / blend crossover, bit-flip / Gaussian mutate.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · genetic algorithm. */
export const METHOD_GA = 'method-genetic-algorithm'

/** Algo · one generation (select → crossover → mutate → replace). */
export const METHOD_ALGO_GA_GENERATION = 'method-algo-ga-generation'

/** Parent alias (aligns with familyId). */
export const GA_PARENT = METHOD_GA

export const GA_METHOD_IDS = [METHOD_ALGO_GA_GENERATION] as const

/** Deterministic RNG (mulberry32); same seed → same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Bitstring OneMax ───────────────────────────────────────────────────────

/** Fitness = number of 1-bits (maximize). */
export function oneMaxFitness(bits: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) s++
  }
  return s
}

/** Random bitstring of length L with bits in {0,1}. */
export function randomBitstring(L: number, rand: () => number): Uint8Array {
  if (!(L > 0) || !Number.isInteger(L)) {
    throw new Error('randomBitstring: L must be positive integer')
  }
  const g = new Uint8Array(L)
  for (let i = 0; i < L; i++) g[i] = rand() < 0.5 ? 0 : 1
  return g
}

/**
 * Tournament selection: pick `tour` random indices, return best fitness index.
 * Higher fitness wins (maximization).
 */
export function tournamentSelect(
  fitness: ArrayLike<number>,
  tour: number,
  rand: () => number,
): number {
  const n = fitness.length
  if (!(n > 0)) throw new Error('tournamentSelect: empty population')
  if (!(tour >= 1) || !Number.isInteger(tour)) {
    throw new Error('tournamentSelect: tour must be integer ≥ 1')
  }
  let best = Math.floor(rand() * n) % n
  let bestF = fitness[best]!
  for (let k = 1; k < tour; k++) {
    const j = Math.floor(rand() * n) % n
    if (fitness[j]! > bestF) {
      best = j
      bestF = fitness[j]!
    }
  }
  return best
}

/**
 * One-point crossover: cut in [1, L−1], swap tails.
 * If L < 2, returns clones of parents.
 */
export function onePointCrossover(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  rand: () => number,
): [Uint8Array, Uint8Array] {
  const L = a.length
  if (L !== b.length) throw new Error('onePointCrossover: length mismatch')
  const c1 = new Uint8Array(L)
  const c2 = new Uint8Array(L)
  if (L < 2) {
    for (let i = 0; i < L; i++) {
      c1[i] = a[i]! ? 1 : 0
      c2[i] = b[i]! ? 1 : 0
    }
    return [c1, c2]
  }
  const cut = 1 + Math.floor(rand() * (L - 1))
  for (let i = 0; i < L; i++) {
    if (i < cut) {
      c1[i] = a[i]! ? 1 : 0
      c2[i] = b[i]! ? 1 : 0
    } else {
      c1[i] = b[i]! ? 1 : 0
      c2[i] = a[i]! ? 1 : 0
    }
  }
  return [c1, c2]
}

/** Bit-flip mutation: each bit flips with probability pMut. */
export function bitFlipMutate(
  bits: Uint8Array,
  pMut: number,
  rand: () => number,
): void {
  if (!(pMut >= 0) || !(pMut <= 1) || !Number.isFinite(pMut)) {
    throw new Error('bitFlipMutate: pMut must be in [0,1]')
  }
  for (let i = 0; i < bits.length; i++) {
    if (rand() < pMut) bits[i] = bits[i]! ? 0 : 1
  }
}

export type GaBitPop = {
  pop: Uint8Array[]
  fitness: Float64Array
  bestFitness: number
  meanFitness: number
  bestIndex: number
}

/** Evaluate OneMax fitness for whole population. */
export function evaluateOneMax(pop: Uint8Array[]): GaBitPop {
  const n = pop.length
  const fitness = new Float64Array(n)
  let bestFitness = -Infinity
  let bestIndex = 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const f = oneMaxFitness(pop[i]!)
    fitness[i] = f
    sum += f
    if (f > bestFitness) {
      bestFitness = f
      bestIndex = i
    }
  }
  return {
    pop,
    fitness,
    bestFitness,
    meanFitness: n > 0 ? sum / n : 0,
    bestIndex,
  }
}

/**
 * One generational GA step on bitstrings (OneMax):
 * tournament → crossover → mutate → full replace (keep pop size even-friendly).
 * Elitism: inject previous best into next[0] if enabled.
 */
export function gaGenerationBits(
  pop: Uint8Array[],
  opts: {
    tour?: number
    pCross?: number
    pMut?: number
    elitism?: boolean
    rand: () => number
  },
): GaBitPop {
  const n = pop.length
  if (!(n >= 2)) throw new Error('gaGenerationBits: need pop size ≥ 2')
  const tour = opts.tour ?? 3
  const pCross = opts.pCross ?? 0.9
  const pMut = opts.pMut ?? 1 / Math.max(pop[0]!.length, 1)
  const elitism = opts.elitism !== false
  const rand = opts.rand

  const cur = evaluateOneMax(pop)
  const next: Uint8Array[] = new Array(n)
  let filled = 0

  if (elitism) {
    next[0] = new Uint8Array(pop[cur.bestIndex]!)
    filled = 1
  }

  while (filled < n) {
    const i1 = tournamentSelect(cur.fitness, tour, rand)
    const i2 = tournamentSelect(cur.fitness, tour, rand)
    let c1: Uint8Array
    let c2: Uint8Array
    if (rand() < pCross) {
      ;[c1, c2] = onePointCrossover(pop[i1]!, pop[i2]!, rand)
    } else {
      c1 = new Uint8Array(pop[i1]!)
      c2 = new Uint8Array(pop[i2]!)
    }
    bitFlipMutate(c1, pMut, rand)
    bitFlipMutate(c2, pMut, rand)
    next[filled++] = c1
    if (filled < n) next[filled++] = c2
  }

  return evaluateOneMax(next)
}

/**
 * Initialize random OneMax population and run `generations` GA steps.
 */
export function runOneMaxGa(
  generations: number,
  opts: {
    popSize?: number
    L?: number
    tour?: number
    pCross?: number
    pMut?: number
    seed?: number
    elitism?: boolean
  } = {},
): {
  generations: number
  bestHistory: Float64Array
  meanHistory: Float64Array
  bestFitness0: number
  bestFitness: number
  meanFitness: number
  L: number
  popSize: number
  finalPop: GaBitPop
} {
  if (!(generations > 0) || !Number.isFinite(generations)) {
    throw new Error('runOneMaxGa: generations must be positive finite')
  }
  const G = Math.floor(generations)
  const popSize = opts.popSize ?? 40
  const L = opts.L ?? 32
  const seed = opts.seed ?? 7
  const rand = mulberry32(seed)

  let pop: Uint8Array[] = []
  for (let i = 0; i < popSize; i++) pop.push(randomBitstring(L, rand))

  let state = evaluateOneMax(pop)
  const bestHistory = new Float64Array(G + 1)
  const meanHistory = new Float64Array(G + 1)
  bestHistory[0] = state.bestFitness
  meanHistory[0] = state.meanFitness
  const bestFitness0 = state.bestFitness

  for (let g = 0; g < G; g++) {
    state = gaGenerationBits(state.pop, {
      tour: opts.tour,
      pCross: opts.pCross,
      pMut: opts.pMut ?? 1 / L,
      elitism: opts.elitism,
      rand,
    })
    bestHistory[g + 1] = state.bestFitness
    meanHistory[g + 1] = state.meanFitness
  }

  return {
    generations: G,
    bestHistory,
    meanHistory,
    bestFitness0,
    bestFitness: state.bestFitness,
    meanFitness: state.meanFitness,
    L,
    popSize,
    finalPop: state,
  }
}

// ─── Real-vector maximize −‖x − target‖ ─────────────────────────────────────

/** Fitness = −‖x − target‖₂ (maximize → approach target). */
export function targetProximityFitness(
  x: ArrayLike<number>,
  target: ArrayLike<number>,
): number {
  if (x.length !== target.length) {
    throw new Error('targetProximityFitness: length mismatch')
  }
  let s = 0
  for (let i = 0; i < x.length; i++) {
    const d = x[i]! - target[i]!
    s += d * d
  }
  return -Math.sqrt(s)
}

/** Uniform random vector in [lo, hi]^dim. */
export function randomRealVector(
  dim: number,
  lo: number,
  hi: number,
  rand: () => number,
): Float64Array {
  const v = new Float64Array(dim)
  const span = hi - lo
  for (let i = 0; i < dim; i++) v[i] = lo + rand() * span
  return v
}

/**
 * Blend crossover: child = α a + (1−α) b with α ~ U(0,1).
 * Returns two complementary children.
 */
export function blendCrossover(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  rand: () => number,
): [Float64Array, Float64Array] {
  const d = a.length
  if (d !== b.length) throw new Error('blendCrossover: length mismatch')
  const c1 = new Float64Array(d)
  const c2 = new Float64Array(d)
  const alpha = rand()
  const beta = 1 - alpha
  for (let i = 0; i < d; i++) {
    c1[i] = alpha * a[i]! + beta * b[i]!
    c2[i] = beta * a[i]! + alpha * b[i]!
  }
  return [c1, c2]
}

/** Additive Gaussian-ish mutate via Box–Muller lite: two U → N(0,1) scale. */
export function gaussianMutate(
  x: Float64Array,
  sigma: number,
  rand: () => number,
): void {
  if (!(sigma >= 0) || !Number.isFinite(sigma)) {
    throw new Error('gaussianMutate: sigma must be finite and ≥ 0')
  }
  for (let i = 0; i < x.length; i++) {
    // Box–Muller
    const u1 = Math.max(rand(), 1e-12)
    const u2 = rand()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    x[i]! += sigma * z
  }
}

export type GaRealPop = {
  pop: Float64Array[]
  fitness: Float64Array
  bestFitness: number
  meanFitness: number
  bestIndex: number
}

export function evaluateTargetProximity(
  pop: Float64Array[],
  target: ArrayLike<number>,
): GaRealPop {
  const n = pop.length
  const fitness = new Float64Array(n)
  let bestFitness = -Infinity
  let bestIndex = 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const f = targetProximityFitness(pop[i]!, target)
    fitness[i] = f
    sum += f
    if (f > bestFitness) {
      bestFitness = f
      bestIndex = i
    }
  }
  return {
    pop,
    fitness,
    bestFitness,
    meanFitness: n > 0 ? sum / n : 0,
    bestIndex,
  }
}

/**
 * One generation on real vectors with target-proximity fitness.
 */
export function gaGenerationReal(
  pop: Float64Array[],
  target: ArrayLike<number>,
  opts: {
    tour?: number
    pCross?: number
    sigma?: number
    elitism?: boolean
    rand: () => number
  },
): GaRealPop {
  const n = pop.length
  if (!(n >= 2)) throw new Error('gaGenerationReal: need pop size ≥ 2')
  const tour = opts.tour ?? 3
  const pCross = opts.pCross ?? 0.9
  const sigma = opts.sigma ?? 0.15
  const elitism = opts.elitism !== false
  const rand = opts.rand

  const cur = evaluateTargetProximity(pop, target)
  const next: Float64Array[] = new Array(n)
  let filled = 0

  if (elitism) {
    next[0] = new Float64Array(pop[cur.bestIndex]!)
    filled = 1
  }

  while (filled < n) {
    const i1 = tournamentSelect(cur.fitness, tour, rand)
    const i2 = tournamentSelect(cur.fitness, tour, rand)
    let c1: Float64Array
    let c2: Float64Array
    if (rand() < pCross) {
      ;[c1, c2] = blendCrossover(pop[i1]!, pop[i2]!, rand)
    } else {
      c1 = new Float64Array(pop[i1]!)
      c2 = new Float64Array(pop[i2]!)
    }
    gaussianMutate(c1, sigma, rand)
    gaussianMutate(c2, sigma, rand)
    next[filled++] = c1
    if (filled < n) next[filled++] = c2
  }

  return evaluateTargetProximity(next, target)
}

/**
 * Representative sample: OneMax GA over generations.
 * Max fitness increases; ok teaching gate.
 */
export function runGaGenerationSample(
  opts: {
    generations?: number
    popSize?: number
    L?: number
    seed?: number
    /** Also run a short real-vector proximity GA for dual coverage. */
    realDim?: number
    realGens?: number
  } = {},
): {
  generations: number
  L: number
  popSize: number
  bestFitness0: number
  bestFitness: number
  fitnessIncreased: boolean
  meanFitness: number
  solved: boolean
  realBest0: number
  realBest: number
  realImproved: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_GA_GENERATION
  familyId: typeof METHOD_GA
} {
  const generations = opts.generations ?? 80
  const popSize = opts.popSize ?? 60
  const L = opts.L ?? 32
  const seed = opts.seed ?? 11

  const bit = runOneMaxGa(generations, {
    popSize,
    L,
    seed,
    tour: 3,
    pCross: 0.9,
    pMut: 1 / L,
    elitism: true,
  })

  const fitnessIncreased = bit.bestFitness > bit.bestFitness0 + 1e-12
  const solved = bit.bestFitness >= L

  // Real-vector: maximize −‖x−target‖
  const realDim = opts.realDim ?? 3
  const realGens = opts.realGens ?? 50
  const target = new Float64Array(realDim)
  for (let i = 0; i < realDim; i++) target[i] = 1
  const randR = mulberry32(seed + 99)
  const rpop: Float64Array[] = []
  for (let i = 0; i < 40; i++) {
    rpop.push(randomRealVector(realDim, -2, 2, randR))
  }
  let rstate = evaluateTargetProximity(rpop, target)
  const realBest0 = rstate.bestFitness
  for (let g = 0; g < realGens; g++) {
    rstate = gaGenerationReal(rstate.pop, target, {
      tour: 3,
      pCross: 0.85,
      sigma: 0.15,
      elitism: true,
      rand: randR,
    })
  }
  const realBest = rstate.bestFitness
  const realImproved = realBest > realBest0 + 1e-9

  const finite =
    Number.isFinite(bit.bestFitness) &&
    Number.isFinite(bit.meanFitness) &&
    Number.isFinite(realBest) &&
    Number.isFinite(realBest0)

  const ok =
    finite &&
    fitnessIncreased &&
    bit.bestFitness >= bit.bestFitness0 + 2 &&
    realImproved &&
    realBest > -0.6

  return {
    generations: bit.generations,
    L: bit.L,
    popSize: bit.popSize,
    bestFitness0: bit.bestFitness0,
    bestFitness: bit.bestFitness,
    fitnessIncreased,
    meanFitness: bit.meanFitness,
    solved,
    realBest0,
    realBest,
    realImproved,
    finite,
    ok,
    methodId: METHOD_ALGO_GA_GENERATION,
    familyId: METHOD_GA,
  }
}
