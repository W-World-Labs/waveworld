/**
 * K43: energy_nodes counts by parent presence (public companion to K36 parent filter).
 * Host: GET /api/v1/knowledge/nodes/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type NodeCountsByParent = {
  /** parent_id IS NULL */
  roots: number
  /** parent_id IS NOT NULL */
  children: number
  total: number
}

export function countNodesByParentOnDb(db: SqliteDatabase): NodeCountsByParent {
  const rootsRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM energy_nodes WHERE parent_id IS NULL`,
    )
    .get() as { c: number }
  const childrenRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM energy_nodes WHERE parent_id IS NOT NULL`,
    )
    .get() as { c: number }
  const roots = Number(rootsRow?.c) || 0
  const children = Number(childrenRow?.c) || 0
  return {
    roots,
    children,
    total: roots + children,
  }
}

export function countNodesByParentSync(options?: {
  root?: string
  dbPath?: string
}): NodeCountsByParent {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countNodesByParentOnDb(db)
  } finally {
    db.close()
  }
}
