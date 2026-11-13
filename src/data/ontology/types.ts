// 统一能量本体的四类核心类型。纯类型 + 类型守卫，无运行时逻辑。
// 设计见 docs/superpowers/specs/2026-05-29-energy-ontology-foundation-design.md

/** ① 物理量：数 + 单位 + 量级范围（WebGPU 输入的原子）。 */
export interface Quantity {
  symbol: string                 // η, λ, f, ρ_E …
  value?: number
  min?: number
  max?: number
  unit: string                   // SI 字符串: "W" | "J/kg" | "Hz" | "m" | "K" | "1"(无量纲)
  log?: boolean                  // 跨数量级时建议对数展示
  note?: string
}

/** ② 共识/争议层。 */
export type ConsensusStatus = 'established' | 'convention' | 'contested' | 'open'
export type Confidence = 'high' | 'medium'
export interface Viewpoint {
  stance: string                 // 立场陈述
  /** English stance for locale=en */
  stanceEn?: string
  proponents?: string[]          // 代表人物/学派
  source?: string                // 出处/引用
}
export interface Consensus {
  status: ConsensusStatus        // 公认 / 约定（非基础）/ 有争议 / 未解
  confidence?: Confidence        // 默认 high；附录 A 中"○来源"项为 medium
  summary?: string               // 一句话点出争议
  /** English summary for locale=en */
  summaryEn?: string
  viewpoints?: Viewpoint[]
}

/** 频谱维度（沿用现有 src/data/spectrum.ts 字段）。 */
export interface Band {
  name: string
  range: string
  freq: string
  color: string
  desc: string
  apps: string[]
}

/** ③ 节点：能量/状态形式（分层）。 */
export interface EnergyNode {
  id: string
  parent?: string                // 顶层=undefined；子形态→指向顶层 id
  name: string
  /** English display name; optional for gradual i18n. Machine id stays English. */
  nameEn?: string
  symbol?: string
  icon?: string
  color?: string
  desc: string
  /** English description; Chinese `desc` remains source of truth. */
  descEn?: string
  quantities: Quantity[]         // 能量密度 / 典型功率 / 频段范围 …
  spectrum?: Band[]              // 可选：电磁能 / 声能挂这里
  consensus: Consensus
  refs?: string[]
}

/** ④ 可执行公式（为 WebGPU 预留）。expr 形如 "P_loss = I^2 * R"。
 *  sample+expected 是自带的"工作算例"：测试逐条断言 evalExpr(expr, sample) ≈ expected。
 *  注意这是**自洽/回归闸门**（防求值器与公式书写漂移），**不**校验公式的物理正确性——
 *  物理正确性靠 efficiency 的量纲/第一定律闸门（见 ontology.test.ts「转换边 η≤1」）
 *  与人工/对抗式核查保证。 */
export interface Formula {
  latex?: string
  expr: string                   // 可被 src/lib/formula.ts 求值
  vars: Record<string, string>   // 变量名 → 单位/含义
  sample?: Record<string, number> // 工作算例输入：每个 expr 变量一个数值
  expected?: number              // 该算例的预期输出（用 sample 代入 expr 应得到的值）
  tol?: number                   // 相对容差，默认 1e-6
  /**
   * 可选人话一句（KUX 解释层）。缺省时由 formulaExplain 从 expr+vars 推导。
   * 不参与 evalExpr；旧 JSON 无此字段不炸。
   */
  plainZh?: string
  /** English plain-language formula line; Chinese plainZh remains source. */
  plainEn?: string
}

export interface LossMechanism {
  name: string
  desc: string
  formula?: Formula
}

/** 真实产品型号（厂商 + 型号 + 规格）。 */
export interface Product {
  vendor?: string
  /** English vendor label; Chinese `vendor` remains source of truth. */
  vendorEn?: string
  model: string
  /** English model label; Chinese `model` remains source of truth. */
  modelEn?: string
  spec?: string                  // 关键规格，如 "功率 700W / 效率 47%"
  /** English spec; Chinese `spec` remains source of truth (progressive overlay). */
  specEn?: string
}

/** 效率的物理性质：
 *  - 'conversion'：真实能量转换效率 η ≤ 1（第一定律）；链路连乘。
 *  - 'transport'：搬运/能效型（热泵、制冷的 COP 性能系数），可 >1，因为它**搬运环境能量**
 *    而非凭空转换。COP 是能效指标，不是转换比率；在转换效率链中按 100% 封顶计。 */
export type EfficiencyKind = 'conversion' | 'transport'

/** ④ 边：转换/传输。 */
export interface ConversionEdge {
  id: string
  from: string                   // node id，可连顶层或子形态
  to: string
  name: string
  /** English display name; optional for gradual i18n. Machine id stays English. */
  nameEn?: string
  principle: string
  /** English principle one-liner; Chinese `principle` remains source of truth. */
  principleEn?: string
  kind?: EfficiencyKind          // 缺省 'conversion'；'transport' 表示 COP 能效（搬运类）
  device?: string[]              // 典型换能器/器件（通用类别）
  products?: Product[]           // 实际产品型号
  efficiency: Quantity           // conversion: η∈[0,1]；transport: COP（可>1），unit 仍 "1"
  lossMechanisms: LossMechanism[]
  formula?: Formula
  maturity?: string
  apps?: string[]
  consensus: Consensus
  refs?: string[]
}

