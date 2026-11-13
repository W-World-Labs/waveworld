/**
 * K52: conflict_members membership totals (companion to K40 conflicts by state).
 * Host: GET /api/v1/knowledge/conflicts/members/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type ConflictMemberCounts = {
  /** rows in conflict_members */
  total: number
  /** distinct conflict_id with ≥1 member */
  conflictsWithMembers: number
  /** distinct claim_id appearing in any membership */
  distinctClaims: number
}

export function countConflictMembersOnDb(db: SqliteDatabase): ConflictMemberCounts {
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM conflict_members`)
    .get() as { c: number }
  const confRow = db
    .prepare(
      `SELECT COUNT(DISTINCT conflict_id) AS c FROM conflict_members`,
    )
    .get() as { c: number }
  const claimRow = db
    .prepare(`SELECT COUNT(DISTINCT claim_id) AS c FROM conflict_members`)
    .get() as { c: number }
  return {
    total: Number(totalRow?.c) || 0,
    conflictsWithMembers: Number(confRow?.c) || 0,
    distinctClaims: Number(claimRow?.c) || 0,
  }
}

export function countConflictMembersSync(options?: {
  root?: string
  dbPath?: string
}): ConflictMemberCounts {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countConflictMembersOnDb(db)
  } finally {
    db.close()
  }
}
