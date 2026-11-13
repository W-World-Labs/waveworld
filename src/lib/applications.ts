// 面向用户的「能力层」：把已校验的能量本体 + 最优路径内核，包装成可直接使用的功能——
//  ① bestConversionMethods：找 from→to 的高效率/合理转换方法(含器件、真实产品、成熟度、距理论上限)。
//  ② sensorsFor：传感/换能——把被测能量形式转成可观察输出的换能链；电信号只是默认读出，不是必经终点。
// 全部基于 ontology edges 的 device[]/products[]/maturity 与 physics 内核(效率/㶲/第一性原理上限)，
// 而非旧的手写 transducers.ts。

import type { ConversionEdge, ConsensusStatus } from '../data/ontology/types'
import { NODES } from '../data/ontology/nodes'
import { EDGES } from '../data/ontology/edges'
import { buildOptGraph, findOptimalPaths, type OptPath } from './optimize'
import { effForChain } from './paths'
import { pathExergy } from './exergy'
import { bindingLimit } from './physics/registry'
import { energyDisplayName } from './energyAlias'
import { topEnergyForm } from './conversionCatalog'

const formOf = topEnergyForm
/** 展示用能量名（KUX 靶 A：禁止 fallback 到 raw id）。locale=en 时走 nameEn。 */
export const formName = (id: string, locale: 'zh' | 'en' = 'zh') =>
  energyDisplayName(id, locale)

// 单例图（数据在编译期固定）。
const G = buildOptGraph(NODES, EDGES)

export type MaturityTier = 'mature' | 'demonstration' | 'experimental' | 'unknown'
const TIER_RANK: Record<MaturityTier, number> = { mature: 3, demonstration: 2, experimental: 1, unknown: 0 }
const RANK_TIER: MaturityTier[] = ['unknown', 'experimental', 'demonstration', 'mature']

/** 把自由文本 maturity 归一到四档。复合短语取**最弱档**（先判 experimental，再 demonstration，
 *  最后 mature）——否则 "示范/小批量商用" 会被 "商用" 误升为 mature(L-3 修复)。 */
export function maturityTier(m?: string): MaturityTier {
  if (!m) return 'unknown'
  if (/实验|研究|基础|前沿|理论|lab|research|experimental|natural-process/i.test(m)) return 'experimental'
  if (/示范|demo|原型|prototype|小批量|早期商用|emerging/i.test(m)) return 'demonstration'
  if (/商用|commercial|mature|成熟|established|临床|clinical|量产|growth/i.test(m)) return 'mature'
  return 'unknown'
}

const STATUS_RANK: Record<ConsensusStatus, number> = { established: 0, convention: 1, contested: 2, open: 3 }
const RANK_STATUS: ConsensusStatus[] = ['established', 'convention', 'contested', 'open']

export interface ConversionMethod {
  fromForm: string
  toForm: string
  formChain: string[]          // 节点 id 链
  formChainNames: string[]     // 名称链
  hops: OptPath['hops']
  realHops: number
  efficiency: number           // 典型累积效率 ∏η
  usableWorkOut: number        // 㶲(可用功)留存 = ∏η · φ_end
  endGradePhi: number          // 终态㶲品位
  limit: { law: string; lawEn: string; limitEta: number; fraction: number } | null // 距理论上限(瓶颈跳)
  devices: string[]            // 沿路器件类型(去重)
  products: { vendor?: string; model: string; spec?: string }[] // 真实产品型号
  maturity: MaturityTier       // 路径最弱环的成熟度
  consensus: ConsensusStatus   // 路径最"可疑"环的共识状态(established<convention<contested<open)，供 UI 标注
  edgeIds: string[]
}

function toMethod(p: OptPath, from: string, to: string): ConversionMethod {
  const ex = pathExergy(p.hops, formOf)
  const limit = bindingLimit(p.hops.map((h) => ({ edge: h.edge, eff: h.eff })), formOf)
  const devices: string[] = []
  const products: ConversionMethod['products'] = []
  let tier = 3
  let statusRank = 0
  for (const h of p.hops) {
    for (const d of h.edge.device ?? []) if (!devices.includes(d)) devices.push(d)
    for (const pr of h.edge.products ?? []) products.push(pr)
    tier = Math.min(tier, TIER_RANK[maturityTier(h.edge.maturity)])
    statusRank = Math.max(statusRank, STATUS_RANK[h.edge.consensus.status])
  }
  const seq = [p.hops[0].from, ...p.hops.map((h) => h.to)]
  return {
    fromForm: from, toForm: to,
    formChain: seq, formChainNames: seq.map((id) => formName(id)),
    hops: p.hops, realHops: p.realHops,
    efficiency: p.totalEff, usableWorkOut: ex.usableWorkOut, endGradePhi: ex.phiEnd,
    limit, devices, products, maturity: RANK_TIER[tier], consensus: RANK_STATUS[statusRank],
    edgeIds: p.hops.map((h) => h.edge.id),
  }
}