/** 元层面争议（不归属单一节点）。 */
export interface Controversy {
  id: string
  title: string
  /** English title for locale=en; Chinese `title` remains source of truth. */
  titleEn?: string
  layer: 'meta' | 'conventional' | 'frontier'
  consensus: Consensus
  relatedNodeIds?: string[]      // 关联的节点 id（可空）
}

/** 类型守卫：运行时校验 Quantity 形态（数据完整性测试用）。 */
export function isQuantity(x: unknown): x is Quantity {
  return !!x && typeof (x as Quantity).symbol === 'string'
    && typeof (x as Quantity).unit === 'string'
}

/** 类型守卫：运行时校验 EnergyNode 形态（JSON 加载护栏）。 */
export function isEnergyNode(x: unknown): x is EnergyNode {
  const n = x as EnergyNode
  return !!n && typeof n.id === 'string' && typeof n.name === 'string'
    && typeof n.desc === 'string'
    && Array.isArray(n.quantities)
    && !!n.consensus && typeof n.consensus.status === 'string'
}

/** 类型守卫：运行时校验 ConversionEdge 形态（JSON 加载护栏）。 */
export function isConversionEdge(x: unknown): x is ConversionEdge {
  const e = x as ConversionEdge
  return !!e && typeof e.id === 'string'
    && typeof e.from === 'string' && typeof e.to === 'string'
    && typeof e.name === 'string' && typeof e.principle === 'string'
    && isQuantity(e.efficiency)
    && Array.isArray(e.lossMechanisms)
    && !!e.consensus && typeof e.consensus.status === 'string'
}

// ===== ⑤ 前沿现象/通路（一等对象）。设计见
// docs/superpowers/specs/2026-05-31-frontier-phenomenon-sdt-design.md =====

/** 现象主干的一步：引用真实节点/边；hypothetical=争议连线（只在现象层，不入 EDGES）。 */
export interface PhenomenonStep {
  nodeId?: string                  // 引用 NODES 节点（落主图的）
  label?: string                   // 未单列时用文字（如"细胞凋亡/免疫激活"）
  labelEn?: string
  edgeId?: string                  // 引用 EDGES（已确立边）
  via?: string                     // 该步机理简述
  viaEn?: string
  hypothetical?: boolean           // true=虚线假说连线
}

/** 机理多假说——"机理不明确"的核心承载，复用 Consensus 争议机器。 */
export type Likelihood = 'leading' | 'plausible' | 'minority'
export interface MechanismHypothesis {
  id: string
  name: string                     // 空化-声化学 / 声致发光-光敏化 / 压电-半导体声催化 / 直接三线态敏化
  nameEn?: string
  summary: string
  summaryEn?: string
  likelihood: Likelihood           // 渲染时据此高亮"最可能"虚线
  consensus: Consensus             // 复用 status/confidence/viewpoints/proponents/source
  steps?: PhenomenonStep[]         // 该假说对应的子路径（虚线）
  reuseEdgeIds?: string[]          // 复用的现有边（如 acoustic-to-chemical-sonochemistry）
}

/** 真实应用/科研档案——"具体例子尚未列出"的承载。 */
export interface ResearchInstance {
  kind: 'science' | 'engineering' | 'clinical'
  title: string                    // 具体实例（不是泛标签）
  titleEn?: string
  detail: string                   // 到底做了什么
  detailEn?: string
  org?: string
  year?: number
  maturity?: string                // 实验室 / 临床前 / 临床 I–III / 商用
  maturityEn?: string
  key?: string[]                   // 关键声敏剂 / 换能器 / 材料
  keyEn?: string[]
  ref?: string                     // 链接（可选，整理已知，不强制溯源）
}

/** ⑤ 前沿现象/通路：跨多节点的被策展通路（一等公民）。 */
export interface FrontierPhenomenon {
  id: string
  name: string
  /** English display name; Chinese `name` remains source of truth. */
  nameEn?: string
  icon?: string
  domain?: string                  // 生物医学 / 材料 / …
  domainEn?: string
  summary: string
  summaryEn?: string
  steps: PhenomenonStep[]           // 汇聚枢纽视角的主干序列
  hypotheses: MechanismHypothesis[] // 机理多假说（多虚线）
  consensus: Consensus              // 现象整体（contested/open）
  applications: ResearchInstance[]  // 真实工程/科研/临床档案
  sampleId?: string                 // 关联量化样板间，SDT → 'photosensitization'
  refs?: string[]
}

/** 类型守卫：运行时校验 FrontierPhenomenon 形态（数据完整性测试用）。 */
export function isFrontierPhenomenon(x: unknown): x is FrontierPhenomenon {
  const p = x as FrontierPhenomenon
  return !!p && typeof p.id === 'string' && typeof p.name === 'string'
    && typeof p.summary === 'string'
    && Array.isArray(p.steps) && Array.isArray(p.hypotheses)
    && Array.isArray(p.applications)
    && !!p.consensus && typeof p.consensus.status === 'string'
}
