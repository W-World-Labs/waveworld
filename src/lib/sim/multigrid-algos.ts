/**
 * 几何多重网格 · 1D Poisson FD（V-cycle）。
 * 全权限制 + 线性延拓；Jacobi / Gauss–Seidel 光滑。
 * method id 仅常量，不改 methods.data / moduleRegistry / edges。
 */

/** 父族 · 多重网格。 */
export const METHOD_MULTIGRID = 'method-multigrid'

/** 子算法 · 全权限制 / 线性延拓（1D 传输算子）。 */
export const METHOD_ALGO_MG_RESTRICT = 'method-algo-mg-restrict'

/** 子算法 · 几何 V-cycle。 */
export const METHOD_ALGO_MG_VCYCLE = 'method-algo-mg-vcycle'

export const MG_METHOD_IDS = [
  METHOD_ALGO_MG_RESTRICT,
  METHOD_ALGO_MG_VCYCLE,
] as const

/** ‖v‖₂（含边界点；Dirichlet 残差边界为 0 时不影响）。 */
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
 * 1D 二阶中心差 Poisson 算子 (A u)_i = (2u_i − u_{i−1} − u_{i+1}) / h²，
 * 边界点输出 0（齐次 Dirichlet 语义）。
 * n = 总点数（含端点），h = 1/(n−1)，域 [0,1]。
 */
export function applyPoisson1d(
  u: ArrayLike<number>,
  out: Float64Array,
  h: number,
): void {
  const n = u.length
  if (out.length !== n) throw new Error('applyPoisson1d: length mismatch')
  if (!(h > 0) || n < 3) throw new Error('applyPoisson1d: need n≥3, h>0')
  const invh2 = 1 / (h * h)
  out[0] = 0
  out[n - 1] = 0
  for (let i = 1; i < n - 1; i++) {
    out[i] = (2 * u[i]! - u[i - 1]! - u[i + 1]!) * invh2
  }
}

/** r = f − A u（边界强制 0）。 */
export function residual1d(
  u: ArrayLike<number>,
  f: ArrayLike<number>,
  h: number,
  out?: Float64Array,
): Float64Array {
  const n = u.length
  if (f.length !== n) throw new Error('residual1d: length mismatch')
  const r = out ?? new Float64Array(n)
  applyPoisson1d(u, r, h)
  r[0] = 0
  r[n - 1] = 0
  for (let i = 1; i < n - 1; i++) r[i] = f[i]! - r[i]!
  return r
}

/**
 * 全权限制（full-weighting）1D：细 → 粗。
 * 细网格 n_f 点（n_f 奇，= 2^k+1）；粗 n_c = (n_f+1)/2。
 * r_c[i] = (r_f[2i−1] + 2 r_f[2i] + r_f[2i+1]) / 4，端点拷贝。
 * 常数场精确保持。
 */
export function restrictFullWeighting1d(fine: ArrayLike<number>): Float64Array {
  const nf = fine.length
  if (nf < 3 || nf % 2 === 0) {
    throw new Error('restrictFullWeighting1d: fine length must be odd ≥ 3')
  }
  const nc = (nf + 1) >> 1
  const coarse = new Float64Array(nc)
  coarse[0] = fine[0]!
  coarse[nc - 1] = fine[nf - 1]!
  for (let i = 1; i < nc - 1; i++) {
    const j = 2 * i
    coarse[i] = (fine[j - 1]! + 2 * fine[j]! + fine[j + 1]!) / 4
  }
  return coarse
}

/**
 * 线性延拓（prolongation）1D：粗 → 细。
 * 偶点注入，奇点平均；端点对齐。
 * 常数场精确保持。
 */
export function prolongLinear1d(coarse: ArrayLike<number>): Float64Array {
  const nc = coarse.length
  if (nc < 2) throw new Error('prolongLinear1d: coarse length ≥ 2')
  const nf = 2 * (nc - 1) + 1
  const fine = new Float64Array(nf)
  for (let i = 0; i < nc; i++) fine[2 * i] = coarse[i]!
  for (let i = 0; i < nc - 1; i++) {
    fine[2 * i + 1] = 0.5 * (coarse[i]! + coarse[i + 1]!)
  }
  return fine
}

/**
 * 加权 Jacobi 光滑：解 A u = f，
 * u ← (1−ω) u + ω · ½ (u_{i−1}+u_{i+1}+h² f_i)，端点不动。
 * 默认 ω=2/3（多重网格经典）。
 */
