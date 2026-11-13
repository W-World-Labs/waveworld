/**
 * 本体多视图查询：不改 NODES/EDGES 数据本体，只提供「节点 ↔ 元争议」等组装视图。
 * 多学派原则：争议是一等查询结果，不是附属脚注。
 */
import { CONTROVERSIES } from '../data/ontology/controversies'
import type { Controversy } from '../data/ontology/types'

/** 与节点相关的元层争议（relatedNodeIds 命中，或全局 meta 且无绑定）。 */
export function controversiesForNode(nodeId: string): Controversy[] {
  return CONTROVERSIES.filter((c) => {
    const rel = c.relatedNodeIds ?? []
    if (rel.length === 0) return c.layer === 'meta' // 全局元争议对所有人可见时可在专门页展示
    return rel.includes(nodeId)
  })
}

/** 仅返回显式绑定到该节点的争议（不含空 related 的全局 meta）。 */
export function controversiesBoundToNode(nodeId: string): Controversy[] {
  return CONTROVERSIES.filter((c) => (c.relatedNodeIds ?? []).includes(nodeId))
}

export function allControversies(): readonly Controversy[] {
  return CONTROVERSIES
}
