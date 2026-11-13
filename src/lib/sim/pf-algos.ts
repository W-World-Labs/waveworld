/**
 * 粒子滤波 PF · 纯算法（1D SIR：预测 + 重加权 + 多项式重采样）。
 * 对应 method-particle-filter / method-algo-pf-1d。
 * 可选：EKF 样例（method-kalman-ekf）供 registry。
 * 不修改 methods.data。
 */

/** 父族 · 粒子滤波。 */
export const METHOD_PARTICLE_FILTER = 'method-particle-filter'
/** @deprecated alias */
export const PF_PARENT = METHOD_PARTICLE_FILTER

/** 子算法 · 1D 粒子滤波。 */
export const METHOD_ALGO_PF_1D = 'method-algo-pf-1d'

export const EKF_METHOD_ID = 'method-kalman-ekf'
export const EKF_PARENT = 'method-kalman'

export type Particles1d = {
  x: Float64Array
  w: Float64Array
}

/** 简单 LCG，可复现。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 标准正态（Box–Muller）。 */
export function randn(rng: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** 高斯密度 N(z; mean, var)。 */
export function gaussPdf(z: number, mean: number, variance: number): number {
  if (!(variance > 0)) throw new Error('variance must be positive')
  const d = z - mean
  return Math.exp((-0.5 * d * d) / variance) / Math.sqrt(2 * Math.PI * variance)
}

/** 均匀权重初始化。 */
export function initParticles(N: number, x0: number, spread: number, rng: () => number): Particles1d {
  const x = new Float64Array(N)
  const w = new Float64Array(N)
  const inv = 1 / N
  for (let i = 0; i < N; i++) {
    x[i] = x0 + spread * randn(rng)
    w[i] = inv
  }
  return { x, w }
}

/** 预测：x ← x + √Q · ε。 */
export function pfPredict(p: Particles1d, Q: number, rng: () => number): void {
  const s = Math.sqrt(Q)
  for (let i = 0; i < p.x.length; i++) p.x[i]! += s * randn(rng)
}

/**
 * 重加权：似然 p(z|x)=N(z; x, R)，归一化；返回 N_eff。
 */
export function pfReweight(p: Particles1d, z: number, R: number): number {
  const N = p.x.length
  let sum = 0
  for (let i = 0; i < N; i++) {
    const li = gaussPdf(z, p.x[i]!, R)
    p.w[i] = li
    sum += li
  }
  if (!(sum > 0)) {
    const inv = 1 / N
    for (let i = 0; i < N; i++) p.w[i] = inv
    return N
  }
  let sumSq = 0
  for (let i = 0; i < N; i++) {
    p.w[i]! /= sum
    sumSq += p.w[i]! * p.w[i]!
  }
  return 1 / sumSq
}

/** 多项式重采样：按权重抽 N 个，权重重置 1/N。 */
export function pfMultinomialResample(p: Particles1d, rng: () => number): void {
  const N = p.x.length
  const cdf = new Float64Array(N)
  cdf[0] = p.w[0]!
  for (let i = 1; i < N; i++) cdf[i] = cdf[i - 1]! + p.w[i]!
  const total = cdf[N - 1]!
  const xNew = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const u = rng() * total
    let j = 0
    while (j < N - 1 && cdf[j]! < u) j++
    xNew[i] = p.x[j]!
  }
  const inv = 1 / N
  for (let i = 0; i < N; i++) {
    p.x[i] = xNew[i]!
    p.w[i] = inv
  }
}

/** 加权均值。 */
export function pfEstimate(p: Particles1d): number {
  let m = 0
  for (let i = 0; i < p.x.length; i++) m += p.w[i]! * p.x[i]!
  return m
}

/** 有效样本量。 */
export function effectiveSampleSize(weights: ArrayLike<number>): number {
  let s2 = 0
  for (let i = 0; i < weights.length; i++) s2 += weights[i]! * weights[i]!
  return s2 > 0 ? 1 / s2 : 0
}

/** 系统重采样。 */
export function systematicResample(
  particles: Float64Array,
  weights: Float64Array,
  rng: () => number,
): Float64Array {
  const N = particles.length
  const out = new Float64Array(N)
  const cdf = new Float64Array(N)
  cdf[0] = weights[0]!
  for (let i = 1; i < N; i++) cdf[i] = cdf[i - 1]! + weights[i]!
  const u0 = rng() / N
  let i = 0
  for (let j = 0; j < N; j++) {
    const u = u0 + j / N
    while (i < N - 1 && cdf[i]! < u) i++
    out[j] = particles[i]!
  }
  return out
}

