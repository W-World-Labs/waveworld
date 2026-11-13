// 适配层：把 WaveWorld 现有 ontology ConversionEdge 接地到统一模块图（F7 Module）。
// 这样采纳自学术界的统一形式化就建立在**真实数据**之上，而非空类型。
// 能量通道完整接线（现有 229 条边全可转成 Module）；物质/信息通道 schema 就位、待数据接入。

import type { ConversionEdge } from '../../data/ontology/types'
import { EDGES } from '../../data/ontology/edges'
import { NODES } from '../../data/ontology/nodes'
import { domainOf, port, type EnergyDomain, type DomainCell } from './domains'
import { domainCell } from './domains'
import { primitiveSpec, type ComponentRole } from './primitives'
import type { Module, ModuleRole, Procedure } from './module'

const byId = new Map(NODES.map((n) => [n.id, n]))
export const formOf = (id: string): string => byId.get(id)?.parent ?? id

/** 从边推断模块角色（粗启发：to=electric 且非纯 transport→可能是 generator/sensor）。 */
export function inferRole(edge: ConversionEdge): ModuleRole {
  const toForm = formOf(edge.to)
  if (edge.kind === 'transport') return 'generic'
  if (toForm === 'electric' || toForm === 'mechanical') {
    // device 名字提示测量/取能；无 device 字段时默认 generic 换能器
    const dev = (edge.device ?? []).join(' ').toLowerCase()
    if (/传感|sensor|探测器|detector|probe|计$|器$/.test(dev)) return 'sensor'
    return 'generator'
  }
  if (toForm === 'chemical') return 'reactor'
  return 'generic'
}

/** 从边推断 ETP 机理序列（F8 粗启发）。绝大多数单步换能器 = C（跨域能量转换）。 */
export function inferETP(edge: ConversionEdge): Procedure['etp'] {
  const fromD = domainOf(formOf(edge.from)), toD = domainOf(formOf(edge.to))
  if (fromD === toD) return ['M']            // 同域 = 调制（变压器/齿轮）
  return ['C']                                // 跨域 = 能量转换
}

/** 把一条 ConversionEdge 转成统一 Module。 */
export function edgeToModule(edge: ConversionEdge): Module {
  const fromForm = formOf(edge.from), toForm = formOf(edge.to)
  const fromD: EnergyDomain = domainOf(fromForm)
  const toD: EnergyDomain = domainOf(toForm)
  const role = inferRole(edge)
  const etp = inferETP(edge)
  return {
    id: `mod:${edge.id}`,
    name: edge.name,
    role,
    procedures: [{
      id: `proc:${edge.id}`,
      role,
      etp,
      summary: edge.principle,
    }],
    ports: [
      { channel: 'energy', domain: fromD, direction: 'in', powerPort: port(fromD, 'in') },
      { channel: 'energy', domain: toD, direction: 'out', powerPort: port(toD, 'out') },
    ],
    primitive: primitiveSpec(fromD, toD),
    componentRole: 'transducer' as ComponentRole,
    sourceEdgeId: edge.id,
    refs: edge.refs,
  }
}

/** 全量边 → 统一模块目录（编译期固定，单例）。 */
export const MODULES: Module[] = EDGES.map(edgeToModule)
const moduleById = new Map(MODULES.map((m) => [m.id, m]))
export const moduleForEdge = (edgeId: string): Module | undefined => moduleById.get(`mod:${edgeId}`)

// ===== 6×6 域矩阵覆盖（F1）=====

export interface DomainCoverage {
  cell: DomainCell
  count: number
  edgeIds: string[]
}

/** 按 from/to 域聚合边的覆盖（含扩展域行/列）。 */
export function domainMatrix(onlyCore = false): DomainCoverage[] {
  const map = new Map<string, DomainCoverage>()
  for (const e of EDGES) {
    const cell = domainCell(e.from, e.to)
    if (onlyCore) {
      const core = new Set(['mechanical', 'thermal', 'electrical', 'magnetic', 'radiant', 'chemical'])
      if (!core.has(cell.from) || !core.has(cell.to)) continue
    }
    const k = cell.key
    if (!map.has(k)) map.set(k, { cell, count: 0, edgeIds: [] })
    const c = map.get(k)!
    c.count++; c.edgeIds.push(e.id)
  }
  return [...map.values()].sort((a, b) => a.cell.key.localeCompare(b.cell.key))
}

/** 经典六域 6×6 = 36 单元中实际有数据覆盖的单元数（诊断缺口）。 */
export function coreMatrixCoverage(): { filled: number; total: number; missing: string[] } {
  const have = new Set(domainMatrix(true).map((c) => c.cell.key))
  const core: EnergyDomain[] = ['mechanical', 'thermal', 'electrical', 'magnetic', 'radiant', 'chemical']
  const missing: string[] = []
  for (const f of core) for (const t of core) {
    const k = `${f}->${t}`
    if (!have.has(k)) missing.push(k)
  }
  return { filled: 36 - missing.length, total: 36, missing }
}
