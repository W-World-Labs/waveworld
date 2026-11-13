/**
 * K55: release_bindings membership totals (companion to K45/K51/K53).
 * Host: GET /api/v1/knowledge/releases/bindings/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type ReleaseBindingCounts = {
  /** rows in release_bindings */
  total: number
  /** distinct release_id with ≥1 binding */
  distinctReleases: number
  /** distinct binding_id in any release membership */
  distinctBindings: number
}

export function countReleaseBindingsOnDb(
  db: SqliteDatabase,
): ReleaseBindingCounts {
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM release_bindings`)
    .get() as { c: number }
  const relRow = db
    .prepare(
      `SELECT COUNT(DISTINCT release_id) AS c FROM release_bindings`,
    )
    .get() as { c: number }
  const bindRow = db
    .prepare(
      `SELECT COUNT(DISTINCT binding_id) AS c FROM release_bindings`,
    )
    .get() as { c: number }
  return {
    total: Number(totalRow?.c) || 0,
    distinctReleases: Number(relRow?.c) || 0,
    distinctBindings: Number(bindRow?.c) || 0,
  }
}

export function countReleaseBindingsSync(options?: {
  root?: string
  dbPath?: string
}): ReleaseBindingCounts {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countReleaseBindingsOnDb(db)
  } finally {
    db.close()
  }
}