/**
 * 1D PF 样例：先验偏离真值；更新后 |est−true| < 先验误差。
 */
export function runPf1dSample(
  opts: {
    N?: number
    trueX?: number
    priorSpread?: number
    Q?: number
    R?: number
    seed?: number
    steps?: number
  } = {},
): {
  trueX: number
  priorMean: number
  priorErr: number
  estimate: number
  err: number
  neff: number
  improved: boolean
  methodId: typeof METHOD_ALGO_PF_1D
  familyId: typeof METHOD_PARTICLE_FILTER
} {
  const N = opts.N ?? 200
  const trueX = opts.trueX ?? 3
  const priorSpread = opts.priorSpread ?? 2
  const Q = opts.Q ?? 0.01
  const R = opts.R ?? 0.25
  const seed = opts.seed ?? 42
  const steps = opts.steps ?? 5
  const rng = mulberry32(seed)

  const p = initParticles(N, 0, priorSpread, rng)
  const priorMean = pfEstimate(p)
  const priorErr = Math.abs(priorMean - trueX)

  let neff = N
  for (let t = 0; t < steps; t++) {
    pfPredict(p, Q, rng)
    const z = trueX + Math.sqrt(R) * 0.1 * Math.sin(t + 0.5)
    neff = pfReweight(p, z, R)
    pfMultinomialResample(p, rng)
  }

  const estimate = pfEstimate(p)
  const err = Math.abs(estimate - trueX)
  return {
    trueX,
    priorMean,
    priorErr,
    estimate,
    err,
    neff,
    improved: err < priorErr,
    methodId: METHOD_ALGO_PF_1D,
    familyId: METHOD_PARTICLE_FILTER,
  }
}

/** moduleRegistry 入口。 */
export function runParticleFilterSample(
  N = 64,
  steps = 12,
  seed = 11,
): {
  estimate: number
  trueX: number
  err: number
  neff: number
  methodId: typeof METHOD_PARTICLE_FILTER
} {
  const rng = mulberry32(seed)
  const trueX = 3
  const R = 0.25
  let particles = new Float64Array(N)
  for (let i = 0; i < N; i++) particles[i] = trueX + randn(rng) * 2

  let weights = new Float64Array(N)
  let neff = N
  for (let t = 0; t < steps; t++) {
    const z = trueX + randn(rng) * Math.sqrt(R)
    for (let i = 0; i < N; i++) particles[i]! += randn(rng) * 0.05
    let sumW = 0
    for (let i = 0; i < N; i++) {
      const e = z - particles[i]!
      weights[i] = Math.exp(-(e * e) / (2 * R))
      sumW += weights[i]!
    }
    if (!(sumW > 0)) {
      weights.fill(1 / N)
      sumW = 1
    }
    for (let i = 0; i < N; i++) weights[i]! /= sumW
    neff = effectiveSampleSize(weights)
    if (neff < N / 2) {
      const next = systematicResample(particles, weights, rng)
      particles = new Float64Array(next)
      weights.fill(1 / N)
    }
  }
  let estimate = 0
  for (let i = 0; i < N; i++) estimate += weights[i]! * particles[i]!
  return {
    estimate,
    trueX,
    err: Math.abs(estimate - trueX),
    neff,
    methodId: METHOD_PARTICLE_FILTER,
  }
}

// ── EKF · 标量非线性量测 z = x² + v ────────────────────────────────────────

export type Ekf1dState = { x: number; P: number }

export function ekfPredict(s: Ekf1dState, Q: number): Ekf1dState {
  return { x: s.x, P: s.P + Q }
}

export function ekfUpdate(s: Ekf1dState, z: number, R: number): Ekf1dState {
  const H = 2 * s.x
  const h = s.x * s.x
  const S = H * s.P * H + R
  if (!(S > 0)) throw new Error('EKF innovation covariance must be positive')
  const K = (s.P * H) / S
  return {
    x: s.x + K * (z - h),
    P: (1 - K * H) * s.P,
  }
}

export function runEkfSample(steps = 25): {
  estimate: number
  trueX: number
  err: number
  P: number
  P0: number
  methodId: typeof EKF_METHOD_ID
} {
  const trueX = 2
  const Q = 1e-6
  const R = 0.1
  let s: Ekf1dState = { x: 0.5, P: 1 }
  const P0 = s.P
  for (let t = 0; t < steps; t++) {
    s = ekfPredict(s, Q)
    const z = trueX * trueX
    s = ekfUpdate(s, z, R)
  }
  return {
    estimate: s.x,
    trueX,
    err: Math.abs(s.x - trueX),
    P: s.P,
    P0,
    methodId: EKF_METHOD_ID,
  }
}
