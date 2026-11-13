/**
 * MVDR / Capon 波束成形 · 纯函数样例。
 * method-beamforming-mvdr 与 array-factor 并立于 array-beamformer 并行组。
 */
import { ARRAY_PARENT } from './array-algos'

export const MVDR_METHOD_ID = 'method-beamforming-mvdr'
export const MVDR_WEIGHTS_ID = 'method-algo-mvdr-weights'
export const MVDR_PARENT = ARRAY_PARENT
export const ARRAY_BEAMFORMER_GROUP = 'array-beamformer'

const DEG = Math.PI / 180

/** 等距线阵导向矢量 a(θ)：相位参考在阵元 0。 */
export function steeringVector(
  thetaDeg: number,
  N: number,
  dOverLambda: number,
): { re: Float64Array; im: Float64Array } {
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const psi = 2 * Math.PI * dOverLambda * Math.sin(thetaDeg * DEG)
  for (let n = 0; n < N; n++) {
    re[n] = Math.cos(n * psi)
    im[n] = Math.sin(n * psi)
  }
  return { re, im }
}

/** Hermitian 内积 aᴴ b（复数）。 */
export function hermInner(
  aRe: ArrayLike<number>,
  aIm: ArrayLike<number>,
  bRe: ArrayLike<number>,
  bIm: ArrayLike<number>,
): { re: number; im: number } {
  let re = 0
  let im = 0
  const n = aRe.length
  for (let i = 0; i < n; i++) {
    // conj(a)·b
    re += aRe[i]! * bRe[i]! + aIm[i]! * bIm[i]!
    im += aRe[i]! * bIm[i]! - aIm[i]! * bRe[i]!
  }
  return { re, im }
}

/**
 * 由平面波 + 各向同性噪声构造实对称协方差（实阵流形投影到实部块）。
 * 教学简化：使用实值相关 R_ij = σ²δ_ij + Σ_k P_k cos((i−j)ψ_k)。
 */
export function sampleCovarianceReal(
  N: number,
  dOverLambda: number,
  sources: { thetaDeg: number; power: number }[],
  noisePower: number,
): Float64Array {
  // 行主序 N×N
  const R = new Float64Array(N * N)
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      let v = i === j ? noisePower : 0
      for (const s of sources) {
        const psi = 2 * Math.PI * dOverLambda * Math.sin(s.thetaDeg * DEG)
        v += s.power * Math.cos((i - j) * psi)
      }
      R[i * N + j] = v
    }
  }
  return R
}

/** 高斯消元解 R x = b（对称正定小规模）。 */
export function solveLinear(R: Float64Array, b: Float64Array, N: number): Float64Array {
  const cols = N + 1
  const A = new Float64Array(N * cols)
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) A[i * cols + j] = R[i * N + j]!
    A[i * cols + N] = b[i]!
  }
  for (let k = 0; k < N; k++) {
    let piv = k
    let best = Math.abs(A[k * cols + k]!)
    for (let i = k + 1; i < N; i++) {
      const v = Math.abs(A[i * cols + k]!)
      if (v > best) {
        best = v
        piv = i
      }
    }
    if (best < 1e-14) throw new Error('MVDR: singular covariance')
    if (piv !== k) {
      for (let j = k; j <= N; j++) {
        const t = A[k * cols + j]!
        A[k * cols + j] = A[piv * cols + j]!
        A[piv * cols + j] = t
      }
    }
    const diag = A[k * cols + k]!
    for (let j = k; j <= N; j++) A[k * cols + j] = A[k * cols + j]! / diag
    for (let i = 0; i < N; i++) {
      if (i === k) continue
      const f = A[i * cols + k]!
      if (f === 0) continue
      for (let j = k; j <= N; j++) {
        A[i * cols + j] = A[i * cols + j]! - f * A[k * cols + j]!
      }
    }
  }
  const x = new Float64Array(N)
  for (let i = 0; i < N; i++) x[i] = A[i * cols + N]!
  return x
}

