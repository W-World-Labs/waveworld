// F9 OntoCAPE 物质通道本体 + F10 OntoRXN 反应网络 schema（直接 ingest 目标）。
// 采纳来源（deep-research wf_f4ad4c5c-d8b，high-confidence 3-0）：
//  - F9 OntoCAPE (Morbach, Wiesner & Marquardt, Comp. & Chem. Eng. 2009)：过程工程大规模可复用本体，
//    62 子本体分层：上层 mereotopology/systems-theory/quantities-units，下层 materials/chemical-reactions/
//    unit-operations。物质通道从这里借「物种/反应/单元操作」三元概念化。
//  - F10 OntoRXN (Garay-Ruiz & Bo, J. Cheminf. 2022, PMC9153116)：OWl/RDF 反应网络本体，公开可用，
//    有 live Blazegraph SPARQL endpoint，四核心类 CompCalculation/ChemSpecies/NetworkStage/ReactionStep，
//    把反应网络建成无向图——节点/边 schema 与物质转换模块图 1:1 同构，是直接 ingest 目标。
//    仓库：https://gitlab.com/dwarayr/ontorxn （取自论文证据）。

import type { ModuleRole } from './module'

// ===== F9 OntoCAPE 概念化：物质 / 反应 / 单元操作 =====

/** 化学物种（OntoCAPE materials 层）。 */
export interface ChemSpecies {
  id: string
  name: string
  formula?: string             // 分子式
  /** 标准生成性质（待数据接入；缺省不参与定量）。 */
  dGf?: number                 // J/mol 标准生成 Gibbs 能（化学㶲）
  dHf?: number                 // J/mol 标准生成焓
  charge?: number              // 电荷数（电荷守恒用）
  refs?: string[]
}

/** 化学反应（OntoCAPE chemical-reactions 层）：反应物→产物的化学计量关系。
 *  守恒律：原子守恒(mass-stoichiometry) + 电荷守恒(charge)——与 physics/conversion.ts 一致声明。 */
export interface ChemicalReaction {
  id: string
  name: string
  /** 反应物与产物（物种 id + 化学计量系数，负=消耗/正=生成）。 */
  stoichiometry: Record<string, number>
  dG?: number                  // J/mol 反应 Gibbs 自由能变（决定自发性/化学㶲）
  dH?: number                  // J/mol 反应焓变
  /** 该反应需守恒的律（框架声明；具体校验待计量数据）。 */
  conserves: Array<'mass-stoichiometry' | 'charge' | 'atom'>
  conditions?: { T?: number; p?: number; catalyst?: string }
  refs?: string[]
}

/** 单元操作（OntoCAPE unit-operations 层）：反应器/分离器/换热器等过程单元。
 *  过程系统工程(flowsheet)的基本积木。 */
export interface UnitOperation {
  id: string
  name: string
  kind: 'reactor' | 'separator' | 'heat-exchanger' | 'mixer' | 'pump' | 'other'
  /** 该单元实现的过程机理（可挂 ETP/Procedure 或反应 id）。 */
  implements?: string[]
  refs?: string[]
}

// ===== F10 OntoRXN 四核心类（ingest-ready schema） =====

/** OntoRXN CompCalculation：计算化学数据存储（Gaussian/ADF/VASP/ORCA 等解析结果）。 */
export interface CompCalculation {
  id: string
  method?: string              // DFT/HF/CCSD… / 程序 Gaussian/ORCA…
  energy?: number              // Hartree（总电子能）
  speciesId?: string           // 关联的 ChemSpecies
  source?: string              // ioChem-BD / OntoCompChem 入口
}

/** OntoRXN ChemSpecies：分子**与**反应中间体（过渡态）。复用上面 F9 的 ChemSpecies，
 *  OntoRXN 额外区分 isTransient（过渡态 vs 稳定分子）。 */
export interface OntoRXNSpecies extends ChemSpecies {
  isTransient?: boolean        // true=过渡态/中间体
  calc?: CompCalculation       // 量化数据
}

/** OntoRXN NetworkStage：反应网络的「阶段/层级」节点——把反应分阶段组织。 */
export interface NetworkStage {
  id: string
  label: string
  /** 进入/离开本阶段的物种（无向图边界）。 */
  speciesIn: string[]
  speciesOut: string[]
}

/** OntoRXN ReactionStep：物种↔物种 的反应步骤（无向边，不预设方向）。
 *  与 WaveWorld ConversionEdge 同构：from/to 物种 + 计量/能量。 */
export interface ReactionStep {
  id: string
  from: string                 // ChemSpecies id
  to: string                   // ChemSpecies id（产物之一；多产物按多步或多计量记录）
  reactionId?: string          // 关联 F9 ChemicalReaction（守恒/能量）
  undirected: true             // OntoRXN 约定：不假设遍历方向
  barrier?: number             // J/mol 活化能（过渡态）
}

/** OntoRXN 反应网络（整体）：四核心类的聚合容器，可直接 ingest 自其 SPARQL endpoint。 */
export interface OntoRXNNetwork {
  calculations: CompCalculation[]
  species: OntoRXNSpecies[]
  stages: NetworkStage[]
  steps: ReactionStep[]
  /** 来源 SPARQL endpoint / GitLab 快照。 */
  source?: string
}

/** 把 OntoRXN 物质网络转成统一模块（物质通道模块）的辅助契约。
 *  每条 ReactionStep → 一个 reactor 模块（物质 in→out），能量/信息通道待数据补。 */
export interface MatterModuleHint {
  role: Extract<ModuleRole, 'reactor'>
  fromSpecies: string
  toSpecies: string
  reactionId?: string
  conditions?: ChemicalReaction['conditions']
}
