/**
 * 多物理场弱耦合 · 纯函数样例（热 → 电导 → 焦耳热闭环残差）。
 * method-comsol-style-multiphysics 研究骨架；不改 methods.data。
 */

export const MULTIPHYSICS_PARENT = 'method-comsol-style-multiphysics'
export const MULTIPHYSICS_STAGGERED_ID = 'method-algo-staggered-thermoelastic'
export const MULTIPHYSICS_PARTITIONED_ID = 'method-algo-partitioned-coupling'

/** 线性温度相关电导 σ(T) = σ0 / (1 + α (T − Tref))。 */
export function conductivity(T: number, sigma0: number, alpha: number, Tref: number): number {
  const d = 1 + alpha * (T - Tref)
  if (!(d > 0)) throw new Error('conductivity denominator must be positive')
  return sigma0 / d
}

/** 稳态 0D 焦耳加热：P = V² · σ · A/L → 温升 ΔT = P · Rth（热阻）。 */
export function jouleHeatingDeltaT(
  V: number,
  sigma: number,
  geomFactor: number,
  Rth: number,
): number {
  // geomFactor = A/L
  const P = V * V * sigma * geomFactor
  return P * Rth
}

/**
 * 弱耦合定点一步：给定 T_guess → σ → 新温升 T_new；残差 |T_new − T_guess|。
 * 可选少量 Picard 迭代收敛。
 */
export function weakCoupleThermalElectric(
  V: number,
  sigma0: number,
  alpha: number,
  Tref: number,
  geomFactor: number,
  Rth: number,
  T0: number,
  iters = 8,
): { T: number; sigma: number; residual: number; iters: number } {
  let T = T0
  let residual = Infinity
  let sigma = conductivity(T, sigma0, alpha, Tref)
  for (let k = 0; k < iters; k++) {
    sigma = conductivity(T, sigma0, alpha, Tref)
    const Tnew = Tref + jouleHeatingDeltaT(V, sigma, geomFactor, Rth)
    residual = Math.abs(Tnew - T)
    T = Tnew
    if (residual < 1e-9) return { T, sigma, residual, iters: k + 1 }
  }
  return { T, sigma, residual, iters }
}

/**
 * 代表样例：Picard 弱耦合收敛；σ 随升温下降（正 α）。
 */
export function runMultiphysicsSample(): {
  T: number
  sigma: number
  sigma0: number
  residual: number
  coupled: string[]
  ok: boolean
  methodId: typeof MULTIPHYSICS_PARENT
} {
  const sigma0 = 1e4
  const alpha = 0.002
  const Tref = 300
  // 温和参数保证 Picard 收敛（教学骨架，非工业额定）
  const out = weakCoupleThermalElectric(5, sigma0, alpha, Tref, 1e-5, 0.5, Tref, 40)
  return {
    T: out.T,
    sigma: out.sigma,
    sigma0,
    residual: out.residual,
    coupled: ['thermal', 'electric'],
    ok: out.residual < 1e-3 && out.sigma > 0 && out.T >= Tref,
    methodId: MULTIPHYSICS_PARENT,
  }
}

/**
 * 交错热–弹性弱耦合 0D：
 *  ΔT → 热应变 ε_th=α_th ΔT → 应力 σ=E(ε_mech−ε_th)；
 *  固定总应变 ε=0 时 σ=−E α_th ΔT。
 */
export function runStaggeredThermoelasticSample(): {
  deltaT: number
  epsTh: number
  stress: number
  E: number
  alphaTh: number
  residual: number
  methodId: typeof MULTIPHYSICS_STAGGERED_ID
} {
  const E = 200e9 // Pa steel-ish
  const alphaTh = 12e-6 // /K
  // 热步：简单 lumped 加热
  const Q = 1e4 // W
  const mC = 500 // J/K
  const deltaT = Q / mC // K
  const epsTh = alphaTh * deltaT
  // 力学步：固支 ε_total=0 → σ = −E ε_th
  const stress = -E * epsTh
  // 可选回流：应力不影响 0D 温度（弱耦合残差=0 闭合）
  const residual = 0
  return {
    deltaT,
    epsTh,
    stress,
    E,
    alphaTh,
    residual,
    methodId: MULTIPHYSICS_STAGGERED_ID,
  }
}

/**
 * 玩具分区耦合：两块物理 A、B 交换接口变量。
 *   A: u_A ← (1−α) u_A + α · f_B(u_B)   （Dirichlet 侧）
 *   B: u_B ← (1−β) u_B + β · g_A(u_A)   （Neumann/响应侧）
 * 固定点 (u_A*, u_B*) 满足线性耦合；残差 → 0。
 */
export function partitionedCoupleToy(
  alpha = 0.4,
  beta = 0.5,
  iters = 40,
): { uA: number; uB: number; residual: number; iters: number } {
  // 目标固定点：u_A = 0.5 u_B + 1,  u_B = 0.3 u_A + 2
  // 解析：u_A = 0.5(0.3 u_A + 2)+1 = 0.15 u_A + 2 → u_A = 2/0.85 ≈ 2.353
  let uA = 0
  let uB = 0
  let residual = Infinity
  for (let k = 0; k < iters; k++) {
    const fB = 0.5 * uB + 1
    const gA = 0.3 * uA + 2
    const nA = (1 - alpha) * uA + alpha * fB
    const nB = (1 - beta) * uB + beta * gA
    residual = Math.hypot(nA - uA, nB - uB)
    uA = nA
    uB = nB
    if (residual < 1e-12) return { uA, uB, residual, iters: k + 1 }
  }
  return { uA, uB, residual, iters }
}

/** 分区耦合玩具样例：收敛到解析固定点。 */
export function runPartitionedCouplingSample(): {
  uA: number
  uB: number
  residual: number
  analyticA: number
  analyticB: number
  err: number
  ok: boolean
  methodId: typeof MULTIPHYSICS_PARTITIONED_ID
  familyId: typeof MULTIPHYSICS_PARENT
} {
  const out = partitionedCoupleToy(0.45, 0.55, 60)
  // u_A = 0.5 u_B + 1, u_B = 0.3 u_A + 2
  // u_A = 0.5(0.3 u_A + 2) + 1 = 0.15 u_A + 2 → 0.85 u_A = 2 → u_A = 2/0.85
  const analyticA = 2 / 0.85
  const analyticB = 0.3 * analyticA + 2
  const err = Math.hypot(out.uA - analyticA, out.uB - analyticB)
  return {
    uA: out.uA,
    uB: out.uB,
    residual: out.residual,
    analyticA,
    analyticB,
    err,
    ok: out.residual < 1e-6 && err < 1e-4,
    methodId: MULTIPHYSICS_PARTITIONED_ID,
    familyId: MULTIPHYSICS_PARENT,
  }
}
