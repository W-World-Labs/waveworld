/**
 * 小波 L2 · Haar 细节硬阈值去噪。
 * 对应 parent method-wavelet；method id 仅常量，不改 methods.data / registry / edges。
 */
import {
  METHOD_WAVELET,
  haarDwt1Level,
  haarIdwt1Level,
  sumSquares,
} from './wavelet-algos'

/** 父族 · 小波多分辨。 */
export const WAVELET_L2_PARENT = METHOD_WAVELET

/** 二级 · Haar 细节硬阈值去噪。 */
export const METHOD_ALGO_WAVELET_HARD_THRESH = 'method-algo-wavelet-hard-thresh'

export const WAVELET_L2_METHOD_IDS = [METHOD_ALGO_WAVELET_HARD_THRESH] as const

/**
 * 硬阈值：|v| > λ 保留，否则置 0。
 * 与软阈值不同，不收缩超过阈值的系数（稀疏大系数更友好）。
 */
export function hardThreshold(v: number, lambda: number): number {
  if (!(lambda >= 0)) throw new Error('hardThreshold: lambda ≥ 0')
  return Math.abs(v) > lambda ? v : 0
}

/** 逐元素硬阈值。 */
export function hardThresholdVec(v: ArrayLike<number>, lambda: number): Float64Array {
  const out = new Float64Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = hardThreshold(v[i]!, lambda)
  return out
}

/** 均方误差 (1/N) Σ (a−b)²。 */
export function mse(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length
  if (n === 0 || b.length !== n) throw new Error('mse: length mismatch')
  let s = 0
  for (let i = 0; i < n; i++) {
    const e = a[i]! - b[i]!
    s += e * e
  }
  return s / n
}

/**
 * 相对干净信号的 SNR（dB）：10 log10(‖clean‖² / ‖est−clean‖²)。
 * 误差为 0 时返回 +∞。
 */
export function snrDb(clean: ArrayLike<number>, estimate: ArrayLike<number>): number {
  const n = clean.length
  if (n === 0 || estimate.length !== n) throw new Error('snrDb: length mismatch')
  let ps = 0
  let pe = 0
  for (let i = 0; i < n; i++) {
    const c = clean[i]!
    const e = estimate[i]! - c
    ps += c * c
    pe += e * e
  }
  if (pe === 0) return Number.POSITIVE_INFINITY
  if (ps === 0) return Number.NEGATIVE_INFINITY
  return 10 * Math.log10(ps / pe)
}

/**
 * Haar 一级细节硬阈值去噪：保留近似，硬阈值细节后逆变换。
 */
export function haarHardThreshDenoise(
  x: ArrayLike<number>,
  lambda: number,
): {
  approx: Float64Array
  detail: Float64Array
  detailThresh: Float64Array
  recon: Float64Array
} {
  const { approx, detail } = haarDwt1Level(x)
  const detailThresh = hardThresholdVec(detail, lambda)
  const recon = haarIdwt1Level(approx, detailThresh)
  return { approx, detail, detailThresh, recon }
}

/**
 * 代表样例：分段常数（Haar 稀疏）+ 加性噪声；
 * 硬阈值细节后细节能量下降，MSE 下降，SNR 提升。
 */
export function runWaveletHardThreshSample(opts?: {
  N?: number
  lambda?: number
  noiseAmp?: number
}): {
  N: number
  lambda: number
  detailEnergyBefore: number
  detailEnergyAfter: number
  detailEnergyReduced: boolean
  mseNoisy: number
  mseDenoised: number
  mseImproved: boolean
  snrNoisyDb: number
  snrDenoisedDb: number
  snrImproved: boolean
  methodId: typeof METHOD_ALGO_WAVELET_HARD_THRESH
  familyId: typeof WAVELET_L2_PARENT
} {
  const nRaw = opts?.N ?? 64
  const n = Math.max(16, nRaw + (nRaw % 2))
  const lambda = opts?.lambda ?? 0.45
  const noiseAmp = opts?.noiseAmp ?? 0.2

  // 分段常数：Haar 近似承载块值，细节仅在跳变处非零 → 稀疏
  const clean = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    if (i < n / 4) clean[i] = 0
    else if (i < n / 2) clean[i] = 2
    else if (i < (3 * n) / 4) clean[i] = -1.5
    else clean[i] = 1
  }

  // 确定性伪噪声（LCG 风格，可复现）；幅值 << 跳变，便于硬阈值分离
  const noisy = new Float64Array(n)
  let seed = 1234567
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0
    const u = (seed >>> 0) / 0xffffffff // [0,1)
    const noise = noiseAmp * (2 * u - 1)
    noisy[i] = clean[i]! + noise
  }

  const { detail, detailThresh, recon } = haarHardThreshDenoise(noisy, lambda)
  const detailEnergyBefore = sumSquares(detail)
  const detailEnergyAfter = sumSquares(detailThresh)
  const mseNoisy = mse(noisy, clean)
  const mseDenoised = mse(recon, clean)
  const snrNoisyDb = snrDb(clean, noisy)
  const snrDenoisedDb = snrDb(clean, recon)

  return {
    N: n,
    lambda,
    detailEnergyBefore,
    detailEnergyAfter,
    detailEnergyReduced: detailEnergyAfter < detailEnergyBefore,
    mseNoisy,
    mseDenoised,
    mseImproved: mseDenoised < mseNoisy,
    snrNoisyDb,
    snrDenoisedDb,
    snrImproved: snrDenoisedDb > snrNoisyDb,
    methodId: METHOD_ALGO_WAVELET_HARD_THRESH,
    familyId: WAVELET_L2_PARENT,
  }
}
