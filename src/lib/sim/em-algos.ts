/**
 * EM algorithm pure teaching stubs.
 * 1D 2-component Gaussian mixture: E-step responsibilities, M-step
 * mean / variance / weights; log-likelihood nondecreasing; recover modes.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · expectation–maximization. */
export const METHOD_EM = 'method-em'

/** Algo · EM for 1D two-component Gaussian mixture. */
export const METHOD_ALGO_EM_GMM = 'method-algo-em-gmm'

/** Parent alias (aligns with familyId). */
export const EM_PARENT = METHOD_EM

export const EM_METHOD_IDS = [METHOD_ALGO_EM_GMM] as const

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

/** Univariate normal density N(x | μ, σ²). */
export function gaussianDensity(
  x: number,
  mu: number,
  variance: number,
): number {
  if (!(variance > 0) || !Number.isFinite(variance)) {
    throw new Error('gaussianDensity: variance must be finite and > 0')
  }
  if (!Number.isFinite(x) || !Number.isFinite(mu)) {
    throw new Error('gaussianDensity: x and mu must be finite')
  }
  const inv = 1 / Math.sqrt(2 * Math.PI * variance)
  const z = x - mu
  return inv * Math.exp((-0.5 * z * z) / variance)
}

/** log N(x | μ, σ²). */
export function gaussianLogDensity(
  x: number,
  mu: number,
  variance: number,
): number {
  if (!(variance > 0) || !Number.isFinite(variance)) {
    throw new Error('gaussianLogDensity: variance must be finite and > 0')
  }
  const z = x - mu
  return -0.5 * Math.log(2 * Math.PI * variance) - (0.5 * z * z) / variance
}

/** 1D 2-component GMM parameters. */
export type Gmm2Params = {
  /** Mixing weights; π0 + π1 = 1, each ≥ 0. */
  weights: [number, number]
  means: [number, number]
  /** Component variances (σ²). */
  variances: [number, number]
}

/** Mixture density Σ_k π_k N(x|μ_k,σ_k²). */
export function gmm2Density(x: number, p: Gmm2Params): number {
  return (
    p.weights[0] * gaussianDensity(x, p.means[0], p.variances[0]) +
    p.weights[1] * gaussianDensity(x, p.means[1], p.variances[1])
  )
}

/**
 * Average log-likelihood (1/n) Σ_i log p(x_i | θ).
 */
export function gmm2LogLikelihood(
  data: ArrayLike<number>,
  p: Gmm2Params,
): number {
  const n = data.length
  if (!(n > 0)) throw new Error('gmm2LogLikelihood: empty data')
  let s = 0
  for (let i = 0; i < n; i++) {
    const d = gmm2Density(data[i]!, p)
    if (!(d > 0) || !Number.isFinite(d)) {
      return -Infinity
    }
    s += Math.log(d)
  }
  return s / n
}

/**
 * E-step: responsibility γ_{i0} for component 0
 * (γ_{i1} = 1 − γ_{i0}). Returns Float64Array length n.
 */
export function emEStep(
  data: ArrayLike<number>,
  p: Gmm2Params,
): Float64Array {
  const n = data.length
  const gamma0 = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const x = data[i]!
    const p0 = p.weights[0] * gaussianDensity(x, p.means[0], p.variances[0])
    const p1 = p.weights[1] * gaussianDensity(x, p.means[1], p.variances[1])
    const den = p0 + p1
    gamma0[i] = den > 0 ? p0 / den : 0.5
  }
  return gamma0
}

/** Floor on component variance to avoid collapse. */
const VAR_FLOOR = 1e-6

/**
 * M-step: update weights, means, variances from responsibilities.
 * N_k = Σ_i γ_{ik}; π_k = N_k/n; μ_k = Σ γ x / N_k; σ² similar.
 */
