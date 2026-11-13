/**
 * 有限元二级算法 · 1D 线性元 Poisson −u″=f，Dirichlet 齐次，三对角刚度组装/求解。
 * method id 仅常量，不改 methods.data。
 */

/** 父族（与 methods.data 中 method-fem 对齐）。 */
export const FEM_L2_PARENT = 'method-fem'

/** 一级 · 1D Poisson FEM 完整求解。 */
export const FEM_L2_POISSON_1D_ID = 'method-algo-fem-poisson-1d'

/**
 * 二级 · 刚度/载荷组装原子（仅常量，不写 methods.data）。
 */
export const FEM_L2_ASSEMBLE_ID = 'method-algo-fem-assemble'

/** 二级 · 一致质量矩阵组装（1D 线性元）。 */
export const FEM_L2_MASS_MATRIX_ID = 'method-algo-fem-mass-matrix'

export const FEM_L2_METHOD_IDS = [
  FEM_L2_POISSON_1D_ID,
  FEM_L2_ASSEMBLE_ID,
  FEM_L2_MASS_MATRIX_ID,
] as const

/**
 * Thomas 算法解三对角 Ax=d：
 * a[i] 下对角（a[0] 未用）、b 主对角、c 上对角（c[n-1] 未用）、d 右端。
 * 返回新数组，不修改入参。
 */
export function solveTridiag(
  a: Float64Array | number[],
  b: Float64Array | number[],
  c: Float64Array | number[],
  d: Float64Array | number[],
): Float64Array {
  const n = b.length
  if (a.length !== n || c.length !== n || d.length !== n) {
    throw new Error('tridiag vectors must share length')
  }
  if (n === 0) return new Float64Array(0)
  const cp = new Float64Array(n)
  const dp = new Float64Array(n)
  const x = new Float64Array(n)
  let denom = b[0]!
  if (denom === 0) throw new Error('zero pivot')
  cp[0] = c[0]! / denom
  dp[0] = d[0]! / denom
  for (let i = 1; i < n; i++) {
    denom = b[i]! - a[i]! * cp[i - 1]!
    if (denom === 0) throw new Error('zero pivot')
    cp[i] = i < n - 1 ? c[i]! / denom : 0
    dp[i] = (d[i]! - a[i]! * dp[i - 1]!) / denom
  }
  x[n - 1] = dp[n - 1]!
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i]! - cp[i]! * x[i + 1]!
  return x
}

export type FemTridiagSystem = {
  /** 内部自由度数 M（Dirichlet 边界已消去）。 */
  M: number
  /** 单元尺寸 h = 1/(M+1)，域 [0,1]。 */
  h: number
  /** 下对角 a[0] 未用。 */
  a: Float64Array
  /** 主对角。 */
  b: Float64Array
  /** 上对角 c[M-1] 未用。 */
  c: Float64Array
  /** 载荷向量。 */
  d: Float64Array
}

/**
 * 1D 线性元组装 K u = F：
 * 区间 [0,1]，均匀节点 x_i = i h，h=1/(M+1)，i=0..M+1。
 * u(0)=u(1)=0 已消去；内部节点 i=1..M。
 * 单元刚度 (1/h)[1 −1; −1 1]；载荷 f 常数时节点力 = f·h。
 * 默认 f≡1 → 解析 u(x)=x(1−x)/2。
 */
export function assemblePoisson1d(M: number, f = 1): FemTridiagSystem {
  if (!(M >= 1)) throw new Error('M must be >= 1')
  const h = 1 / (M + 1)
  const a = new Float64Array(M)
  const b = new Float64Array(M)
  const c = new Float64Array(M)
  const d = new Float64Array(M)
  const kDiag = 2 / h
  const kOff = -1 / h
  const load = f * h
  for (let i = 0; i < M; i++) {
    b[i] = kDiag
    d[i] = load
    if (i > 0) a[i] = kOff
    if (i < M - 1) c[i] = kOff
  }
  return { M, h, a, b, c, d }
}

/**
 * 组装 + Thomas 求解，返回内部节点解 u[0..M-1] 对应 x=(i+1)h。
 */
export function solvePoisson1d(M: number, f = 1): {
  u: Float64Array
  h: number
  system: FemTridiagSystem
} {
  const system = assemblePoisson1d(M, f)
  const u = solveTridiag(system.a, system.b, system.c, system.d)
  return { u, h: system.h, system }
}

/** 解析解 u(x)=f·x(1−x)/2（−u″=f 常数，齐次 Dirichlet）。 */
export function analyticPoisson1d(x: number, f = 1): number {
  return (f * x * (1 - x)) / 2
}

/**
 * 刚度组装样例：检查三对角结构、正定性特征，并与解析中点对照。
 * methodId → method-algo-fem-assemble。
 */
