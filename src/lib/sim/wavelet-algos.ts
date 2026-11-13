/**
 * 小波 / 多分辨 · 纯算法（Haar 一级 DWT）。
 * 对应 method-wavelet / method-algo-haar-dwt；正交 Haar，能量 Σx² 守恒。
 * 不修改 methods.data。
 */

/** 父族 · 小波多分辨。 */
export const METHOD_WAVELET = 'method-wavelet'
/** @deprecated alias — moduleRegistry / 旧名 */
export const WAVELET_PARENT = METHOD_WAVELET

/** 子算法 · Haar 一级离散小波变换。 */
export const METHOD_ALGO_HAAR_DWT = 'method-algo-haar-dwt'

/** 子算法 · 小波软阈值去噪。 */
export const METHOD_ALGO_WAVELET_SOFT_THRESH = 'method-algo-wavelet-soft-thresh'

export type Haar1Level = {
  approx: Float64Array
  detail: Float64Array
}

/**
 * 正交 Haar 一级分解（归一化 1/√2）。
 * cA[i]=(x[2i]+x[2i+1])/√2，cD[i]=(x[2i]−x[2i+1])/√2。
 */
export function haarDwt1Level(x: ArrayLike<number>): Haar1Level {
  const N = x.length
  if (N < 2 || N % 2 !== 0) {
    throw new Error('haarDwt1Level: length must be even and ≥ 2')
  }
  const half = N >> 1
  const s = Math.SQRT1_2
  const approx = new Float64Array(half)
  const detail = new Float64Array(half)
  for (let i = 0; i < half; i++) {
    const a = x[2 * i]!
    const b = x[2 * i + 1]!
    approx[i] = (a + b) * s
    detail[i] = (a - b) * s
  }
  return { approx, detail }
}

/** 别名：c/d 命名（moduleRegistry 风格）。 */
export function haarForward1(x: ArrayLike<number>): { c: Float64Array; d: Float64Array } {
  const { approx, detail } = haarDwt1Level(x)
  return { c: approx, d: detail }
}

/** 逆 Haar 一级。 */
export function haarIdwt1Level(approx: ArrayLike<number>, detail: ArrayLike<number>): Float64Array {
  const half = approx.length
  if (half === 0 || half !== detail.length) {
    throw new Error('haarIdwt1Level: approx/detail length mismatch')
  }
  const s = Math.SQRT1_2
  const x = new Float64Array(half * 2)
  for (let i = 0; i < half; i++) {
    const a = approx[i]!
    const d = detail[i]!
    x[2 * i] = (a + d) * s
    x[2 * i + 1] = (a - d) * s
  }
  return x
}

export function haarInverse1(c: ArrayLike<number>, d: ArrayLike<number>): Float64Array {
  return haarIdwt1Level(c, d)
}

/** Σ v[i]² */
export function sumSquares(v: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return s
}

/**
 * Haar 样例：短实信号一级分解；Parseval 能量守恒 + 逆变换残差。
 */
export function runHaarDwtSample(): {
  N: number
  energyIn: number
  energyOut: number
  energyErr: number
  reconMaxErr: number
  methodId: typeof METHOD_ALGO_HAAR_DWT
  familyId: typeof METHOD_WAVELET
} {
  const x = new Float64Array([1, 2, 3, 0, -1, 4, 2, 2])
  const { approx, detail } = haarDwt1Level(x)
  const energyIn = sumSquares(x)
  const energyOut = sumSquares(approx) + sumSquares(detail)
  const recon = haarIdwt1Level(approx, detail)
  let reconMaxErr = 0
  for (let i = 0; i < x.length; i++) {
    const e = Math.abs(recon[i]! - x[i]!)
    if (e > reconMaxErr) reconMaxErr = e
  }
  return {
    N: x.length,
    energyIn,
    energyOut,
    energyErr: Math.abs(energyOut - energyIn),
    reconMaxErr,
    methodId: METHOD_ALGO_HAAR_DWT,
    familyId: METHOD_WAVELET,
  }
}

