/**
 * RBF（径向基函数）无网格插值 · 纯算法教学 stub。
 * 高斯 / 可选多二次；配置点 colloc 解 Φλ=f；求值 s(x)=Σ λ_j φ(|x−x_j|)。
 * method id 仅常量；不改 methods.data / moduleRegistry / edges。
 */

/** 父族 · RBF 无网格插值。 */
export const METHOD_RBF = 'method-rbf'

/** 子算法 · 高斯 RBF 核 φ(r)=exp(−(ε r)²)。 */
export const METHOD_ALGO_RBF_GAUSS = 'method-algo-rbf-gauss'

/** 子算法 · 配置点 RBF 插值（解 Φλ=f 并求值）。 */
export const METHOD_ALGO_RBF_INTERP = 'method-algo-rbf-interp'

export const RBF_METHOD_IDS = [
  METHOD_ALGO_RBF_GAUSS,
  METHOD_ALGO_RBF_INTERP,
] as const

/** 教学默认最大配置点数（稠密 Φ 高斯消元）。 */
export const RBF_MAX_N = 8

/**
 * 高斯 RBF：φ(r) = exp(−(ε r)²)，ε>0 为形状参数。
 * r 取绝对值；非有限或 ε≤0 → 0（教学 stub 安全回退）。
 */
export function gaussianRbf(r: number, epsilon: number): number {
  if (!(epsilon > 0) || !Number.isFinite(epsilon) || !Number.isFinite(r)) return 0
  const er = epsilon * Math.abs(r)
  return Math.exp(-(er * er))
}

/**
 * 多二次（multiquadric）RBF：φ(r) = √(r² + c²)，c>0。
 * 可选核；非有限或 c≤0 → 0。
 */
export function multiquadricRbf(r: number, c: number): number {
  if (!(c > 0) || !Number.isFinite(c) || !Number.isFinite(r)) return 0
  return Math.sqrt(r * r + c * c)
}

/** RBF 核类型。 */
export type RbfKernelKind = 'gaussian' | 'multiquadric'

/**
 * 统一核求值。
 * gaussian: shape=ε；multiquadric: shape=c。
 */
export function rbfPhi(
  r: number,
  shape: number,
  kind: RbfKernelKind = 'gaussian',
): number {
  if (kind === 'multiquadric') return multiquadricRbf(r, shape)
  return gaussianRbf(r, shape)
}

/**
 * 配置矩阵 Φ_{ij} = φ(|x_i − x_j|)，行主序 n×n Float64Array。
 * n = centers.length；教学限制 n ≤ RBF_MAX_N。
 */
export function rbfCollocationMatrix(
  centers: ArrayLike<number>,
  shape: number,
  kind: RbfKernelKind = 'gaussian',
): Float64Array {
  const n = centers.length
  if (n < 1 || n > RBF_MAX_N) {
    throw new Error(`rbfCollocationMatrix: need 1 ≤ n ≤ ${RBF_MAX_N}`)
  }
  const Phi = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    const xi = centers[i]!
    for (let j = 0; j < n; j++) {
      const r = Math.abs(xi - centers[j]!)
      Phi[i * n + j] = rbfPhi(r, shape, kind)
    }
  }
  return Phi
}

/**
 * 带部分主元的高斯消元解 A x = b（A 行主序 n×n，拷贝后消元）。
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

  const x = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let s = rhs[i]!
    for (let j = i + 1; j < n; j++) s -= M[i * n + j]! * x[j]!
    x[i] = s / M[i * n + i]!
  }
  return x
}

/**
 * RBF 插值系数：解 Φ λ = f，其中 Φ_{ij}=φ(|x_i−x_j|)。
 * centers 与 values 等长，1 ≤ n ≤ RBF_MAX_N。
 */
export function rbfFit(
  centers: ArrayLike<number>,
  values: ArrayLike<number>,
  shape: number,
  kind: RbfKernelKind = 'gaussian',
): Float64Array {
  const n = centers.length
  if (values.length !== n) throw new Error('rbfFit: centers/values length mismatch')
  if (n < 1 || n > RBF_MAX_N) {
    throw new Error(`rbfFit: need 1 ≤ n ≤ ${RBF_MAX_N}`)
  }
  const Phi = rbfCollocationMatrix(centers, shape, kind)
  return solveDenseGauss(Phi, values, n)
}

/**
 * 求值 s(x) = Σ_j λ_j φ(|x − x_j|)。
 */
export function rbfEval(
  x: number,
  centers: ArrayLike<number>,
  lambda: ArrayLike<number>,
  shape: number,
  kind: RbfKernelKind = 'gaussian',
): number {
  const n = centers.length
  if (lambda.length !== n) throw new Error('rbfEval: centers/lambda length mismatch')
  if (!Number.isFinite(x)) return NaN
  let s = 0
  for (let j = 0; j < n; j++) {
    const r = Math.abs(x - centers[j]!)
    s += lambda[j]! * rbfPhi(r, shape, kind)
  }
  return s
}

