// 㶲（exergy / 可用功）层：能量 ≠ 做功能力。第一定律守恒的是「量」，第二定律说「品位(quality)」
// 才决定能做多少功。把不同品位的 Joule 当同质代币连乘（如把 100 J 电与 100 J 室温废热等量齐观）
// 会系统性误判热泵 vs 电阻加热、余热回收 vs 直接燃烧——对面向教育的工具，这等于传播错误能量观。
//
// 㶲因子 φ = 㶲/能量 ∈ [0,1]：
//  - 功品位形式（电/机械/动能/声/核/质能/引力势能）≈ 1（近纯㶲）；
//  - 热能 = 卡诺因子 φ = 1 − T₀/T（T₀≈298K 环境）：低品位且随温度变，室温废热 φ→0；
//  - 化学能 ≈ |ΔG|/|ΔH|（做功能力是吉布斯自由能 ΔG，而非反应焓 ΔH）。
//
// 一条 A→B、能量效率 η 的转换边，其㶲效率 ε = η · φ_B/φ_A；第二定律要求 ε ≤ 1 ⟺ η ≤ φ_A/φ_B。
// 对「热→功」这恰好退化为卡诺极限 η ≤ 1 − T₀/T。沿路径 ∏ε = (∏η)·(φ_end/φ_start)（望远镜消去），
// 故固定端点时㶲排序与能量排序同序——㶲的价值在于**显式暴露每跳/全程被销毁的可用功**与**卡诺保守闸门**。

import { T0_ENV, THERMAL_GATE_T } from './physics/constants'

/** 环境/死态参考温度（单一真源，见 physics/constants.ts）。 */
export const T0 = T0_ENV

/** 温度 T(>T₀) 的热能卡诺㶲因子 1 − T₀/T，截断到 [0,1]。 */
export function thermalExergyFactor(T: number): number {
  if (!Number.isFinite(T) || T <= T0) return 0
  return Math.max(0, Math.min(1, 1 - T0 / T))
}

/** 展示用代表温度（工业/废热中段）；热能㶲随真实温度变，此为标注过的代表估计。 */
export const THERMAL_DISPLAY_T = 500 // K → φ≈0.40

/** 展示用：各顶层能量形式的代表性㶲因子。
 *  注：radiant 已并入 electromagnetic 子树，顶层 radiant 经一级 formOf 归 electromagnetic→取 0.95；
 *  此处 radiant:0.9 仅对 radiant-* 子形态(radiant-blackbody/solar/luminescence)生效。 */
export const FORM_EXERGY_FACTOR: Record<string, number> = {
  electric: 1, mechanical: 1, electromagnetic: 0.95, radiant: 0.9,
  acoustic: 1, chemical: 0.9, nuclear: 1, mass: 1, gravitational: 1,
  thermal: thermalExergyFactor(THERMAL_DISPLAY_T),
}

/** 展示用㶲因子（按顶层形式）。 */
export function exergyFactor(form: string): number {
  return FORM_EXERGY_FACTOR[form] ?? 1
}

/** 闸门用㶲因子：仅热能用保守高温上界(≈燃烧级)、其余取 1。
 *  故只对「热→功」边构成 <1 的卡诺约束，避免对化学/电化学等品位口径模糊处误报。 */
export { THERMAL_GATE_T } // 单一真源 physics/constants.ts，re-export 兼容旧导入
export function gateExergyFactor(form: string): number {
  return form === 'thermal' ? thermalExergyFactor(THERMAL_GATE_T) : 1
}

/** 品位明确的「功」形式：朝它们升级才是无歧义的第二定律约束（热→功 卡诺）。
 *  radiant/electromagnetic 品位随源温变化（太阳≈高㶲、热辐射≈低㶲），不在此列以免误判黑体发射。 */
export const WORK_FORMS = new Set(['electric', 'mechanical', 'acoustic'])

export interface ExergyHop { eff: number; from: string; to: string }
export interface PathExergy {
  energyEff: number       // ∏η（能量留存，第一定律）
  /** 输出侧可用功留存 = energyEff·φ_end（每单位输入能量最终成为可用功的份额；恒 ≤ energyEff，无伪影）。
   *  终态为低品位(热)时远小于 energyEff——这就是「能量守恒≠做功能力守恒」的直观量。 */
  usableWorkOut: number
  /** 全程㶲效率 = energyEff·φ_end/φ_start（相对源㶲）。注：起态品位口径粗(化学按燃料、热按代表温度)
   *  时可能 >1，仅供参考；展示请用 usableWorkOut。 */
  exergyEff: number
  phiStart: number
  phiEnd: number
  startForm: string
  endForm: string
  /** 逐跳：相对代表品位的㶲效率 eps；secondLawViolation 用**保守闸门品位**判定，仅对朝
   *  品位明确「功」形式升级且超保守卡诺界时为真（不会对真实热机误报）。 */
  hops: { eps: number; secondLawViolation: boolean }[]
}

/** 沿路径计算能量效率、可用功留存与逐跳㶲销毁。formOf 把节点 id 映射到顶层形式。 */
export function pathExergy(hops: ExergyHop[], formOf: (id: string) => string): PathExergy {
  const startForm = formOf(hops[0].from)
  const endForm = formOf(hops[hops.length - 1].to)
  const phiStart = exergyFactor(startForm)
  const phiEnd = exergyFactor(endForm)
  let energyEff = 1
  const perHop = hops.map((h) => {
    energyEff *= h.eff
    // eps 与 secondLawViolation 用**同一**保守闸门㶲口径（热能取高温上界 φ≈0.85），避免 display 口径
    // 制造"eps>1 却不报违反"的不一致；仅对朝品位明确「功」形式升级且超界时判违反，真实热机不误报。
    const gf = gateExergyFactor(formOf(h.from))
    const gt = gateExergyFactor(formOf(h.to))
    const eps = gf > 0 ? h.eff * (gt / gf) : 0
    const secondLawViolation = eps > 1 + 1e-6 && WORK_FORMS.has(formOf(h.to))
    return { eps, secondLawViolation }
  })
  const usableWorkOut = energyEff * phiEnd
  const exergyEff = phiStart > 0 ? energyEff * (phiEnd / phiStart) : 0
  return { energyEff, usableWorkOut, exergyEff, phiStart, phiEnd, startForm, endForm, hops: perHop }
}
