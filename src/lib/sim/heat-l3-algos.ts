/**
 * 热扩散三级 · Crank–Nicolson 1D（θ=0.5）+ Thomas 三对角。
 * 比同 r 的 FTCS 时间精度高（2 阶）；无条件稳定。
 * method id 仅常量，不改 methods.data。
 */
import { STABLE_R } from './heat'
import {
  ftcsStep1D,
  gaussianIC,
  HEAT_L2_PARENT,
  solveTridiagThomas,
} from './heat-l2-algos'

export { STABLE_R, gaussianIC, ftcsStep1D, solveTridiagThomas }

/** 父族（与 heat-ftcs 对齐）。 */
export const HEAT_L3_PARENT = HEAT_L2_PARENT

/** 三级 · Crank–Nicolson。 */
export const METHOD_ALGO_HEAT_CRANK_NICOLSON = 'method-algo-heat-crank-nicolson'

export const HEAT_L3_METHOD_IDS = [METHOD_ALGO_HEAT_CRANK_NICOLSON] as const

/**
 * 1D Crank–Nicolson 单步（θ=0.5，Dirichlet 两端固定）：
 * −(r/2) u′_{i−1} + (1+r) u′_i − (r/2) u′_{i+1}
 *   = (r/2) u_{i−1} + (1−r) u_i + (r/2) u_{i+1}
 *
 * `bcNext` 给时间变化的 Dirichlet 值：显式一侧仍取 `u` 中保存的
 * 当前边界值（u_bcⁿ），隐式一侧和输出边界取 `bcNext`（u_bcⁿ⁺¹），
 * 即标准的时变边界 CN 处理。
 */
export function crankNicolsonStep1D(
  u: Float32Array | Float64Array,
  r: number,
  bcNext?: { left?: number; right?: number },
): Float64Array {
  const n = u.length
  if (n === 0) return new Float64Array(0)
  if (n === 1) return new Float64Array([u[0]!])
  if (n === 2) return new Float64Array([u[0]!, u[1]!])

  const m = n - 2
  const a = new Float64Array(m)
  const b = new Float64Array(m)
  const c = new Float64Array(m)
  const d = new Float64Array(m)
  const left = u[0]!
  const right = u[n - 1]!
  const leftNext = bcNext?.left ?? left
  const rightNext = bcNext?.right ?? right
  const halfR = 0.5 * r

  for (let k = 0; k < m; k++) {
    const i = k + 1
    a[k] = -halfR
    b[k] = 1 + r
    c[k] = -halfR
    d[k] = halfR * u[i - 1]! + (1 - r) * u[i]! + halfR * u[i + 1]!
  }
  // Dirichlet 左/右端并入右端（n+1 时刻值）
  d[0]! += halfR * leftNext
  d[m - 1]! += halfR * rightNext
  a[0] = 0
  c[m - 1] = 0

  const interior = solveTridiagThomas(a, b, c, d)
  const out = new Float64Array(n)
  out[0] = leftNext
  out[n - 1] = rightNext
  for (let k = 0; k < m; k++) out[k + 1] = interior[k]!
  return out
}

function l2Diff(a: Float64Array, b: Float64Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!
    s += d * d
  }
  return Math.sqrt(s / Math.max(a.length, 1))
}

function maxAbs(u: Float64Array): number {
  let m = 0
  for (let i = 0; i < u.length; i++) {
    const a = Math.abs(u[i]!)
    if (a > m) m = a
  }
  return m
}

/**
 * 样例：同一高斯初值、同一 r（FTCS 稳定域内）与相同步数，
 * CN 相对「半步长 FTCS 参考」误差小于全步 FTCS（时间 2 阶优势的代理检验）。
 * 另：大 r 下 CN 仍有限且峰值下降。
 */
export function runCrankNicolsonSample(
  n = 48,
  r = 0.2,
  steps = 30,
): {
  r: number
  stableR: number
  /** 小 r：CN 与参考解的 L2 误差 */
  cnErr: number
  /** 小 r：全步 FTCS 与参考的 L2 误差 */
  ftcsErr: number
  /** CN 比 FTCS 更准（同 r、同终点时间） */
  cnMoreAccurate: boolean
  cnMax: number
  ftcsMax: number
  /** 大 r 稳定性探针 */
  largeR: {
    r: number
    cnFinite: boolean
    cnMaxDropped: boolean
    cnMax: number
  }
  finite: boolean
  methodId: typeof METHOD_ALGO_HEAT_CRANK_NICOLSON
  familyId: typeof HEAT_L3_PARENT
} {
  const u0 = gaussianIC(n)
  const max0 = maxAbs(u0)

  // 参考：半步长 FTCS（2*steps 步，r/2）逼近更真的轨迹
  let uref: Float64Array = new Float64Array(u0)
  for (let s = 0; s < steps * 2; s++) uref = ftcsStep1D(uref, r / 2)

  let ucn: Float64Array = new Float64Array(u0)
  for (let s = 0; s < steps; s++) ucn = crankNicolsonStep1D(ucn, r)

  let uft: Float64Array = new Float64Array(u0)
  for (let s = 0; s < steps; s++) uft = ftcsStep1D(uft, r)

  const cnErr = l2Diff(ucn, uref)
  const ftcsErr = l2Diff(uft, uref)

  // 大 r 稳定性
  const rBig = 2.0
  let ub: Float64Array = new Float64Array(u0)
  for (let s = 0; s < 20; s++) ub = crankNicolsonStep1D(ub, rBig)
  let cnFinite = true
  for (let i = 0; i < ub.length; i++) {
    if (!Number.isFinite(ub[i]!)) {
      cnFinite = false
      break
    }
  }
  const cnMaxBig = maxAbs(ub)

  const finite =
    cnFinite &&
    Number.isFinite(cnErr) &&
    Number.isFinite(ftcsErr) &&
    Number.isFinite(maxAbs(ucn))

  return {
    r,
    stableR: STABLE_R,
    cnErr,
    ftcsErr,
    cnMoreAccurate: cnErr < ftcsErr,
    cnMax: maxAbs(ucn),
    ftcsMax: maxAbs(uft),
    largeR: {
      r: rBig,
      cnFinite,
      cnMaxDropped: cnMaxBig < max0,
      cnMax: cnMaxBig,
    },
    finite,
    methodId: METHOD_ALGO_HEAT_CRANK_NICOLSON,
    familyId: HEAT_L3_PARENT,
  }
}