export function emMStep(
  data: ArrayLike<number>,
  gamma0: ArrayLike<number>,
): Gmm2Params {
  const n = data.length
  if (n !== gamma0.length) {
    throw new Error('emMStep: data and gamma length mismatch')
  }
  if (!(n > 0)) throw new Error('emMStep: empty data')

  let N0 = 0
  let N1 = 0
  let sx0 = 0
  let sx1 = 0
  for (let i = 0; i < n; i++) {
    const g0 = gamma0[i]!
    const g1 = 1 - g0
    const x = data[i]!
    N0 += g0
    N1 += g1
    sx0 += g0 * x
    sx1 += g1 * x
  }

  // avoid zero mass
  const eps = 1e-12
  if (!(N0 > eps)) N0 = eps
  if (!(N1 > eps)) N1 = eps

  const mu0 = sx0 / N0
  const mu1 = sx1 / N1

  let ss0 = 0
  let ss1 = 0
  for (let i = 0; i < n; i++) {
    const g0 = gamma0[i]!
    const g1 = 1 - g0
    const x = data[i]!
    const d0 = x - mu0
    const d1 = x - mu1
    ss0 += g0 * d0 * d0
    ss1 += g1 * d1 * d1
  }

  let v0 = ss0 / N0
  let v1 = ss1 / N1
  if (!(v0 >= VAR_FLOOR)) v0 = VAR_FLOOR
  if (!(v1 >= VAR_FLOOR)) v1 = VAR_FLOOR

  const w0 = N0 / n
  const w1 = N1 / n
  // renormalize in case of eps floor
  const wSum = w0 + w1
  return {
    weights: [w0 / wSum, w1 / wSum],
    means: [mu0, mu1],
    variances: [v0, v1],
  }
}

export type EmIteration = {
  params: Gmm2Params
  logLikelihood: number
  gamma0: Float64Array
}

/**
 * One full EM iteration: E then M, return updated params + avg LL.
 */
export function emIteration(
  data: ArrayLike<number>,
  p: Gmm2Params,
): EmIteration {
  const gamma0 = emEStep(data, p)
  const params = emMStep(data, gamma0)
  const logLikelihood = gmm2LogLikelihood(data, params)
  return { params, logLikelihood, gamma0 }
}

export type EmGmmResult = {
  iterations: number
  params: Gmm2Params
  params0: Gmm2Params
  logLikelihood: number
  logLikelihood0: number
  /** Avg log-likelihood after each iteration (length iterations). */
  llHistory: Float64Array
  /** True if LL is nondecreasing within numerical tolerance. */
  llNondecreasing: boolean
}

/**
 * Run EM for `iterations` steps on fixed 1D data from initial params.
 */
export function runEmGmm(
  data: ArrayLike<number>,
  params0: Gmm2Params,
  iterations: number,
): EmGmmResult {
  if (!(iterations > 0) || !Number.isFinite(iterations)) {
    throw new Error('runEmGmm: iterations must be positive finite')
  }
  const nIter = Math.floor(iterations)
  let p: Gmm2Params = {
    weights: [params0.weights[0], params0.weights[1]],
    means: [params0.means[0], params0.means[1]],
    variances: [params0.variances[0], params0.variances[1]],
  }
  const ll0 = gmm2LogLikelihood(data, p)
  const llHistory = new Float64Array(nIter)
  let prev = ll0
  let llNondecreasing = true
  const tol = 1e-9

  for (let t = 0; t < nIter; t++) {
    const step = emIteration(data, p)
    p = step.params
    llHistory[t] = step.logLikelihood
    if (step.logLikelihood + tol < prev) llNondecreasing = false
    prev = step.logLikelihood
  }

  return {
    iterations: nIter,
    params: p,
    params0: {
      weights: [params0.weights[0], params0.weights[1]],
      means: [params0.means[0], params0.means[1]],
      variances: [params0.variances[0], params0.variances[1]],
    },
    logLikelihood: prev,
    logLikelihood0: ll0,
    llHistory,
    llNondecreasing,
  }
}

/**
 * Synthesize 1D 2-component Gaussian mixture samples (well-separated modes).
 */
export function sampleGmm2Data(
  n: number,
  trueParams: Gmm2Params,
  seed = 1,
): Float64Array {
  if (!(n > 0) || !Number.isInteger(n)) {
    throw new Error('sampleGmm2Data: n must be positive integer')
  }
  const rand = mulberry32(seed)
  const out = new Float64Array(n)
  const w0 = trueParams.weights[0]
  for (let i = 0; i < n; i++) {
    const k = rand() < w0 ? 0 : 1
    const mu = trueParams.means[k]!
    const sd = Math.sqrt(trueParams.variances[k]!)
    out[i] = mu + sd * sampleStandardNormal(rand)
  }
  return out
}

