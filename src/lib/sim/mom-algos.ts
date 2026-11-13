/**
 * Method of Moments (MoM) · 1D thin-wire / pulse-basis teaching stubs.
 * Free-space simplified impedance Z_mn; solve Z I = V; input-impedance toy.
 * method id 仅常量；不改 methods.data / moduleRegistry / edges.
 */

/** 父族 · Method of Moments. */
export const METHOD_MOM = 'method-mom'

/** 子算法 · 脉冲基阻抗矩阵 Z_mn. */
export const METHOD_ALGO_MOM_IMPEDANCE = 'method-algo-mom-impedance'

/** 子算法 · 恒压激励下 Z I = V 求解与输入阻抗玩具. */
export const METHOD_ALGO_MOM_SOLVE = 'method-algo-mom-solve'

export const MOM_METHOD_IDS = [
  METHOD_ALGO_MOM_IMPEDANCE,
  METHOD_ALGO_MOM_SOLVE,
] as const

/** 教学默认最大分段数（稠密 Z 高斯消元）. */
export const MOM_MAX_N = 8

/** 默认导线总长（任意单位）. */
export const MOM_DEFAULT_LENGTH = 1

/**
 * 默认自项系数：Z_mm = 2 selfScale / h.
 * selfScale≥2 时 n≤8 均匀分段对角占优（教学 GE 更稳）.
 */
export const MOM_DEFAULT_SELF_SCALE = 2

/**
 * 均匀分段中心：长度 L 的导线置于 [0, L]，n 段，中心 x_m = (m+0.5) h，h=L/n.
 * 1 ≤ n ≤ MOM_MAX_N.
 */
export function momSegmentCenters(
  n: number,
  length: number = MOM_DEFAULT_LENGTH,
): Float64Array {
  if (n < 1 || n > MOM_MAX_N || !Number.isFinite(n)) {
    throw new Error(`momSegmentCenters: need 1 ≤ n ≤ ${MOM_MAX_N}`)
  }
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new Error('momSegmentCenters: length must be positive finite')
  }
  const h = length / n
  const x = new Float64Array(n)
  for (let m = 0; m < n; m++) x[m] = (m + 0.5) * h
  return x
}

/**
 * 简化 2D 静电 / 细导线脉冲 MoM 核：
 *   m=n → selfTerm
 *   m≠n → 1 / |x_m − x_n|
 * dx = |x_m − x_n|（对角传 0）.
 */
export function momImpedanceKernel(dx: number, selfTerm: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(selfTerm)) return NaN
  if (dx === 0 || !(dx > 0)) return selfTerm
  return 1 / dx
}

/**
 * 默认自阻抗：2 * selfScale / h（半段宽倒数，保证对角占优玩具）.
 */
export function momSelfTerm(
  segmentLength: number,
  selfScale: number = MOM_DEFAULT_SELF_SCALE,
): number {
  if (!(segmentLength > 0) || !Number.isFinite(segmentLength)) {
    throw new Error('momSelfTerm: segmentLength must be positive finite')
  }
  if (!(selfScale > 0) || !Number.isFinite(selfScale)) {
    throw new Error('momSelfTerm: selfScale must be positive finite')
  }
  return (2 * selfScale) / segmentLength
}

/**
 * 脉冲基阻抗矩阵 Z_mn（行主序 n×n Float64Array）.
 * Z_mm = selfTerm（默认 2·selfScale/h）；Z_mn = 1/|x_m−x_n|（m≠n）.
 * centers 等长 1 ≤ n ≤ MOM_MAX_N；若未给 selfTerm 则用相邻中心距推 h.
 */
