/**
 * GMRES 纯算法 stub · 重启 GMRES(m) 解小规模稠密 / 三对角型 Ax=b。
 * 支持非对称系统；残差下降。
 * method id 仅常量，不改 methods.data / moduleRegistry。
 */

/** 族 · GMRES（求解器族，尚未入库）。 */
export const METHOD_GMRES = 'method-gmres'

/** 算法 · 重启 GMRES(m)。 */
export const METHOD_ALGO_GMRES = 'method-algo-gmres'

/** 父族别名（与 familyId 对齐）。 */
export const GMRES_PARENT = METHOD_GMRES

export const GMRES_METHOD_IDS = [METHOD_ALGO_GMRES] as const

export type MatVec = (x: Float64Array, y: Float64Array) => void

export type GmresResult = {
  x: Float64Array
  /** 每外迭代（含初值）残差 ‖b−Ax‖₂ */
  residuals: number[]
  iterations: number
  restarts: number
  converged: boolean
}

/** ‖v‖₂ */
export function norm2(v: Float64Array | number[]): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
}

/** 点积 */
export function dot(u: Float64Array | number[], v: Float64Array | number[]): number {
  let s = 0
  for (let i = 0; i < u.length; i++) s += u[i]! * v[i]!
  return s
}

/** y = A x，A 行主序稠密 n×n。 */
export function denseMatVec(
  A: ArrayLike<number>,
  n: number,
  x: Float64Array | number[],
  y: Float64Array,
): void {
  for (let i = 0; i < n; i++) {
    let s = 0
    const row = i * n
    for (let j = 0; j < n; j++) s += A[row + j]! * x[j]!
    y[i] = s
  }
}

/** 由行主序数组构造 matvec。 */
export function makeDenseMatVec(A: ArrayLike<number>, n: number): MatVec {
  return (x, y) => denseMatVec(A, n, x, y)
}

/**
 * 三对角 matvec：a 下对角（a[0] 未用）、b 主对角、c 上对角（c[n-1] 未用）。
 * 可非对称（a ≠ c）。
 */
export function tridiagMatVec(
  a: Float64Array | number[],
  b: Float64Array | number[],
  c: Float64Array | number[],
  x: Float64Array | number[],
  y: Float64Array,
): void {
  const n = b.length
  for (let i = 0; i < n; i++) {
    let s = b[i]! * x[i]!
    if (i > 0) s += a[i]! * x[i - 1]!
    if (i < n - 1) s += c[i]! * x[i + 1]!
    y[i] = s
  }
}

export function makeTridiagMatVec(
  a: Float64Array | number[],
  b: Float64Array | number[],
  c: Float64Array | number[],
): MatVec {
  return (x, y) => tridiagMatVec(a, b, c, x, y)
}

/**
 * 重启 GMRES(m)：Arnoldi + Givens 消元解上 Hessenberg 最小二乘。
 * 判据：‖r‖ < tol · max(1, ‖b‖)。
 */
