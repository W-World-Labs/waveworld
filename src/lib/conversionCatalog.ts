import { EDGES } from '../data/ontology/edges'
import { NODES } from '../data/ontology/nodes'
import type { ConversionEdge } from '../data/ontology/types'
import { effForChain } from './paths'

const nodeById = new Map(NODES.map((node) => [node.id, node]))
const children = new Map<string, string[]>()
for (const node of NODES) {
  if (!node.parent) continue
  const row = children.get(node.parent) ?? []
  row.push(node.id)
  children.set(node.parent, row)
}

export const ONTOLOGY_ENERGY_FORMS = NODES.filter((node) => !node.parent)

export function topEnergyForm(id: string): string {
  let current = nodeById.get(id)
  const seen = new Set<string>()
  while (current?.parent && !seen.has(current.id)) {
    seen.add(current.id)
    current = nodeById.get(current.parent)
  }
  return current?.id ?? id
}

export function energyFamily(id: string): string[] {
  const result: string[] = []
  const queue = [id]
  const seen = new Set<string>()
  while (queue.length) {
    const current = queue.shift()!
    if (seen.has(current)) continue
    seen.add(current); result.push(current)
    queue.push(...(children.get(current) ?? []))
  }
  return result
}

/** Every ontology edge for a top-level pair; parallel mechanisms are never collapsed. */
export function directConversionEdges(from: string, to: string): ConversionEdge[] {
  return EDGES.filter((edge) => topEnergyForm(edge.from) === from && topEnergyForm(edge.to) === to)
}

export interface CatalogPath {
  edgeIds: string[]
  hops: Array<{ from: string; to: string; edge: ConversionEdge; efficiency: number }>
  totalEfficiency: number
}

export interface CatalogPathResult {
  paths: CatalogPath[]
  /** false means the safety cap was reached; the UI must not claim completeness. */
  complete: boolean
  examined: number
  maxHops: number
}

/**
 * Enumerate edge-distinct, node-simple paths within an explicit hop bound. Unlike the
 * optimization engine, this keeps parallel edges with the same node sequence. Cyclic
 * walks are intentionally excluded: without that rule “all paths” is infinite.
 */
export function enumerateConversionPaths(
  from: string,
  to: string,
  options: { maxHops?: number; safetyCap?: number; includeDirect?: boolean } = {},
): CatalogPathResult {
  const maxHops = Math.min(5, Math.max(1, Math.floor(options.maxHops ?? 3)))
  const safetyCap = Math.min(100_000, Math.max(1, Math.floor(options.safetyCap ?? 100_000)))
  // Catalog mode means “everything explicitly represented in this family”. Unlike an
  // optimizer, it must not silently suppress process-state subforms such as laser/ROS;
  // their prerequisites remain visible on the edge and can be filtered by the caller.
  const starts = energyFamily(from)
  const targets = new Set(energyFamily(to))
  const outgoing = new Map<string, ConversionEdge[]>()
  for (const edge of EDGES) {
    if (edge.from === edge.to) continue
    const row = outgoing.get(edge.from) ?? []
    row.push(edge); outgoing.set(edge.from, row)
  }
  const paths: CatalogPath[] = []
  let examined = 0
  let complete = true
  const visit = (node: string, seen: Set<string>, hops: CatalogPath['hops']): void => {
    if (!complete || hops.length >= maxHops) return
    for (const edge of outgoing.get(node) ?? []) {
      if (seen.has(edge.to)) continue
      examined += 1
      if (examined > safetyCap) { complete = false; return }
      const efficiency = effForChain(edge)
      const next = [...hops, { from: edge.from, to: edge.to, edge, efficiency }]
      if (targets.has(edge.to)) {
        if (options.includeDirect !== false || next.length > 1) {
          paths.push({ edgeIds: next.map((hop) => hop.edge.id), hops: next,
            totalEfficiency: next.reduce((product, hop) => product * hop.efficiency, 1) })
        }
        continue
      }
      const nextSeen = new Set(seen); nextSeen.add(edge.to)
      visit(edge.to, nextSeen, next)
      if (!complete) return
    }
  }
  for (const start of starts) {
    visit(start, new Set([start]), [])
    if (!complete) break
  }
  paths.sort((a, b) => b.totalEfficiency - a.totalEfficiency || a.edgeIds.join('|').localeCompare(b.edgeIds.join('|')))
  return { paths, complete, examined, maxHops }
}
