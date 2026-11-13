// src/lib/graph.ts
import type { EnergyNode, ConversionEdge } from '../data/ontology/types'

export interface Graph {
  nodes: EnergyNode[]
  edges: ConversionEdge[]
  topLevels: EnergyNode[]
  childrenOf: (id: string) => EnergyNode[]
  edgesOf: (id: string) => ConversionEdge[]
  isFilled: (id: string) => boolean // 是否已建样板（有子节点或有关联边）
}

export function buildGraph(nodes: EnergyNode[], edges: ConversionEdge[]): Graph {
  const topLevels = nodes.filter((n) => !n.parent)
  const childIds = (id: string) => nodes.filter((n) => n.parent === id)
  // 某顶层节点"被填充" = 它或其子节点参与了任意一条边
  const subtreeIds = (id: string) => {
    const result = new Set<string>()
    const queue = [id]
    while (queue.length) {
      const current = queue.shift()!
      if (result.has(current)) continue
      result.add(current)
      queue.push(...childIds(current).map((child) => child.id))
    }
    return result
  }
  return {
    nodes,
    edges,
    topLevels,
    childrenOf: childIds,
    edgesOf: (id) => {
      const sub = subtreeIds(id)
      return edges.filter((e) => sub.has(e.from) || sub.has(e.to))
    },
    isFilled: (id) => {
      const sub = subtreeIds(id)
      return childIds(id).length > 0 || edges.some((e) => sub.has(e.from) || sub.has(e.to))
    },
  }
}