export function momImpedanceMatrix(
  centers: ArrayLike<number>,
  selfTerm?: number,
): Float64Array {
  const n = centers.length
  if (n < 1 || n > MOM_MAX_N) {
    throw new Error(`momImpedanceMatrix: need 1 ≤ n ≤ ${MOM_MAX_N}`)
  }
  let zSelf = selfTerm
  if (zSelf === undefined) {
    if (n === 1) {
      zSelf = momSelfTerm(MOM_DEFAULT_LENGTH)
    } else {
      const h = Math.abs(centers[1]! - centers[0]!)
      if (!(h > 0)) throw new Error('momImpedanceMatrix: degenerate centers')
      zSelf = momSelfTerm(h)
    }
  }
  if (!Number.isFinite(zSelf!)) {
    throw new Error('momImpedanceMatrix: selfTerm must be finite')
  }

  const Z = new Float64Array(n * n)
  for (let m = 0; m < n; m++) {
    const xm = centers[m]!
    if (!Number.isFinite(xm)) {
      throw new Error('momImpedanceMatrix: non-finite center')
    }
    for (let nn = 0; nn < n; nn++) {
      if (m === nn) {
        Z[m * n + nn] = zSelf!
      } else {
        const dx = Math.abs(xm - centers[nn]!)
        Z[m * n + nn] = momImpedanceKernel(dx, zSelf!)
      }
    }
  }
  return Z
}

/**
 * 带部分主元的高斯消元解 A x = b（A 行主序 n×n，拷贝后消元）.
 * 教学用：n 小；奇异时抛错.
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
 * 恒压激励向量 V_m = V0（玩具：均匀电位 / 宽缝近似）.
 */
export function momConstantVoltage(n: number, V0: number = 1): Float64Array {
  if (n < 1 || n > MOM_MAX_N) {
    throw new Error(`momConstantVoltage: need 1 ≤ n ≤ ${MOM_MAX_N}`)
  }
  if (!Number.isFinite(V0)) throw new Error('momConstantVoltage: V0 must be finite')
  const V = new Float64Array(n)
  for (let i = 0; i < n; i++) V[i] = V0
  return V
}

/**
 * 解 Z I = V，返回电流系数 I（脉冲基幅值）.
 */
export function momSolveCurrent(
  Z: ArrayLike<number>,
  V: ArrayLike<number>,
  n: number,
): Float64Array {
  if (n < 1 || n > MOM_MAX_N) {
    throw new Error(`momSolveCurrent: need 1 ≤ n ≤ ${MOM_MAX_N}`)
  }
  if (Z.length < n * n || V.length < n) {
    throw new Error('momSolveCurrent: size mismatch')
  }
  return solveDenseGauss(Z, V, n)
}

/** 电流系数之和 Σ I_m（总“电荷/电流”玩具量）. */
export function momCurrentSum(I: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < I.length; i++) {
    const v = I[i]!
    if (!Number.isFinite(v)) return NaN
    s += v
  }
  return s
}

/**
 * 玩具输入阻抗：Z_in = V0 / I_in.
 * I_in 通常取馈电段电流；|I_in| 过小 → Infinity.
 */
export function momInputImpedance(V0: number, Iin: number): number {
  if (!Number.isFinite(V0) || !Number.isFinite(Iin)) return NaN
  if (Math.abs(Iin) < 1e-15) return Iin === 0 ? Infinity : Math.sign(Iin) * Infinity
  return V0 / Iin
}

/**
 * 残差 ‖Z I − V‖_∞（验证求解）.
 */
export function momResidualInf(
  Z: ArrayLike<number>,
  I: ArrayLike<number>,
  V: ArrayLike<number>,
  n: number,
): number {
  let max = 0
  for (let m = 0; m < n; m++) {
    let s = 0
    const row = m * n
    for (let j = 0; j < n; j++) s += Z[row + j]! * I[j]!
    const e = Math.abs(s - V[m]!)
    if (e > max) max = e
  }
  return max
}

/**
 * 阻抗矩阵样例：对称、对角自项、非对角 1/|Δx|；对角占优检查.
 */
