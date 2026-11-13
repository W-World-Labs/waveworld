/**
 * Helmholtz 1D 有限差分 · u″ + k² u = f，区间齐次 Dirichlet。
 * 亦可检验本征模残差（离散 Helmholtz 算子）。
 * method id 仅常量，不改 methods.data / registry / edges。
 */

/** 父族 · Helmholtz。 */
export const METHOD_HELMHOLTZ = 'method-helmholtz'

/** 算法 · 1D 中心差分 Helmholtz。 */
export const METHOD_ALGO_HELMHOLTZ_FD = 'method-algo-helmholtz-fd'

export const HELMHOLTZ_METHOD_IDS = [METHOD_ALGO_HELMHOLTZ_FD] as const

/** ‖v‖₂ */
export function norm2(v: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
}

/** 最大绝对值。 */
export function maxAbs(v: ArrayLike<number>): number {
  let m = 0
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i]!)
    if (a > m) m = a
  }
  return m
}

/**
 * Thomas 算法解三对角 Ax=d：
 * a[i] 下对角（a[0] 未用）、b 主对角、c 上对角（c[n-1] 未用）、d 右端。
 * 返回新数组。
 */
export function solveTridiag(
  a: Float64Array | number[],
  b: Float64Array | number[],
  c: Float64Array | number[],
  d: Float64Array | number[],
): Float64Array {
  const n = b.length
  if (a.length !== n || c.length !== n || d.length !== n) {
    throw new Error('solveTridiag: length mismatch')
  }
  if (n === 0) return new Float64Array(0)
  const cp = new Float64Array(n)
  const dp = new Float64Array(n)
  const x = new Float64Array(n)
  let denom = b[0]!
  if (denom === 0) throw new Error('solveTridiag: zero pivot')
  cp[0] = c[0]! / denom
  dp[0] = d[0]! / denom
  for (let i = 1; i < n; i++) {
    denom = b[i]! - a[i]! * cp[i - 1]!
    if (denom === 0) throw new Error('solveTridiag: zero pivot')
    cp[i] = i < n - 1 ? c[i]! / denom : 0
    dp[i] = (d[i]! - a[i]! * dp[i - 1]!) / denom
  }
  x[n - 1] = dp[n - 1]!
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i]! - cp[i]! * x[i + 1]!
  return x
}

export type HelmholtzTridiag = {
  /** 内部自由度数 M（两端 Dirichlet 已消去）。 */
  M: number
  /** 域长 L，节点 x_i = i h，h = L/(M+1)，i=0..M+1。 */
  L: number
  h: number
  k: number
  a: Float64Array
  b: Float64Array
  c: Float64Array
  d: Float64Array
}

/**
 * 组装 1D 中心差 Helmholtz 系统（齐次 Dirichlet）：
 * (u_{i−1} − 2 u_i + u_{i+1}) / h² + k² u_i = f_i，i=1..M。
 * 三对角：主对角 −2/h² + k²，副对角 1/h²；右端 f 在内部节点。
 * f 可为常数或长度 M 的数组；缺省 f≡1。
 */
export function assembleHelmholtz1d(
  M: number,
  L: number,
  k: number,
  f: number | ArrayLike<number> = 1,
): HelmholtzTridiag {
  if (!(M >= 1) || !Number.isInteger(M)) {
    throw new Error('assembleHelmholtz1d: M integer ≥ 1')
  }
  if (!(L > 0) || !Number.isFinite(k)) {
    throw new Error('assembleHelmholtz1d: L > 0, k finite')
  }
  const h = L / (M + 1)
  const invh2 = 1 / (h * h)
  const a = new Float64Array(M)
  const b = new Float64Array(M)
  const c = new Float64Array(M)
  const d = new Float64Array(M)
  const diag = -2 * invh2 + k * k
  const off = invh2
  for (let i = 0; i < M; i++) {
    b[i] = diag
    if (i > 0) a[i] = off
    if (i < M - 1) c[i] = off
    d[i] = typeof f === 'number' ? f : f[i]!
  }
  return { M, L, h, k, a, b, c, d }
}

/**
 * 求解 (d²/dx² + k²) u = f，齐次 Dirichlet，返回含端点的全场（u[0]=u[n−1]=0）。
 * n = M+2 总点数。
 */
export function solveHelmholtzFd(
  M: number,
  L: number,
  k: number,
  f: number | ArrayLike<number> = 1,
): {
  u: Float64Array
  h: number
  L: number
  k: number
  M: number
  system: HelmholtzTridiag
} {
  const system = assembleHelmholtz1d(M, L, k, f)
  const interior = solveTridiag(system.a, system.b, system.c, system.d)
  const u = new Float64Array(M + 2)
  u[0] = 0
  u[M + 1] = 0
  for (let i = 0; i < M; i++) u[i + 1] = interior[i]!
  return { u, h: system.h, L, k, M, system }
}

/**
 * 离散 Helmholtz 算子 (A u)_i = (u_{i−1} − 2 u_i + u_{i+1}) / h² + k² u_i，
 * 边界点输出 0（齐次 Dirichlet 语义）。u 长度 n ≥ 3，h = L/(n−1)。
 */
export function applyHelmholtz1d(
  u: ArrayLike<number>,
  k: number,
  h: number,
  out: Float64Array,
): void {
  const n = u.length
  if (out.length !== n) throw new Error('applyHelmholtz1d: length mismatch')
  if (!(h > 0) || n < 3) throw new Error('applyHelmholtz1d: need n≥3, h>0')
  const invh2 = 1 / (h * h)
  out[0] = 0
  out[n - 1] = 0
  for (let i = 1; i < n - 1; i++) {
    out[i] =
      (u[i - 1]! - 2 * u[i]! + u[i + 1]!) * invh2 + k * k * u[i]!
  }
}

