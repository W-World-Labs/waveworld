/**
 * Convolution theorem · circular convolution via DFT product (teaching stub).
 * (a ⋆ b)[n] = Σ_k a[k] b[(n−k) mod N]  ↔  IDFT( DFT(a) · DFT(b) ).
 * N power of 2; direct O(N²) vs spectral O(N²) naive DFT for equivalence tests.
 * method id 仅常量；不改 methods.data / moduleRegistry / edges。
 * Family: METHOD_CONVOLUTION（非 spectral parent）。
 */

/** 父族 · 卷积 / 卷积定理。 */
export const METHOD_CONVOLUTION = 'method-convolution'

/** 子算法 · 圆周卷积的 DFT 乘积实现。 */
export const METHOD_ALGO_CONV_DFT = 'method-algo-conv-dft'

export const CONVOLUTION_METHOD_IDS = [METHOD_ALGO_CONV_DFT] as const

/** 教学默认最大长度（朴素 DFT）。 */
export const CONV_MAX_N = 64

/** N 是否为 2 的幂且 ≥ 2。 */
export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0
}

/**
 * 实序列朴素 DFT：X[k]=Σ_n x[n] exp(−2π i k n / N)。
 */
export function dftReal1d(x: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const N = x.length
  if (N < 2) throw new Error('dftReal1d: length must be ≥ 2')
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
 * 逆 DFT（含 1/N）：x[n]=(1/N) Σ_k X[k] exp(+2π i k n / N)；返回实部。
 */
export function idftReal1d(re: ArrayLike<number>, im: ArrayLike<number>): Float64Array {
  const N = re.length
  if (N < 2 || im.length !== N) throw new Error('idftReal1d: length mismatch / need ≥ 2')
  const x = new Float64Array(N)
  for (let n = 0; n < N; n++) {
    let rn = 0
    for (let k = 0; k < N; k++) {
      const ang = (2 * Math.PI * k * n) / N
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      rn += re[k]! * c - im[k]! * s
    }
    x[n] = rn / N
  }
  return x
}

/**
 * 直接圆周卷积：c[n] = Σ_{k=0}^{N−1} a[k] b[(n−k) mod N]。
 * a、b 等长；N 为 2 的幂且 ≤ CONV_MAX_N。
 */
export function circularConvDirect(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): Float64Array {
  const N = a.length
  if (b.length !== N) throw new Error('circularConvDirect: length mismatch')
  if (!isPowerOfTwo(N) || N > CONV_MAX_N) {
    throw new Error(`circularConvDirect: need power-of-2 2…${CONV_MAX_N}`)
  }
  const c = new Float64Array(N)
  for (let n = 0; n < N; n++) {
    let s = 0
    for (let k = 0; k < N; k++) {
      let j = n - k
      j = ((j % N) + N) % N
      s += a[k]! * b[j]!
    }
    c[n] = s
  }
  return c
}

/**
 * 卷积定理：c = IDFT( DFT(a) ⊙ DFT(b) )（逐频点复数乘）。
 * 与 circularConvDirect 在数值容差内一致。
 */
export function circularConvDft(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): Float64Array {
  const N = a.length
  if (b.length !== N) throw new Error('circularConvDft: length mismatch')
  if (!isPowerOfTwo(N) || N > CONV_MAX_N) {
    throw new Error(`circularConvDft: need power-of-2 2…${CONV_MAX_N}`)
  }
  const A = dftReal1d(a)
  const B = dftReal1d(b)
  const pr = new Float64Array(N)
  const pi = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    // (Ar+iAi)(Br+iBi)
    pr[k] = A.re[k]! * B.re[k]! - A.im[k]! * B.im[k]!
    pi[k] = A.re[k]! * B.im[k]! + A.im[k]! * B.re[k]!
  }
  return idftReal1d(pr, pi)
}

/** max_i |u_i − v_i| */
export function maxAbsDiff(u: ArrayLike<number>, v: ArrayLike<number>): number {
  const n = u.length
  if (v.length !== n) throw new Error('maxAbsDiff: length mismatch')
  let m = 0
  for (let i = 0; i < n; i++) {
    const e = Math.abs(u[i]! - v[i]!)
    if (e > m) m = e
  }
  return m
}

/**
 * 代表样例：长度 N=2^p 的短脉冲/斜坡；DFT 乘积圆周卷积与直接卷积对照。
 */
export function runConvDftSample(opts?: {
  /** 长度，须为 2 的幂，默认 16 */
  N?: number
}): {
  N: number
  maxAbsErr: number
  /** max |c_dft|（能量非零） */
  maxAbsConv: number
  /** 脉冲自相关峰位（单位脉冲 ⊗ 自身 → 峰在 0） */
  peakIndex: number
  peakValue: number
  ok: boolean
  methodId: typeof METHOD_ALGO_CONV_DFT
  familyId: typeof METHOD_CONVOLUTION
} {
  const N = opts?.N ?? 16
  if (!isPowerOfTwo(N) || N > CONV_MAX_N) {
    throw new Error(`runConvDftSample: need power-of-2 2…${CONV_MAX_N}`)
  }

  // a: 单位脉冲；b: 短斜坡 + 小正弦（非对称，便于验 wrap）
  const a = new Float64Array(N)
  const b = new Float64Array(N)
  a[0] = 1
  a[1] = 0.5
  for (let n = 0; n < N; n++) {
    b[n] = (n < 4 ? n + 1 : 0) + 0.25 * Math.sin((2 * Math.PI * 3 * n) / N)
  }

  const cDirect = circularConvDirect(a, b)
  const cDft = circularConvDft(a, b)
  const maxAbsErr = maxAbsDiff(cDirect, cDft)

  let maxAbsConv = 0
  let peakIndex = 0
  let peakValue = cDft[0]!
  for (let i = 0; i < N; i++) {
    const v = Math.abs(cDft[i]!)
    if (v > maxAbsConv) maxAbsConv = v
    if (cDft[i]! > peakValue) {
      peakValue = cDft[i]!
      peakIndex = i
    }
  }

  // 单位脉冲自相关样例：δ ⋆ δ = δ
  const d = new Float64Array(N)
  d[0] = 1
  const auto = circularConvDft(d, d)
  const autoOk =
    Math.abs(auto[0]! - 1) < 1e-12 &&
    (() => {
      for (let i = 1; i < N; i++) {
        if (Math.abs(auto[i]!) > 1e-12) return false
      }
      return true
    })()

  const ok = maxAbsErr < 1e-10 && maxAbsConv > 0 && autoOk

  return {
    N,
    maxAbsErr,
    maxAbsConv,
    peakIndex,
    peakValue,
    ok,
    methodId: METHOD_ALGO_CONV_DFT,
    familyId: METHOD_CONVOLUTION,
  }
}
