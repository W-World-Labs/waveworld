/**
 * K27: list claims by lifecycle state (write-path companion for K26 promote).
 * Public defaults still omit candidates from Atlas; this read is for ops/host
 * tooling and is intended behind registration key on the Host route.
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export const CLAIM_LIST_STATES = [
  'candidate',
  'quarantine',
  'validated',
  'released',
  'all',
] as const

export type ClaimListState = (typeof CLAIM_LIST_STATES)[number]

export type KnowledgeClaimListItem = {
  id: string
  kind: string
  subjectId: string
  state: string
  confidence: number | null
  createdAt: string
  updatedAt: string | null
  /** Parsed statement JSON when parseable; else null. */
  statement: Record<string, unknown> | null
}

export type ListClaimsQuery = {
  state?: ClaimListState
  kind?: string
  subjectId?: string
  q?: string
  limit?: number
  offset?: number
}

export type ListClaimsResult = {
  items: KnowledgeClaimListItem[]
  total: number
  limit: number
  offset: number
  state: ClaimListState
}

function clampLimit(n?: number): number {
  if (n == null || !Number.isFinite(n)) return 50
  return Math.max(1, Math.min(200, Math.floor(n)))
}

function clampOffset(n?: number): number {
  if (n == null || !Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

/**
 * Fail-closed state guard: absent → 'candidate'; a present-but-unknown value
 * throws `invalid:…` instead of silently filtering on a bogus state (empty list).
 */
function normalizeListState(raw?: string): ClaimListState {
  if (raw == null || !raw.trim()) return 'candidate'
  const s = raw.trim()
  if ((CLAIM_LIST_STATES as readonly string[]).includes(s)) {
    return s as ClaimListState
  }
  throw new Error(
    `invalid: state must be one of ${CLAIM_LIST_STATES.join(', ')}`,
  )
}

export function listClaimsOnDb(
  db: SqliteDatabase,
  query: ListClaimsQuery = {},
): ListClaimsResult {
  const limit = clampLimit(query.limit)
  const offset = clampOffset(query.offset)
  const state = normalizeListState(query.state)
  const clauses: string[] = []
  const params: Record<string, unknown> = {}

  if (state !== 'all') {
    clauses.push('state = @state')
    params.state = state
  }
  if (query.kind?.trim()) {
    clauses.push('kind = @kind')
    params.kind = query.kind.trim()
  }
  if (query.subjectId?.trim()) {
    clauses.push('subject_id = @subjectId')
    params.subjectId = query.subjectId.trim()
  }
  if (query.q?.trim()) {
    clauses.push(
      `(id LIKE @like OR subject_id LIKE @like OR kind LIKE @like OR statement_json LIKE @like)`,
    )
    params.like = `%${query.q.trim()}%`
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM claims ${where}`).get(params) as {
      c: number
    }
  ).c
  const rows = db
    .prepare(
      `SELECT id, kind, subject_id, state, confidence, created_at, updated_at, statement_json
       FROM claims ${where}
       ORDER BY updated_at DESC, id
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset }) as Array<{
    id: string
    kind: string
    subject_id: string
    state: string
    confidence: number | null
    created_at: string
    updated_at: string | null
    statement_json: string
  }>

  const items: KnowledgeClaimListItem[] = rows.map((r) => {
    let statement: Record<string, unknown> | null = null
    try {
      const parsed = JSON.parse(r.statement_json)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        statement = parsed as Record<string, unknown>
      }
    } catch {
      statement = null
    }
    return {
      id: r.id,
      kind: r.kind,
      subjectId: r.subject_id,
      state: r.state,
      confidence: r.confidence,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      statement,
    }
  })
  return { items, total, limit, offset, state }
}

export function listClaimsSync(
  query: ListClaimsQuery = {},
  options?: { root?: string; dbPath?: string },
): ListClaimsResult {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return listClaimsOnDb(db, query)
  } finally {
    db.close()
  }
}
