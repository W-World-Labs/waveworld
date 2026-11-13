// Petri 网对反应网络的编码（claim-group 11，high-confidence 核实）。
// 采纳来源：Petri 网（Koch 受 Chaouiya 等综述）——20 年来系统生物学/化学的标准形式化：
//  - place（库所）= 化学物种/代谢物；transition（变迁）= 反应；
//  - token = 分子计数；arc weight = 化学计量系数；
//  - 关联矩阵(incidence matrix) = 化学计量矩阵 Γ；
//  - P-不变量(place-invariant) = 质量/化学计量守恒律（全正 P-不变量 ⇒ 网 conservative，加权和恒定）；
//  - T-不变量 = 稳态反应循环（net composition 回到原态）；
//  - 结构性质：trap/siphon/deadlock/reachability，可从网结构直接判定。
// 这是物质通道「转换网络」可组合性/守恒的图论面，与 crn.ts（动力学/pH 面）互补。

/** 一个 Petri 网（反应网络的图论编码）。 */
export interface PetriNet {
  places: string[]                  // 物种 id
  transitions: string[]             // 反应 id
  /** 弧 (place, transition, weight)；consume = 进 transition 的计量，produce = 出 transition 的计量。 */
  consumes: Array<{ place: number; transition: number; weight: number }>
  produces: Array<{ place: number; transition: number; weight: number }>
}

/** 关联矩阵 Γ[place][transition] = produce − consume（即化学计量矩阵 S）。
 *  这是 Petri 网理论里的 incidence matrix。 */
export function incidenceMatrix(net: PetriNet): number[][] {
  const Γ: number[][] = Array.from({ length: net.places.length }, () =>
    new Array<number>(net.transitions.length).fill(0))
  for (const c of net.consumes) Γ[c.place][c.transition] -= c.weight
  for (const p of net.produces) Γ[p.place][p.transition] += p.weight
  return Γ
}

/** 判定向量 y 是否为 P-不变量（守恒律）：Γ^T·y = 0。
 *  y[place] 给每个物种的守恒权重（如 H 原子数贡献）。 */
export function isPInvariant(net: PetriNet, y: number[]): { invariant: boolean; residual: number } {
  const Γ = incidenceMatrix(net)
  let max = 0
  for (let t = 0; t < net.transitions.length; t++) {
    let s = 0
    for (let p = 0; p < net.places.length; p++) s += Γ[p][t] * y[p]
    if (Math.abs(s) > max) max = Math.abs(s)
  }
  return { invariant: max < 1e-9, residual: max }
}

/** 判定向量 v 是否为 T-不变量（稳态反应循环）：Γ·v = 0。 */
export function isTInvariant(net: PetriNet, v: number[]): { invariant: boolean; residual: number } {
  const Γ = incidenceMatrix(net)
  let max = 0
  for (let p = 0; p < net.places.length; p++) {
    let s = 0
    for (let t = 0; t < net.transitions.length; t++) s += Γ[p][t] * v[t]
    if (Math.abs(s) > max) max = Math.abs(s)
  }
  return { invariant: max < 1e-9, residual: max }
}

/** 网是否 conservative：存在全正 P-不变量（加权和恒定的强守恒）。
 *  这里检查一个给定的候选 y 是否全正且为 P-不变量。 */
export function isConservative(net: PetriNet, y: number[]): boolean {
  return y.every((w) => w > 0) && isPInvariant(net, y).invariant
}

/** 矩阵转置（小工具，测试/诊断用）。 */
export function transpose(m: number[][]): number[][] {
  if (m.length === 0) return []
  return m[0].map((_, j) => m.map((row) => row[j]))
}
