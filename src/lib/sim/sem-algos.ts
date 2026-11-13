/**
 * 谱元 SEM · 纯函数样例（Legendre 多项式 + GLL 节点/权重）。
 * method-spectral-element 研究骨架；不改 methods.data。
 */

export const SEM_PARENT = 'method-spectral-element'
export const SEM_LAGRANGE_ID = 'method-algo-sem-lagrange'
export const SEM_GLL_ID = 'method-algo-sem-gll-quadrature'

/** Legendre P0..P3（显式低阶，教学骨架）。 */
export function legendreP(n: number, x: number): number {
  if (n === 0) return 1
  if (n === 1) return x
  if (n === 2) return 0.5 * (3 * x * x - 1)
  if (n === 3) return 0.5 * (5 * x * x * x - 3 * x)
  // 三项递推
  let p0 = 1
  let p1 = x
  for (let k = 1; k < n; k++) {
    const p2 = ((2 * k + 1) * x * p1 - k * p0) / (k + 1)
    p0 = p1
    p1 = p2
  }
  return p1
}

/**
 * N=2 GLL 节点与权重（参考元 [−1,1]）：
 * 节点 {−1, 0, 1}，权重 {1/3, 4/3, 1/3}。
 * 精确积分 ≤ 2N−1 = 3 次多项式。
 */
export function gllNodesWeightsN2(): { nodes: number[]; weights: number[] } {
  return {
    nodes: [-1, 0, 1],
    weights: [1 / 3, 4 / 3, 1 / 3],
  }
}

/** GLL 求积 ∫_{-1}^{1} f(x) dx ≈ Σ w_i f(x_i)。 */
export function gllQuadrature(
  f: (x: number) => number,
  nodes: number[],
  weights: number[],
): number {
  let s = 0
  for (let i = 0; i < nodes.length; i++) s += weights[i]! * f(nodes[i]!)
  return s
}

/**
 * 代表样例：P2 正交性片段、GLL 对 x² 精确积分 2/3、权重和 =2。
 */
export function runSemSample(): {
  p2At0: number
  p2At1: number
  gllIntegralX2: number
  analyticX2: number
  weightSum: number
  errX2: number
  methodId: typeof SEM_PARENT
} {
  const { nodes, weights } = gllNodesWeightsN2()
  const gllIntegralX2 = gllQuadrature((x) => x * x, nodes, weights)
  const analyticX2 = 2 / 3
  let weightSum = 0
  for (const w of weights) weightSum += w
  return {
    p2At0: legendreP(2, 0),
    p2At1: legendreP(2, 1),
    gllIntegralX2,
    analyticX2,
    weightSum,
    errX2: Math.abs(gllIntegralX2 - analyticX2),
    methodId: SEM_PARENT,
  }
}

/** 子算法 · Lagrange–GLL 谱元原子。 */
export function runSemLagrangeSample() {
  const r = runSemSample()
  return { ...r, methodId: SEM_LAGRANGE_ID as typeof SEM_LAGRANGE_ID }
}

/** 子算法 · GLL 求积原子（别名 runSemSample 口径）。 */
export function runGllSample() {
  const r = runSemSample()
  return { ...r, methodId: SEM_GLL_ID as typeof SEM_GLL_ID }
}
