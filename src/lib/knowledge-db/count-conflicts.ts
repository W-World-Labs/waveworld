/**
 * K40: conflict_sets counts by state (public companion to K31 list).
 * Host: GET /api/v1/knowledge/conflicts/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type ConflictCountsByState = {
  open: number
  resolved: number
  total: number
  other: number
}

export function countConflictsByStateOnDb(db: SqliteDatabase): ConflictCountsByState {
  const rows = db
    .prepare(`SELECT state, COUNT(*) AS c FROM conflict_sets GROUP BY state`)
    .all() as Array<{ state: string; c: number }>

  const out: ConflictCountsByState = {
    open: 0,
    resolved: 0,
    total: 0,
    other: 0,
  }
  for (const r of rows) {
    const n = Number(r.c) || 0
    if (r.state === 'open') out.open = n
    else if (r.state === 'resolved') out.resolved = n
    else out.other += n
  }
  out.total = out.open + out.resolved
  return out
}

export function countConflictsByStateSync(options?: {
  root?: string
  dbPath?: string
}): ConflictCountsByState {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countConflictsByStateOnDb(db)
  } finally {
    db.close()
  }
}
