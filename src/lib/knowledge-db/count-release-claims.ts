/**
 * K53: release_claims membership totals (companion to K45 releases totals).
 * Host: GET /api/v1/knowledge/releases/claims/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type ReleaseClaimCounts = {
  /** rows in release_claims */
  total: number
  /** distinct release_id with ≥1 claim */
  distinctReleases: number
  /** distinct claim_id in any release membership */
  distinctClaims: number
}

export function countReleaseClaimsOnDb(db: SqliteDatabase): ReleaseClaimCounts {
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM release_claims`)
    .get() as { c: number }
  const relRow = db
    .prepare(
      `SELECT COUNT(DISTINCT release_id) AS c FROM release_claims`,
    )
    .get() as { c: number }
  const claimRow = db
    .prepare(`SELECT COUNT(DISTINCT claim_id) AS c FROM release_claims`)
    .get() as { c: number }
  return {
    total: Number(totalRow?.c) || 0,
    distinctReleases: Number(relRow?.c) || 0,
    distinctClaims: Number(claimRow?.c) || 0,
  }
}

export function countReleaseClaimsSync(options?: {
  root?: string
  dbPath?: string
}): ReleaseClaimCounts {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countReleaseClaimsOnDb(db)
  } finally {
    db.close()
  }
}
