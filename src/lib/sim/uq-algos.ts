/**
 * Uncertainty quantification · Monte Carlo input propagation (pure algo).
 * y = g(x) with x ~ N(mu, sig) or Uniform; estimate mean / var of y.
 * Analytic moments for linear g; method id constants only (no catalog).
 */

/** Family · uncertainty quantification. */
export const METHOD_UQ = 'method-uq'

/** Algo · Monte Carlo UQ propagation. */
export const METHOD_ALGO_UQ_MC = 'method-algo-uq-mc'

/** Parent alias (aligns with familyId). */
export const UQ_PARENT = METHOD_UQ

export const UQ_METHOD_IDS = [METHOD_ALGO_UQ_MC] as const

/** Scalar map g: R → R. */
export type ScalarMap = (x: number) => number

export type InputDist =
  | { kind: 'normal'; mu: number; sigma: number }
  | { kind: 'uniform'; lo: number; hi: number }

export type UqMoments = {
  mean: number
  variance: number
  n: number
}

export type UqMcResult = {
  mean: number
  variance: number
  std: number
  n: number
  samples: Float64Array
}

/** Deterministic RNG (mulberry32); same seed → same stream. */
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

/**
 * Box–Muller standard normal from U(0,1)×U(0,1).
 * Returns one N(0,1); second draw cached on the RNG object for pairing.
 */
export function sampleStandardNormal(rand: () => number): number {
  // polar Box–Muller (Marsaglia)
  let u = 0
  let v = 0
  let s = 0
  do {
    u = 2 * rand() - 1
    v = 2 * rand() - 1
    s = u * u + v * v
  } while (!(s > 0) || s >= 1)
  const mul = Math.sqrt((-2 * Math.log(s)) / s)
  return u * mul
}

/** Draw one sample from the input distribution. */
export function sampleInput(dist: InputDist, rand: () => number): number {
  if (dist.kind === 'normal') {
    if (!(dist.sigma >= 0) || !Number.isFinite(dist.mu) || !Number.isFinite(dist.sigma)) {
      throw new Error('sampleInput: normal needs finite mu, sigma≥0')
    }
    return dist.mu + dist.sigma * sampleStandardNormal(rand)
  }
  const lo = dist.lo
  const hi = dist.hi
  if (!(hi >= lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new Error('sampleInput: uniform needs finite lo≤hi')
  }
  return lo + (hi - lo) * rand()
}

/** Sample mean and (unbiased, n−1) sample variance of values. */
export function sampleMoments(vals: ArrayLike<number>): UqMoments {
  const n = vals.length
  if (n === 0) return { mean: 0, variance: 0, n: 0 }
  let mean = 0
  for (let i = 0; i < n; i++) mean += vals[i]!
  mean /= n
  if (n === 1) return { mean, variance: 0, n: 1 }
  let ss = 0
  for (let i = 0; i < n; i++) {
    const d = vals[i]! - mean
    ss += d * d
  }
  return { mean, variance: ss / (n - 1), n }
}

/**
 * Analytic mean / var of y = a x + b under Normal or Uniform x.
 * E[y] = a E[x] + b, Var[y] = a² Var[x].
 */
export function analyticLinearMoments(
  a: number,
  b: number,
  dist: InputDist,
): { mean: number; variance: number } {
  let ex: number
  let vx: number
  if (dist.kind === 'normal') {
    if (!(dist.sigma >= 0)) throw new Error('analyticLinearMoments: sigma≥0')
    ex = dist.mu
    vx = dist.sigma * dist.sigma
  } else {
    if (!(dist.hi >= dist.lo)) throw new Error('analyticLinearMoments: lo≤hi')
    const w = dist.hi - dist.lo
    ex = 0.5 * (dist.lo + dist.hi)
    vx = (w * w) / 12
  }
  return { mean: a * ex + b, variance: a * a * vx }
}

/**
 * Monte Carlo UQ: draw n samples of x, evaluate y = g(x), return moments.
 */
export function uqMcPropagate(
  g: ScalarMap,
  dist: InputDist,
  n: number,
  seed = 1,
): UqMcResult {
  if (!(n >= 1) || !Number.isFinite(n)) {
    throw new Error('uqMcPropagate: n must be ≥ 1')
  }
  const N = Math.floor(n)
  const rand = mulberry32(seed)
  const samples = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const x = sampleInput(dist, rand)
    samples[i] = g(x)
  }
  const m = sampleMoments(samples)
  return {
    mean: m.mean,
    variance: m.variance,
    std: Math.sqrt(Math.max(0, m.variance)),
    n: m.n,
    samples,
  }
}

/**
 * Representative sample: MC UQ for linear g under Normal and Uniform,
 * compared to analytic moments. ok teaching gate.
 */
export function runUqMcSample(
  opts: {
    n?: number
    seed?: number
    a?: number
    b?: number
    mu?: number
    sigma?: number
    lo?: number
    hi?: number
  } = {},
): {
  n: number
  normalMean: number
  normalVar: number
  normalAnalyticMean: number
  normalAnalyticVar: number
  normalMeanErr: number
  normalVarErr: number
  uniformMean: number
  uniformVar: number
  uniformAnalyticMean: number
  uniformAnalyticVar: number
  uniformMeanErr: number
  uniformVarErr: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_UQ_MC
  familyId: typeof METHOD_UQ
} {
  const n = opts.n ?? 20_000
  const seed = opts.seed ?? 42
  const a = opts.a ?? 2.5
  const b = opts.b ?? -1
  const mu = opts.mu ?? 1
  const sigma = opts.sigma ?? 0.4
  const lo = opts.lo ?? -1
  const hi = opts.hi ?? 3

  const g: ScalarMap = (x) => a * x + b

  const normalDist: InputDist = { kind: 'normal', mu, sigma }
  const uniformDist: InputDist = { kind: 'uniform', lo, hi }

  const mcN = uqMcPropagate(g, normalDist, n, seed)
  const mcU = uqMcPropagate(g, uniformDist, n, seed + 17)
  const anN = analyticLinearMoments(a, b, normalDist)
  const anU = analyticLinearMoments(a, b, uniformDist)

  const normalMeanErr = Math.abs(mcN.mean - anN.mean)
  const normalVarErr = Math.abs(mcN.variance - anN.variance)
  const uniformMeanErr = Math.abs(mcU.mean - anU.mean)
  const uniformVarErr = Math.abs(mcU.variance - anU.variance)

  const finite =
    Number.isFinite(mcN.mean) &&
    Number.isFinite(mcN.variance) &&
    Number.isFinite(mcU.mean) &&
    Number.isFinite(mcU.variance)

  // MC error scales ~ O(1/√n); with n=20k, mean tol ~ few 1e-2 is loose but safe
  const ok =
    finite &&
    normalMeanErr < 0.03 &&
    normalVarErr < 0.05 &&
    uniformMeanErr < 0.03 &&
    uniformVarErr < 0.05 &&
    mcN.n === n &&
    mcU.n === n

  return {
    n,
    normalMean: mcN.mean,
    normalVar: mcN.variance,
    normalAnalyticMean: anN.mean,
    normalAnalyticVar: anN.variance,
    normalMeanErr,
    normalVarErr,
    uniformMean: mcU.mean,
    uniformVar: mcU.variance,
    uniformAnalyticMean: anU.mean,
    uniformAnalyticVar: anU.variance,
    uniformMeanErr,
    uniformVarErr,
    finite,
    ok,
    methodId: METHOD_ALGO_UQ_MC,
    familyId: METHOD_UQ,
  }
}
