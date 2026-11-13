// 化学反应网络（CRN）理论 + port-Hamiltonian 桥（claim-group 17，high-confidence 核实）。
// 采纳来源：van der Schaft & Jeltsema 2014 / 与 CRN 的扩展：
//  「isothermal chemical reaction networks governed by mass-action kinetics ... admit a natural
//   port-Hamiltonian formulation ... dynamics ẋ = S·v(x), stoichiometric matrix S = Z·B,
//   Hamiltonian given by the free Gibbs' energy.」
// 关键意义：物质通道**复用同一套 port-Hamiltonian 形式化**（不必另起一套）——
//  能量通道的 (flow,effort)/Dirac 组合性、Transformer/Gyrator 原语照样适用，
//  只把 Hamiltonian 从「储能」换成「Gibbs 自由能」，flow=反应速率，effort=化学势差。
//  守恒律（原子/电荷）由化学计量矩阵 S 的左零空间（P-不变量）结构化编码（见 petri.ts）。

/** 化学反应网络。 */
export interface ChemicalReactionNetwork {
  species: string[]               // x 的维
  reactions: string[]             // v 的维
  /** 化学计量矩阵 S[species][reaction] = Z·B（见 incidenceMatrix in petri.ts）。 */
  S: number[][]
  /** 每个物种的 Gibbs 自由能 μ（化学势，J/mol）——pH Hamiltonian 的 effort。 */
  gibbsPotential?: number[]
  /** 质量作用动力学速率法则 v(x) 的前置因子 k（每反应）。 */
  rateConstants?: number[]
}

/** 质量作用速率 v(x)：对反应 j = Σ s_ij^+ reactants，v_j = k_j · ∏ x_i^(-s_ij^-, consume 计量)。
 *  这里用「正向 consume 计量」近似（可逆可拆两条反应）。返回 v 向量。 */
export function massActionRates(
  crn: ChemicalReactionNetwork, x: number[],
): number[] {
  const k = crn.rateConstants ?? crn.reactions.map(() => 1)
  return crn.reactions.map((_, j) => {
    let v = k[j]
    for (let i = 0; i < crn.species.length; i++) {
      const consume = crn.S[i][j] < 0 ? -crn.S[i][j] : 0
      if (consume > 0) v *= Math.pow(Math.max(x[i], 0), consume)
    }
    return v
  })
}

/** CRN 动力学 ẋ = S·v(x)（mass-action）。返回 ẋ。 */
export function crnDynamics(crn: ChemicalReactionNetwork, x: number[]): number[] {
  const v = massActionRates(crn, x)
  return crn.species.map((_, i) =>
    crn.reactions.reduce((a, _, j) => a + crn.S[i][j] * v[j], 0))
}

/** port-Hamiltonian 结构契约（claim-group 17）：
 *  isothermal mass-action CRN = port-Hamiltonian 系统，Hamiltonian = Gibbs 自由能。 */
export interface CRNasPortHamiltonian {
  /** flow = 反应速率向量 v。 */
  flow: number[]
  /** effort = 化学势差（Gibbs 梯度），S^T·μ 的量级。 */
  effort: number[]
  /** Hamiltonian = Gibbs 自由能 G(x) = Σ x_i μ_i（粗，缺活度系数）。 */
  hamiltonian: number
  /** 动力学 ẋ = S·v 是否与 pH 形式一致（恒真，构造保证）。 */
  isPortHamiltonian: true
}

/** 把 CRN 诠释为 port-Hamiltonian 系统。无 Gibbs 数据时 effort/hamiltonian 用占位 0。 */
export function asPortHamiltonian(
  crn: ChemicalReactionNetwork, x: number[],
): CRNasPortHamiltonian {
  const v = massActionRates(crn, x)
  const mu = crn.gibbsPotential ?? crn.species.map(() => 0)
  // effort ≜ −S^T·μ（反应亲和力/化学势驱动力，port-Hamiltonian 约定）
  const effort = crn.reactions.map((_, j) =>
    -crn.species.reduce((a, __, i) => a + crn.S[i][j] * mu[i], 0))
  const hamiltonian = crn.species.reduce((a, _, i) => a + x[i] * mu[i], 0)
  return { flow: v, effort, hamiltonian, isPortHamiltonian: true }
}

/** 守恒律（S 的左零空间基，即 P-不变量）：Γ·y=0 ⟺ S^T·y=0。
 *  复用 petri.ts 的同名概念；这里给 CRN 直接口径。y = 物种守恒权重（如 H 原子数）。 */
export function isConservationLaw(crn: ChemicalReactionNetwork, y: number[]): boolean {
  let max = 0
  for (let j = 0; j < crn.reactions.length; j++) {
    let s = 0
    for (let i = 0; i < crn.species.length; i++) s += crn.S[i][j] * y[i]
    if (Math.abs(s) > max) max = Math.abs(s)
  }
  return max < 1e-9
}