export function runMomImpedanceSample(opts?: {
  n?: number
  length?: number
  selfScale?: number
}): {
  n: number
  length: number
  h: number
  selfTerm: number
  centers: number[]
  /** max |Z_mn − Z_nm| */
  symmetryErr: number
  /** min_m Z_mm */
  minDiag: number
  /** max off-diag |Z_mn| */
  maxOff: number
  diagonallyDominant: boolean
  /** 核对照：最近邻应 = 1/h */
  nearestOff: number
  ok: boolean
  methodId: typeof METHOD_ALGO_MOM_IMPEDANCE
  familyId: typeof METHOD_MOM
} {
  const n = Math.min(MOM_MAX_N, Math.max(1, opts?.n ?? 4))
  const length = opts?.length ?? MOM_DEFAULT_LENGTH
  const selfScale = opts?.selfScale ?? MOM_DEFAULT_SELF_SCALE
  const h = length / n
  const selfTerm = momSelfTerm(h, selfScale)
  const centers = momSegmentCenters(n, length)
  const Z = momImpedanceMatrix(centers, selfTerm)

  let symmetryErr = 0
  let minDiag = Infinity
  let maxOff = 0
  let diagDom = true
  for (let m = 0; m < n; m++) {
    const d = Z[m * n + m]!
    if (d < minDiag) minDiag = d
    let rowOff = 0
    for (let nn = 0; nn < n; nn++) {
      if (m === nn) continue
      const z = Z[m * n + nn]!
      const a = Math.abs(z)
      if (a > maxOff) maxOff = a
      rowOff += a
      const sym = Math.abs(z - Z[nn * n + m]!)
      if (sym > symmetryErr) symmetryErr = sym
    }
    if (!(d >= rowOff - 1e-12)) diagDom = false
  }

  const nearestOff = n >= 2 ? Z[0 * n + 1]! : 0
  const nearestOk =
    n < 2 || Math.abs(nearestOff - 1 / h) < 1e-12

  const ok =
    symmetryErr < 1e-14 &&
    Number.isFinite(minDiag) &&
    minDiag > 0 &&
    nearestOk &&
    (n === 1 || maxOff > 0) &&
    (n === 1 || diagDom)

  return {
    n,
    length,
    h,
    selfTerm,
    centers: Array.from(centers),
    symmetryErr,
    minDiag,
    maxOff,
    diagonallyDominant: diagDom,
    nearestOff,
    ok,
    methodId: METHOD_ALGO_MOM_IMPEDANCE,
    familyId: METHOD_MOM,
  }
}

/**
 * 求解样例：恒压 V0，解 Z I = V；检查残差、电流和、玩具 Z_in.
 * I_in 取中段（馈电）电流.
 */
export function runMomSolveSample(opts?: {
  n?: number
  length?: number
  V0?: number
  selfScale?: number
}): {
  n: number
  length: number
  V0: number
  centers: number[]
  current: number[]
  currentSum: number
  /** 馈电段（中段）电流 */
  Iin: number
  Zin: number
  residualInf: number
  ok: boolean
  methodId: typeof METHOD_ALGO_MOM_SOLVE
  familyId: typeof METHOD_MOM
} {
  const n = Math.min(MOM_MAX_N, Math.max(1, opts?.n ?? 5))
  const length = opts?.length ?? MOM_DEFAULT_LENGTH
  const V0 = opts?.V0 ?? 1
  const selfScale = opts?.selfScale ?? MOM_DEFAULT_SELF_SCALE
  const h = length / n
  const selfTerm = momSelfTerm(h, selfScale)
  const centers = momSegmentCenters(n, length)
  const Z = momImpedanceMatrix(centers, selfTerm)
  const V = momConstantVoltage(n, V0)
  const I = momSolveCurrent(Z, V, n)
  const currentSum = momCurrentSum(I)
  const feed = Math.floor(n / 2)
  const Iin = I[feed]!
  const Zin = momInputImpedance(V0, Iin)
  const residualInf = momResidualInf(Z, I, V, n)

  const ok =
    residualInf < 1e-10 &&
    Number.isFinite(currentSum) &&
    Number.isFinite(Iin) &&
    Number.isFinite(Zin) &&
    Math.abs(Iin) > 1e-15

  return {
    n,
    length,
    V0,
    centers: Array.from(centers),
    current: Array.from(I),
    currentSum,
    Iin,
    Zin,
    residualInf,
    ok,
    methodId: METHOD_ALGO_MOM_SOLVE,
    familyId: METHOD_MOM,
  }
}
