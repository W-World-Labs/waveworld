/**
 * Multigrid L2 · 几何 W-cycle（1D Poisson FD）。
 * 相对 V-cycle：粗层两次递归校正；同 nu 下残差通常降得更多。
 * method id 仅常量，不改 methods.data / registry / edges。
 */

import {
  METHOD_MULTIGRID,
  residual1d,
  restrictFullWeighting1d,
  prolongLinear1d,
  gaussSeidelSmooth1d,
  coarseSolve1d,
  vcycle1d,
  norm2,
} from './multigrid-algos'

/** 父族 · 多重网格（与 multigrid-algos 对齐）。 */
export { METHOD_MULTIGRID }

/** 子算法 · 几何 W-cycle。 */
export const METHOD_ALGO_MG_WCYCLE = 'method-algo-mg-wcycle'

/** 父族别名。 */
export const MG_L2_PARENT = METHOD_MULTIGRID

export const MG_L2_METHOD_IDS = [METHOD_ALGO_MG_WCYCLE] as const

/**
 * 单层 W-cycle（递归）：
 * 前光滑 → 限制残差 → 粗校正两次（W）→ 延拓累加 → 后光滑。
 * nu1/nu2 为 GS 前/后光滑次数；最粗 n≤minN 精确/GS 解。
 */
export function wcycle1d(
  u: Float64Array,
  f: ArrayLike<number>,
  h: number,
  opts?: { nu1?: number; nu2?: number; minN?: number },
): void {
  const n = u.length
  if (f.length !== n) throw new Error('wcycle1d: length mismatch')
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
  rc[0] = 0
  rc[nc - 1] = 0
  // W-cycle：两次递归粗校正（第二次在第一次解上继续）
  wcycle1d(ec, rc, hc, opts)
  wcycle1d(ec, rc, hc, opts)

  const ef = prolongLinear1d(ec)
  for (let i = 0; i < n; i++) u[i] = u[i]! + ef[i]!
  u[0] = 0
  u[n - 1] = 0

  gaussSeidelSmooth1d(u, f, h, nu2)
}

/**
 * W-cycle 样例：−u″=sin(πx)，u(0)=u(1)=0。
 * 一次 W-cycle 残差下降，且相对同 nu 的单次 V-cycle 残差更低（松比较）。
 */
export function runMgWcycleSample(opts?: {
  /** 细网格总点数（2^L+1，默认 33）。 */
  n?: number
  nu1?: number
  nu2?: number
}): {
  n: number
  h: number
  residual0: number
  residualAfterW: number
  residualAfterV: number
  residualRatioW: number
  residualRatioV: number
  residualDecreased: boolean
  /** W 残差 ≤ V 残差（同 nu，W 多一次粗递归） */
  betterOrEqualThanV: boolean
  midU: number
  analyticMid: number
  errMid: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MG_WCYCLE
  familyId: typeof METHOD_MULTIGRID
} {
  const n = opts?.n ?? 33
  const nu1 = opts?.nu1 ?? 2
  const nu2 = opts?.nu2 ?? 2
  if (n < 5 || n % 2 === 0) throw new Error('runMgWcycleSample: n odd ≥ 5')

  const h = 1 / (n - 1)
  const f = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const x = i * h
    f[i] = Math.sin(Math.PI * x)
  }
  f[0] = 0
  f[n - 1] = 0

  const uW = new Float64Array(n)
  const res0 = residual1d(uW, f, h)
  const residual0 = norm2(res0)

  wcycle1d(uW, f, h, { nu1, nu2, minN: 3 })
  const resW = residual1d(uW, f, h)
  const residualAfterW = norm2(resW)

  const uV = new Float64Array(n)
  vcycle1d(uV, f, h, { nu1, nu2, minN: 3 })
  const resV = residual1d(uV, f, h)
  const residualAfterV = norm2(resV)

  const residualRatioW = residual0 > 0 ? residualAfterW / residual0 : 0
  const residualRatioV = residual0 > 0 ? residualAfterV / residual0 : 0
  const residualDecreased = residualAfterW < residual0 * 0.5
  // 松：W 残差不劣于 V（浮点下允许极小相对容差）
  const betterOrEqualThanV =
    residualAfterW <= residualAfterV * (1 + 1e-9)

  const mid = (n - 1) >> 1
  const midU = uW[mid]!
  const analyticMid = Math.sin(Math.PI * 0.5) / (Math.PI * Math.PI)
  const errMid = Math.abs(midU - analyticMid)

  let finite = true
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(uW[i]!)) finite = false
  }

  const ok =
    residualDecreased &&
    betterOrEqualThanV &&
    finite &&
    residualAfterW < residual0

  return {
    n,
    h,
    residual0,
    residualAfterW,
    residualAfterV,
    residualRatioW,
    residualRatioV,
    residualDecreased,
    betterOrEqualThanV,
    midU,
    analyticMid,
    errMid,
    finite,
    ok,
    methodId: METHOD_ALGO_MG_WCYCLE,
    familyId: METHOD_MULTIGRID,
  }
}