/**
 * Capon / MVDR 权（实导向简化）：
 * w = R⁻¹ a / (aᵀ R⁻¹ a)，look 方向单位增益。
 */
export function mvdrWeights(
  R: Float64Array,
  lookDeg: number,
  N: number,
  dOverLambda: number,
): Float64Array {
  const a = steeringVector(lookDeg, N, dOverLambda)
  // 用实部导向（相位参考 0 时虚部在 θ=0 为 0；一般取 Re 作实阵近似）
  const aRe = a.re
  const invRa = solveLinear(R, aRe, N)
  let denom = 0
  for (let i = 0; i < N; i++) denom += aRe[i]! * invRa[i]!
  if (!(Math.abs(denom) > 1e-14)) throw new Error('MVDR: zero denominator')
  const w = new Float64Array(N)
  for (let i = 0; i < N; i++) w[i] = invRa[i]! / denom
  return w
}

/** 波束响应 |wᵀ a(θ)|（实导向）。 */
export function mvdrPattern(
  w: Float64Array,
  thetaDeg: number,
  N: number,
  dOverLambda: number,
): number {
  const a = steeringVector(thetaDeg, N, dOverLambda)
  let re = 0
  let im = 0
  for (let i = 0; i < N; i++) {
    re += w[i]! * a.re[i]!
    im += w[i]! * a.im[i]!
  }
  return Math.hypot(re, im)
}

/**
 * MVDR 样例：look 方向增益≈1，干扰方向响应压低。
 */
export function runMvdrSample(opts?: {
  N?: number
  dOverLambda?: number
  lookDeg?: number
  jammerDeg?: number
}): {
  lookGain: number
  jammerGain: number
  nullDepth: number
  weightSum: number
  methodId: typeof MVDR_METHOD_ID
  familyId: typeof MVDR_PARENT
} {
  const N = opts?.N ?? 8
  const d = opts?.dOverLambda ?? 0.5
  const lookDeg = opts?.lookDeg ?? 0
  const jammerDeg = opts?.jammerDeg ?? 30
  const R = sampleCovarianceReal(
    N,
    d,
    [
      { thetaDeg: lookDeg, power: 1 },
      { thetaDeg: jammerDeg, power: 10 },
    ],
    0.1,
  )
  const w = mvdrWeights(R, lookDeg, N, d)
  const lookGain = mvdrPattern(w, lookDeg, N, d)
  const jammerGain = mvdrPattern(w, jammerDeg, N, d)
  let weightSum = 0
  for (let i = 0; i < N; i++) weightSum += w[i]!
  return {
    lookGain,
    jammerGain,
    nullDepth: lookGain / Math.max(jammerGain, 1e-12),
    weightSum,
    methodId: MVDR_METHOD_ID,
    familyId: MVDR_PARENT,
  }
}

/**
 * MVDR 权向量原子样例：look 约束 aᵀw≈1，范数有限。
 */
export function runMvdrWeightsSample(opts?: {
  N?: number
  dOverLambda?: number
  lookDeg?: number
}): {
  lookConstraint: number
  weightNorm: number
  n: number
  methodId: typeof MVDR_WEIGHTS_ID
  parentId: typeof MVDR_METHOD_ID
} {
  const N = opts?.N ?? 8
  const d = opts?.dOverLambda ?? 0.5
  const lookDeg = opts?.lookDeg ?? 0
  const R = sampleCovarianceReal(N, d, [{ thetaDeg: lookDeg, power: 1 }], 0.2)
  const w = mvdrWeights(R, lookDeg, N, d)
  const a = steeringVector(lookDeg, N, d)
  let lookConstraint = 0
  let weightNorm = 0
  for (let i = 0; i < N; i++) {
    lookConstraint += w[i]! * a.re[i]!
    weightNorm += w[i]! * w[i]!
  }
  return {
    lookConstraint,
    weightNorm: Math.sqrt(weightNorm),
    n: N,
    methodId: MVDR_WEIGHTS_ID,
    parentId: MVDR_METHOD_ID,
  }
}
