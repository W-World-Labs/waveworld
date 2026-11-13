/**
 * Metropolis–Hastings MCMC pure teaching stubs.
 * 1D random-walk MH targeting standard normal exp(−x²/2)/√(2π).
 * Symmetric Gaussian proposal; sample mean≈0, var≈1 after burn-in.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · MCMC. */
export const METHOD_MCMC = 'method-mcmc'

/** Algo · Metropolis–Hastings random-walk step / chain. */
export const METHOD_ALGO_MH = 'method-algo-mh'

/** Parent alias (aligns with familyId). */
export const MCMC_PARENT = METHOD_MCMC

export const MCMC_METHOD_IDS = [METHOD_ALGO_MH] as const

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

/**
 * Box–Muller polar (Marsaglia) standard normal from U(0,1).
 */
export function sampleStandardNormal(rand: () => number): number {
  let u = 0
  let v = 0
  let s = 0
  do {
    u = 2 * rand() - 1
    v = 2 * rand() - 1
    s = u * u + v * v
  } while (!(s > 0) || s >= 1)
  return u * Math.sqrt((-2 * Math.log(s)) / s)
}

/** log π(x) for N(0,1): −x²/2 − ½ log(2π). */
export function standardNormalLogDensity(x: number): number {
  if (!Number.isFinite(x)) {
    throw new Error('standardNormalLogDensity: x must be finite')
  }
  return -0.5 * x * x - 0.5 * Math.log(2 * Math.PI)
}

/** π(x) = exp(−x²/2)/√(2π). */
export function standardNormalDensity(x: number): number {
  return Math.exp(standardNormalLogDensity(x))
}

/**
 * MH accept probability for density ratio under symmetric proposal:
 * P = min(1, π(x′)/π(x)) = min(1, exp(logπ′ − logπ)).
 */
export function mhAcceptProb(logPiCurr: number, logPiProp: number): number {
  if (!Number.isFinite(logPiCurr) || !Number.isFinite(logPiProp)) {
    throw new Error('mhAcceptProb: log densities must be finite')
  }
  const d = logPiProp - logPiCurr
  if (d >= 0) return 1
  const p = Math.exp(d)
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0
}

/** Draw accept/reject: true iff u < P(accept). */
export function mhAccept(
  logPiCurr: number,
  logPiProp: number,
  u: number,
): boolean {
  return u < mhAcceptProb(logPiCurr, logPiProp)
}

export type MhStepResult = {
  x: number
  xProp: number
  logPi: number
  logPiProp: number
  accepted: boolean
}

/**
 * One RW-MH step targeting standard normal:
 * propose x′ = x + σ · N(0,1), accept with Metropolis ratio.
 */
export function mhStep1d(
  x: number,
  sigma: number,
  rand: () => number,
  logTarget: (x: number) => number = standardNormalLogDensity,
): MhStepResult {
  if (!(sigma > 0) || !Number.isFinite(sigma) || !Number.isFinite(x)) {
    throw new Error('mhStep1d: need finite x and sigma > 0')
  }
  const xProp = x + sigma * sampleStandardNormal(rand)
  const logPi = logTarget(x)
  const logPiProp = logTarget(xProp)
  const accepted = mhAccept(logPi, logPiProp, rand())
  return {
    x: accepted ? xProp : x,
    xProp,
    logPi: accepted ? logPiProp : logPi,
    logPiProp,
    accepted,
  }
}

export type SampleMoments = {
  mean: number
  variance: number
  n: number
}

/** Sample mean and unbiased (n−1) variance. */
export function sampleMoments(vals: ArrayLike<number>): SampleMoments {
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

export type MhChainResult = {
  steps: number
  burnIn: number
  samples: Float64Array
  mean: number
  variance: number
  acceptCount: number
  acceptRate: number
  xFinal: number
}

/**
 * Run RW-MH for `steps` proposals; discard first `burnIn` states when
 * collecting post-burn samples for moments.
 */
export function runMhChain(
  steps: number,
  opts: {
    x0?: number
    sigma?: number
    burnIn?: number
    seed?: number
    logTarget?: (x: number) => number
  } = {},
): MhChainResult {
  if (!(steps > 0) || !Number.isFinite(steps)) {
    throw new Error('runMhChain: steps must be positive finite')
  }
  const n = Math.floor(steps)
  const x0 = opts.x0 ?? 0
  const sigma = opts.sigma ?? 1.0
  const burnIn = opts.burnIn ?? Math.floor(n / 5)
  const seed = opts.seed ?? 42
  const logTarget = opts.logTarget ?? standardNormalLogDensity

  if (!(burnIn >= 0) || burnIn >= n) {
    throw new Error('runMhChain: burnIn must be in [0, steps)')
  }

  const rand = mulberry32(seed)
  let x = x0
  let acceptCount = 0
  const keep = n - burnIn
  const samples = new Float64Array(keep)
  let k = 0

  for (let i = 0; i < n; i++) {
    const s = mhStep1d(x, sigma, rand, logTarget)
    x = s.x
    if (s.accepted) acceptCount++
    if (i >= burnIn) {
      samples[k++] = x
    }
  }

  const m = sampleMoments(samples)
  return {
    steps: n,
    burnIn,
    samples,
    mean: m.mean,
    variance: m.variance,
    acceptCount,
    acceptRate: acceptCount / n,
    xFinal: x,
  }
}

/**
 * Representative sample: MH random-walk on N(0,1).
 * Post-burn mean≈0, var≈1 loosely; ok teaching gate.
 */
export function runMhSample(
  opts: {
    steps?: number
    burnIn?: number
    x0?: number
    sigma?: number
    seed?: number
  } = {},
): {
  steps: number
  burnIn: number
  mean: number
  variance: number
  acceptRate: number
  meanAbs: number
  varErr: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MH
  familyId: typeof METHOD_MCMC
} {
  const steps = opts.steps ?? 25_000
  const burnIn = opts.burnIn ?? 5_000
  const x0 = opts.x0 ?? 3.0
  const sigma = opts.sigma ?? 1.2
  const seed = opts.seed ?? 17

  const chain = runMhChain(steps, { x0, sigma, burnIn, seed })
  const meanAbs = Math.abs(chain.mean)
  const varErr = Math.abs(chain.variance - 1)

  // one isolated step for structure
  const one = mhStep1d(0, sigma, mulberry32(seed + 3))

  const finite =
    Number.isFinite(chain.mean) &&
    Number.isFinite(chain.variance) &&
    Number.isFinite(chain.acceptRate) &&
    Number.isFinite(one.x) &&
    Number.isFinite(one.xProp) &&
    Number.isFinite(standardNormalDensity(0))

  // loose gates: mean near 0, var near 1 after burn-in
  const ok =
    finite &&
    meanAbs < 0.15 &&
    varErr < 0.25 &&
    chain.variance > 0.5 &&
    chain.variance < 1.6 &&
    chain.acceptRate > 0.1 &&
    chain.acceptRate < 0.95 &&
    chain.samples.length === steps - burnIn

  return {
    steps: chain.steps,
    burnIn: chain.burnIn,
    mean: chain.mean,
    variance: chain.variance,
    acceptRate: chain.acceptRate,
    meanAbs,
    varErr,
    finite,
    ok,
    methodId: METHOD_ALGO_MH,
    familyId: METHOD_MCMC,
  }
}
