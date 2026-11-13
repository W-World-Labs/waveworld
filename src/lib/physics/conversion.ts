// 单个转换 = 可组合的「原子单元」。每条边自描述其物理契约：
//   输入形式 → 输出形式(产物)、能力(受第一性原理上限约束的典型效率)、㶲品位、应满足的守恒律。
// 设计哲学（分层）：把基础理论(physics/limits)做对 → 把每个**单个转换**维护成合法原子 →
//   路径由原子的**组合**自动涌现、且由构造保证正确（连续性 + 每跳合法 + 累积量守恒）。
//
// 守恒律为框架声明（标注该转换类「应」满足哪些守恒）；具体化学计量/电荷数等待经验数据接入后填充校验。

import type { ConversionEdge } from '../../data/ontology/types'
import { effForChain, isTransport } from '../paths'
import { exergyFactor, gateExergyFactor } from '../exergy'
import { theoreticalEtaLimit } from './registry'

export type ConservationLaw = 'energy' | 'charge' | 'mass-stoichiometry' | 'baryon-lepton-number' | 'mass-energy'

/** 一条转换边作为原子单元的物理契约。 */
export interface ConversionContract {
  id: string
  inputForm: string
  outputForm: string
  /** 能力：典型效率(effForChain，COP 搬运型已封顶 1)。 */
  eta: number
  /** 第一性原理理论上限（来自 physics/registry；transport 为 Infinity 不按 η 限）。 */
  etaLimit: number
  etaLimitLaw: string
  /** 能力是否落在理论天花板内（第一/第二定律一致性）。 */
  withinLimit: boolean
  isTransport: boolean
  phiIn: number
  phiOut: number
  /** 㶲效率 ε=η·φ_out/φ_in（保守口径，用闸门㶲因子，对真实热机不误报）。 */
  exergyEff: number
  /** 该转换类「应」满足的守恒律（框架声明，具体校验待计量数据）。 */
  requiredConservation: ConservationLaw[]
  violations: string[]
  /** 是否为合法原子（在上限内 + 无违规）。 */
  valid: boolean
}

/** 按 from/to 形式判定该转换类应满足的守恒律（除能量外，化学/核/电相关各有附加守恒）。 */
function requiredConservation(f: string, t: string): ConservationLaw[] {
  const laws = new Set<ConservationLaw>(['energy'])
  const touches = (x: string) => f === x || t === x
  if (touches('chemical')) laws.add('mass-stoichiometry')
  if (touches('electric') || touches('chemical')) laws.add('charge') // 电化学/氧化还原需电荷守恒
  if (touches('nuclear') || touches('mass')) { laws.add('baryon-lepton-number'); laws.add('mass-energy') }
  return [...laws]
}

/** 分析单个转换，产出其物理契约 + 合法性。formOf：节点 id → 顶层形式。 */
export function analyzeConversion(edge: ConversionEdge, formOf: (id: string) => string): ConversionContract {
  const inputForm = formOf(edge.from)
  const outputForm = formOf(edge.to)
  const transport = isTransport(edge)          // 用于展示字段/㶲口径
  const isCopDevice = edge.kind === 'transport' // 判据用 kind 字面量，避免 isTransport(含 max>1) 自我抵消(B1)
  const eta = effForChain(edge)
  const peak = edge.efficiency.max ?? eta       // 声称峰值(B2)：非搬运边须连峰值也 ≤ 上限
  const lim = theoreticalEtaLimit(edge, formOf)
  // 保守㶲因子（热能高温上界、其余 1），与第二定律闸门一致，对真实热机不误报。
  const phiIn = gateExergyFactor(inputForm)
  const phiOut = gateExergyFactor(outputForm)
  const exergyEff = phiIn > 0 ? eta * (phiOut / phiIn) : 0

  const violations: string[] = []
  // 能力须在第一性原理上限内：非搬运边连**峰值**也不得超(B2)；搬运型(COP)不按 η 限。
  const withinLimit = isCopDevice || !Number.isFinite(lim.eta) || (eta <= lim.eta + 1e-6 && peak <= lim.eta + 1e-6)
  if (!withinLimit) violations.push(`能力(典型 ${eta.toFixed(3)}/峰值 ${peak.toFixed(3)}) 超过第一性原理上限 ${lim.eta.toFixed(3)}（${lim.law}）`)
  // 数据完整性：非 transport 边 efficiency.max 不得 >1（B1：用 kind 字面量，不被 isTransport 抵消）
  if (!isCopDevice && (edge.efficiency.max ?? 0) > 1 + 1e-9) {
    violations.push(`非搬运边 efficiency.max=${edge.efficiency.max}>1（应标 kind=transport 或修正 η）`)
  }
  // 搬运型 COP 上界(B4)：缺工作温度时用保守硬上界；有温度数据后改卡诺 COP=Th/(Th−Tc)。
  if (isCopDevice && (edge.efficiency.max ?? 0) > 20) {
    violations.push(`搬运型 COP=${edge.efficiency.max} 超保守上界 20（待工作温度用卡诺 COP=Th/(Th−Tc) 精确）`)
  }

  return {
    id: edge.id, inputForm, outputForm, eta,
    etaLimit: lim.eta, etaLimitLaw: lim.law, withinLimit, isTransport: transport,
    phiIn, phiOut, exergyEff,
    requiredConservation: requiredConservation(inputForm, outputForm),
    violations, valid: violations.length === 0,
  }
}

