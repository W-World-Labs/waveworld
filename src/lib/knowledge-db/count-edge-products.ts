/**
 * K58: edge_products totals (companion to edges / devices).
 * Host: GET /api/v1/knowledge/edges/products/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type EdgeProductCounts = {
  total: number
  /** distinct edge_id with ≥1 product */
  distinctEdges: number
}

export function countEdgeProductsOnDb(db: SqliteDatabase): EdgeProductCounts {
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM edge_products`)
    .get() as { c: number }
  const edgeRow = db
    .prepare(`SELECT COUNT(DISTINCT edge_id) AS c FROM edge_products`)
    .get() as { c: number }
  return {
    total: Number(totalRow?.c) || 0,
    distinctEdges: Number(edgeRow?.c) || 0,
  }
}

export function countEdgeProductsSync(options?: {
  root?: string
  dbPath?: string
}): EdgeProductCounts {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countEdgeProductsOnDb(db)
  } finally {
    db.close()
  }
}
