/**
 * 热扩散二级算法 · 1D 隐式 BTCS（Thomas 三对角）对照显式 FTCS。
 * 显式族与 heat.ts（2D FTCS）同型：u' = u + r·∇²u；
 * 隐式在大 r 下仍稳定。method id 仅常量，不改 methods.data。
 */
import { STABLE_R } from './heat'

/** 父族（与 methods.data 中 heat-ftcs 对齐）。 */
export const HEAT_L2_PARENT = 'method-heat-ftcs'

/** 一级 · 显式 FTCS 步进。 */
export const HEAT_L2_FTCS_ID = 'method-algo-heat-ftcs-step'

/**
 * 二级 · 1D 隐式（BTCS + Thomas）。
 * 仅常量，不写入 methods.data。
 */
export const HEAT_L2_IMPLICIT_ID = 'method-algo-heat-implicit'

export const HEAT_L2_METHOD_IDS = [HEAT_L2_FTCS_ID, HEAT_L2_IMPLICIT_ID] as const

/** 导出 heat 稳定阈，便于对照。 */
export { STABLE_R }

/**
 * Thomas 算法解三对角 Ax=d：
 * a[i] 下对角（a[0] 未用）、b 主对角、c 上对角（c[n-1] 未用）、d 右端。
 * 返回新数组，不修改入参。
 */
export function solveTridiagThomas(
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

/**
 * 1D 显式 FTCS 单步（纯函数，与 heat.ts 同型 stencil）：
 * interior: u' = u + r·(u_{i−1} − 2u_i + u_{i+1})
 * 两端 Dirichlet 固定。r > 0.5 时不稳定。
 */
export function ftcsStep1D(u: Float32Array | Float64Array, r: number): Float64Array {
  const n = u.length
  const out = new Float64Array(n)
  if (n === 0) return out
  out[0] = u[0]!
  out[n - 1] = u[n - 1]!
  for (let i = 1; i < n - 1; i++) {
    out[i] = u[i]! + r * (u[i - 1]! - 2 * u[i]! + u[i + 1]!)
  }
  return out
}

/**
 * 1D 隐式 BTCS 单步（Thomas）：
 * −r·u'_{i−1} + (1+2r)·u'_i − r·u'_{i+1} = u_i
 * 两端 Dirichlet 固定为入参边界值。无条件稳定。
 */
export function implicitStep1D(u: Float32Array | Float64Array, r: number): Float64Array {
  const n = u.length
  if (n === 0) return new Float64Array(0)
  if (n === 1) return new Float64Array([u[0]!])
  if (n === 2) return new Float64Array([u[0]!, u[1]!])

  // 仅解内部节点 1..n-2
  const m = n - 2
  const a = new Float64Array(m)
  const b = new Float64Array(m)
  const c = new Float64Array(m)
  const d = new Float64Array(m)
  const left = u[0]!
  const right = u[n - 1]!
  for (let k = 0; k < m; k++) {
    a[k] = -r
    b[k] = 1 + 2 * r
    c[k] = -r
    d[k] = u[k + 1]!
  }
  // Dirichlet 贡献并入右端
  d[0]! += r * left
  d[m - 1]! += r * right
  // 端点行：a[0]、c[m-1] 不参与
  a[0] = 0
  c[m - 1] = 0

  const interior = solveTridiagThomas(a, b, c, d)
  const out = new Float64Array(n)
  out[0] = left
  out[n - 1] = right
  for (let k = 0; k < m; k++) out[k + 1] = interior[k]!
  return out
}

/** 中心高斯峰初值，两端 0。 */
export function gaussianIC(n: number, sigmaFrac = 0.08): Float64Array {
  const u = new Float64Array(n)
  const mid = (n - 1) / 2
  const sigma = Math.max(1, sigmaFrac * n)
  for (let i = 0; i < n; i++) {
    const z = (i - mid) / sigma
    u[i] = Math.exp(-0.5 * z * z)
  }
  u[0] = 0
  u[n - 1] = 0
  return u
}

function fieldStats(u: Float64Array): { maxAbs: number; energy: number; finite: boolean } {
  let maxAbs = 0
  let energy = 0
  let finite = true
  for (let i = 0; i < u.length; i++) {
    const v = u[i]!
    if (!Number.isFinite(v)) finite = false
    const a = Math.abs(v)
    if (a > maxAbs) maxAbs = a
    energy += v * v
  }
  return { maxAbs, energy, finite: finite && Number.isFinite(energy) }
}

/**
 * 大 r 隐式样例：r ≫ STABLE_R 时 FTCS 发散，BTCS 保持有限且峰值下降。
 */
export function runImplicitHeatSample(
  n = 48,
  r = 2.0,
  steps = 20,
): {
  r: number
  stableR: number
  ftcs: { maxAbs: number; energy: number; finite: boolean }
  implicit: { maxAbs: number; energy: number; finite: boolean; maxDropped: boolean }
  methodId: typeof HEAT_L2_IMPLICIT_ID
} {
  const u0 = gaussianIC(n)
  const e0 = fieldStats(u0)

  let uf: Float64Array = new Float64Array(u0)
  for (let s = 0; s < steps; s++) uf = new Float64Array(ftcsStep1D(uf, r))
  const ftcs = fieldStats(uf)

  let ui: Float64Array = new Float64Array(u0)
  for (let s = 0; s < steps; s++) ui = new Float64Array(implicitStep1D(ui, r))
  const imp = fieldStats(ui)

  return {
    r,
    stableR: STABLE_R,
    ftcs,
    implicit: {
      ...imp,
      maxDropped: imp.maxAbs < e0.maxAbs,
    },
    methodId: HEAT_L2_IMPLICIT_ID,
  }
}
