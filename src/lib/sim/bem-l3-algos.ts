/**
 * 边界元三级 · 1D 双层势密度配点（Fredholm 第二类）。
 * (½ I + K) μ = g；Nyström/配点残差随节点加密下降。
 * 复用 research-algos Green；method id 仅常量，不改 methods.data。
 */
import { METHOD_BEM } from './research-algos'
import { BEM_COLLOCATION_ID, BEM_L2_PARENT } from './bem-l2-algos'

export { METHOD_BEM, BEM_L2_PARENT, BEM_COLLOCATION_ID }

/** 父族 · BEM。 */
export const BEM_L3_PARENT = METHOD_BEM

/** 三级 · 双层密度配点。 */
export const METHOD_ALGO_BEM_DOUBLE_LAYER = 'method-algo-bem-double-layer'

export const BEM_L3_METHOD_IDS = [METHOD_ALGO_BEM_DOUBLE_LAYER] as const

/**
 * 自由空间 1D 双层核（主值）：∂/∂y (−|x−y|/2) = ½ sign(x−y)。
 * 对角跳变由 ½ I 单独处理，此处 PV 对角取 0。
 */
export function doubleLayerKernel1d(x: number, y: number): number {
  if (x === y) return 0
  return x > y ? 0.5 : -0.5
}

/**
 * 光滑辅助核（紧致扰动）：使离散 K 非平凡、第二类良好条件。
 * k_s(x,y) = α · cos(2π(x−y))，α 小。
 */
export function smoothDoubleLayerKernel(
  x: number,
  y: number,
  alpha = 0.15,
): number {
  return alpha * Math.cos(2 * Math.PI * (x - y))
}

/**
 * 合成配点核：½ 跳变主部 + 光滑双层扰动（教学用第二类算子）。
 */
export function collocationKernel(x: number, y: number, alpha = 0.15): number {
  return doubleLayerKernel1d(x, y) + smoothDoubleLayerKernel(x, y, alpha)
}

/**
 * 均匀节点 x_i = (i+½)/n ∈ (0,1)。
 */
export function collocationNodes(n: number): Float64Array {
  if (n < 2) throw new Error('collocationNodes: n ≥ 2')
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = (i + 0.5) / n
  return x
}

/**
 * 组装 Nyström 矩阵 A = ½ I + K_h：
 * A_ij = ½ δ_ij + h · k(x_i, x_j)  （梯形/中点矩形，开区间节点）
 */
export function assembleDoubleLayerMatrix(
  n: number,
  alpha = 0.15,
): { A: Float64Array; x: Float64Array; h: number } {
  const x = collocationNodes(n)
  const h = 1 / n
  const A = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const jump = i === j ? 0.5 : 0
      A[i * n + j] = jump + h * collocationKernel(x[i]!, x[j]!, alpha)
    }
  }
  return { A, x, h }
}

/** 高斯消元解 A μ = g（A 行主元，n 小）。返回 μ。 */
export function solveDense(A: Float64Array, g: Float64Array, n: number): Float64Array {
  const M = new Float64Array(A) // copy
  const b = new Float64Array(g)
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
    if (best < 1e-14) throw new Error('solveDense: singular')
    if (piv !== k) {
      for (let j = k; j < n; j++) {
        const tmp = M[k * n + j]!
        M[k * n + j] = M[piv * n + j]!
        M[piv * n + j] = tmp
      }
      const tb = b[k]!
      b[k] = b[piv]!
      b[piv] = tb
    }
    const akk = M[k * n + k]!
    for (let i = k + 1; i < n; i++) {
      const f = M[i * n + k]! / akk
      M[i * n + k] = 0
      for (let j = k + 1; j < n; j++) {
        M[i * n + j]! -= f * M[k * n + j]!
      }
      b[i]! -= f * b[k]!
    }
  }
  const mu = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!
    for (let j = i + 1; j < n; j++) s -= M[i * n + j]! * mu[j]!
    mu[i] = s / M[i * n + i]!
  }
  return mu
}

/** r = A μ − g；返回 ‖r‖₂。 */
export function residualL2(
  A: Float64Array,
  mu: Float64Array,
  g: Float64Array,
  n: number,
): number {
  let s = 0
  for (let i = 0; i < n; i++) {
    let row = 0
    for (let j = 0; j < n; j++) row += A[i * n + j]! * mu[j]!
    const d = row - g[i]!
    s += d * d
  }
  return Math.sqrt(s / n)
}

/**
 * 解析制造解 μ*(x) = sin(2π x)。
 * 用高分辨率 Nyström 算子在配点上算 g ≈ (½I+K)μ*，再在粗网格上求解。
 */
export function manufacturedDensity(x: number): number {
  return Math.sin(2 * Math.PI * x)
}

/** 在节点上施加 μ*。 */
export function sampleDensity(x: Float64Array): Float64Array {
  const mu = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) mu[i] = manufacturedDensity(x[i]!)
  return mu
}

