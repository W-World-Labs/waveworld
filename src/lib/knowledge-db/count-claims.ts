/**
 * K34: claim counts by lifecycle state (ops companion to K27 list).
 * Host: GET /api/v1/knowledge/claims/counts (registration key).
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export const CLAIM_COUNT_STATES = [
  'candidate',
  'quarantine',
  'validated',
  'released',
] as const

export type ClaimCountState = (typeof CLAIM_COUNT_STATES)[number]

export type ClaimCountsByState = {
  candidate: number
  quarantine: number
  validated: number
  released: number
  /** Sum of known lifecycle buckets (unknown states not included). */
  total: number
  /** Rows whose state is not one of the four lifecycle values. */
  other: number
}

export function countClaimsByStateOnDb(db: SqliteDatabase): ClaimCountsByState {
  const rows = db
    .prepare(
      `SELECT state, COUNT(*) AS c FROM claims GROUP BY state`,
    )
    .all() as Array<{ state: string; c: number }>

  const out: ClaimCountsByState = {
    candidate: 0,
    quarantine: 0,
    validated: 0,
    released: 0,
    total: 0,
    other: 0,
  }
  for (const r of rows) {
    const n = Number(r.c) || 0
    if (r.state === 'candidate') out.candidate = n
    else if (r.state === 'quarantine') out.quarantine = n
    else if (r.state === 'validated') out.validated = n
    else if (r.state === 'released') out.released = n
    else out.other += n
  }
  out.total = out.candidate + out.quarantine + out.validated + out.released
  return out
}

export function countClaimsByStateSync(options?: {
  root?: string
  dbPath?: string
}): ClaimCountsByState {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countClaimsByStateOnDb(db)
  } finally {
    db.close()
  }
}
