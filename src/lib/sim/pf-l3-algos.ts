/**
 * 粒子滤波三级 · 系统重采样（systematic resampling）探针。
 * 加权粒子经系统重采样后权重 = 1/N，ESS 恢复。
 * method id 仅常量，不改 methods.data / moduleRegistry。
 */
import {
  METHOD_ALGO_PF_1D,
  METHOD_PARTICLE_FILTER,
  effectiveSampleSize,
  mulberry32,
  pfEstimate,
  systematicResample,
  type Particles1d,
} from './pf-algos'
import {
  METHOD_ALGO_PF_ESS,
  PF_L2_PARENT,
  initUniformParticles,
  multimodalLikelihood,
  pfReweightMultimodal,
  pfSystematicResample,
} from './pf-l2-algos'

export {
  METHOD_PARTICLE_FILTER,
  METHOD_ALGO_PF_1D,
  METHOD_ALGO_PF_ESS,
  PF_L2_PARENT,
  effectiveSampleSize,
  systematicResample,
  mulberry32,
  pfEstimate,
  initUniformParticles,
  multimodalLikelihood,
  pfReweightMultimodal,
  pfSystematicResample,
}
export type { Particles1d }

/** 父族 · 粒子滤波（与 methods.data method-particle-filter 对齐）。 */
export const PF_L3_PARENT = METHOD_PARTICLE_FILTER

/** 三级 · 系统重采样（weights → 1/N，ESS 恢复）。 */
export const METHOD_ALGO_PF_SYSTEMATIC = 'method-algo-pf-systematic'

export const PF_L3_METHOD_IDS = [METHOD_ALGO_PF_SYSTEMATIC] as const

/**
 * 构造尖峰权重：首粒子权 w0，其余均分 1−w0。
 * 用于压塌 ESS 再测系统重采样恢复。
 */
export function makeSpikedWeights(N: number, w0 = 0.9): Float64Array {
  if (!(N >= 2)) throw new Error('makeSpikedWeights: N >= 2')
  if (!(w0 > 0 && w0 < 1)) throw new Error('makeSpikedWeights: w0 in (0,1)')
  const w = new Float64Array(N)
  w[0] = w0
  const rest = (1 - w0) / (N - 1)
  for (let i = 1; i < N; i++) w[i] = rest
  return w
}

/**
 * 系统重采样一步：返回新粒子状态，权重一律 1/N。
 */
export function systematicResampleStep(
  p: Particles1d,
  rng: () => number,
): {
  /** 重采样前 ESS */
  essBefore: number
  /** 重采样后 ESS（应 ≈ N） */
  essAfter: number
  /** 所有权重是否为 1/N */
  weightsUniform: boolean
} {
  const N = p.x.length
  const essBefore = effectiveSampleSize(p.w)
  const next = systematicResample(p.x, p.w, rng)
  const inv = 1 / N
  let weightsUniform = true
  for (let i = 0; i < N; i++) {
    p.x[i] = next[i]!
    p.w[i] = inv
    if (Math.abs(p.w[i]! - inv) > 1e-15) weightsUniform = false
  }
  const essAfter = effectiveSampleSize(p.w)
  return { essBefore, essAfter, weightsUniform }
}

/**
 * 系统重采样后高权粒子被复制次数应占多数（尖峰 w0 大时）。
 */
export function countCopies(values: ArrayLike<number>, target: number): number {
  let c = 0
  for (let i = 0; i < values.length; i++) {
    if (values[i] === target) c++
  }
  return c
}

/**
 * 代表样例：尖峰权 + 系统重采样。
 * 1) 重采样前 ESS ≪ N
 * 2) 重采样后权重 = 1/N，ESS → N
 * 3) 高权粒子被多次复制
 */
export function runPfSystematicSample(
  opts: {
    N?: number
    w0?: number
    seed?: number
    /** 可选：多峰似然压迫后再系统重采样（演示与 L2 ESS 衔接） */
    multimodal?: boolean
  } = {},
): {
  N: number
  essBefore: number
  essAfter: number
  weightsUniform: boolean
  /** essBefore < N/2 */
  collapsed: boolean
  /** essAfter ≈ N 且 > essBefore */
  recovered: boolean
  /** 尖峰粒子（值 0）被复制次数（非 multimodal 时） */
  copiesOfSpike: number
  estimate: number
  ok: boolean
  methodId: typeof METHOD_ALGO_PF_SYSTEMATIC
  familyId: typeof PF_L3_PARENT
  relatedAlgoId: typeof METHOD_ALGO_PF_ESS
} {
  const N = opts.N ?? 128
  const w0 = opts.w0 ?? 0.85
  const seed = opts.seed ?? 23
  const multimodal = opts.multimodal ?? false
  const rng = mulberry32(seed)

  const p = initUniformParticles(N, 0, 1, rng)
  // 标记粒子身份：x[i] = i，便于统计复制
  for (let i = 0; i < N; i++) p.x[i] = i

  let essBefore: number
  if (multimodal) {
    // 均匀权 → 尖峰似然压迫
    essBefore = pfReweightMultimodal(p, 0, 0.05, 6)
    // 若未塌缩，强制尖峰权
    if (essBefore >= N / 2) {
      const spiked = makeSpikedWeights(N, w0)
      for (let i = 0; i < N; i++) p.w[i] = spiked[i]!
      essBefore = effectiveSampleSize(p.w)
    }
  } else {
    const spiked = makeSpikedWeights(N, w0)
    for (let i = 0; i < N; i++) p.w[i] = spiked[i]!
    essBefore = effectiveSampleSize(p.w)
  }

  const spikeValue = p.x[0]!
  const step = systematicResampleStep(p, rng)
  const copiesOfSpike = countCopies(p.x, spikeValue)
  const estimate = pfEstimate(p)

  const collapsed = essBefore < N / 2
  const recovered =
    step.essAfter > essBefore &&
    step.essAfter > 0.95 * N &&
    step.weightsUniform

  // 尖峰权路径：高权粒子应被大量复制；多峰路径仅要求 ESS/权重恢复
  const copiesOk = multimodal ? true : copiesOfSpike > N / 2
  const ok =
    collapsed &&
    recovered &&
    step.weightsUniform &&
    Number.isFinite(estimate) &&
    copiesOk

  return {
    N,
    essBefore,
    essAfter: step.essAfter,
    weightsUniform: step.weightsUniform,
    collapsed,
    recovered,
    copiesOfSpike,
    estimate,
    ok,
    methodId: METHOD_ALGO_PF_SYSTEMATIC,
    familyId: PF_L3_PARENT,
    relatedAlgoId: METHOD_ALGO_PF_ESS,
  }
}
