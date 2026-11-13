/**
 * K13: edge-detail read p95 smoke harness (EPIC #52).
 *
 * Measures the same library path Host uses for
 * `GET /api/v1/knowledge/edges/:id` (open → edge + devices + products +
 * released claims → close) against local SQLite.
 *
 * Budget: docs/knowledge-db.md §7.3 — local SQLite p95 &lt; 50ms.
 * On failure, callers should surface measured p50/p95/max (ms).
 */
import type { ReadDbOptions } from './read.ts'
import { getKnowledgeEdge, listKnowledgeEdges } from './read.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

/** Checklist target for local SQLite edge-detail reads (ms). */
export const EDGE_DETAIL_P95_BUDGET_MS = 50

export type EdgeDetailP95Options = ReadDbOptions & {
  /** Unique edge ids to cycle (default: first page of active edges). */
  edgeIds?: string[]
  /** Timed samples after warmup (default 200). */
  iterations?: number
  /** Untimed warm-up calls (default 20). */
  warmup?: number
  /** Max edges to sample from list when edgeIds omitted (default 40). */
  sampleEdgeCount?: number
  /** Pass when p95 &lt; budget (default EDGE_DETAIL_P95_BUDGET_MS). */
  budgetMs?: number
  /** Embed released claims (Host edge detail default = true). */
  embedReleasedClaims?: boolean
}

export type EdgeDetailP95Report = {
  dbPath: string
  edgeIds: string[]
  iterations: number
  warmup: number
  samplesMs: number[]
  minMs: number
  maxMs: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  budgetMs: number
  /** true when p95Ms &lt; budgetMs */
  pass: boolean
  embedReleasedClaims: boolean
}

/** Nearest-rank percentile on a non-empty ascending array. */
export function percentileNearestRank(
  sortedAsc: readonly number[],
  p: number,
): number {
  if (sortedAsc.length === 0) {
    throw new Error('percentileNearestRank: empty sample')
  }
  if (!Number.isFinite(p) || p <= 0) return sortedAsc[0]!
  if (p >= 100) return sortedAsc[sortedAsc.length - 1]!
  const rank = Math.ceil((p / 100) * sortedAsc.length)
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))
  return sortedAsc[idx]!
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

/**
 * Resolve edge ids for smoke: explicit list, or first page of active edges.
 */
export function resolveSmokeEdgeIds(
  options: ReadDbOptions & { edgeIds?: string[]; sampleEdgeCount?: number },
): string[] {
  if (options.edgeIds && options.edgeIds.length > 0) {
    return [...options.edgeIds]
  }
  const limit = Math.min(
    200,
    Math.max(1, options.sampleEdgeCount ?? 40),
  )
  const page = listKnowledgeEdges(
    { limit, offset: 0, status: 'active' },
    options,
  )
  const ids = page.items.map((e) => e.id)
  if (ids.length === 0) {
    throw new Error(
      'edge-detail-p95-smoke: no active conversion_edges to sample ' +
        `(dbPath=${options.dbPath ?? resolveKnowledgeDbPath(options.root ?? repoRootFromHere())})`,
    )
  }
  return ids
}

/**
 * Run timed `getKnowledgeEdge` samples and report p50/p95 against budget.
 * Does not throw on budget miss — set `pass` false so callers can assert
 * with measured numbers in the failure message.
 */
export function measureEdgeDetailP95(
  options: EdgeDetailP95Options = {},
): EdgeDetailP95Report {
  const root = options.root ?? repoRootFromHere()
  const dbPath = options.dbPath ?? resolveKnowledgeDbPath(root)
  const readOpts: ReadDbOptions = {
    dbPath,
    root,
    readonly: options.readonly !== false,
  }
  const embed = options.embedReleasedClaims !== false
  const iterations = Math.max(1, options.iterations ?? 200)
  const warmup = Math.max(0, options.warmup ?? 20)
  const budgetMs = options.budgetMs ?? EDGE_DETAIL_P95_BUDGET_MS
  const edgeIds = resolveSmokeEdgeIds({
    ...readOpts,
    edgeIds: options.edgeIds,
    sampleEdgeCount: options.sampleEdgeCount,
  })

  const callOnce = (edgeId: string): void => {
    const edge = getKnowledgeEdge(edgeId, {
      ...readOpts,
      embedReleasedClaims: embed,
    })
    if (!edge) {
      throw new Error(`edge-detail-p95-smoke: edge not found: ${edgeId}`)
    }
  }

  for (let i = 0; i < warmup; i++) {
    callOnce(edgeIds[i % edgeIds.length]!)
  }

  const samplesMs: number[] = []
  for (let i = 0; i < iterations; i++) {
    const edgeId = edgeIds[i % edgeIds.length]!
    const t0 = performance.now()
    callOnce(edgeId)
    samplesMs.push(performance.now() - t0)
  }

  const sorted = [...samplesMs].sort((a, b) => a - b)
  const p50Ms = percentileNearestRank(sorted, 50)
  const p95Ms = percentileNearestRank(sorted, 95)
  const minMs = sorted[0]!
  const maxMs = sorted[sorted.length - 1]!
  const meanMs = mean(samplesMs)
  const pass = p95Ms < budgetMs

  return {
    dbPath,
    edgeIds,
    iterations,
    warmup,
    samplesMs,
    minMs,
    maxMs,
    meanMs,
    p50Ms,
    p95Ms,
    budgetMs,
    pass,
    embedReleasedClaims: embed,
  }
}

/** One-line summary for test failures / CI logs. */
export function formatEdgeDetailP95Report(report: EdgeDetailP95Report): string {
  const fmt = (n: number) => n.toFixed(3)
  return (
    `edge-detail p95 smoke: pass=${report.pass} ` +
    `p50=${fmt(report.p50Ms)}ms p95=${fmt(report.p95Ms)}ms ` +
    `max=${fmt(report.maxMs)}ms mean=${fmt(report.meanMs)}ms ` +
    `budget=${report.budgetMs}ms n=${report.iterations} ` +
    `edges=${report.edgeIds.length} embed=${report.embedReleasedClaims} ` +
    `db=${report.dbPath}`
  )
}
