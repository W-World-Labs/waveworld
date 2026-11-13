/**
 * K32: get a single claim by id (ops companion to K27 list + K26 promote).
 * Host: GET /api/v1/knowledge/claims/:id (registration key).
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import {
  listClaimsOnDb,
  type KnowledgeClaimListItem,
} from './list-claims.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type GetClaimResult = {
  item: KnowledgeClaimListItem
}

/**
 * Return one claim by primary key, or null if missing.
 * Uses the same DTO shape as listClaims (statement parsed).
 */
export function getClaimOnDb(
  db: SqliteDatabase,
  claimId: string,
): KnowledgeClaimListItem | null {
  const id = claimId.trim()
  if (!id) return null
  // Reuse list path with exact id match via LIKE would be wrong; query by id.
  const row = db
    .prepare(
      `SELECT id, kind, subject_id, state, confidence, created_at, updated_at, statement_json
       FROM claims WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string
        kind: string
        subject_id: string
        state: string
        confidence: number | null
        created_at: string
        updated_at: string | null
        statement_json: string
      }
    | undefined
  if (!row) return null
  let statement: Record<string, unknown> | null = null
  try {
    const parsed = JSON.parse(row.statement_json)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      statement = parsed as Record<string, unknown>
    }
  } catch {
    statement = null
  }
  return {
    id: row.id,
    kind: row.kind,
    subjectId: row.subject_id,
    state: row.state,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    statement,
  }
}

export function getClaimSync(
  claimId: string,
  options?: { root?: string; dbPath?: string },
): KnowledgeClaimListItem | null {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return getClaimOnDb(db, claimId)
  } finally {
    db.close()
  }
}

/** @internal test helper — ensure list path stays compatible */
export function getClaimMatchesListShape(
  db: SqliteDatabase,
  claimId: string,
): boolean {
  const one = getClaimOnDb(db, claimId)
  if (!one) return false
  const listed = listClaimsOnDb(db, { state: 'all', q: claimId, limit: 50 })
  const fromList = listed.items.find((c) => c.id === claimId)
  if (!fromList) return false
  return (
    fromList.kind === one.kind &&
    fromList.subjectId === one.subjectId &&
    fromList.state === one.state
  )
}