/** 在多个点上求值。 */
export function rbfEvalMany(
  xs: ArrayLike<number>,
  centers: ArrayLike<number>,
  lambda: ArrayLike<number>,
  shape: number,
  kind: RbfKernelKind = 'gaussian',
): Float64Array {
  const out = new Float64Array(xs.length)
  for (let i = 0; i < xs.length; i++) {
    out[i] = rbfEval(xs[i]!, centers, lambda, shape, kind)
  }
  return out
}

/**
 * 高斯核样例：φ(0)=1，随 r 衰减，对称；可选与 MQ 对照。
 */
export function runRbfGaussSample(opts?: {
  epsilon?: number
  r?: number
}): {
  epsilon: number
  r: number
  phi0: number
  phiR: number
  phiNegR: number
  /** φ(0) − 1 */
  errAt0: number
  /** |φ(r) − φ(−r)| */
  symmetryErr: number
  /** φ 在 r 处是否严格小于 φ(0)（r>0） */
  decays: boolean
  /** 多二次对照：√(r²+c²) 在 r=0 为 c */
  mqAt0: number
  ok: boolean
  methodId: typeof METHOD_ALGO_RBF_GAUSS
  familyId: typeof METHOD_RBF
} {
  const epsilon = opts?.epsilon ?? 1.5
  const r = opts?.r ?? 0.7
  const phi0 = gaussianRbf(0, epsilon)
  const phiR = gaussianRbf(r, epsilon)
  const phiNegR = gaussianRbf(-r, epsilon)
  const errAt0 = Math.abs(phi0 - 1)
  const symmetryErr = Math.abs(phiR - phiNegR)
  const decays = r > 0 ? phiR < phi0 - 1e-15 : true
  const mqAt0 = multiquadricRbf(0, epsilon)
  const ok =
    errAt0 < 1e-14 &&
    symmetryErr < 1e-14 &&
    decays &&
    phi0 > 0 &&
    Math.abs(mqAt0 - epsilon) < 1e-14

  return {
    epsilon,
    r,
    phi0,
    phiR,
    phiNegR,
    errAt0,
    symmetryErr,
    decays,
    mqAt0,
    ok,
    methodId: METHOD_ALGO_RBF_GAUSS,
    familyId: METHOD_RBF,
  }
}

/**
 * 配置点插值样例：在 centers 上插值 f(x)=sin(π x) 或给定 values；
 * 检验插值性质 s(x_i)=f_i，以及内部探测点有限残差。
 */
export function runRbfInterpSample(opts?: {
  /** 配置点数，默认 5，≤ RBF_MAX_N */
  n?: number
  epsilon?: number
  kind?: RbfKernelKind
  /** 域 [lo, hi]，默认 [0,1] 均匀中心 */
  lo?: number
  hi?: number
}): {
  n: number
  epsilon: number
  kind: RbfKernelKind
  centers: number[]
  values: number[]
  lambda: number[]
  /** max_i |s(x_i) − f_i| */
  maxInterpErr: number
  /** 中点探测 |s − f|（非必须精确） */
  midProbeErr: number
  ok: boolean
  methodId: typeof METHOD_ALGO_RBF_INTERP
  familyId: typeof METHOD_RBF
} {
  const n = Math.min(RBF_MAX_N, Math.max(1, opts?.n ?? 5))
  const epsilon = opts?.epsilon ?? 2
  const kind = opts?.kind ?? 'gaussian'
  const lo = opts?.lo ?? 0
  const hi = opts?.hi ?? 1

  const centers = new Float64Array(n)
  const values = new Float64Array(n)
  if (n === 1) {
    centers[0] = 0.5 * (lo + hi)
  } else {
    for (let i = 0; i < n; i++) {
      centers[i] = lo + ((hi - lo) * i) / (n - 1)
    }
  }
  for (let i = 0; i < n; i++) {
    values[i] = Math.sin(Math.PI * centers[i]!)
  }

  const lambda = rbfFit(centers, values, epsilon, kind)

  let maxInterpErr = 0
  for (let i = 0; i < n; i++) {
    const s = rbfEval(centers[i]!, centers, lambda, epsilon, kind)
    const e = Math.abs(s - values[i]!)
    if (e > maxInterpErr) maxInterpErr = e
  }

  const mid = 0.5 * (lo + hi)
  const midTrue = Math.sin(Math.PI * mid)
  const midProbeErr = Math.abs(rbfEval(mid, centers, lambda, epsilon, kind) - midTrue)

  const ok = maxInterpErr < 1e-10 && Number.isFinite(midProbeErr)

  return {
    n,
    epsilon,
    kind,
    centers: Array.from(centers),
    values: Array.from(values),
    lambda: Array.from(lambda),
    maxInterpErr,
    midProbeErr,
    ok,
    methodId: METHOD_ALGO_RBF_INTERP,
    familyId: METHOD_RBF,
  }
}