export interface CompositionResult {
  /** 节点级连续：每跳 to === 下一跳 from。 */
  continuous: boolean
  /** 每个原子(单跳)是否都合法。 */
  allAtomsValid: boolean
  /** 累积效率 = ∏η（与逐原子相乘一致）。 */
  cumulativeEta: number
  startForm: string
  endForm: string
  hopContracts: ConversionContract[]
  /** 整条路径作为合法组合是否成立（连续 + 全原子合法）。 */
  valid: boolean
}

/** 校验一条路径是否为**单个转换的合法组合**：连续性 + 每个原子合法 + 累积量一致。
 *  这正是「维护好单个转换 → 路径自动涌现且正确」的形式化保证。 */
export function isValidComposition(
  hops: { from: string; to: string; edge: ConversionEdge; eff: number }[],
  formOf: (id: string) => string,
): CompositionResult {
  let continuous = true
  for (let i = 1; i < hops.length; i++) if (hops[i - 1].to !== hops[i].from) continuous = false
  const hopContracts = hops.map((h) => analyzeConversion(h.edge, formOf))
  const allAtomsValid = hopContracts.every((c) => c.valid)
  // 用封顶后的逐原子能力连乘(B3)，COP 已封顶 1，累积转换效率恒 ≤1；不直接用传入的 raw h.eff。
  const cumulativeEta = hopContracts.reduce((a, c) => a * c.eta, 1)
  return {
    continuous, allAtomsValid, cumulativeEta,
    startForm: formOf(hops[0].from), endForm: formOf(hops[hops.length - 1].to),
    hopContracts, valid: continuous && allAtomsValid && cumulativeEta <= 1 + 1e-9,
  }
}

export type OutputRole = 'product' | 'loss-heat' | 'transported'
export interface ConversionOutput { form: string; fraction: number; role: OutputRole; note?: string }

/** 单个转换的**能量去向**（第一定律闭合）：产物(主输出 η) + 损耗((1−η)，默认全部热化为热)。
 *  这让"电磁波 → 电 + 热"这类内部去向显式且守恒——每条原子的输出份额之和 = 1。
 *  搬运型(COP)：产物份额=COP(含从环境搬运的热)，额外记 ambientDraw=COP−1(来自环境，不计入输入能量)。
 *  说明：当前损耗默认归热(多数转换损耗最终热化)；具体去向(反射/透射的电磁、声等)待经验数据细分。 */
export function conversionOutputs(edge: ConversionEdge, formOf: (id: string) => string): {
  outputs: ConversionOutput[]; closes: boolean; ambientDraw: number
} {
  const toForm = formOf(edge.to)
  if (isTransport(edge)) {
    const cop = edge.efficiency.max ?? edge.efficiency.min ?? 1
    const ambientDraw = Math.max(0, cop - 1)
    // 第一定律闭合：输入功(1) + 环境搬运(ambientDraw) = 产物(cop)。COP<1 时不闭合(标 false)，不假报(B5)。
    return {
      outputs: [{ form: toForm, fraction: cop, role: 'transported', note: '含从环境搬运的热(COP)' }],
      closes: Math.abs(cop - (1 + ambientDraw)) < 1e-6, ambientDraw,
    }
  }
  const eta = effForChain(edge)
  const outputs: ConversionOutput[] = [{ form: toForm, fraction: eta, role: 'product' }]
  const loss = 1 - eta
  if (loss > 1e-9) outputs.push({ form: 'thermal', fraction: loss, role: 'loss-heat', note: '损耗主要热化为热(默认；具体去向待数据细分)' })
  const sum = outputs.reduce((a, o) => a + o.fraction, 0)
  return { outputs, closes: Math.abs(sum - 1) < 1e-6, ambientDraw: 0 }
}

/** 用展示用㶲因子算原子的㶲效率（供 UI/诊断，区别于 analyzeConversion 的保守闸门口径）。 */
export const displayExergyEff = (edge: ConversionEdge, formOf: (id: string) => string): number => {
  const pf = exergyFactor(formOf(edge.from)), pt = exergyFactor(formOf(edge.to))
  return pf > 0 ? effForChain(edge) * (pt / pf) : 0
}
