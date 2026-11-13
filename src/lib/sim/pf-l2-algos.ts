/**
 * 粒子滤波二级 · 有效样本量 ESS 与系统重采样质量。
 * 多峰似然下权值塌缩 → ESS 下降；系统重采样后权重均匀、ESS 恢复。
 * method id 仅常量，不改 methods.data。
 */
import {
  METHOD_ALGO_PF_1D,
  METHOD_PARTICLE_FILTER,
  effectiveSampleSize,
  gaussPdf,
  mulberry32,
  pfEstimate,
  pfPredict,
  randn,
  systematicResample,
  type Particles1d,
} from './pf-algos'

export {
  METHOD_PARTICLE_FILTER,
  METHOD_ALGO_PF_1D,
  effectiveSampleSize,
  systematicResample,
  mulberry32,
}

/** 父族 · 粒子滤波。 */
export const PF_L2_PARENT = METHOD_PARTICLE_FILTER

/** 二级 · ESS / 系统重采样质量探针。 */
export const METHOD_ALGO_PF_ESS = 'method-algo-pf-ess'

export const PF_L2_METHOD_IDS = [METHOD_ALGO_PF_ESS, METHOD_ALGO_PF_1D] as const

/**
 * 双峰似然（bootstrap PF 教学用）：
 * p(z|x) ∝ ½ N(z; x, R) + ½ N(z; x − sep, R)
 * 真值附近与 sep 镜像处都抬权，促权重塌缩、多模态。
 */
export function multimodalLikelihood(
  z: number,
  x: number,
  R: number,
  sep = 4,
): number {
  return 0.5 * gaussPdf(z, x, R) + 0.5 * gaussPdf(z, x - sep, R)
}

/**
 * 多峰重加权：归一化权重并返回 N_eff = 1/Σ w²。
 */
export function pfReweightMultimodal(
  p: Particles1d,
  z: number,
  R: number,
  sep = 4,
): number {
  const N = p.x.length
  let sum = 0
  for (let i = 0; i < N; i++) {
    const li = multimodalLikelihood(z, p.x[i]!, R, sep)
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

/**
 * 对 Particles1d 做系统重采样，权重重置 1/N。
 */
export function pfSystematicResample(
  p: Particles1d,
  rng: () => number,
): void {
  const next = systematicResample(p.x, p.w, rng)
  const inv = 1 / p.x.length
  for (let i = 0; i < p.x.length; i++) {
    p.x[i] = next[i]!
    p.w[i] = inv
  }
}

/**
 * 均匀权重初始化（均值 mean、散布 spread）。
 */
export function initUniformParticles(
  N: number,
  mean: number,
  spread: number,
  rng: () => number,
): Particles1d {
  const x = new Float64Array(N)
  const w = new Float64Array(N)
  const inv = 1 / N
  for (let i = 0; i < N; i++) {
    x[i] = mean + spread * randn(rng)
    w[i] = inv
  }
  return { x, w }
}

/**
 * 代表样例：bootstrap PF + 多峰似然。
 * 1) 预测后重加权 → ESS 相对 N 明显下降（权值塌缩）
 * 2) 系统重采样后 ESS → N（权重均匀恢复）
 * 3) 估计仍有限、靠近真值一侧峰
 */
export function runPfEssSample(
  opts: {
    N?: number
    trueX?: number
    priorSpread?: number
    Q?: number
    R?: number
    sep?: number
    seed?: number
    steps?: number
  } = {},
): {
  N: number
  trueX: number
  /** 均匀先验时 ESS（应 ≈ N） */
  essPrior: number
  /** 多峰重加权后 ESS（应 ≪ N） */
  essAfterWeight: number
  /** 系统重采样后 ESS（应 ≈ N） */
  essAfterResample: number
  /** essAfterWeight < 阈值（N/2） */
  collapsed: boolean
  /** 重采样后 ESS 恢复 */
  recovered: boolean
  estimate: number
  err: number
  methodId: typeof METHOD_ALGO_PF_ESS
  familyId: typeof PF_L2_PARENT
  relatedAlgoId: typeof METHOD_ALGO_PF_1D
} {
  const N = opts.N ?? 256
  const trueX = opts.trueX ?? 2
  const priorSpread = opts.priorSpread ?? 3
  const Q = opts.Q ?? 0.05
  const R = opts.R ?? 0.15
  const sep = opts.sep ?? 5
  const seed = opts.seed ?? 17
  const steps = opts.steps ?? 3
  const rng = mulberry32(seed)

  const p = initUniformParticles(N, 0, priorSpread, rng)
  const essPrior = effectiveSampleSize(p.w)

  // 多步 bootstrap：预测 + 多峰似然；最后一步先记录塌缩 ESS 再重采样
  let essAfterWeight = essPrior
  for (let t = 0; t < steps; t++) {
    pfPredict(p, Q, rng)
    // 量测靠近真值（小噪声）以抬高局部峰
    const z = trueX + Math.sqrt(R) * 0.2 * Math.sin(t + 0.3)
    essAfterWeight = pfReweightMultimodal(p, z, R, sep)
    if (t < steps - 1) {
      // 中间步也重采样，避免完全退化；最后一步留给探针
      if (essAfterWeight < N / 2) pfSystematicResample(p, rng)
    }
  }

  // 最后一步：确保在塌缩态测 ESS，再系统重采样
  // 若中间步已恢复，再做一次尖峰似然压迫权值
  if (essAfterWeight >= N / 2) {
    const zSharp = trueX
    essAfterWeight = pfReweightMultimodal(p, zSharp, R * 0.25, sep)
  }

  const collapsed = essAfterWeight < N / 2
  pfSystematicResample(p, rng)
  const essAfterResample = effectiveSampleSize(p.w)
  const estimate = pfEstimate(p)
  const err = Math.abs(estimate - trueX)

  return {
    N,
    trueX,
    essPrior,
    essAfterWeight,
    essAfterResample,
    collapsed,
    recovered: essAfterResample > essAfterWeight && essAfterResample > 0.9 * N,
    estimate,
    err,
    methodId: METHOD_ALGO_PF_ESS,
    familyId: PF_L2_PARENT,
    relatedAlgoId: METHOD_ALGO_PF_1D,
  }
}