export function gmres(
  matvec: MatVec,
  b: Float64Array | number[],
  opts?: {
    m?: number
    maxRestarts?: number
    tol?: number
    x0?: Float64Array
  },
): GmresResult {
  const n = b.length
  const m = opts?.m ?? Math.min(n, 10)
  const maxRestarts = opts?.maxRestarts ?? 20
  const tol = opts?.tol ?? 1e-10
  const x = opts?.x0 ? new Float64Array(opts.x0) : new Float64Array(n)

  const Ax = new Float64Array(n)
  const r = new Float64Array(n)
  const V: Float64Array[] = []
  for (let i = 0; i <= m; i++) V.push(new Float64Array(n))

  // Hessenberg H[(m+1) × m] 行主序
  const H = new Float64Array((m + 1) * m)
  const cs = new Float64Array(m)
  const sn = new Float64Array(m)
  const g = new Float64Array(m + 1)

  const residuals: number[] = []
  const bNorm = Math.max(norm2(b), 1)
  const thresh = tol * bNorm

  // r0 = b − A x
  matvec(x, Ax)
  for (let i = 0; i < n; i++) r[i] = b[i]! - Ax[i]!
  let beta = norm2(r)
  residuals.push(beta)

  let iterations = 0
  let restarts = 0
  let converged = beta < thresh

  outer: while (!converged && restarts < maxRestarts) {
    restarts++
    // v1 = r / ‖r‖
    const invBeta = beta > 0 ? 1 / beta : 1
    for (let i = 0; i < n; i++) V[0]![i] = r[i]! * invBeta
    g.fill(0)
    g[0] = beta
    H.fill(0)

    let jFinal = 0
    for (let j = 0; j < m; j++) {
      jFinal = j
      // w = A v_j
      matvec(V[j]!, Ax)
      // Arnoldi 正交化
      for (let i = 0; i <= j; i++) {
        const hij = dot(Ax, V[i]!)
        H[i * m + j] = hij
        for (let k = 0; k < n; k++) Ax[k]! -= hij * V[i]![k]!
      }
      const hjp1 = norm2(Ax)
      H[(j + 1) * m + j] = hjp1
      if (hjp1 > 0) {
        const inv = 1 / hjp1
        for (let k = 0; k < n; k++) V[j + 1]![k] = Ax[k]! * inv
      }

      // 对 H 列 j 应用已有 Givens
      for (let i = 0; i < j; i++) {
        const h_ij = H[i * m + j]!
        const h_i1j = H[(i + 1) * m + j]!
        H[i * m + j] = cs[i]! * h_ij + sn[i]! * h_i1j
        H[(i + 1) * m + j] = -sn[i]! * h_ij + cs[i]! * h_i1j
      }
      // 新 Givens 消 H[j+1,j]
      const hjj = H[j * m + j]!
      const hj1j = H[(j + 1) * m + j]!
      const denom = Math.hypot(hjj, hj1j)
      if (denom === 0) {
        cs[j] = 1
        sn[j] = 0
      } else {
        cs[j] = hjj / denom
        sn[j] = hj1j / denom
      }
      H[j * m + j] = cs[j]! * hjj + sn[j]! * hj1j
      H[(j + 1) * m + j] = 0

      // 更新 g
      const gj = g[j]!
      g[j] = cs[j]! * gj
      g[j + 1] = -sn[j]! * gj

      iterations++
      const resApprox = Math.abs(g[j + 1]!)
      residuals.push(resApprox)
      if (resApprox < thresh) {
        // 回代 y，更新 x
        updateSolution(x, V, H, g, j + 1, m, n)
        converged = true
        break outer
      }
      // 精确零 → 不变子空间
      if (!(hjp1 > 0)) {
        updateSolution(x, V, H, g, j + 1, m, n)
        matvec(x, Ax)
        for (let i = 0; i < n; i++) r[i] = b[i]! - Ax[i]!
        beta = norm2(r)
        residuals[residuals.length - 1] = beta
        converged = beta < thresh
        break outer
      }
    }

    // 满 m 步：回代并重启
    if (!converged) {
      updateSolution(x, V, H, g, jFinal + 1, m, n)
      matvec(x, Ax)
      for (let i = 0; i < n; i++) r[i] = b[i]! - Ax[i]!
      beta = norm2(r)
      residuals.push(beta)
      if (beta < thresh) {
        converged = true
        break
      }
    }
  }

  // 最终精确残差
  matvec(x, Ax)
  for (let i = 0; i < n; i++) r[i] = b[i]! - Ax[i]!
  const finalRes = norm2(r)
  if (residuals[residuals.length - 1] !== finalRes) {
    residuals.push(finalRes)
  }
  converged = finalRes < thresh

  return { x, residuals, iterations, restarts, converged }
}

/** 上三角回代 H(0:k-1,0:k-1) y = g(0:k-1)，x += V y */
function updateSolution(
  x: Float64Array,
  V: Float64Array[],
  H: Float64Array,
  g: Float64Array,
  k: number,
  m: number,
  n: number,
): void {
  const y = new Float64Array(k)
  for (let i = k - 1; i >= 0; i--) {
    let s = g[i]!
    for (let j = i + 1; j < k; j++) s -= H[i * m + j]! * y[j]!
    const hii = H[i * m + i]!
    y[i] = Math.abs(hii) > 1e-30 ? s / hii : 0
  }
  for (let j = 0; j < k; j++) {
    const yj = y[j]!
    const vj = V[j]!
    for (let i = 0; i < n; i++) x[i]! += yj * vj[i]!
  }
}

/**
 * 构造小非对称三对角系统（对流–扩散型）：
 * 下 a = −1−δ，主 b = 2，上 c = −1+δ，δ>0 使 a≠c。
 * 右端 b 使精确解 x* = (1,1,...,1) 时由 A 1 给出。
 */
