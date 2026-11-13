/**
 * 浸没边界 IBM 二级 · 铺展→插值力投影一致性（IB 伴随恒等式）。
 * 离散 δ 的 spread / interpolate 构成伴随对：⟨Sf, u⟩_h = F · (S* u)。
 * method id 仅常量，不改 methods.data。
 */
import {
  METHOD_IMMERSED_BOUNDARY,
  interpolate1d,
  peskinPhi4,
  spreadForce1dPeriodic,
} from './ibm-algos'

export {
  METHOD_IMMERSED_BOUNDARY,
  interpolate1d,
  peskinPhi4,
  spreadForce1dPeriodic,
}

/** 父族 · IBM。 */
export const IBM_L2_PARENT = METHOD_IMMERSED_BOUNDARY

/** 二级 · 铺展-插值投影一致性。 */
export const METHOD_ALGO_IBM_SPREAD_INTERP = 'method-algo-ibm-spread-interp'

export const IBM_L2_METHOD_IDS = [METHOD_ALGO_IBM_SPREAD_INTERP] as const

/**
 * Euler 内积 ⟨f, u⟩_h = Σ_i f_i u_i h。
 */
export function eulerInner(
  f: ArrayLike<number>,
  u: ArrayLike<number>,
  h: number,
): number {
  const n = f.length
  let s = 0
  for (let i = 0; i < n; i++) s += f[i]! * u[i]! * h
  return s
}

/**
 * IB 伴随恒等式残差（单 Lagrangian 点）：
 *   | ⟨spread(F), u⟩_h − F · interpolate(u) |
 * 对任意 Euler 场 u 应 ≈ 0（同一 Peskin 核 + 周期格）。
 */
export function spreadInterpAdjointResidual(
  F: number,
  X: number,
  u: ArrayLike<number>,
  n: number,
  dx: number,
): {
  left: number
  right: number
  residual: number
  f: Float64Array
  U: number
} {
  const f = spreadForce1dPeriodic(F, X, n, dx)
  const U = interpolate1d(u, X, n, dx)
  const left = eulerInner(f, u, dx)
  const right = F * U
  return {
    left,
    right,
    residual: Math.abs(left - right),
    f,
    U,
  }
}

/**
 * 多点铺展：Σ_k F_k δ(x − X_k)，再对每点插值。
 * 返回 Euler 力密度与各点插值值。
 */
export function spreadMany(
  forces: ArrayLike<number>,
  Xs: ArrayLike<number>,
  n: number,
  dx: number,
): Float64Array {
  const f = new Float64Array(n)
  for (let k = 0; k < forces.length; k++) {
    const fk = spreadForce1dPeriodic(forces[k]!, Xs[k]!, n, dx)
    for (let i = 0; i < n; i++) f[i]! += fk[i]!
  }
  return f
}

export function interpolateMany(
  u: ArrayLike<number>,
  Xs: ArrayLike<number>,
  n: number,
  dx: number,
): Float64Array {
  const out = new Float64Array(Xs.length)
  for (let k = 0; k < Xs.length; k++) {
    out[k] = interpolate1d(u, Xs[k]!, n, dx)
  }
  return out
}

/**
 * 多点伴随：⟨Σ spread(F_k), u⟩_h ≟ Σ F_k U_k。
 */
export function multiPointAdjointResidual(
  forces: ArrayLike<number>,
  Xs: ArrayLike<number>,
  u: ArrayLike<number>,
  n: number,
  dx: number,
): { left: number; right: number; residual: number } {
  const f = spreadMany(forces, Xs, n, dx)
  const left = eulerInner(f, u, dx)
  const U = interpolateMany(u, Xs, n, dx)
  let right = 0
  for (let k = 0; k < forces.length; k++) right += forces[k]! * U[k]!
  return { left, right, residual: Math.abs(left - right) }
}

/**
 * 样例：铺展后插值的力投影 / IB 伴随一致性。
 * - 单点伴随残差 ≈ 0
 * - 多点伴随残差 ≈ 0
 * - 总力守恒 Σ f h ≈ Σ F
 * - 常数场插值再现
 */
export function runIbmSpreadInterpSample(
  opts?: { n?: number; dx?: number },
): {
  n: number
  dx: number
  F: number
  X: number
  adjointResidual: number
  multiAdjointResidual: number
  forceSum: number
  forceSumErr: number
  constInterp: number
  constField: number
  constInterpErr: number
  /** 对 spread(F) 再插值：与 F 同号且有限（核自能标度） */
  selfInterp: number
  methodId: typeof METHOD_ALGO_IBM_SPREAD_INTERP
  familyId: typeof IBM_L2_PARENT
} {
  const n = opts?.n ?? 64
  const dx = opts?.dx ?? 1
  const F = 2.5
  const X = 20.3

  // 光滑非平凡 Euler 场
  const u = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    u[i] = Math.sin((2 * Math.PI * i) / n) + 0.3 * Math.cos((4 * Math.PI * i) / n)
  }

  const single = spreadInterpAdjointResidual(F, X, u, n, dx)

  const forces = [1.2, -0.7, 0.5]
  const Xs = [8.1, 20.3, 40.6]
  const multi = multiPointAdjointResidual(forces, Xs, u, n, dx)

  const fAll = spreadMany(forces, Xs, n, dx)
  let forceSum = 0
  for (let i = 0; i < n; i++) forceSum += fAll[i]! * dx
  const Ftot = forces.reduce((a, b) => a + b, 0)

  const constField = 3.25
  const uConst = new Float64Array(n)
  uConst.fill(constField)
  const constInterp = interpolate1d(uConst, X, n, dx)

  // 自作用：插值 spread 结果（力密度 → 标量）
  const selfInterp = interpolate1d(single.f, X, n, dx)

  return {
    n,
    dx,
    F,
    X,
    adjointResidual: single.residual,
    multiAdjointResidual: multi.residual,
    forceSum,
    forceSumErr: Math.abs(forceSum - Ftot),
    constInterp,
    constField,
    constInterpErr: Math.abs(constInterp - constField),
    selfInterp,
    methodId: METHOD_ALGO_IBM_SPREAD_INTERP,
    familyId: IBM_L2_PARENT,
  }
}
