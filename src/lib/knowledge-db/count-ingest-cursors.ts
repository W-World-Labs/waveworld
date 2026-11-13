/**
 * K60: ingest_cursors totals (companion to K5 cursor store).
 * Host: GET /api/v1/knowledge/ingest-cursors/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type IngestCursorCounts = {
  total: number
  /** cursor IS NOT NULL AND length > 0 */
  withCursor: number
  /** empty / null cursor */
  withoutCursor: number
}

export function countIngestCursorsOnDb(db: SqliteDatabase): IngestCursorCounts {
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM ingest_cursors`)
    .get() as { c: number }
  const withRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ingest_cursors
       WHERE cursor IS NOT NULL AND length(cursor) > 0`,
    )
    .get() as { c: number }
  const total = Number(totalRow?.c) || 0
  const withCursor = Number(withRow?.c) || 0
  return {
    total,
    withCursor,
    withoutCursor: total - withCursor,
  }
}

export function countIngestCursorsSync(options?: {
  root?: string
  dbPath?: string
}): IngestCursorCounts {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countIngestCursorsOnDb(db)
  } finally {
    db.close()
  }
}
