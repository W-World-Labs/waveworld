/**
 * Legacy residual-laden principle-depth access (kind-* ids, compose KPI nodes).
 * Product UI must use query.ts / PRODUCT_CALCULATION_METHODS instead.
 */
import { explainFormula } from '../formulaExplain'
import type { Locale } from '../i18n/types'
import {
  getLegacyCalculationMethod,
  listLegacyCalculationMethods,
} from './registry'
import {
  filterExplainTree,
  flattenExplainTree,
  groupByLayer,
} from './tree'
import type {
  BuildSessionOptions,
  CalculationMethod,
  ExplainNode,
  MethodExplainBundle,
  ParallelExplainSession,
} from './types'

export function listLegacyMethods(): CalculationMethod[] {
  return listLegacyCalculationMethods()
}

export function getLegacyMethod(id: string): CalculationMethod | undefined {
  return getLegacyCalculationMethod(id)
}

export function getLegacyMethodExplainTree(
  methodId: string,
  opts: {
    layers?: BuildSessionOptions['layers']
    maxDepth?: number
  } = {},
): ExplainNode | null {
  const m = getLegacyCalculationMethod(methodId)
  if (!m) return null
  return filterExplainTree(m.explainRoot, opts)
}

export function buildLegacyParallelExplainSession(
  opts: BuildSessionOptions,
): ParallelExplainSession {
  const layers = opts.layers ?? 'all'
  const includeAll = opts.includeAllSubExplains !== false
  const methods: MethodExplainBundle[] = []

  for (const id of opts.methodIds) {
    const method = getLegacyCalculationMethod(id)
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

export function findLegacyMethodsByLink(opts: {
  jobKind?: string
  simMethodId?: string
}): CalculationMethod[] {
  return listLegacyCalculationMethods().filter((m) => {
    if (opts.jobKind && m.jobKinds?.includes(opts.jobKind)) return true
    if (opts.simMethodId && m.simMethodIds?.includes(opts.simMethodId)) return true
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

export function enrichLegacyWithFormulaViews(
  nodes: Parameters<typeof enrichWithFormulaViewsShim>[0],
  locale: Locale = 'zh',
) {
  return enrichWithFormulaViewsShim(nodes, locale)
}

function enrichWithFormulaViewsShim(
  nodes: { formula?: Parameters<typeof explainFormula>[0]; titleZh: string }[],
  locale: Locale,
) {
  return nodes.map((n) => ({
    ...n,
    formulaView: n.formula ? explainFormula(n.formula, locale) : undefined,
  }))
}
