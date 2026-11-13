/**
 * K54: release_snapshots membership totals (companion to K45/K53).
 * Host: GET /api/v1/knowledge/releases/snapshots/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type ReleaseSnapshotCounts = {
  /** rows in release_snapshots */
  total: number
  /** distinct release_id with ≥1 snapshot */
  distinctReleases: number
  /** distinct source_snapshot_id in any release membership */
  distinctSnapshots: number
}

export function countReleaseSnapshotsOnDb(
  db: SqliteDatabase,
): ReleaseSnapshotCounts {
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM release_snapshots`)
    .get() as { c: number }
  const relRow = db
    .prepare(
      `SELECT COUNT(DISTINCT release_id) AS c FROM release_snapshots`,
    )
    .get() as { c: number }
  const snapRow = db
    .prepare(
      `SELECT COUNT(DISTINCT source_snapshot_id) AS c FROM release_snapshots`,
    )
    .get() as { c: number }
  return {
    total: Number(totalRow?.c) || 0,
    distinctReleases: Number(relRow?.c) || 0,
    distinctSnapshots: Number(snapRow?.c) || 0,
  }
}

export function countReleaseSnapshotsSync(options?: {
  root?: string
  dbPath?: string
}): ReleaseSnapshotCounts {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countReleaseSnapshotsOnDb(db)
  } finally {
    db.close()
  }
}