/**
 * 配点残差：把真密度 μ* 代入离散算子，‖(½I+K_h)μ* − g_ref‖。
 * g_ref 取自更细网格插值/直接用细网格算子在相同 μ* 上的投影。
 * 这里简化：g = A_fine 作用在细 μ* 后限制到粗节点；
 * 更直接的教学探针：同一 g 来自 μ* 与同一 A，则求解残差→0；
 * 跨分辨率：细网格算子残差更小（求积更准）。
 *
 * 探针 A：固定 μ*=sin(2πx)，g_h = A_h μ*（自洽），残差应 ~ 机精。
 * 探针 B：用细网格 g 限制到粗点，粗 A_h μ_h − g 的残差随 h↓ 下降。
 */
export function doubleLayerCollocationResidual(n: number, alpha = 0.15): {
  n: number
  /** 自洽求解后 ‖Aμ−g‖ */
  solveResidual: number
  /** 真密度代入 ‖Aμ*−g‖（g=Aμ* ⇒ ~0） */
  truthInjectResidual: number
  /** 相对细网格参考的密度 L2 误差 */
  densityErr: number
  maxAbsMu: number
} {
  const { A, x } = assembleDoubleLayerMatrix(n, alpha)
  const muStar = sampleDensity(x)
  // 自洽右端
  const g = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = 0; j < n; j++) s += A[i * n + j]! * muStar[j]!
    g[i] = s
  }
  const truthInjectResidual = residualL2(A, muStar, g, n)
  const mu = solveDense(A, g, n)
  const solveResidual = residualL2(A, mu, g, n)

  // 相对「真」密度
  let densErr = 0
  let maxAbsMu = 0
  for (let i = 0; i < n; i++) {
    const d = mu[i]! - muStar[i]!
    densErr += d * d
    maxAbsMu = Math.max(maxAbsMu, Math.abs(mu[i]!))
  }
  densErr = Math.sqrt(densErr / n)

  return {
    n,
    solveResidual,
    truthInjectResidual,
    densityErr: densErr,
    maxAbsMu,
  }
}

/**
 * 跨分辨率残差：用 nFine 构造参考 g 在细节点上，限制/重采样到 nCoarse，
 * 再在粗矩阵上评估 ‖A_c μ*_c − g_c‖（求积不一致残差），应随 nCoarse↑ 下降。
 */
export function crossMeshResidual(
  nCoarse: number,
  nFine: number,
  alpha = 0.15,
): number {
  if (nFine < nCoarse) throw new Error('nFine ≥ nCoarse')
  const fine = assembleDoubleLayerMatrix(nFine, alpha)
  const muFine = sampleDensity(fine.x)
  const gFine = new Float64Array(nFine)
  for (let i = 0; i < nFine; i++) {
    let s = 0
    for (let j = 0; j < nFine; j++) s += fine.A[i * nFine + j]! * muFine[j]!
    gFine[i] = s
  }
  // 粗节点：取最邻近细节点的 g
  const coarse = assembleDoubleLayerMatrix(nCoarse, alpha)
  const gC = new Float64Array(nCoarse)
  const muC = sampleDensity(coarse.x)
  for (let i = 0; i < nCoarse; i++) {
    const xi = coarse.x[i]!
    let best = 0
    let bd = Infinity
    for (let j = 0; j < nFine; j++) {
      const d = Math.abs(fine.x[j]! - xi)
      if (d < bd) {
        bd = d
        best = j
      }
    }
    gC[i] = gFine[best]!
  }
  return residualL2(coarse.A, muC, gC, nCoarse)
}

/**
 * 代表样例：双层密度配点；残差随加密下降；求解残差≈0。
 */
export function runBemDoubleLayerSample(
  opts: { nCoarse?: number; nFine?: number; alpha?: number } = {},
): {
  nCoarse: number
  nFine: number
  residualCoarse: number
  residualFine: number
  /** 细网格残差 < 粗网格残差 */
  residualDecreased: boolean
  solveResidualFine: number
  densityErrFine: number
  methodId: typeof METHOD_ALGO_BEM_DOUBLE_LAYER
  familyId: typeof BEM_L3_PARENT
  relatedAlgoId: typeof BEM_COLLOCATION_ID
} {
  const nCoarse = opts.nCoarse ?? 8
  const nFine = opts.nFine ?? 32
  const alpha = opts.alpha ?? 0.15

  const residualCoarse = crossMeshResidual(nCoarse, 64, alpha)
  const residualFine = crossMeshResidual(nFine, 64, alpha)
  const fineProbe = doubleLayerCollocationResidual(nFine, alpha)

  return {
    nCoarse,
    nFine,
    residualCoarse,
    residualFine,
    residualDecreased: residualFine < residualCoarse,
    solveResidualFine: fineProbe.solveResidual,
    densityErrFine: fineProbe.densityErr,
    methodId: METHOD_ALGO_BEM_DOUBLE_LAYER,
    familyId: BEM_L3_PARENT,
    relatedAlgoId: BEM_COLLOCATION_ID,
  }
}