export function jacobiSmooth1d(
  u: Float64Array,
  f: ArrayLike<number>,
  h: number,
  iters: number,
  omega = 2 / 3,
): void {
  const n = u.length
  if (f.length !== n) throw new Error('jacobiSmooth1d: length mismatch')
  const h2 = h * h
  const tmp = new Float64Array(n)
  for (let k = 0; k < iters; k++) {
    tmp[0] = u[0]!
    tmp[n - 1] = u[n - 1]!
    for (let i = 1; i < n - 1; i++) {
      const gs = 0.5 * (u[i - 1]! + u[i + 1]! + h2 * f[i]!)
      tmp[i] = (1 - omega) * u[i]! + omega * gs
    }
    u.set(tmp)
  }
}

/**
 * Gauss–Seidel 光滑（红黑/逐点左→右）：
 * u_i ← ½ (u_{i−1}+u_{i+1}+h² f_i)，端点不动。
 */
export function gaussSeidelSmooth1d(
  u: Float64Array,
  f: ArrayLike<number>,
  h: number,
  iters: number,
): void {
  const n = u.length
  if (f.length !== n) throw new Error('gaussSeidelSmooth1d: length mismatch')
  const h2 = h * h
  for (let k = 0; k < iters; k++) {
    for (let i = 1; i < n - 1; i++) {
      u[i] = 0.5 * (u[i - 1]! + u[i + 1]! + h2 * f[i]!)
    }
  }
}

/** 最粗层：1 个内点精确解，或若干 GS。 */
export function coarseSolve1d(
  u: Float64Array,
  f: ArrayLike<number>,
  h: number,
): void {
  const n = u.length
  if (n === 3) {
    // 单内点：(2/h²) u1 = f1
    u[0] = 0
    u[2] = 0
    u[1] = (f[1]! * h * h) / 2
    return
  }
  // 稍粗：多步 GS 当精确解近似
  u.fill(0)
  u[0] = 0
  u[n - 1] = 0
  gaussSeidelSmooth1d(u, f, h, Math.max(50, 4 * n))
}

/**
 * 单层 V-cycle（递归）：
 * 前光滑 → 限制残差 → 粗校正 → 延拓累加 → 后光滑。
 * nu1/nu2 为 GS 前/后光滑次数；最粗 n≤3 精确解。
 */
export function vcycle1d(
  u: Float64Array,
  f: ArrayLike<number>,
  h: number,
  opts?: { nu1?: number; nu2?: number; minN?: number },
): void {
  const n = u.length
  if (f.length !== n) throw new Error('vcycle1d: length mismatch')
  const nu1 = opts?.nu1 ?? 2
  const nu2 = opts?.nu2 ?? 2
  const minN = opts?.minN ?? 3

  if (n <= minN) {
    coarseSolve1d(u, f, h)
    return
  }

  gaussSeidelSmooth1d(u, f, h, nu1)

  const r = residual1d(u, f, h)
  const rc = restrictFullWeighting1d(r)
  const nc = rc.length
  const hc = 2 * h
  const ec = new Float64Array(nc)
  // 粗方程 A_H e = R r；边界 0
  rc[0] = 0
  rc[nc - 1] = 0
  vcycle1d(ec, rc, hc, opts)

  const ef = prolongLinear1d(ec)
  for (let i = 0; i < n; i++) u[i]! += ef[i]!
  u[0] = 0
  u[n - 1] = 0

  gaussSeidelSmooth1d(u, f, h, nu2)
}

/**
 * 限制/延拓样例：常数场精确保持；高频在限制后衰减。
 */