export function makeNonsymTridiagSystem(n: number, delta = 0.3): {
  a: Float64Array
  b: Float64Array
  c: Float64Array
  rhs: Float64Array
  xTrue: Float64Array
} {
  const a = new Float64Array(n)
  const b = new Float64Array(n)
  const c = new Float64Array(n)
  const xTrue = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    b[i] = 2
    if (i > 0) a[i] = -1 - delta
    if (i < n - 1) c[i] = -1 + delta
    xTrue[i] = 1
  }
  const rhs = new Float64Array(n)
  tridiagMatVec(a, b, c, xTrue, rhs)
  return { a, b, c, rhs, xTrue }
}

/**
 * 稠密非对称 3×3 样例：
 *   A = [[4, 1, 0],
 *        [2, 5, 1],
 *        [0, 1, 3]]
 * 精确解 x = (1, 2, 3)。
 */
export function makeDenseNonsym3x3(): {
  A: Float64Array
  n: number
  rhs: Float64Array
  xTrue: Float64Array
} {
  const n = 3
  const A = new Float64Array([4, 1, 0, 2, 5, 1, 0, 1, 3])
  const xTrue = new Float64Array([1, 2, 3])
  const rhs = new Float64Array(n)
  denseMatVec(A, n, xTrue, rhs)
  return { A, n, rhs, xTrue }
}

/**
 * 代表样例：重启 GMRES 解非对称三对角 + 稠密小系统。
 * 残差下降、解逼近真值、ok。
 */
export function runGmresSample(
  opts: {
    n?: number
    delta?: number
    m?: number
    maxRestarts?: number
    tol?: number
  } = {},
): {
  n: number
  residual0: number
  residualF: number
  residualDecreased: boolean
  maxErr: number
  denseMaxErr: number
  denseResidualF: number
  iterations: number
  restarts: number
  converged: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_GMRES
  familyId: typeof METHOD_GMRES
} {
  const n = opts.n ?? 12
  const delta = opts.delta ?? 0.35
  // 教学样例：m≈n 一次 Krylov 空间足够；tol 相对 ‖b‖
  const m = opts.m ?? Math.min(n, 12)
  const maxRestarts = opts.maxRestarts ?? 8
  const tol = opts.tol ?? 1e-10

  const sys = makeNonsymTridiagSystem(n, delta)
  const matvec = makeTridiagMatVec(sys.a, sys.b, sys.c)
  const g = gmres(matvec, sys.rhs, { m, maxRestarts, tol })

  let maxErr = 0
  let finite = true
  for (let i = 0; i < n; i++) {
    const e = Math.abs(g.x[i]! - sys.xTrue[i]!)
    if (e > maxErr) maxErr = e
    if (!Number.isFinite(g.x[i]!)) finite = false
  }

  const residual0 = g.residuals[0]!
  const residualF = g.residuals[g.residuals.length - 1]!
  const residualDecreased =
    residualF < residual0 * 1e-4 || residualF < 1e-8

  // 稠密 3×3 非对称对照
  const d = makeDenseNonsym3x3()
  const gd = gmres(makeDenseMatVec(d.A, d.n), d.rhs, {
    m: 3,
    maxRestarts: 5,
    tol: 1e-12,
  })
  let denseMaxErr = 0
  for (let i = 0; i < d.n; i++) {
    const e = Math.abs(gd.x[i]! - d.xTrue[i]!)
    if (e > denseMaxErr) denseMaxErr = e
    if (!Number.isFinite(gd.x[i]!)) finite = false
  }
  const denseResidualF = gd.residuals[gd.residuals.length - 1]!

  // 以残差下降 + 解精度为主；converged 依赖相对 tol，教学核允许近似
  const ok =
    residualDecreased &&
    (g.converged || residualF < residual0 * 1e-6) &&
    maxErr < 1e-6 &&
    denseMaxErr < 1e-8 &&
    denseResidualF < 1e-8 &&
    finite

  return {
    n,
    residual0,
    residualF,
    residualDecreased,
    maxErr,
    denseMaxErr,
    denseResidualF,
    iterations: g.iterations,
    restarts: g.restarts,
    converged: g.converged,
    finite,
    ok,
    methodId: METHOD_ALGO_GMRES,
    familyId: METHOD_GMRES,
  }
}
