import { explainFormula } from '../formulaExplain'
import type { Locale } from '../i18n/types'
import { getCalculationMethod, listCalculationMethods } from './registry'
import {
  filterExplainTree,
  flattenExplainTree,
  groupByLayer,
} from './tree'
import type {
  BuildSessionOptions,
  CalculationMethod,
  ExplainNode,
  ExplainNodeView,
  MethodExplainBundle,
  ParallelExplainSession,
  PrincipleDepthLayer,
} from './types'

export function listMethods(): CalculationMethod[] {
  return listCalculationMethods()
}

export function getMethod(id: string): CalculationMethod | undefined {
  return getCalculationMethod(id)
}

/** Filtered explain tree for one method. */
export function getMethodExplainTree(
  methodId: string,
  opts: {
    layers?: PrincipleDepthLayer[] | 'all'
    maxDepth?: number
  } = {},
): ExplainNode | null {
  const m = getCalculationMethod(methodId)
  if (!m) return null
  return filterExplainTree(m.explainRoot, opts)
}

/**
 * Parallel multi-method + multi-layer explain session.
 * - methodIds: any set of methods at once
 * - layers: any subset of depths (or all)
 * - allSubExplains: every nested node under the filter (default)
 */
export function buildParallelExplainSession(
  opts: BuildSessionOptions,
): ParallelExplainSession {
  const layers = opts.layers ?? 'all'
  const includeAll = opts.includeAllSubExplains !== false
  const methods: MethodExplainBundle[] = []

  for (const id of opts.methodIds) {
    const method = getCalculationMethod(id)
    if (!method) continue
    const tree = filterExplainTree(method.explainRoot, {
      layers,
      maxDepth: opts.maxDepth,
    })
    let allExplains = flattenExplainTree(tree)
    if (!includeAll && layers !== 'all') {
      const set = new Set(layers)
      allExplains = allExplains.filter((n) => set.has(n.layer))
    }
    methods.push({ method, tree, allExplains })
  }

  const allSubExplains = methods.flatMap((m) =>
    m.allExplains.map((n) => ({
      ...n,
      // prefix path with method title for cross-method lists
      path: [m.method.titleZh, ...n.path.slice(1)],
    })),
  )

  return {
    methodIds: methods.map((m) => m.method.id),
    layers,
    methods,
    byLayer: groupByLayer(allSubExplains),
    allSubExplains,
  }
}

/** Attach formulaExplain views for nodes that carry formulas. */
export function enrichWithFormulaViews(
  nodes: ExplainNodeView[],
  locale: Locale = 'zh',
) {
  return nodes.map((n) => ({
    ...n,
    formulaView: n.formula ? explainFormula(n.formula, locale) : undefined,
  }))
}

/** Lookup methods that advertise a job kind or sim method id. */
export function findMethodsByLink(opts: {
  jobKind?: string
  simMethodId?: string
}): CalculationMethod[] {
  return listCalculationMethods().filter((m) => {
    if (opts.jobKind && m.jobKinds?.includes(opts.jobKind)) return true
    if (opts.simMethodId && m.simMethodIds?.includes(opts.simMethodId)) return true
    // also search tree
    let hit = false
    const walk = (node: ExplainNode) => {
      if (opts.jobKind && node.jobKinds?.includes(opts.jobKind)) hit = true
      if (opts.simMethodId && node.simMethodIds?.includes(opts.simMethodId)) hit = true
      for (const c of node.children ?? []) walk(c)
    }
    walk(m.explainRoot)
    return hit
  })
}