export interface MethodOpts {
  k?: number
  maxHops?: number
  /** 只保留全程成熟/示范的"可落地"方法（剔除纯实验/理论边）。 */
  practicalOnly?: boolean
  /** 排除 consensus 为 contested/open 的边。 */
  excludeDisputed?: boolean
}

function buildFilter(opts: MethodOpts): ((e: ConversionEdge) => boolean) | undefined {
  const preds: ((e: ConversionEdge) => boolean)[] = []
  if (opts.excludeDisputed) preds.push((e) => e.consensus.status !== 'contested' && e.consensus.status !== 'open')
  if (opts.practicalOnly) preds.push((e) => TIER_RANK[maturityTier(e.maturity)] >= TIER_RANK.demonstration)
  return preds.length ? (e) => preds.every((p) => p(e)) : undefined
}

/** 高效率/合理的能源转换方法：from→to 的最优 + K 条次优（按典型累积效率排序，保证全局最优）。
 *  默认 excludeDisputed=true：推荐只给可信(非 contested/open)方法，避免概念/争议边夺冠(L-4)；
 *  传 excludeDisputed:false 可显式纳入前沿/争议方法。每条方法仍透传 consensus 供 UI 标注。 */
export function bestConversionMethods(from: string, to: string, opts: MethodOpts = {}): ConversionMethod[] {
  const excludeDisputed = opts.excludeDisputed ?? true
  const paths = findOptimalPaths(G, from, to, {
    k: opts.k ?? 5, maxHops: opts.maxHops, filter: buildFilter({ ...opts, excludeDisputed }),
  })
  return paths.map((p) => toMethod(p, from, to))
}

/** 单条最优方法（无则 null）。 */
export function topMethod(from: string, to: string, opts: MethodOpts = {}): ConversionMethod | null {
  return bestConversionMethods(from, to, { ...opts, k: 1 })[0] ?? null
}

/** 把单条边包装成 1 跳 ConversionMethod（直接换能器/传感器）。 */
function edgeMethod(e: ConversionEdge): ConversionMethod {
  const eff = effForChain(e)
  const hop = { from: e.from, to: e.to, edge: e, eff }
  const p: OptPath = { hops: [hop], totalEff: eff, totalWeight: -Math.log(Math.max(eff, 1e-12)), realHops: 1 }
  return toMethod(p, formOf(e.from), formOf(e.to))
}

/**
 * Device / edge **physical scale** for sensing UX.
 * Plant/grid generators dominate η-sort and mislead "measure" queries — demote them there.
 * Harvest may still prefer high-η plant machines.
 *
 * Classification order: **transducer tokens first** (so product specs like "mW-class"
 * never flip a piezo into plant), then plant/industrial. Never use case-insensitive
 * bare `MW` — it matches milliwatt `mW` / `μW–mW` in harvester datasheets.
 */
export type TransducerScale = 'plant' | 'industrial' | 'transducer' | 'unknown'

/**
 * Megawatt / grid / utility rotating generation (not a field sensor).
 * Includes wind/hydro power-capture edges that only say 「风机/冲击/贯流」.
 * Deliberately excludes bare 「发电机」 alone (covers 动磁式振动发电机 harvesters).
 */
const PLANT_SCALE_RE =
  /同步发电机|感应发电机|直流发电机|多极永磁同步|主变压器|励磁系统|全功率变流器|直驱主轴|汽轮|水轮|风力机|风机功率|风力发电|风平动动能|冲击\/贯流|冲击式\/贯流|冲击式转轮|贯流式转轮|并网|兆瓦|发电机组|燃气轮机|蒸汽轮机|再生制动|牵引电机|双向变流器|偏航\/变桨|导流与喷管|Haliade|Pelton|bulb\s*turbine|synchronous\s*generator|induction\s*generator|power\s*transformer|wind\s*turbine|grid[- ]?tied|hydroelectric|power\s*plant|utility[- ]?scale/i

