/**
 * K45: knowledge_releases totals (public companion to releases list / K38 q filter).
 * Host: GET /api/v1/knowledge/releases/counts
 *
 * Schema only allows state='released'; split by optional export_relpath.
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type ReleaseCounts = {
  total: number
  /** export_relpath IS NOT NULL AND length > 0 */
  withExport: number
  /** no export path */
  withoutExport: number
}

export function countReleasesOnDb(db: SqliteDatabase): ReleaseCounts {
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM knowledge_releases`)
    .get() as { c: number }
  const withRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM knowledge_releases
       WHERE export_relpath IS NOT NULL AND length(export_relpath) > 0`,
    )
    .get() as { c: number }
  const total = Number(totalRow?.c) || 0
  const withExport = Number(withRow?.c) || 0
  return {
    total,
    withExport,
    withoutExport: total - withExport,
  }
}

export function countReleasesSync(options?: {
  root?: string
  dbPath?: string
}): ReleaseCounts {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countReleasesOnDb(db)
  } finally {
    db.close()
  }
}
