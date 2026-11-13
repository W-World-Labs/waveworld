// F6 Exergetic Port-Hamiltonian Systems (EPHS)：把 Hamiltonian/储能函数诠释为「㶲」，
//  把 conditions(环境/工况) 结构化并接到第二定律/第一性原理理论上限。
// 采纳来源（deep-research wf_f4ad4c5c-d8b，high-confidence 3-0）：
//  Lohmayer, Kotyczka & Leyendecker (arXiv:2008.04091, 2021)：「The Hamiltonian is traditionally
//  thought of as energy, although its meaning is exergy」（相对参考环境的可用功）。
//  这恰好接 WaveWorld 已有的 exergy.ts（φ 㶲因子）与 physics/registry.ts（卡诺/Landsberg/第一定律上限）。
//
// conditions 在统一模块图里承担两件事（research 的 open question 之一）：
//  (a) 闸门端口相容性/组合——温度/压力/化学势必须相容才能互连；
//  (b) 挂载第一性原理理论上限——热源 T 给卡诺、源温 T_rad 给 Petela、ΔG/ΔH 给化学。

import { T0_ENV, THERMAL_GATE_T, T_SUN } from '../physics/constants'
import { thermalExergyFactor } from '../exergy'
import { carnotEfficiency, petelaExergy } from '../physics/limits'

/** 死态/参考环境（EPHS 参考点）。所有㶲相对此计算。单一真源 T0_ENV。 */
export interface ReferenceEnvironment {
  T0: number          // K 环境温度
  p0?: number         // Pa 环境压力（化学/相变 conditions 用，缺省 1e5）
  /** 环境化学势基准（待数据：具体物种 μ_i^0）。 */
  chemicalPotentials?: Record<string, number>
}

export const DEAD_STATE: ReferenceEnvironment = { T0: T0_ENV, p0: 1e5 }

/** 模块的工况 conditions（结构化）。任意子字段可缺省——缺什么按保守代表值算。 */
export interface Conditions {
  /** 热源/工作温度（K）。决定热㶲 φ=1−T0/T 与卡诺上限。 */
  T?: number
  /** 压力（Pa）。相变/流体 conditions 用。 */
  p?: number
  /** 源辐射温度（K）。决定 Petela/Landsberg 辐射㶲。 */
  Trad?: number
  /** 化学势/反应自由能。ΔG/ΔH 决定化学㶲与燃料电池上限。 */
  dG?: number              // J/mol
  dH?: number              // J/mol
  /** 其它物性占位（带隙 eV、ZT、浓度…），第一性原理收紧 helper 用。 */
  props?: Record<string, number>
  reference?: ReferenceEnvironment
}

/** 取 conditions 的代表温度（缺省 THERMAL_GATE_T 保守上界）。 */
export function resolveT(c?: Conditions): number {
  return c?.T ?? THERMAL_GATE_T
}

/** conditions 下的热㶲因子 φ=1−T0/T（缺省保守高温上界）。 */
export function conditionsThermalExergy(c?: Conditions): number {
  return thermalExergyFactor(resolveT(c))
}

/** conditions 下的辐射㶲因子 Petela（缺省太阳温）。 */
export function conditionsRadiantExergy(c?: Conditions): number {
  return petelaExergy(c?.Trad ?? T_SUN, c?.reference?.T0 ?? T0_ENV)
}

/** 化学㶲因子 |ΔG|/|ΔH|（缺数据回 1，等同纯㶲——保守不误报）。 */
export function conditionsChemicalExergy(c?: Conditions): number {
  if (c?.dG != null && c?.dH != null && Math.abs(c.dH) > 1e-12) return Math.abs(c.dG) / Math.abs(c.dH)
  return 1
}

/** 闸门用：conditions 下某形式的㶲因子（热=高温代表、辐射=太阳温、化学=数据或缺省 1、其余 1）。
 *  与 exergy.ts gateExergyFactor 一致，但允许 conditions 覆盖代表温度。 */
export function gateExergyUnder(form: string, c?: Conditions): number {
  switch (form) {
    case 'thermal': return conditionsThermalExergy(c)
    case 'radiant':
    case 'electromagnetic': return conditionsRadiantExergy(c)
    case 'chemical': return conditionsChemicalExergy(c)
    default: return 1
  }
}

/** conditions 下的「热→功」卡诺理论上限（缺温度回保守高温代表）。 */
export function carnotLimitUnder(c?: Conditions): number {
  return carnotEfficiency(c?.reference?.T0 ?? T0_ENV, resolveT(c))
}

/** 统一第二定律 η 上界：η ≤ φ_from/φ_to（降级边 clamp 1）。
 *  这是 EPHS 把 conditions 接到第一性原理上限的统一入口。 */
export function etaBoundUnder(fromForm: string, toForm: string, c?: Conditions): number {
  const pf = gateExergyUnder(fromForm, c)
  const pt = gateExergyUnder(toForm, c)
  return pt > 0 ? Math.min(1, pf / pt) : 1
}

/** conditions 相容性（组合闸门）：两个模块的温度/压力须同量级才能直接互连。
 *  粗判：同字段都在场且差异超 2× 视为不相容（提示需中间匹配级，如换热器）。 */
export function conditionsCompatible(a: Conditions | undefined, b: Conditions | undefined): {
  compatible: boolean
  reason?: string
} {
  if (a?.T != null && b?.T != null) {
    const r = Math.max(a.T, b.T) / Math.min(a.T, b.T)
    if (r > 2) return { compatible: false, reason: `温度失配 ${a.T}K vs ${b.T}K（需换热/匹配级）` }
  }
  if (a?.p != null && b?.p != null) {
    const r = Math.max(a.p, b.p) / Math.min(a.p, b.p)
    if (r > 2) return { compatible: false, reason: `压力失配 ${a.p}Pa vs ${b.p}Pa` }
  }
  return { compatible: true }
}
