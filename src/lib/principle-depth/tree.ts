import type {
  ExplainNode,
  ExplainNodeView,
  PrincipleDepthLayer,
} from './types'
import { PRINCIPLE_DEPTH_LAYERS } from './types'

export function isPrincipleDepthLayer(x: string): x is PrincipleDepthLayer {
  return (PRINCIPLE_DEPTH_LAYERS as readonly string[]).includes(x)
}

/** Depth-first walk with path/depth. */
export function walkExplainTree(
  root: ExplainNode,
  visit: (node: ExplainNode, path: string[], depth: number) => void,
  path: string[] = [],
  depth = 0,
): void {
  const p = [...path, root.titleZh]
  visit(root, p, depth)
  for (const c of root.children ?? []) {
    walkExplainTree(c, visit, p, depth + 1)
  }
}

export function flattenExplainTree(root: ExplainNode): ExplainNodeView[] {
  const out: ExplainNodeView[] = []
  walkExplainTree(root, (node, path, depth) => {
    out.push({ ...node, path, depth })
  })
  return out
}

/**
 * Filter tree to layers / maxDepth. Keeps ancestors if a descendant matches
 * so the user still sees structure when drilling.
 */
export function filterExplainTree(
  root: ExplainNode,
  opts: {
    layers?: PrincipleDepthLayer[] | 'all'
    maxDepth?: number
  } = {},
): ExplainNode {
  const layers = opts.layers ?? 'all'
  const maxDepth = opts.maxDepth
  const layerSet =
    layers === 'all' ? null : new Set<PrincipleDepthLayer>(layers)

  function keepNode(node: ExplainNode, depth: number): boolean {
    if (maxDepth != null && depth > maxDepth) return false
    if (!layerSet) return true
    if (layerSet.has(node.layer)) return true
    return (node.children ?? []).some((c) => keepNode(c, depth + 1))
  }

  function mapNode(node: ExplainNode, depth: number): ExplainNode | null {
    if (maxDepth != null && depth > maxDepth) return null
    const kids = (node.children ?? [])
      .map((c) => mapNode(c, depth + 1))
      .filter((c): c is ExplainNode => c != null)

    const selfOk = !layerSet || layerSet.has(node.layer)
    if (!selfOk && kids.length === 0) return null
    if (!keepNode(node, depth) && kids.length === 0) return null

    return {
      ...node,
      children: kids.length ? kids : undefined,
    }
  }

  const mapped = mapNode(root, 0)
  // Always return at least a stub if filter emptied everything
  return (
    mapped ?? {
      ...root,
      bodyZh: root.bodyZh,
      children: undefined,
    }
  )
}

export function groupByLayer(
  views: ExplainNodeView[],
): Partial<Record<PrincipleDepthLayer, ExplainNodeView[]>> {
  const out: Partial<Record<PrincipleDepthLayer, ExplainNodeView[]>> = {}
  for (const v of views) {
    const list = out[v.layer] ?? []
    list.push(v)
    out[v.layer] = list
  }
  return out
}