/** Sort components by mean ascending (label-switch invariant view). */
export function sortGmmByMean(p: Gmm2Params): Gmm2Params {
  if (p.means[0] <= p.means[1]) {
    return {
      weights: [p.weights[0], p.weights[1]],
      means: [p.means[0], p.means[1]],
      variances: [p.variances[0], p.variances[1]],
    }
  }
  return {
    weights: [p.weights[1], p.weights[0]],
    means: [p.means[1], p.means[0]],
    variances: [p.variances[1], p.variances[0]],
  }
}

/**
 * Representative sample: EM on well-separated 2-mode GMM.
 * Likelihood nondecreasing; means recover true modes loosely; ok gate.
 */
export function runEmGmmSample(
  opts: {
    n?: number
    iterations?: number
    seed?: number
    trueMeans?: [number, number]
    trueVars?: [number, number]
    trueWeights?: [number, number]
  } = {},
): {
  n: number
  iterations: number
  means: [number, number]
  trueMeans: [number, number]
  meanErr0: number
  meanErr1: number
  weights: [number, number]
  ll0: number
  llFinal: number
  llGain: number
  llNondecreasing: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_EM_GMM
  familyId: typeof METHOD_EM
} {
  const n = opts.n ?? 400
  const iterations = opts.iterations ?? 40
  const seed = opts.seed ?? 11
  const trueMeans: [number, number] = opts.trueMeans ?? [-3, 3]
  const trueVars: [number, number] = opts.trueVars ?? [0.5, 0.5]
  const trueWeights: [number, number] = opts.trueWeights ?? [0.45, 0.55]

  const trueParams: Gmm2Params = {
    weights: trueWeights,
    means: trueMeans,
    variances: trueVars,
  }
  const data = sampleGmm2Data(n, trueParams, seed)

  // intentionally imperfect init (swapped-ish centers, equal weights)
  const params0: Gmm2Params = {
    weights: [0.5, 0.5],
    means: [-1, 1],
    variances: [1.5, 1.5],
  }

  const fit = runEmGmm(data, params0, iterations)
  const sorted = sortGmmByMean(fit.params)
  const trueSorted = sortGmmByMean(trueParams)

  const meanErr0 = Math.abs(sorted.means[0] - trueSorted.means[0])
  const meanErr1 = Math.abs(sorted.means[1] - trueSorted.means[1])
  const llGain = fit.logLikelihood - fit.logLikelihood0

  // structure: one E and M on init
  const gamma = emEStep(data, params0)
  const mOnce = emMStep(data, gamma)

  const finite =
    Number.isFinite(fit.logLikelihood) &&
    Number.isFinite(fit.logLikelihood0) &&
    Number.isFinite(sorted.means[0]) &&
    Number.isFinite(sorted.means[1]) &&
    Number.isFinite(mOnce.means[0]) &&
    gamma.length === n

  const modesSeparated =
    sorted.means[1] - sorted.means[0] > 3 &&
    sorted.means[0] < -1 &&
    sorted.means[1] > 1

  const ok =
    finite &&
    fit.llNondecreasing &&
    llGain > 0 &&
    meanErr0 < 0.6 &&
    meanErr1 < 0.6 &&
    modesSeparated &&
    sorted.weights[0] > 0.2 &&
    sorted.weights[1] > 0.2 &&
    sorted.weights[0] + sorted.weights[1] > 0.99

  return {
    n,
    iterations: fit.iterations,
    means: sorted.means,
    trueMeans: trueSorted.means,
    meanErr0,
    meanErr1,
    weights: sorted.weights,
    ll0: fit.logLikelihood0,
    llFinal: fit.logLikelihood,
    llGain,
    llNondecreasing: fit.llNondecreasing,
    finite,
    ok,
    methodId: METHOD_ALGO_EM_GMM,
    familyId: METHOD_EM,
  }
}
