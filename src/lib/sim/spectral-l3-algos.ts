/**
 * 谱方法 L3 · Fourier 拟谱一阶导数。
 * 周期网格上 sin(κx) 的导数在带宽内精确到数值容差。
 * method id 仅常量，不改 methods.data / registry / edges。
 */
import { METHOD_SPECTRAL } from './research-algos'

/** 父族 · 谱方法。 */
export const SPECTRAL_L3_PARENT = METHOD_SPECTRAL

/** 三级 · Fourier 拟谱微分。 */
export const METHOD_ALGO_PSEUDOSPECTRAL_DIFF = 'method-algo-pseudospectral-diff'

export const SPECTRAL_L3_METHOD_IDS = [METHOD_ALGO_PSEUDOSPECTRAL_DIFF] as const

/**
 * 一阶导数用 Fourier 波数 κ_k（物理域长度 L）。
 * k=0..N−1 映射到 [−⌊(N−1)/2⌋ .. ⌊N/2⌋]；
 * 偶 N 时 Nyquist 模 κ 置 0（一阶导数保持实值）。
 */
export function fourierWaveNumbers(N: number, L: number = 2 * Math.PI): Float64Array {
  if (!(N >= 2) || !Number.isInteger(N)) {
    throw new Error('fourierWaveNumbers: N integer ≥ 2')
  }
  if (!(L > 0)) throw new Error('fourierWaveNumbers: L > 0')
  const kappa = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    const m = k <= N / 2 ? k : k - N
    kappa[k] = (2 * Math.PI * m) / L
  }
  if (N % 2 === 0) kappa[N / 2] = 0
  return kappa
}

/**
 * 实序列朴素 DFT：X[k]=Σ_n x[n] exp(−2π i k n / N)。
 */
export function dft1d(x: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const N = x.length
  if (N < 2) throw new Error('dft1d: length must be ≥ 2')
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    let rk = 0
    let ik = 0
    for (let n = 0; n < N; n++) {
      const ang = (-2 * Math.PI * k * n) / N
      const xn = x[n]!
      rk += xn * Math.cos(ang)
      ik += xn * Math.sin(ang)
    }
    re[k] = rk
    im[k] = ik
  }
  return { re, im }
}

/**
 * 逆 DFT（含 1/N）：x[n]=(1/N) Σ_k X[k] exp(+2π i k n / N)。
 */
export function idft1d(re: ArrayLike<number>, im: ArrayLike<number>): Float64Array {
  const N = re.length
  if (N < 2 || im.length !== N) throw new Error('idft1d: length mismatch / need ≥ 2')
  const x = new Float64Array(N)
  for (let n = 0; n < N; n++) {
    let rn = 0
    for (let k = 0; k < N; k++) {
      const ang = (2 * Math.PI * k * n) / N
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      // 实部：Re(X[k] e^{+iθ})；实信号虚部≈0，不累加
      rn += re[k]! * c - im[k]! * s
    }
    x[n] = rn / N
  }
  return x
}

/**
 * Fourier 拟谱一阶导数：û' = i κ û，再 iDFT。
 * 周期域 [0, L)，格点 x_n = n L / N。
 */
export function spectralDiff1d(u: ArrayLike<number>, L: number = 2 * Math.PI): Float64Array {
  const N = u.length
  if (N < 2) throw new Error('spectralDiff1d: length must be ≥ 2')
  if (!(L > 0)) throw new Error('spectralDiff1d: L > 0')
  const { re, im } = dft1d(u)
  const kappa = fourierWaveNumbers(N, L)
  // (re + i im) * (i κ) = −κ im + i κ re
  const reD = new Float64Array(N)
  const imD = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    const κ = kappa[k]!
    reD[k] = -κ * im[k]!
    imD[k] = κ * re[k]!
  }
  return idft1d(reD, imD)
}

/** max_i |a_i − b_i| */
export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length
  if (b.length !== n) throw new Error('maxAbsDiff: length mismatch')
  let m = 0
  for (let i = 0; i < n; i++) {
    const e = Math.abs(a[i]! - b[i]!)
    if (e > m) m = e
  }
  return m
}

/**
 * 代表样例：周期网格 u=sin(m x)，x∈[0,2π)，
 * 拟谱 u' 与 m cos(m x) 对照；带限整数模应机器精度。
 */
export function runPseudospectralDiffSample(opts?: {
  N?: number
  /** 波数 m（整数，1 ≤ m < N/2） */
  m?: number
}): {
  N: number
  m: number
  L: number
  maxErr: number
  /** 误差应远小于 1e−10 */
  exact: boolean
  methodId: typeof METHOD_ALGO_PSEUDOSPECTRAL_DIFF
  familyId: typeof SPECTRAL_L3_PARENT
} {
  const N = opts?.N ?? 64
  const m = opts?.m ?? 3
  if (!(N >= 4) || !Number.isInteger(N)) {
    throw new Error('runPseudospectralDiffSample: N integer ≥ 4')
  }
  if (!(m >= 1) || !Number.isInteger(m) || m >= N / 2) {
    throw new Error('runPseudospectralDiffSample: m integer in [1, N/2)')
  }
  const L = 2 * Math.PI
  const u = new Float64Array(N)
  const duExact = new Float64Array(N)
  for (let n = 0; n < N; n++) {
    const x = (n * L) / N
    u[n] = Math.sin(m * x)
    duExact[n] = m * Math.cos(m * x)
  }
  const du = spectralDiff1d(u, L)
  const maxErr = maxAbsDiff(du, duExact)
  return {
    N,
    m,
    L,
    maxErr,
    exact: maxErr < 1e-10,
    methodId: METHOD_ALGO_PSEUDOSPECTRAL_DIFF,
    familyId: SPECTRAL_L3_PARENT,
  }
}