/** moduleRegistry 入口：正弦+阶跃 Haar 样例。 */
export function runWaveletSample(N = 32): {
  energyX: number
  energyCD: number
  parsevalRatio: number
  reconErr: number
  detailEnergy: number
  methodId: typeof METHOD_WAVELET
} {
  const n = Math.max(4, N + (N % 2))
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = Math.sin((2 * Math.PI * i) / n) + (i >= n / 2 ? 0.5 : 0)
  }
  const { c, d } = haarForward1(x)
  const recon = haarInverse1(c, d)
  let reconErr = 0
  for (let i = 0; i < n; i++) {
    const e = recon[i]! - x[i]!
    reconErr += e * e
  }
  const energyX = sumSquares(x)
  const energyCD = sumSquares(c) + sumSquares(d)
  return {
    energyX,
    energyCD,
    parsevalRatio: energyX > 0 ? energyCD / energyX : 1,
    reconErr: Math.sqrt(reconErr / n),
    detailEnergy: sumSquares(d),
    methodId: METHOD_WAVELET,
  }
}

/**
 * 软阈值：sign(v)·max(|v|−λ, 0)。
 * 小波去噪标准收缩算子（Donoho–Johnstone）。
 */
export function softThreshold(v: number, lambda: number): number {
  if (!(lambda >= 0)) throw new Error('softThreshold: lambda ≥ 0')
  if (v > lambda) return v - lambda
  if (v < -lambda) return v + lambda
  return 0
}

/** 逐元素软阈值。 */
export function softThresholdVec(v: ArrayLike<number>, lambda: number): Float64Array {
  const out = new Float64Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = softThreshold(v[i]!, lambda)
  return out
}

/**
 * Haar 细节软阈值去噪样例：干净正弦 + 尖脉冲噪声；
 * 阈值后细节能量下降，重构更接近干净信号。
 */
export function runWaveletThresholdSample(opts?: {
  N?: number
  lambda?: number
}): {
  N: number
  lambda: number
  detailEnergyBefore: number
  detailEnergyAfter: number
  detailEnergyReduced: boolean
  mseNoisy: number
  mseDenoised: number
  mseImproved: boolean
  methodId: typeof METHOD_ALGO_WAVELET_SOFT_THRESH
  familyId: typeof METHOD_WAVELET
} {
  const n = Math.max(8, (opts?.N ?? 32) + ((opts?.N ?? 32) % 2))
  const lambda = opts?.lambda ?? 0.4
  const clean = new Float64Array(n)
  const noisy = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    clean[i] = Math.sin((2 * Math.PI * 3 * i) / n)
    // 稀疏尖脉冲噪声（小波细节可捕）
    const spike = i % 7 === 0 ? 1.2 * (i % 2 === 0 ? 1 : -1) : 0
    noisy[i] = clean[i]! + spike
  }
  const { approx, detail } = haarDwt1Level(noisy)
  const detailEnergyBefore = sumSquares(detail)
  const detailT = softThresholdVec(detail, lambda)
  const detailEnergyAfter = sumSquares(detailT)
  const recon = haarIdwt1Level(approx, detailT)
  let mseNoisy = 0
  let mseDenoised = 0
  for (let i = 0; i < n; i++) {
    const en = noisy[i]! - clean[i]!
    const ed = recon[i]! - clean[i]!
    mseNoisy += en * en
    mseDenoised += ed * ed
  }
  mseNoisy /= n
  mseDenoised /= n
  return {
    N: n,
    lambda,
    detailEnergyBefore,
    detailEnergyAfter,
    detailEnergyReduced: detailEnergyAfter < detailEnergyBefore,
    mseNoisy,
    mseDenoised,
    mseImproved: mseDenoised < mseNoisy,
    methodId: METHOD_ALGO_WAVELET_SOFT_THRESH,
    familyId: METHOD_WAVELET,
  }
}