export function runFemAssembleSample(M = 16, f = 1): {
  M: number
  h: number
  /** 主对角应全为 2/h */
  diagOk: boolean
  /** 非零下对角应全为 −1/h */
  offDiagOk: boolean
  /** 载荷应全为 f·h */
  loadOk: boolean
  midU: number
  analyticMid: number
  errMid: number
  maxU: number
  methodId: typeof FEM_L2_ASSEMBLE_ID
} {
  const sys = assemblePoisson1d(M, f)
  const { h, a, b, c, d } = sys
  const kDiag = 2 / h
  const kOff = -1 / h
  const load = f * h
  let diagOk = true
  let offDiagOk = true
  let loadOk = true
  for (let i = 0; i < M; i++) {
    if (Math.abs(b[i]! - kDiag) > 1e-12) diagOk = false
    if (Math.abs(d[i]! - load) > 1e-12) loadOk = false
    if (i > 0 && Math.abs(a[i]! - kOff) > 1e-12) offDiagOk = false
    if (i < M - 1 && Math.abs(c[i]! - kOff) > 1e-12) offDiagOk = false
  }

  const u = solveTridiag(a, b, c, d)
  const midIdx = Math.floor(M / 2)
  const midU = u[midIdx]!
  const xMid = (midIdx + 1) * h
  const analyticMid = analyticPoisson1d(xMid, f)
  let maxU = 0
  for (let i = 0; i < M; i++) if (u[i]! > maxU) maxU = u[i]!

  return {
    M,
    h,
    diagOk,
    offDiagOk,
    loadOk,
    midU,
    analyticMid,
    errMid: Math.abs(midU - analyticMid),
    maxU,
    methodId: FEM_L2_ASSEMBLE_ID,
  }
}

/**
 * 完整 1D Poisson 样例（与 research-algos 同题）：中点 vs x(1−x)/2。
 * methodId → method-algo-fem-poisson-1d。
 */
export function runFemPoisson1dSample(M = 16, f = 1): {
  midU: number
  analyticMid: number
  errMid: number
  maxU: number
  methodId: typeof FEM_L2_POISSON_1D_ID
} {
  const { u, h } = solvePoisson1d(M, f)
  const midIdx = Math.floor(M / 2)
  const midU = u[midIdx]!
  const xMid = (midIdx + 1) * h
  const analyticMid = analyticPoisson1d(xMid, f)
  let maxU = 0
  for (let i = 0; i < M; i++) if (u[i]! > maxU) maxU = u[i]!
  return {
    midU,
    analyticMid,
    errMid: Math.abs(midU - analyticMid),
    maxU,
    methodId: FEM_L2_POISSON_1D_ID,
  }
}

export type FemMassTridiag = {
  /** 内部自由度数 M（Dirichlet 边界已消去）。 */
  M: number
  h: number
  /** 下对角 a[0] 未用。 */
  a: Float64Array
  /** 主对角。 */
  b: Float64Array
  /** 上对角 c[M-1] 未用。 */
  c: Float64Array
}

/**
 * 1D 线性元一致质量矩阵组装（齐次 Dirichlet 消去边界）：
 * 单元质量 (h/6)[2 1; 1 2] → 内部三对角：主对角 2h/3，副对角 h/6。
 * 域 [0,1]，h=1/(M+1)。
 */
export function assembleMass1d(M: number): FemMassTridiag {
  if (!(M >= 1)) throw new Error('M must be >= 1')
  const h = 1 / (M + 1)
  const a = new Float64Array(M)
  const b = new Float64Array(M)
  const c = new Float64Array(M)
  const mDiag = (2 * h) / 3
  const mOff = h / 6
  for (let i = 0; i < M; i++) {
    b[i] = mDiag
    if (i > 0) a[i] = mOff
    if (i < M - 1) c[i] = mOff
  }
  return { M, h, a, b, c }
}

/**
 * 质量矩阵样例：三对角结构校验；对全 1 向量 (1…1) 的二次型 vᵀMv
 * 逼近 ∫_0^1 (线性帽函数组合)²，且 M 严格对角占优 / SPD 特征。
 */
export function runFemMassMatrixSample(M = 16): {
  M: number
  h: number
  diagOk: boolean
  offDiagOk: boolean
  /** 全 1 试向量二次型 vᵀ M v */
  onesQuadratic: number
  /** 对角占优：b_i ≥ |a_i|+|c_i| */
  diagonallyDominant: boolean
  /** 对随机向量二次型 > 0（SPD 抽检） */
  spdSample: boolean
  methodId: typeof FEM_L2_MASS_MATRIX_ID
} {
  const sys = assembleMass1d(M)
  const { h, a, b, c } = sys
  const mDiag = (2 * h) / 3
  const mOff = h / 6
  let diagOk = true
  let offDiagOk = true
  let diagonallyDominant = true
  for (let i = 0; i < M; i++) {
    if (Math.abs(b[i]! - mDiag) > 1e-12) diagOk = false
    if (i > 0 && Math.abs(a[i]! - mOff) > 1e-12) offDiagOk = false
    if (i < M - 1 && Math.abs(c[i]! - mOff) > 1e-12) offDiagOk = false
    const off =
      (i > 0 ? Math.abs(a[i]!) : 0) + (i < M - 1 ? Math.abs(c[i]!) : 0)
    if (b[i]! + 1e-15 < off) diagonallyDominant = false
  }

  // v = 全 1：vᵀMv = Σ_i b_i + 2 Σ_i a_{i+1}（对称）
  let onesQuadratic = 0
  for (let i = 0; i < M; i++) onesQuadratic += b[i]!
  for (let i = 1; i < M; i++) onesQuadratic += 2 * a[i]!

  // SPD 抽检：随机向量
  const v = new Float64Array(M)
  for (let i = 0; i < M; i++) v[i] = Math.sin((i + 1) * 1.7)
  let MvDot = 0
  for (let i = 0; i < M; i++) {
    let Mv = b[i]! * v[i]!
    if (i > 0) Mv += a[i]! * v[i - 1]!
    if (i < M - 1) Mv += c[i]! * v[i + 1]!
    MvDot += v[i]! * Mv
  }

  return {
    M,
    h,
    diagOk,
    offDiagOk,
    onesQuadratic,
    diagonallyDominant,
    spdSample: MvDot > 0,
    methodId: FEM_L2_MASS_MATRIX_ID,
  }
}
