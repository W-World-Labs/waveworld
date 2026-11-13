/**
 * 边界元 BEM 二级 · 1D 配点 Green 求和。
 * 对应 method-algo-bem-collocation；复用 research-algos Dirichlet Green 核。
 */
import { greenDirichlet1d, METHOD_BEM } from './research-algos'

/** 父族 · BEM。 */
export const BEM_L2_PARENT = METHOD_BEM

/** 二级 · 配点法 Green 离散和。 */
export const BEM_COLLOCATION_ID = 'method-algo-bem-collocation'

/**
 * 1D 配点：在内部配置点 x_i 上对源点 y_j 做梯形 Green 求和
 *   u(x_i) ≈ Σ_j w_j G(x_i, y_j) f_j
 * f≡1 时解析 u(x)=x(1−x)/2。
 */
export function bemCollocation1d(
  nNodes: number,
  f: (y: number) => number = () => 1,
): { x: Float64Array; u: Float64Array } {
  if (nNodes < 3) throw new Error('bemCollocation1d: nNodes ≥ 3')
  // 边界 y=0,1 上 G=0；配点取开区间内均匀节点
  const n = nNodes
  const h = 1 / (n + 1)
  const x = new Float64Array(n)
  const u = new Float64Array(n)
  // 求积节点：含端点的梯形
  const nQuad = n + 1
  const hy = 1 / nQuad
  for (let i = 0; i < n; i++) {
    const xi = (i + 1) * h
    x[i] = xi
    let s = 0
    for (let j = 0; j <= nQuad; j++) {
      const y = j * hy
      const w = j === 0 || j === nQuad ? 0.5 : 1
      s += w * greenDirichlet1d(xi, y) * f(y)
    }
    u[i] = s * hy
  }
  return { x, u }
}

/** 解析 Poisson −u″=1、u(0)=u(1)=0：u=x(1−x)/2。 */
export function analyticPoisson1d(x: number): number {
  return (x * (1 - x)) / 2
}

/**
 * 代表样例：配点 Green 和 vs 解析中点；最大相对误差。
 */
export function runBemCollocationSample(nNodes = 32): {
  nNodes: number
  uMid: number
  analyticMid: number
  errMid: number
  maxAbsErr: number
  methodId: typeof BEM_COLLOCATION_ID
  familyId: typeof BEM_L2_PARENT
} {
  const { x, u } = bemCollocation1d(nNodes)
  let maxAbsErr = 0
  let midIdx = 0
  let midDist = Infinity
  for (let i = 0; i < x.length; i++) {
    const err = Math.abs(u[i]! - analyticPoisson1d(x[i]!))
    if (err > maxAbsErr) maxAbsErr = err
    const d = Math.abs(x[i]! - 0.5)
    if (d < midDist) {
      midDist = d
      midIdx = i
    }
  }
  const analyticMid = 0.125
  return {
    nNodes,
    uMid: u[midIdx]!,
    analyticMid,
    errMid: Math.abs(u[midIdx]! - analyticMid),
    maxAbsErr,
    methodId: BEM_COLLOCATION_ID,
    familyId: BEM_L2_PARENT,
  }
}