export function runMgRestrictSample(opts?: {
  /** 细网格总点数（奇数，默认 17 = 2^4+1）。 */
  nFine?: number
  c?: number
}): {
  nFine: number
  nCoarse: number
  /** 常数限制 max|R c − c| */
  constRestrictErr: number
  /** 常数延拓 max|P c − c| */
  constProlongErr: number
  /** 限制后再延拓：低频近似保持（线性） */
  linearRoundtripMaxErr: number
  /** 棋盘/锯齿高频限制后范数比 */
  highFreqAtten: number
  constantsExact: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MG_RESTRICT
  familyId: typeof METHOD_MULTIGRID
} {
  const nFine = opts?.nFine ?? 17
  const c = opts?.c ?? 3.5
  if (nFine < 5 || nFine % 2 === 0) {
    throw new Error('runMgRestrictSample: nFine odd ≥ 5')
  }

  const fineConst = new Float64Array(nFine)
  fineConst.fill(c)
  const coarseConst = restrictFullWeighting1d(fineConst)
  let constRestrictErr = 0
  for (let i = 0; i < coarseConst.length; i++) {
    const e = Math.abs(coarseConst[i]! - c)
    if (e > constRestrictErr) constRestrictErr = e
  }

  const coarseC = new Float64Array(coarseConst.length)
  coarseC.fill(c)
  const fineFromC = prolongLinear1d(coarseC)
  let constProlongErr = 0
  for (let i = 0; i < fineFromC.length; i++) {
    const e = Math.abs(fineFromC[i]! - c)
    if (e > constProlongErr) constProlongErr = e
  }

  // 线性场 u(x)=x 在延拓/限制下应精确（线性再生）
  const h = 1 / (nFine - 1)
  const fineLin = new Float64Array(nFine)
  for (let i = 0; i < nFine; i++) fineLin[i] = i * h
  const coarseLin = restrictFullWeighting1d(fineLin)
  const reconLin = prolongLinear1d(coarseLin)
  let linearRoundtripMaxErr = 0
  for (let i = 0; i < nFine; i++) {
    const e = Math.abs(reconLin[i]! - fineLin[i]!)
    if (e > linearRoundtripMaxErr) linearRoundtripMaxErr = e
  }

  // 高频锯齿（内点 ±1），限制后能量应显著衰减
  const fineHf = new Float64Array(nFine)
  for (let i = 1; i < nFine - 1; i++) fineHf[i] = i % 2 === 0 ? 1 : -1
  const coarseHf = restrictFullWeighting1d(fineHf)
  const nF = norm2(fineHf)
  const nC = norm2(coarseHf)
  const highFreqAtten = nF > 0 ? nC / nF : 0

  const constantsExact =
    constRestrictErr < 1e-14 && constProlongErr < 1e-14
  const ok =
    constantsExact &&
    linearRoundtripMaxErr < 1e-12 &&
    highFreqAtten < 0.5

  return {
    nFine,
    nCoarse: coarseConst.length,
    constRestrictErr,
    constProlongErr,
    linearRoundtripMaxErr,
    highFreqAtten,
    constantsExact,
    ok,
    methodId: METHOD_ALGO_MG_RESTRICT,
    familyId: METHOD_MULTIGRID,
  }
}

/**
 * V-cycle 样例：−u″=sin(πx)，u(0)=u(1)=0；
 * 一次 V-cycle 残差下降，且优于同等光滑次数的纯细网格 GS。
 */
export function runMgVcycleSample(opts?: {
  /** 细网格总点数（2^L+1，默认 33）。 */
  n?: number
  nu1?: number
  nu2?: number
}): {
  n: number
  h: number
  residual0: number
  residualAfterV: number
  residualAfterSmoothOnly: number
  residualRatioV: number
  residualDecreased: boolean
  /** V-cycle 残差 < 纯光滑残差 */
  betterThanSmoothOnly: boolean
  midU: number
  analyticMid: number
  errMid: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MG_VCYCLE
  familyId: typeof METHOD_MULTIGRID
} {
  const n = opts?.n ?? 33
  const nu1 = opts?.nu1 ?? 2
  const nu2 = opts?.nu2 ?? 2
  if (n < 5 || n % 2 === 0) throw new Error('runMgVcycleSample: n odd ≥ 5')

  const h = 1 / (n - 1)
  const f = new Float64Array(n)
  // −u″ = sin(πx) ⇒ u = sin(πx)/π²
  for (let i = 0; i < n; i++) {
    const x = i * h
    f[i] = Math.sin(Math.PI * x)
  }
  f[0] = 0
  f[n - 1] = 0

  // 初值：零
  const uV = new Float64Array(n)
  const res0 = residual1d(uV, f, h)
  const residual0 = norm2(res0)

  vcycle1d(uV, f, h, { nu1, nu2, minN: 3 })
  const resV = residual1d(uV, f, h)
  const residualAfterV = norm2(resV)

  // 同等前+后光滑次数的纯细网格 GS
  const uS = new Float64Array(n)
  gaussSeidelSmooth1d(uS, f, h, nu1 + nu2)
  const resS = residual1d(uS, f, h)
  const residualAfterSmoothOnly = norm2(resS)

  const residualRatioV = residual0 > 0 ? residualAfterV / residual0 : 0
  const residualDecreased = residualAfterV < residual0 * 0.5
  const betterThanSmoothOnly = residualAfterV < residualAfterSmoothOnly * 0.99

  const mid = (n - 1) >> 1
  const midU = uV[mid]!
  const analyticMid = Math.sin(Math.PI * 0.5) / (Math.PI * Math.PI)
  const errMid = Math.abs(midU - analyticMid)

  let finite = true
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(uV[i]!)) finite = false
  }

  const ok =
    residualDecreased &&
    betterThanSmoothOnly &&
    finite &&
    residualAfterV < residual0

  return {
    n,
    h,
    residual0,
    residualAfterV,
    residualAfterSmoothOnly,
    residualRatioV,
    residualDecreased,
    betterThanSmoothOnly,
    midU,
    analyticMid,
    errMid,
    finite,
    ok,
    methodId: METHOD_ALGO_MG_VCYCLE,
    familyId: METHOD_MULTIGRID,
  }
}
