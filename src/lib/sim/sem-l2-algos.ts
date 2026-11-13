/**
 * 谱元 / 线性元 SEM 二级 · 1D 质量矩阵对角集中（lumping）误差。
 * 对比一致质量 vs 行和集中对角质量；线性基下 lumping 引入可度量的二次型误差。
 * method id 仅常量，不改 methods.data。
 */
import { SEM_PARENT } from './sem-algos'

export { SEM_PARENT }

/** 父族 · SEM。 */
export const SEM_L2_PARENT = SEM_PARENT

/** 二级 · 对角集中质量。 */
export const METHOD_ALGO_SEM_LUMPED_MASS = 'method-algo-sem-lumped-mass'

export const SEM_L2_METHOD_IDS = [METHOD_ALGO_SEM_LUMPED_MASS] as const

export type Mass1d = {
  /** 节点数 n = nElem + 1，域 [0,1]。 */
  n: number
  h: number
  /**
   * 稠密 n×n 行主序质量矩阵（含边界节点）。
   * 一致：单元 (h/6)[2 1; 1 2]；集中：单元 (h/2) I。
   */
  M: Float64Array
}

/** 均匀 1D 网格节点 x_i = i h，i=0..nElem，h=1/nElem。 */
export function linNodes1d(nElem: number): { x: Float64Array; h: number; n: number } {
  if (!(nElem >= 1)) throw new Error('nElem must be >= 1')
  const n = nElem + 1
  const h = 1 / nElem
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = i * h
  return { x, h, n }
}

/**
 * 组装 1D 线性元一致质量矩阵（全域节点，含边界）。
 * 单元局部 M_e = (h/6) [[2,1],[1,2]]。
 */
export function assembleConsistentMass1d(nElem: number): Mass1d {
  const { h, n } = linNodes1d(nElem)
  const M = new Float64Array(n * n)
  const m00 = (2 * h) / 6
  const m01 = h / 6
  for (let e = 0; e < nElem; e++) {
    const i = e
    const j = e + 1
    M[i * n + i]! += m00
    M[i * n + j]! += m01
    M[j * n + i]! += m01
    M[j * n + j]! += m00
  }
  return { n, h, M }
}

/**
 * 行和集中（diagonal lumping）：M_lump_ii = Σ_j M_ij，非对角 0。
 * 对线性元等价于单元 (h/2) I 组装。
 */
export function assembleLumpedMass1d(nElem: number): Mass1d {
  const cons = assembleConsistentMass1d(nElem)
  const { n, h, M: Mc } = cons
  const M = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    let row = 0
    for (let j = 0; j < n; j++) row += Mc[i * n + j]!
    M[i * n + i] = row
  }
  return { n, h, M }
}

/** 直接单元对角集中：边界 h/2，内部 h（与行和一致）。 */
export function assembleLumpedMass1dDirect(nElem: number): Mass1d {
  const { h, n } = linNodes1d(nElem)
  const M = new Float64Array(n * n)
  for (let e = 0; e < nElem; e++) {
    M[e * n + e]! += h / 2
    M[(e + 1) * n + (e + 1)]! += h / 2
  }
  return { n, h, M }
}

/** y = M v（稠密）。 */
export function matVecDense(M: Float64Array, v: ArrayLike<number>, n: number): Float64Array {
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = 0; j < n; j++) s += M[i * n + j]! * v[j]!
    y[i] = s
  }
  return y
}

/** vᵀ M v。 */
export function quadraticForm(M: Float64Array, v: ArrayLike<number>, n: number): number {
  const Mv = matVecDense(M, v, n)
  let s = 0
  for (let i = 0; i < n; i++) s += v[i]! * Mv[i]!
  return s
}

/** Frobenius ‖A‖_F。 */
export function frobenius(A: Float64Array): number {
  let s = 0
  for (let i = 0; i < A.length; i++) s += A[i]! * A[i]!
  return Math.sqrt(s)
}

/** ‖A−B‖_F。 */
export function frobeniusDiff(A: Float64Array, B: Float64Array): number {
  let s = 0
  for (let i = 0; i < A.length; i++) {
    const d = A[i]! - B[i]!
    s += d * d
  }
  return Math.sqrt(s)
}

/**
 * 梯形/节点采样向量：v_i = f(x_i)。
 */
export function sampleOnNodes(f: (x: number) => number, x: Float64Array): Float64Array {
  const v = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) v[i] = f(x[i]!)
  return v
}

/**
 * 样例：线性基 1D 一致 vs 对角集中质量。
 * - 行和 lumping ≡ 单元 (h/2)I
 * - 对 FE 函数 uh（节点向量 v）：vᵀ M_c v = ‖uh‖_{L²}² 精确；
 *   lumping 误差 |vᵀ M_l v − vᵀ M_c v| > 0（非仿射模态）
 * - ‖M_c − M_l‖_F / ‖M_c‖_F > 0
 * - 常数场：两种质量二次型均 = 1
 */
export function runSemLumpedMassSample(nElem = 16): {
  nElem: number
  n: number
  h: number
  /** 行和集中与直接对角组装一致 */
  lumpMatch: boolean
  /** Frobenius 相对差 ‖Mc−Ml‖/‖Mc‖ */
  relFrobDiff: number
  /**
   * FE 插值 sin(πx) 的精确 L² 范数平方 vᵀ M_c v。
   * （≠ ∫ sin²；那是连续函数，这里是分段线性 uh）
   */
  consistentQuad: number
  lumpedQuad: number
  /** |vᵀMl v − vᵀMc v|：对角集中相对一致质量的二次型误差 */
  lumpingQuadErr: number
  /** 相对误差 |Ml−Mc|_quad / |Mc|_quad */
  lumpingRelErr: number
  /** 全 1 向量：两种质量二次型均 = 1（仿射精确） */
  onesConsistent: number
  onesLumped: number
  methodId: typeof METHOD_ALGO_SEM_LUMPED_MASS
  familyId: typeof SEM_L2_PARENT
} {
  const { x, n, h } = linNodes1d(nElem)
  const cons = assembleConsistentMass1d(nElem)
  const lump = assembleLumpedMass1d(nElem)
  const lumpDir = assembleLumpedMass1dDirect(nElem)

  let lumpMatch = true
  for (let i = 0; i < n * n; i++) {
    if (Math.abs(lump.M[i]! - lumpDir.M[i]!) > 1e-12) {
      lumpMatch = false
      break
    }
  }

  const relFrobDiff = frobeniusDiff(cons.M, lump.M) / Math.max(frobenius(cons.M), 1e-30)

  // 节点自由度定义的分段线性 uh；Mc 给出精确 ‖uh‖²
  const u = sampleOnNodes((xi) => Math.sin(Math.PI * xi), x)
  const consistentQuad = quadraticForm(cons.M, u, n)
  const lumpedQuad = quadraticForm(lump.M, u, n)
  const lumpingQuadErr = Math.abs(lumpedQuad - consistentQuad)
  const lumpingRelErr = lumpingQuadErr / Math.max(Math.abs(consistentQuad), 1e-30)

  const ones = new Float64Array(n)
  ones.fill(1)
  const onesConsistent = quadraticForm(cons.M, ones, n)
  const onesLumped = quadraticForm(lump.M, ones, n)

  return {
    nElem,
    n,
    h,
    lumpMatch,
    relFrobDiff,
    consistentQuad,
    lumpedQuad,
    lumpingQuadErr,
    lumpingRelErr,
    onesConsistent,
    onesLumped,
    methodId: METHOD_ALGO_SEM_LUMPED_MASS,
    familyId: SEM_L2_PARENT,
  }
}