/** True megawatt unit only (case-sensitive M so mW / μW–mW do not match). */
const MEGAWATT_UNIT_RE = /(?:^|[\s,;:/(\d])MW(?:e)?(?:\b|级|[-–— ]?class|[-–— ]级)/

/** Transducer / MEMS / sensor-scale — checked BEFORE plant so mW specs stay sensor-class. */
const TRANSDUCER_SCALE_RE =
  /压电|MEMS|微机电|TENG|摩擦电|摩擦纳米|摩擦起电|加速度|应变|拾音|麦克风|换能器|传感器|探头|热电偶|热电堆|热释电|PIR|光电二极|CMUT|piezo|harvester|accelerometer|microphone|strain|thermocouple|photodiode|geiger|闪烁|动磁式振动|摇动手电筒|俘能|能量收集|振动发电|悬臂梁|发电片|叠堆/i

/** Factory motors / large industrial electromechanical (between plant and transducer). */
const INDUSTRIAL_SCALE_RE =
  /伺服电机|工业电机|主轴电机|起重|卷扬|电动汽车驱动|servo\s*motor|traction\s*motor|industrial\s*motor/i

/** Classify a free-text device or edge name blob. */
export function classifyTransducerScale(text: string): TransducerScale {
  if (!text?.trim()) return 'unknown'
  // Transducer first: "mW 级振动取能" must not become plant via MW\b.
  if (TRANSDUCER_SCALE_RE.test(text)) return 'transducer'
  if (PLANT_SCALE_RE.test(text) || MEGAWATT_UNIT_RE.test(text)) return 'plant'
  if (INDUSTRIAL_SCALE_RE.test(text)) return 'industrial'
  return 'unknown'
}

/** Scale of a conversion method from edge name + devices + products. */
export function methodTransducerScale(m: ConversionMethod): TransducerScale {
  const bits: string[] = []
  for (const h of m.hops) {
    bits.push(h.edge.name)
    if (h.edge.nameEn) bits.push(h.edge.nameEn)
    for (const d of h.edge.device ?? []) bits.push(d)
    for (const p of h.edge.products ?? []) {
      if (p.model) bits.push(p.model)
      if (p.vendor) bits.push(p.vendor)
      if (p.spec) bits.push(p.spec)
      // product bilingual specs often carry mW / μW–mW
      const pe = p as { specEn?: string; modelEn?: string }
      if (pe.specEn) bits.push(pe.specEn)
      if (pe.modelEn) bits.push(pe.modelEn)
    }
  }
  bits.push(...m.devices)
  return classifyTransducerScale(bits.join(' | '))
}

/** Higher = better for measure-oriented ranking. */
const SCALE_RANK: Record<TransducerScale, number> = {
  transducer: 3,
  unknown: 1,
  industrial: 0,
  plant: -2,
}

export type SensorsForOpts = MethodOpts & {
  readout?: string
  intent?: 'harvest' | 'measure'
  /**
   * Scale preference for ranking/filter.
   * - `all` (default for plain harvest): pure η — utility generators may lead.
   * - `prefer-transducer` (default for measure **and** self-power harvest): scale first, demote plant.
   * - `transducer`: hard-filter to transducer/harvester-scale only; plant excluded.
   */
  scale?: 'all' | 'prefer-transducer' | 'transducer'
}

/**
 * 面向测量 UX 的输出契约。`readoutForm` 是能量图里的物理出口；`observables`
 * 才是实验者实际读取的量。光学输出可以被眼睛直接观察，也可再接相机/光电探测器数字化，
 * 后者不应被误写成原始换能过程的必经步骤。
 */
export interface SensingOutput {
  id: 'electrical' | 'optical'
  readoutForm: 'electric' | 'electromagnetic'
  label: string
  labelEn: string
  observables: string[]
  observablesEn: string[]
  directReadout: string
  directReadoutEn: string
  optionalAcquisition: string
  optionalAcquisitionEn: string
}

export const SENSING_OUTPUTS: readonly SensingOutput[] = [
  {
    id: 'electrical',
    readoutForm: 'electric',
    label: '电信号',
    labelEn: 'Electrical signal',
    observables: ['电压', '电流', '电荷', '频率/波形'],
    observablesEn: ['voltage', 'current', 'charge', 'frequency / waveform'],
    directReadout: '电表、示波器或采集卡读取',
    directReadoutEn: 'Read with a meter, oscilloscope, or DAQ',
    optionalAcquisition: '模数转换 → 数字结果',
    optionalAcquisitionEn: 'ADC → digital result',
  },
  {
    id: 'optical',
    readoutForm: 'electromagnetic',
    label: '直接光学输出',
    labelEn: 'Direct optical output',
    observables: ['亮度/光强', '颜色', '光谱', '发光寿命', '空间图样'],
    observablesEn: ['brightness / intensity', 'color', 'spectrum', 'lifetime', 'spatial pattern'],
    directReadout: '可直接目视（可见光）或用光学仪器观察',
    directReadoutEn: 'Observe directly (visible light) or with optical instruments',
    optionalAcquisition: '可选：相机/光电探测器 → 电信号 → 数字结果',
    optionalAcquisitionEn: 'Optional: camera / photodetector → electrical signal → digital result',
  },
] as const

export function sensingOutput(id: SensingOutput['id']): SensingOutput {
  return SENSING_OUTPUTS.find((output) => output.id === id) ?? SENSING_OUTPUTS[0]
}

/** Stable deep link from a sensing candidate to its full ontology edge detail. */
export function sensingMethodDetailUrl(method: ConversionMethod): string {
  const edgeId = method.edgeIds[0]
  const query = new URLSearchParams({ node: method.fromForm })
  if (edgeId) query.set('edge', edgeId)
  return `/graph?${query.toString()}`
}

/**
 * 传感/换能：把被测能量形式 stimulus 转成可观察输出（默认电信号）的**直接换能器**。
 * 传感器本质是一步换能(stimulus→readout)，故直接枚举边(stimulus 族→readout 族)而非多跳路径——
 * 既物理正确，也避免多跳搜索的 maxHops 截断。默认**不截断**，保证标志性换能器(如压电)都可见(L-2)。
 * intent：'harvest'(默认)按换能效率排序(取能)；'measure'按尺度→成熟度→效率。
 * 边缘自供电请用 {@link sensorsForSelfPower}（harvest + prefer-transducer）。
 * 注：能量效率 η 不代表测量传感性能；真实选型 FoM(灵敏度/响应度/QE/NEP)待数据接入。
 */
export function sensorsFor(
  stimulus: string,
  opts: SensorsForOpts = {},
): ConversionMethod[] {
  const { readout = 'electric', intent = 'harvest' } = opts
  const scaleMode =
    opts.scale ?? (intent === 'measure' ? 'prefer-transducer' : 'all')
  const stimFam = new Set(G.family.get(stimulus) ?? [stimulus])
  const outFam = new Set(G.family.get(readout) ?? [readout])
  const f = buildFilter(opts)
  let methods = EDGES
    .filter((e) => e.from !== e.to && stimFam.has(e.from) && outFam.has(e.to) && (!f || f(e)))
    .map(edgeMethod)

  if (scaleMode === 'transducer') {
    methods = methods.filter((m) => methodTransducerScale(m) === 'transducer')
  }

  const preferScale =
    scaleMode === 'prefer-transducer' || scaleMode === 'transducer'

  methods.sort((a, b) => {
    if (preferScale) {
      // Scale first: mature plant η must not bury micro-harvesters for edge self-power / measure.
      const ds =
        SCALE_RANK[methodTransducerScale(b)] - SCALE_RANK[methodTransducerScale(a)]
      if (ds !== 0) return ds
    }
    if (intent === 'measure') {
      const dm = TIER_RANK[b.maturity] - TIER_RANK[a.maturity]
      if (dm !== 0) return dm
    }
    // harvest (and measure after maturity): higher η first
    return b.efficiency - a.efficiency
  })
  return opts.k != null ? methods.slice(0, opts.k) : methods
}

/**
 * Edge self-powered node harvest selection: ambient → electric, **harvester-scale first**.
 * Defaults: intent=harvest, scale=prefer-transducer, practicalOnly=true.
 * Plant utility machines stay in the full list when scale is not hard-filtered, but top ranks
 * prefer piezo/TENG/vibration harvesters suitable for µW–mW edge nodes.
 */
export function sensorsForSelfPower(
  stimulus: string,
  opts: Omit<SensorsForOpts, 'intent' | 'scale'> & {
    scale?: SensorsForOpts['scale']
  } = {},
): ConversionMethod[] {
  return sensorsFor(stimulus, {
    practicalOnly: true,
    ...opts,
    intent: 'harvest',
    scale: opts.scale ?? 'prefer-transducer',
  })
}

/** 列出所有顶层能量形式（供 UI 选择被测量/源/目标）。 */
export const ENERGY_FORMS = NODES.filter((n) => !n.parent).map((n) => ({ id: n.id, name: n.name, icon: n.icon }))
