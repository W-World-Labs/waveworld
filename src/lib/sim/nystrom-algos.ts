/**
 * Nyström method for Fredholm integral equations of the 2nd kind (teaching stub).
 * φ(x) − λ ∫₀¹ K(x,y) φ(y) dy = f(x) on [0,1]; continuous K (e.g. exp(−|x−y|)).
 * Collocation + trapezoid / midpoint quadrature; dense GE for n ≤ 16.
 * method id 仅常量；不改 methods.data / moduleRegistry / edges。
 */

/** 父族 · Nyström 积分方程。 */
export const METHOD_NYSTROM = 'method-nystrom'

/** 子算法 · Nyström 求积配点（梯形 / 中点权）。 */
export const METHOD_ALGO_NYSTROM_QUAD = 'method-algo-nystrom-quad'

export const NYSTROM_METHOD_IDS = [METHOD_ALGO_NYSTROM_QUAD] as const

/** 教学默认最大配点数（稠密 A 高斯消元）。 */
export const NYSTROM_MAX_N = 16

/** 求积规则：开区间中点矩形，或含端点梯形。 */
export type NystromQuadRule = 'midpoint' | 'trapezoid'

/** 默认核 K(x,y)=exp(−|x−y|)（连续、对称、正定型）。 */
export function kernelExpAbs(x: number, y: number): number {
  return Math.exp(-Math.abs(x - y))
}

/** 核类型（可注入任意连续 K）。 */
export type NystromKernel = (x: number, y: number) => number

/**
 * 配点节点 x_i ∈ [0,1]。
 * midpoint: x_i = (i+½)/n，i=0..n−1
 * trapezoid: x_i = i/(n−1)，i=0..n−1（n≥2）
 */
export function nystromNodes(n: number, rule: NystromQuadRule = 'midpoint'): Float64Array {
  if (!Number.isInteger(n) || n < 2 || n > NYSTROM_MAX_N) {
    throw new Error(`nystromNodes: need integer 2 ≤ n ≤ ${NYSTROM_MAX_N}`)
  }
  const x = new Float64Array(n)
  if (rule === 'midpoint') {
    for (let i = 0; i < n; i++) x[i] = (i + 0.5) / n
  } else {
    for (let i = 0; i < n; i++) x[i] = i / (n - 1)
  }
  return x
}

/**
 * Nyström 求积权 w_j（∫ g ≈ Σ w_j g(x_j)）。
 * midpoint: w_j = 1/n
 * trapezoid: h=1/(n−1)，端点 h/2，内部 h
 */
export function nystromWeights(n: number, rule: NystromQuadRule = 'midpoint'): Float64Array {
  if (!Number.isInteger(n) || n < 2 || n > NYSTROM_MAX_N) {
    throw new Error(`nystromWeights: need integer 2 ≤ n ≤ ${NYSTROM_MAX_N}`)
  }
  const w = new Float64Array(n)
  if (rule === 'midpoint') {
    const h = 1 / n
    for (let j = 0; j < n; j++) w[j] = h
  } else {
    const h = 1 / (n - 1)
    for (let j = 0; j < n; j++) w[j] = h
    w[0] = h / 2
    w[n - 1] = h / 2
  }
  return w
}

/**
 * 组装 Nyström 矩阵 A_ij = δ_ij − λ w_j K(x_i, x_j)（行主序 n×n）。
 * 离散方程 A φ = f 逼近第二类 Fredholm。
 */
export function assembleNystromMatrix(
  n: number,
  lambda: number,
  opts?: {
    rule?: NystromQuadRule
    kernel?: NystromKernel
  },
): { A: Float64Array; x: Float64Array; w: Float64Array; lambda: number } {
  if (!Number.isFinite(lambda)) throw new Error('assembleNystromMatrix: lambda must be finite')
  const rule = opts?.rule ?? 'midpoint'
  const kernel = opts?.kernel ?? kernelExpAbs
  const x = nystromNodes(n, rule)
  const w = nystromWeights(n, rule)
  const A = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    const xi = x[i]!
    for (let j = 0; j < n; j++) {
      const kij = kernel(xi, x[j]!)
      A[i * n + j] = (i === j ? 1 : 0) - lambda * w[j]! * kij
    }
  }
  return { A, x, w, lambda }
}

/**
 * 带部分主元的高斯消元解 A z = b（A 行主序 n×n，拷贝后消元）。
 * 教学用：n 小；奇异时抛错。
 */
