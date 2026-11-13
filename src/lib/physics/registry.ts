// edge-class → 第一性原理 η 理论上限。当前用保守口径(无经验物性参数即可成立、对 229 条边无误报)：
//  - thermal → 功(电/机械/声)：卡诺(保守高温 2000K) ≈ 0.851
//  - radiant/electromagnetic → 功：Landsberg 辐射→功(太阳温) ≈ 0.931（全谱硬上限）
//  - 其余：第一定律 η ≤ 1
//  - transport(COP) 边：不按 η 限（COP 由卡诺 COP 上界另计）
// 经验物性接入后，可对 photovoltaic(SQ/带隙)、thermoelectric(ZT)、wind(Betz) 等收紧（见下方 helper）。

import type { ConversionEdge } from '../../data/ontology/types'
import { carnotEfficiency, petelaExergy, thermoelectricEfficiency, BETZ_MAX } from './limits'
import { sqEfficiency } from './sq'
import { T0_ENV, T_SUN, QE, THERMAL_GATE_T } from './constants'

const WORK = new Set(['electric', 'mechanical', 'acoustic'])

export interface EdgeLimit {
  eta: number
  /** Chinese source label (tests / zh UI). */
  law: string
  /** English display label for i18n UI. */
  lawEn: string
}

/** 某转换边的第一性原理 η 理论上限（保守、对现有数据无误报）。formOf：节点 id→顶层形式。
 *  transport(COP) 边返回 eta=Infinity（不按 η 限）。 */
export function theoreticalEtaLimit(edge: ConversionEdge, formOf: (id: string) => string): EdgeLimit {
  if (edge.kind === 'transport') {
    return {
      eta: Infinity,
      law: '搬运型(COP)，按卡诺 COP 上界另计',
      lawEn: 'Transport (COP); Carnot COP bound counted separately',
    }
  }
  const f = formOf(edge.from), t = formOf(edge.to)
  if (f === 'thermal' && WORK.has(t)) {
    return {
      eta: carnotEfficiency(T0_ENV, THERMAL_GATE_T),
      law: `卡诺极限(保守 ${THERMAL_GATE_T}K 热源)`,
      lawEn: `Carnot limit (conservative ${THERMAL_GATE_T} K heat source)`,
    }
  }
  if ((f === 'radiant' || f === 'electromagnetic') && WORK.has(t)) {
    return {
      eta: petelaExergy(T_SUN, T0_ENV),
      law: 'Landsberg 辐射→功上限(太阳温)',
      lawEn: 'Landsberg radiation→work bound (solar temperature)',
    }
  }
  return { eta: 1, law: '第一定律 η≤1', lawEn: 'First law η≤1' }
}

/** 实际(典型)效率 eff 距第一性原理理论上限的余量。COP 搬运边返回 null。 */
export function headroom(
  edge: ConversionEdge, formOf: (id: string) => string, eff: number,
): { limit: EdgeLimit; gap: number; fraction: number } | null {
  const lim = theoreticalEtaLimit(edge, formOf)
  if (!Number.isFinite(lim.eta) || lim.eta <= 0) return null
  return { limit: lim, gap: lim.eta - eff, fraction: eff / lim.eta }
}

/** 路径上的热力学瓶颈跳：在**存在非平凡第一性原理上限(<1)**的跳里，取**最逼近自身上限者**
 *  (fraction=eff/limit 最高，最难再提升)。若全是平凡的第一定律(η≤1)上限则返回 null。 */
export function bindingLimit(
  hops: { edge: ConversionEdge; eff: number }[], formOf: (id: string) => string,
): { law: string; lawEn: string; limitEta: number; eff: number; fraction: number } | null {
  let best: { law: string; lawEn: string; limitEta: number; eff: number; fraction: number } | null = null
  for (const h of hops) {
    const hr = headroom(h.edge, formOf, h.eff)
    if (!hr || hr.limit.eta >= 0.999) continue // 跳过平凡的第一定律上限
    const cand = {
      law: hr.limit.law,
      lawEn: hr.limit.lawEn,
      limitEta: hr.limit.eta,
      eff: h.eff,
      fraction: hr.fraction,
    }
    // 瓶颈 = 最逼近自身理论上限者(fraction 最高、最难再提升)，与 UI"已达上限 X%"语义一致。
    if (!best || cand.fraction > best.fraction) best = cand
  }
  return best
}

// ===== 经验物性接入后可用的"收紧"上限 helper（当前不入硬闸门，供数据接入后调用）=====
/** 单结光伏：给定带隙(eV)的 SQ 细致平衡上限（无稀释黑体口径）。多结/聚光可超此值。 */
export const photovoltaicSingleJunctionLimit = (Eg_eV: number) => sqEfficiency(Eg_eV * QE, T_SUN, 300)
/** 热电：给定 ZT 与冷热端温度的效率上限。 */
export const thermoelectricLimit = (ZT: number, Tc: number, Th: number) => thermoelectricEfficiency(ZT, Tc, Th)
/** 开放无导管流(风/水)动能提取上限 Betz 16/27。 */
export const windKineticLimit = () => BETZ_MAX
