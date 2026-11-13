// F7 SSN/SOSA 统一模块抽象 + F8 ETP 机理分解 + 三通道(能量/物质/信息)。
// 采纳来源（deep-research wf_f4ad4c5c-d8b，high-confidence 3-0）：
//  - F7 W3C SSN/SOSA：Sensor/Actuator/Sampler 都是同一个 ssn:System 的子类型，每个「implements ≥1 个
//    sosa:Procedure」(2023 版细分为 ObservingProcedure/ActuatingProcedure/SamplingProcedure)。
//    ⇒ 传感器/执行器/采样器/发电机/反应器视为同一种「通用 I/O 模块」，机理是可插拔的 Procedure。
//    源：W3C/OGC SSN/SOSA Recommendation (https://www.w3.org/TR/vocab-ssn/)。
//  - F8 Zook & Schroeder《Sensors as Information Transducers》(arXiv:0804.0814)：每个换能器分解为四个
//    基本转导过程(ETP)的序列：C(energy Conversion 能量转换) / D(energy Dispersion 能量耗散) /
//    M(energy Modulation 能量调制) / P(Modulation of material/physical property 物性调制)。
//    实例：热敏电阻=PM，硅压力传感器=C-PM，摄像机=M-D-D-C。每个 ETP 有自己的传递函数/响应时间/失真。
//    传感=受数据处理不等式约束的信息转导（不能凭空增加信息）。

import type { Port } from './domains'
import type { PrimitiveSpec, ComponentRole } from './primitives'
import type { Conditions } from './conditions'

// ===== F7 模块角色（SSN/SOSA System 子类型 + WaveWorld 扩展 generate/harvest）=====

export type ModuleRole = 'sensor' | 'actuator' | 'sampler' | 'generator' | 'reactor' | 'generic'

export const MODULE_ROLE_LABEL: Record<ModuleRole, string> = {
  sensor: '传感器(测量：stimulus→信息/电信号)', actuator: '执行器(信息/电→对世界做功)',
  sampler: '采样器(取得物质样本)', generator: '发电机/取能(能量收集：source→电/功)',
  reactor: '反应器(物质转化)', generic: '通用换能器',
}

/** SSN/SOSA Procedure：模块实现的机理契约（可复用、与具体模块解耦）。
 *  2023 版按角色细分 ObservingProcedure/ActuatingProcedure/...；此处统一为带 role 的 Procedure。 */
export interface Procedure {
  id: string
  role: ModuleRole
  /** 机理 = ETP 序列（F8）。如 'PM'、'C-PM'、'M-D-D-C'。 */
  etp: ETP[]
  /** 文字描述（自由文本，ETP 的人类可读补充）。 */
  summary?: string
}

// ===== F8 四个基本转导过程 =====

export type ETP = 'C' | 'D' | 'M' | 'P'

export const ETP_LABEL: Record<ETP, string> = {
  C: 'energy Conversion（能量转换：换域，如压电把压转电）',
  D: 'energy Dispersion（能量耗散：如光发散/吸收衰减）',
  M: 'energy Modulation（能量调制：外加能源被被测量调制，如光敏电阻分压）',
  P: 'Property Modulation（物性调制：被测量改变材料物性，如热敏电阻阻值随温变）',
}

/** 把 ETP 序列字符串解析为 ETP 数组。接受带分隔符('M-D-D-C')或连写('PM')两种写法——
 *  每个 ETP 恰好单字母，故按字符解析，过滤掉分隔符与非法字母。 */
export function parseETP(s: string): ETP[] {
  return s.split('').filter((t): t is ETP => t === 'C' || t === 'D' || t === 'M' || t === 'P')
}

// ===== 三通道（能量/物质/信息）—— 模块的 I/O =====

export type Channel = 'energy' | 'matter' | 'information'

export const CHANNEL_LABEL: Record<Channel, string> = {
  energy: '能量', matter: '物质', information: '信息',
}

/** 一个通道端点：通道类型 + 域（能量域/物种/信号域）+ 方向。 */
export interface ChannelPort {
  channel: Channel
  /** 能量通道→EnergyDomain；物质通道→物种 id（见 matter.ts）；信息通道→信号域（stimulus/readout）。 */
  domain: string
  direction: 'in' | 'out'
  /** 能量通道时填（与端口功率共轭对一致）；其它通道为 null。 */
  powerPort?: Port | null
}

// ===== 统一模块（F7 System + F8 Procedure + 三通道 + F6 conditions）=====

/** 通用转换模块：统一传感器/发电机/换能器/反应器。
 *  这是 WaveWorld「站在前人肩上」的核心新颖抽象——把 port-Hamiltonian(能量) +
 *  SSN/SOSA+ETP(信息) + OntoCAPE/OntoRXN(物质) 收进同一个可组合模块类型。 */
export interface Module {
  id: string
  name: string
  role: ModuleRole
  /** 该模块实现的 Procedure（机理契约，SSN/SOSA implements ≥1）。 */
  procedures: Procedure[]
  /** 三通道端口。能量通道的换能由 primitive 刻画（F3）。 */
  ports: ChannelPort[]
  /** 能量通道的二端口原语（F3，仅跨/同域换能器填）。 */
  primitive?: PrimitiveSpec
  /** 键合图组件角色（F5）。 */
  componentRole: ComponentRole
  /** 工况/环境（F6 EPHS，接第一性原理上限）。 */
  conditions?: Conditions
  /** 来源边 id（若由 ontology ConversionEdge 适配而来）。 */
  sourceEdgeId?: string
  refs?: string[]
}

/** 工具：从模块抽出某通道的全部端口。 */
export function portsOfChannel(m: Module, ch: Channel): ChannelPort[] {
  return m.ports.filter((p) => p.channel === ch)
}

/** 工具：模块是否参与某通道。 */
export function hasChannel(m: Module, ch: Channel): boolean {
  return m.ports.some((p) => p.channel === ch)
}

/** 信息通道的测量 FoM 占位（research open question，待数据接入）。
 *  按研究目标指向标准 FoM：responsivity / NEP / D*（光电）、sensitivity/QE。
 *  注：能量 η 不表征测量传感器性能——故 measure 视角不按 η 排序（见 applications.ts sensorsFor）。
 *  定量计算（NEP、D*、BLIP 上限、Landauer、Shannon 容量）见 ./sensing.ts 与 ./information.ts。 */
export interface SensingFoM {
  responsivity?: number   // A/W 或 V/W
  NEP?: number            // W/√Hz 噪声等效功率
  DStar?: number          // Jones (cm·√Hz/W) 比探测率
  sensitivity?: number    // 通用灵敏度（输出/输入）
  QE?: number             // 量子效率（光电器件）
}
