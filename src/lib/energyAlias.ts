/**
 * 能量形式双轨别名（KUX 靶 A）。
 *
 * - ontology 轨：src/data/ontology（id 如 electric）
 * - conversions 轨：src/data/conversions.json（key 如 electrical）
 *
 * 禁止 silent merge 两套 id；仅提供对照 + 统一「给人看的名字」。
 * 主 UI 应使用 energyDisplayName，不要把 raw id 当主文案。
 */
import { energyType } from '../data/conversions'
import { NODES } from '../data/ontology/nodes'

/** conversions.json energy_types key → 本体顶层 node id（显式对照，非合并）。 */
export const CONVERSIONS_TO_ONTOLOGY: Readonly<Record<string, string>> = {
  electromagnetic: 'electromagnetic',
  mechanical: 'mechanical',
  thermal: 'thermal',
  chemical: 'chemical',
  electrical: 'electric',
  acoustic: 'acoustic',
}

/** 本体顶层 id → conversions key（仅有工程目录条目的那些）。 */
export const ONTOLOGY_TO_CONVERSIONS: Readonly<Record<string, string>> = (() => {
  const m: Record<string, string> = {}
  for (const [conv, ont] of Object.entries(CONVERSIONS_TO_ONTOLOGY)) {
    m[ont] = conv
  }
  return m
})()

const nodeById = new Map(NODES.map((n) => [n.id, n]))

/** 任意轨 id → 本体 id（若可解析）。 */
export function toOntologyId(id: string): string | undefined {
  if (nodeById.has(id)) return id
  if (id in CONVERSIONS_TO_ONTOLOGY) return CONVERSIONS_TO_ONTOLOGY[id]
  return undefined
}

/** 任意轨 id → conversions key（若工程目录有对应）。 */
export function toConversionsId(id: string): string | undefined {
  if (id in CONVERSIONS_TO_ONTOLOGY) return id
  if (id in ONTOLOGY_TO_CONVERSIONS) return ONTOLOGY_TO_CONVERSIONS[id]
  return undefined
}

/** 两 id 是否表示同一能量大类（经别名对照后）。 */
export function sameEnergyForm(a: string, b: string): boolean {
  const oa = toOntologyId(a) ?? a
  const ob = toOntologyId(b) ?? b
  return oa === ob
}

/**
 * 给人看的展示名。解析顺序：本体节点 → 别名映射到本体 → conversions 类型。
 * locale=en 时优先 nameEn；仍未知时返回本地化「未命名」（raw id 不进主文案）。
 */
export function energyDisplayName(id: string, locale: 'zh' | 'en' = 'zh'): string {
  const pick = (zh: string, en?: string) =>
    locale === 'en' && en?.trim() ? en.trim() : zh

  const fromNode = (nid: string): string | undefined => {
    const n = nodeById.get(nid)
    return n?.name ? pick(n.name, n.nameEn) : undefined
  }

  const direct = fromNode(id)
  if (direct) return direct

  // Prefer ontology alias (e.g. electrical → electric) before conversions zh-only names
  const ont = toOntologyId(id)
  if (ont && ont !== id) {
    const via = fromNode(ont)
    if (via) return via
  }

  const et = energyType(id)
  if (et?.name) return pick(et.name, et.nameEn)

  const conv = toConversionsId(id)
  if (conv && conv !== id) {
    const et2 = energyType(conv)
    if (et2?.name) return pick(et2.name, et2.nameEn)
  }

  return locale === 'en' ? 'Unnamed energy form' : '未命名能量形式'
}

/** 图标：本体优先，其次 conversions。 */
export function energyDisplayIcon(id: string): string | undefined {
  const n = nodeById.get(id)
  if (n?.icon) return n.icon
  const et = energyType(id)
  if (et?.icon) return et.icon
  const ont = toOntologyId(id)
  if (ont) {
    const n2 = nodeById.get(ont)
    if (n2?.icon) return n2.icon
  }
  const conv = toConversionsId(id)
  if (conv) return energyType(conv)?.icon
  return undefined
}

/** 开发/脚注用：展示「中文名（轨:id）」，主 UI 慎用。 */
export function energyDisplayNameWithTrack(id: string): string {
  const name = energyDisplayName(id)
  const track = nodeById.has(id)
    ? 'ontology'
    : id in CONVERSIONS_TO_ONTOLOGY
      ? 'conversions'
      : 'unknown'
  return `${name}（${track}:${id}）`
}

/** 工程目录 key 对应的本体中文名（双轨说明条用）。 */
export function ontologyLabelForConversionsKey(
  key: string,
  locale: 'zh' | 'en' = 'zh',
): string {
  const ont = CONVERSIONS_TO_ONTOLOGY[key]
  if (!ont) return energyDisplayName(key, locale)
  return energyDisplayName(ont, locale)
}
