/**
 * 谱方法二级算法 · FFT 风格周期图（DFT 功率谱峰）。
 * 对应 method-algo-fft-periodogram；复用 research-algos 朴素 DFT，不改 methods.data 之外的 id 约定。
 */
import { dftReal, peakBin, METHOD_SPECTRAL } from './research-algos'

/** 父族 · 谱方法。 */
export const SPECTRAL_L2_PARENT = METHOD_SPECTRAL

/** 二级 · 周期图 / 功率谱峰。 */
export const SPECTRAL_PERIODOGRAM_ID = 'method-algo-fft-periodogram'

/**
 * 单边风格功率周期图：P[k] = |X[k]|² / N（Parseval：Σ P ≈ Σ x²）。
 * 朴素 DFT，教学用；N 小时与 FFT 等价。
 */
export function periodogramPower(x: ArrayLike<number>): Float64Array {
  const N = x.length
  if (N < 2) throw new Error('periodogramPower: length must be ≥ 2')
  const { mag } = dftReal(x)
  const P = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    const m = mag[k]!
    P[k] = (m * m) / N
  }
  return P
}

/** Σ v[i] */
export function sumArr(v: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]!
  return s
}

/** Σ v[i]² */
export function sumSquares(v: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return s
}

/**
 * 代表样例：x[n]=sin(2π k0 n/N)，功率峰在 k0（及镜像 N−k0）；
 * Parseval：Σ P ≈ Σ x²。
 */
export function runPeriodogramSample(opts?: {
  N?: number
  k0?: number
}): {
  N: number
  k0: number
  peakK: number
  peakPower: number
  powerDc: number
  energyX: number
  energyP: number
  parsevalErr: number
  methodId: typeof SPECTRAL_PERIODOGRAM_ID
  familyId: typeof SPECTRAL_L2_PARENT
} {
  const N = opts?.N ?? 64
  const k0 = opts?.k0 ?? 5
  const x = new Float64Array(N)
  for (let n = 0; n < N; n++) x[n] = Math.sin((2 * Math.PI * k0 * n) / N)
  const P = periodogramPower(x)
  const peak = peakBin(P)
  const energyX = sumSquares(x)
  const energyP = sumArr(P)
  return {
    N,
    k0,
    peakK: peak.k,
    peakPower: peak.mag,
    powerDc: P[0]!,
    energyX,
    energyP,
    parsevalErr: Math.abs(energyP - energyX),
    methodId: SPECTRAL_PERIODOGRAM_ID,
    familyId: SPECTRAL_L2_PARENT,
  }
}

/** 二级 · Chebyshev 节点重心插值。 */
export const SPECTRAL_CHEBYSHEV_INTERP_ID = 'method-algo-chebyshev-interp'

/**
 * 第二类 Chebyshev 节点 x_j = cos(π j / n)，j=0..n（含端点 ±1）。
 * 返回长度 n+1。
 */
export function chebyshevNodesSecondKind(n: number): Float64Array {
  if (!(n >= 1)) throw new Error('chebyshevNodesSecondKind: n ≥ 1')
  const x = new Float64Array(n + 1)
  for (let j = 0; j <= n; j++) x[j] = Math.cos((Math.PI * j) / n)
  return x
}

/**
 * Chebyshev 第二类节点上的重心权重：
 * w_j = (−1)^j · δ_j，δ_0=δ_n=1/2，其余 1。
 */
export function chebyshevBarycentricWeights(n: number): Float64Array {
  if (!(n >= 1)) throw new Error('chebyshevBarycentricWeights: n ≥ 1')
  const w = new Float64Array(n + 1)
  for (let j = 0; j <= n; j++) {
    const delta = j === 0 || j === n ? 0.5 : 1
    w[j] = (j % 2 === 0 ? 1 : -1) * delta
  }
  return w
}

/**
 * 重心公式插值 p(t)=Σ (w_j/(t−x_j)) y_j  /  Σ (w_j/(t−x_j))。
 * t 恰落在节点上时返回对应 y。
 */
export function barycentricEval(
  t: number,
  nodes: ArrayLike<number>,
  values: ArrayLike<number>,
  weights: ArrayLike<number>,
): number {
  const m = nodes.length
  if (m < 2 || values.length !== m || weights.length !== m) {
    throw new Error('barycentricEval: length mismatch / need ≥2 nodes')
  }
  let num = 0
  let den = 0
  for (let j = 0; j < m; j++) {
    const xj = nodes[j]!
    if (t === xj) return values[j]!
    const a = weights[j]! / (t - xj)
    num += a * values[j]!
    den += a
  }
  if (den === 0) throw new Error('barycentricEval: zero denominator')
  return num / den
}

/**
 * Chebyshev 插值样例：在第二类节点上采 f(x)=sin(π x)，
 * 在开区间测试点上与真值对照；节点上应精确还原。
 */
export function runChebyshevInterpSample(opts?: {
  n?: number
}): {
  n: number
  nNodes: number
  nodeMaxErr: number
  testMaxErr: number
  /** 节点还原应机器精度 */
  nodesExact: boolean
  /** 测试点误差应远小于 1e−6（低阶解析光滑） */
  accurate: boolean
  methodId: typeof SPECTRAL_CHEBYSHEV_INTERP_ID
  familyId: typeof SPECTRAL_L2_PARENT
} {
  const n = opts?.n ?? 12
  const nodes = chebyshevNodesSecondKind(n)
  const weights = chebyshevBarycentricWeights(n)
  const y = new Float64Array(n + 1)
  const f = (x: number) => Math.sin(Math.PI * x)
  for (let j = 0; j <= n; j++) y[j] = f(nodes[j]!)

  let nodeMaxErr = 0
  for (let j = 0; j <= n; j++) {
    const e = Math.abs(barycentricEval(nodes[j]!, nodes, y, weights) - y[j]!)
    if (e > nodeMaxErr) nodeMaxErr = e
  }

  const tests = [-0.7, -0.3, 0, 0.25, 0.55, 0.9]
  let testMaxErr = 0
  for (const t of tests) {
    const e = Math.abs(barycentricEval(t, nodes, y, weights) - f(t))
    if (e > testMaxErr) testMaxErr = e
  }

  return {
    n,
    nNodes: n + 1,
    nodeMaxErr,
    testMaxErr,
    nodesExact: nodeMaxErr < 1e-12,
    accurate: testMaxErr < 1e-6,
    methodId: SPECTRAL_CHEBYSHEV_INTERP_ID,
    familyId: SPECTRAL_L2_PARENT,
  }
}
