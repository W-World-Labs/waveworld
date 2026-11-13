/**
 * K56: release_conflicts membership totals.
 * Host: GET /api/v1/knowledge/releases/conflicts/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type ReleaseConflictCounts = {
  total: number
  distinctReleases: number
  distinctConflicts: number
}

export function countReleaseConflictsOnDb(db: SqliteDatabase): ReleaseConflictCounts {
  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM release_conflicts`).get() as { c: number }
  const relRow = db.prepare(`SELECT COUNT(DISTINCT release_id) AS c FROM release_conflicts`).get() as { c: number }
  const confRow = db.prepare(`SELECT COUNT(DISTINCT conflict_id) AS c FROM release_conflicts`).get() as { c: number }
  return {
    total: Number(totalRow?.c) || 0,
    distinctReleases: Number(relRow?.c) || 0,
    distinctConflicts: Number(confRow?.c) || 0,
  }
}

export function countReleaseConflictsSync(options?: { root?: string; dbPath?: string }): ReleaseConflictCounts {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countReleaseConflictsOnDb(db)
  } finally {
    db.close()
  }
}
