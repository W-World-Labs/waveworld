// Shockley-Queisser 单结细致平衡极限（数值，非闭式）。
// 采用 de Vos「无稀释黑体源」口径：源为 Ts 黑体、电池温度 Tc、入射功率 P_in=σTs⁴（不做几何稀释）。
// 结果 η_max ≈ 0.41 @ Eg≈1.1eV（6000K 级黑体）——这是细致平衡的热力学口径上限；
// 地面 AM1.5 单结 ~0.337 因光谱/稀释不同，需换谱，不在此口径内（见注释）。
//
// 注意：多结/聚光 CPV 可合法超过单结 SQ（如 4 结 47.6%），故本值**不**作硬闸门，仅供「单结距上限」诊断。

import { H, C, KB, QE, SIGMA } from './constants'

/** 黑体光子数谱密度 b(E,T) = (2π/(h³c²))·E²/(exp(E/kT)−1)，单位 1/(m²·s·J)，E 单位 J。 */
export function planckPhotonFlux(E: number, T: number): number {
  if (E <= 0) return 0
  const x = E / (KB * T)
  const denom = Math.expm1(x) // exp(x)-1，小 x 更稳
  if (!Number.isFinite(denom) || denom <= 0) return 0
  return (2 * Math.PI / (H ** 3 * C ** 2)) * (E * E) / denom
}

/** 梯形积分 ∫_a^b f dE。 */
function integrate(f: (E: number) => number, a: number, b: number, n: number): number {
  if (b <= a) return 0
  const h = (b - a) / n
  let s = 0.5 * (f(a) + f(b))
  for (let i = 1; i < n; i++) s += f(a + i * h)
  return s * h
}

/** 光子数通量 ∫_Eg^∞ b(E,T) dE（上限截到 Eg+30kT 覆盖尾部）。 */
export function photonFluxAbove(Eg: number, T: number, n = 1500): number {
  const top = Math.max(Eg, 0) + 30 * KB * T
  return integrate((E) => planckPhotonFlux(E, T), Math.max(Eg, 1e-30), top, n)
}

/** 辐射能流 ∫_0^∞ E·b dE，应等于 σT⁴（积分器自校验）。 */
export function radiantPowerFromPlanck(T: number, n = 4000): number {
  const top = 30 * KB * T
  return integrate((E) => E * planckPhotonFlux(E, T), 1e-3 * KB * T, top, n)
}

/** 给定带隙 Eg(J) 的 SQ 效率：对工作电压 V 求最大功率 / P_in。 */
export function sqEfficiency(Eg: number, Ts = 5778, Tc = 300): number {
  const Nabs = photonFluxAbove(Eg, Ts)
  const N0 = photonFluxAbove(Eg, Tc)
  const Pin = SIGMA * Ts ** 4
  const Vmax = Eg / QE // 开路电压上限 Eg/q（伏）
  let best = 0
  const steps = 400
  for (let i = 1; i < steps; i++) {
    const V = (i / steps) * Vmax
    const J = QE * (Nabs - N0 * Math.exp((QE * V) / (KB * Tc))) // A/m²
    const P = V * J
    if (P > best) best = P
  }
  return best / Pin
}

/** 扫带隙求 SQ 单结最大效率（无稀释黑体口径）。返回 {etaMax, EgOpt_eV}。 */
export function sqMaxEfficiency(Ts = 5778, Tc = 300): { etaMax: number; EgOpt_eV: number } {
  let etaMax = 0, EgOpt_eV = 0
  for (let eV = 0.5; eV <= 2.5; eV += 0.02) {
    const eta = sqEfficiency(eV * QE, Ts, Tc)
    if (eta > etaMax) { etaMax = eta; EgOpt_eV = eV }
  }
  return { etaMax, EgOpt_eV }
}

/** 缓存的单结 SQ 上限（6000K 级无稀释黑体口径，供诊断/注释，非硬闸门）。约 0.41 @ Eg≈1.1eV。 */
export const SQ_SINGLE_JUNCTION_UNDILUTED = 0.41