/**
 * 残差 r = f − A u（边界强制 0）。
 * f 可全长 n 或仅内部；全长时边界 f 忽略。
 */
export function residualHelmholtz1d(
  u: ArrayLike<number>,
  f: ArrayLike<number>,
  k: number,
  h: number,
  out?: Float64Array,
): Float64Array {
  const n = u.length
  if (f.length !== n && f.length !== n - 2) {
    throw new Error('residualHelmholtz1d: f length n or n−2')
  }
  const r = out ?? new Float64Array(n)
  applyHelmholtz1d(u, k, h, r)
  r[0] = 0
  r[n - 1] = 0
  if (f.length === n) {
    for (let i = 1; i < n - 1; i++) r[i] = f[i]! - r[i]!
  } else {
    for (let i = 1; i < n - 1; i++) r[i] = f[i - 1]! - r[i]!
  }
  return r
}

/**
 * 区间 [0,L] 齐次 Dirichlet 本征模：u_m(x) = sin(m π x / L)，
 * 连续 k_m = m π / L（−u″ = k_m² u）。
 */
export function helmholtzEigenmode1d(
  n: number,
  L: number,
  mode: number,
): { u: Float64Array; k: number; h: number; mode: number } {
  if (!(n >= 3) || !Number.isInteger(n)) {
    throw new Error('helmholtzEigenmode1d: n integer ≥ 3')
  }
  if (!(L > 0) || !(mode >= 1) || !Number.isInteger(mode)) {
    throw new Error('helmholtzEigenmode1d: L>0, mode integer ≥ 1')
  }
  const h = L / (n - 1)
  const k = (mode * Math.PI) / L
  const u = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const x = i * h
    u[i] = Math.sin((mode * Math.PI * x) / L)
  }
  u[0] = 0
  u[n - 1] = 0
  return { u, k, h, mode }
}

/**
 * 解析特解：取 u = sin(π x / L)，则
 * f = u″ + k² u = (k² − (π/L)²) sin(π x / L)。
 * 要求 k² ≠ (π/L)²（避开齐次共振）。
 */
export function analyticHelmholtzSine1d(
  x: number,
  L: number,
  k: number,
): { u: number; f: number } {
  const kp = Math.PI / L
  const s = Math.sin(kp * x)
  return { u: s, f: (k * k - kp * kp) * s }
}

/**
 * 代表样例：
 * 1) 非齐次 FD 解 vs 正弦特解，检查 max 误差与残差；
 * 2) 齐次本征模上离散 Helmholtz 残差应 O(h²) 小。
 */
export function runHelmholtzFdSample(opts?: {
  M?: number
  L?: number
  k?: number
  mode?: number
}): {
  M: number
  L: number
  k: number
  h: number
  /** 非齐次解 max |u − u_exact| */
  maxSolveErr: number
  /** 非齐次残差 ‖f − A u_num‖₂ */
  residualSolve: number
  /** 本征模残差 ‖A u_mode‖₂ / ‖u_mode‖₂ */
  residualModeRel: number
  mode: number
  kMode: number
  solveAccurate: boolean
  modeResidualSmall: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_HELMHOLTZ_FD
  familyId: typeof METHOD_HELMHOLTZ
} {
  const M = opts?.M ?? 64
  const L = opts?.L ?? 1
  // 避开 k = π/L 共振：取 k = 2
  const k = opts?.k ?? 2
  const mode = opts?.mode ?? 1

  const h = L / (M + 1)
  const fInterior = new Float64Array(M)
  const uExactInterior = new Float64Array(M)
  for (let i = 0; i < M; i++) {
    const x = (i + 1) * h
    const exact = analyticHelmholtzSine1d(x, L, k)
    fInterior[i] = exact.f
    uExactInterior[i] = exact.u
  }

  const { u } = solveHelmholtzFd(M, L, k, fInterior)
  let maxSolveErr = 0
  for (let i = 0; i < M; i++) {
    const e = Math.abs(u[i + 1]! - uExactInterior[i]!)
    if (e > maxSolveErr) maxSolveErr = e
  }

  const fFull = new Float64Array(M + 2)
  for (let i = 0; i < M; i++) fFull[i + 1] = fInterior[i]!
  const rSolve = residualHelmholtz1d(u, fFull, k, h)
  const residualSolve = norm2(rSolve)

  const nMode = M + 2
  const eigen = helmholtzEigenmode1d(nMode, L, mode)
  const Au = new Float64Array(nMode)
  applyHelmholtz1d(eigen.u, eigen.k, eigen.h, Au)
  const residualModeRel = norm2(Au) / Math.max(norm2(eigen.u), 1e-30)

  const solveAccurate = maxSolveErr < 1e-2 && residualSolve < 1e-6
  // 中心差本征残差 ~ O(h² k⁴)；M=64 应远小于 1e-2
  const modeResidualSmall = residualModeRel < 0.05
  const finite =
    Number.isFinite(maxSolveErr) &&
    Number.isFinite(residualSolve) &&
    Number.isFinite(residualModeRel)
  const ok = finite && solveAccurate && modeResidualSmall

  return {
    M,
    L,
    k,
    h,
    maxSolveErr,
    residualSolve,
    residualModeRel,
    mode,
    kMode: eigen.k,
    solveAccurate,
    modeResidualSmall,
    finite,
    ok,
    methodId: METHOD_ALGO_HELMHOLTZ_FD,
    familyId: METHOD_HELMHOLTZ,
  }
}