export function solveDenseGauss(
  A: ArrayLike<number>,
  b: ArrayLike<number>,
  n: number,
): Float64Array {
  if (n < 1 || A.length < n * n || b.length < n) {
    throw new Error('solveDenseGauss: size mismatch')
  }
  const M = new Float64Array(n * n)
  for (let i = 0; i < n * n; i++) M[i] = A[i]!
  const rhs = new Float64Array(n)
  for (let i = 0; i < n; i++) rhs[i] = b[i]!

  for (let k = 0; k < n; k++) {
    let piv = k
    let best = Math.abs(M[k * n + k]!)
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i * n + k]!)
      if (v > best) {
        best = v
        piv = i
      }
    }
    if (best < 1e-14) throw new Error('solveDenseGauss: singular')
    if (piv !== k) {
      for (let j = k; j < n; j++) {
        const tmp = M[k * n + j]!
        M[k * n + j] = M[piv * n + j]!
        M[piv * n + j] = tmp
      }
      const tb = rhs[k]!
      rhs[k] = rhs[piv]!
      rhs[piv] = tb
    }
    const akk = M[k * n + k]!
    for (let i = k + 1; i < n; i++) {
      const f = M[i * n + k]! / akk
      M[i * n + k] = 0
      for (let j = k + 1; j < n; j++) {
        M[i * n + j] = M[i * n + j]! - f * M[k * n + j]!
      }
      rhs[i] = rhs[i]! - f * rhs[k]!
    }
  }

  const z = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let s = rhs[i]!
    for (let j = i + 1; j < n; j++) s -= M[i * n + j]! * z[j]!
    z[i] = s / M[i * n + i]!
  }
  return z
}

/** r = A φ − f；返回 ‖r‖_∞。 */
export function residualInf(
  A: ArrayLike<number>,
  phi: ArrayLike<number>,
  f: ArrayLike<number>,
  n: number,
): number {
  let m = 0
  for (let i = 0; i < n; i++) {
    let row = 0
    for (let j = 0; j < n; j++) row += A[i * n + j]! * phi[j]!
    const d = Math.abs(row - f[i]!)
    if (d > m) m = d
  }
  return m
}

/** r = A φ − f；返回 RMS ‖r‖₂ / √n。 */
export function residualRms(
  A: ArrayLike<number>,
  phi: ArrayLike<number>,
  f: ArrayLike<number>,
  n: number,
): number {
  let s = 0
  for (let i = 0; i < n; i++) {
    let row = 0
    for (let j = 0; j < n; j++) row += A[i * n + j]! * phi[j]!
    const d = row - f[i]!
    s += d * d
  }
  return Math.sqrt(s / n)
}

/** 在节点上采样 φ*(x)=sin(π x)。 */
export function samplePhiSinPi(x: ArrayLike<number>): Float64Array {
  const phi = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) phi[i] = Math.sin(Math.PI * x[i]!)
  return phi
}

/**
 * 离散算子作用： (T φ)_i = φ_i − λ Σ_j w_j K(x_i,x_j) φ_j  ≡ (A φ)_i。
 */
export function applyNystrom(
  A: ArrayLike<number>,
  phi: ArrayLike<number>,
  n: number,
): Float64Array {
  const f = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = 0; j < n; j++) s += A[i * n + j]! * phi[j]!
    f[i] = s
  }
  return f
}

/**
 * 代表样例：K=exp(−|x−y|)，φ*=sin(πx)，λ 默认 0.5；
 * 自洽右端 f=Aφ* 上解 Aφ=f，残差应近机精；矩阵对角 ≈1。
 */
export function runNystromQuadSample(opts?: {
  n?: number
  lambda?: number
  rule?: NystromQuadRule
}): {
  n: number
  lambda: number
  rule: NystromQuadRule
  residualInf: number
  residualRms: number
  /** max |φ − φ*|（自洽制造解应≈0） */
  densityErr: number
  maxAbsPhi: number
  /** 对角 A_ii 与 1 的偏差上界（权·K 有限） */
  diagShiftMax: number
  ok: boolean
  methodId: typeof METHOD_ALGO_NYSTROM_QUAD
  familyId: typeof METHOD_NYSTROM
} {
  const n = Math.min(NYSTROM_MAX_N, Math.max(2, opts?.n ?? 12))
  const lambda = opts?.lambda ?? 0.5
  const rule = opts?.rule ?? 'midpoint'

  const { A, x } = assembleNystromMatrix(n, lambda, { rule, kernel: kernelExpAbs })
  const phiStar = samplePhiSinPi(x)
  const f = applyNystrom(A, phiStar, n)
  const phi = solveDenseGauss(A, f, n)

  const resInf = residualInf(A, phi, f, n)
  const resRms = residualRms(A, phi, f, n)

  let densityErr = 0
  let maxAbsPhi = 0
  for (let i = 0; i < n; i++) {
    const e = Math.abs(phi[i]! - phiStar[i]!)
    if (e > densityErr) densityErr = e
    const a = Math.abs(phi[i]!)
    if (a > maxAbsPhi) maxAbsPhi = a
  }

  let diagShiftMax = 0
  for (let i = 0; i < n; i++) {
    const shift = Math.abs(A[i * n + i]! - 1)
    if (shift > diagShiftMax) diagShiftMax = shift
  }

  const ok =
    resInf < 1e-10 &&
    resRms < 1e-10 &&
    densityErr < 1e-10 &&
    maxAbsPhi > 0.1 &&
    Number.isFinite(diagShiftMax)

  return {
    n,
    lambda,
    rule,
    residualInf: resInf,
    residualRms: resRms,
    densityErr,
    maxAbsPhi,
    diagShiftMax,
    ok,
    methodId: METHOD_ALGO_NYSTROM_QUAD,
    familyId: METHOD_NYSTROM,
  }
}
