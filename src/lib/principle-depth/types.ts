/**
 * Principle-depth explain model (tech-tree drill-down).
 *
 * User product needs:
 * - Top method A can open deeper principle layers B, C, …
 * - Select any calculation method(s) in parallel
 * - Select any explanation depth layer(s)
 * - See every nested sub-explanation under those choices
 *
 * Does not replace formulaExplain (single formula view) or solvers (numerical).
 * This is the **navigation + multi-method multi-depth explain** plane.
 */

import type { FormulaWithPlain } from '../formulaExplain'

/** Product-facing depth labels (align with coverage + loop depth_layer). */
export type PrincipleDepthLayer =
  | 'product' // product presentation
  | 'method' // calculation method A (entry)
  | 'principle' // mid principles supporting A
  | 'foundation' // deeper primitives (const, SI, assumptions)
  | 'L0' // teaching leaf (Atlas sim)
  | 'smoke' // tiny numerical path
  | 'engineering' // w-sim kind / HQ engineering
  | 'compose' // B∘C reconstitutes A

export const PRINCIPLE_DEPTH_LAYERS: readonly PrincipleDepthLayer[] = [
  'product',
  'method',
  'principle',
  'foundation',
  'L0',
  'smoke',
  'engineering',
  'compose',
] as const

/** One explanation node; children = deeper sub-explanations. */
export interface ExplainNode {
  id: string
  layer: PrincipleDepthLayer
  titleZh: string
  titleEn?: string
  bodyZh: string
  bodyEn?: string
  /** Optional executable formula (uses formulaExplain for rendering). */
  formula?: FormulaWithPlain
  /** Optional links into other registries. */
  simMethodIds?: string[]
  jobKinds?: string[]
  claimKinds?: string[]
  children?: ExplainNode[]
}

/** A selectable calculation method (top or mid entry on the tech tree). */
export interface CalculationMethod {
  id: string
  titleZh: string
  titleEn?: string
  /** Primary layer of this entry (usually method or engineering). */
  layer: PrincipleDepthLayer
  summaryZh: string
  summaryEn?: string
  simMethodIds?: string[]
  jobKinds?: string[]
  /** Root of the explain tree (typically layer=method). */
  explainRoot: ExplainNode
}

export interface ExplainNodeView extends ExplainNode {
  /** Path of titles from method root to this node. */
  path: string[]
  depth: number
}

export interface MethodExplainBundle {
  method: CalculationMethod
  /** Filtered tree (by layer set / maxDepth). */
  tree: ExplainNode
  /** All nodes in filtered tree (for “see every sub-explain”). */
  allExplains: ExplainNodeView[]
}

/** Parallel multi-method session for UI. */
export interface ParallelExplainSession {
  methodIds: string[]
  layers: PrincipleDepthLayer[] | 'all'
  methods: MethodExplainBundle[]
  /** Cross-cut: all selected explains grouped by layer. */
  byLayer: Partial<Record<PrincipleDepthLayer, ExplainNodeView[]>>
  /** Flat union of all sub-explains across methods. */
  allSubExplains: ExplainNodeView[]
}

export interface BuildSessionOptions {
  /** One or more method ids (parallel). */
  methodIds: string[]
  /**
   * Which layers to include. Omit or 'all' = every layer under each method.
   * User can pick any subset (e.g. only foundation + principle).
   */
  layers?: PrincipleDepthLayer[] | 'all'
  /** Max tree depth from method root (0 = root only). Default unlimited. */
  maxDepth?: number
  /**
   * When true (default), include every descendant sub-explain in allExplains.
   * When false, only nodes whose layer is in `layers`.
   */
  includeAllSubExplains?: boolean
}
