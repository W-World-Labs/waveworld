// 现成本体/标准/数据源的采纳笔记与 ingest 指针（claim-group 4/20/23 + 数据源）。
// 不是运行时逻辑，而是「该采纳什么、不采纳什么、从哪 ingest」的可机读清单 + 关键词汇表，
// 把 deep-research 的 caveats（哪些本轮核实了、哪些没核实）固化进代码，避免下次又「闭门造车」。

// ===== SAREF / SAREF4ENER（claim-group 20）=====
// ETSI OWL-DL 本体，TS 103 410-1 v2.1.1，能源灵活性/需求侧管理。
// 多序列化：JSON-LD/N3/N-Triples/RDF/XML/Turtle，namespace https://saref.etsi.org/saref4ener/。
// **采纳决策**：借其「能量条件/约束词汇」（PowerLimit 族 + 时间约束 + PowerEnvelope），
//  **不**采纳其设备模型——SAREF 显式「不」按端口/I-O 通道建模，而用 profile(FlexibilityProfile/PowerProfile/
//  PowerSequence) 暴露能力；我们的统一模块图已用 port-Hamiltonian 端口 + SSN/SOSA System，比 SAREF profile 更通用，
//  故 SAREF 只在 conditions 的「功率/时间约束」面被复用。

export type PowerLimitKind =
  | 'contractual' | 'nominal' | 'failsafe'   // s4ener:ContractualPowerLimit / Nominal / Failsafe

/** SAREF4ENER 风格的功率约束（借作词汇，挂到模块 conditions 的「调度/柔性」面）。 */
export interface SarefPowerConstraint {
  kind: PowerLimitKind
  powerW: number                  // 功率上限 W
  startStep?: number              // hasStartTime（离散时间块）
  endStep?: number                // hasEndTime
  earliestStart?: number          // hasEarliestStartTime
  latestEnd?: number              // hasLatestEndTime
}

/** 校验某时段功率是否落在约束信封内（PowerEnvelope / PowerConstraint 的语义）。 */
export function powerWithinConstraint(p: {
  powerW: number; step: number
}, c: SarefPowerConstraint): boolean {
  if (c.startStep != null && c.endStep != null) {
    if (p.step < c.startStep || p.step > c.endStep) return true   // 时段外不受此约束
  }
  return p.powerW <= c.powerW + 1e-9
}

// ===== EMMO 生态（claim-group 23，经 BTO 验证）=====
// EMMO = 欧洲材料建模本体，分 upper/domain/application 三层。
// BTO（Battery Testing Ontology）在 application 层，reuses EMMO/CHAMEO/BDO/EDO，
// 全 RDF/RDFS/OWL：每个实体 owl:Class、关系 owl:ObjectProperty；GitHub .ttl 公开；StarDog 7+ SPARQL 可查。
// **采纳决策**：EMMO 给我们「分层 upper/domain/application + RDF/OWL ingest 模式」的模板——
//  WaveWorld module-graph 可镜像此分层（domains/primitives=upper，module/conditions=domain，adapter=application）。
//  具体电池/电化学数据 ingest 走 BDO/EDO，不是本层职责。

export const EMMO_ECOSYSTEM = {
  pattern: 'owl:Class(实体) + owl:ObjectProperty(关系)，RDF 三元组，SPARQL 可查',
  layers: ['upper (EMMO: mereotopology/physics)', 'domain (BDO/EDO/CHAMEO)', 'application (BTO)'],
  ingestTargets: [
    { name: 'EMMO', type: 'OWL', url: 'https://github.com/emmo-repo/EMMO', verified: true },
    { name: 'BTO', type: 'OWL (.ttl)', url: 'https://github.com/emmo-repo/battery-testing-ontology', verified: true },
    { name: 'CHAMEO', type: 'OWL', url: 'https://github.com/emmo-repo/CHAMEO', verified: true },
  ],
} as const

// ===== 数据源指针（deep-research caveats：以下本轮未核实，仅作 ingest 候选登记）=====

export interface DataSourcePointer {
  name: string
  domain: 'thermochemistry' | 'device-efficiency' | 'reaction-network' | 'sensor-FoM' | 'systems-engineering'
  access: string                 // URL / SPARQL endpoint / API
  format: string                 // RDF/OWL / SQL / JSON / CSV
  verified: boolean              // 本轮是否经 deep-research 核实
  note: string
}

export const DATA_SOURCES: DataSourcePointer[] = [
  { name: 'OntoRXN', domain: 'reaction-network', access: 'https://gitlab.com/dwarayr/ontorxn + Blazegraph SPARQL',
    format: 'OWL/RDF', verified: true, note: '反应网络四核心类，本轮核实(claim-group 12/68)' },
  { name: 'SAREF4ENER', domain: 'systems-engineering', access: 'https://saref.etsi.org/saref4ener/v2.1.1/',
    format: 'OWL-DL (JSON-LD/Turtle/N3/RDF/XML/N-Triples)', verified: true, note: '功率约束词汇，本轮核实(claim-group 20)' },
  { name: 'EMMO', domain: 'systems-engineering', access: 'https://github.com/emmo-repo',
    format: 'OWL', verified: true, note: '材料建模上层本体，本轮核实(claim-group 23)' },
  { name: 'NIST thermochemistry (WebBook)', domain: 'thermochemistry', access: 'https://webbook.nist.gov/chemistry/',
    format: 'JSON/HTML', verified: false, note: '本轮未核实；ΔG/ΔH/Cp 经验数据候选 ingest 源' },
  { name: 'NREL device efficiency', domain: 'device-efficiency', access: 'https://www.nrel.gov/',
    format: 'CSV/JSON(待确认)', verified: false, note: '本轮未核实；光伏/电池效率记录冠军-cell 数据候选' },
  { name: 'SysML', domain: 'systems-engineering', access: 'https://www.omg.org/spec/SysML/',
    format: 'XMI', verified: false, note: '本轮未核实；Block/Port/FlowSpec 形式化，与 pH 端口近似——待核实是否值得采纳' },
  { name: 'Aspen/DWSIM flowsheet', domain: 'systems-engineering', access: ' proprietary / https://dwsim.org',
    format: '专有/XML', verified: false, note: '本轮未核实；过程 flowsheet 工具，OntoCAPE 已给概念层(claim-group 70)' },
]
