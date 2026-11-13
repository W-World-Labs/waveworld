/**
 * K26: promote/demote claim lifecycle state on the Knowledge DB write path.
 * K29: batch promote via claimIds[] (same state target).
 *
 * Allowed transitions (write API, registration key required):
 *   candidate → validated | quarantine
 *   quarantine → candidate | validated
 *   validated → quarantine | candidate
 *   released is NOT changeable here (use publish release path).
 *
 * Host: POST /api/v1/knowledge/claims/promote
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export const CLAIM_WRITE_STATES = [
  'candidate',
  'quarantine',
  'validated',
] as const

export type ClaimWriteState = (typeof CLAIM_WRITE_STATES)[number]

export type PromoteClaimInput = {
  claimId: string
  /** Target state. */
  state: ClaimWriteState
}

/** K29: batch promote — same target state for many claim ids. */
export type PromoteClaimBatchInput = {
  claimIds: string[]
  state: ClaimWriteState
}

export type PromoteClaimResult = {
  dbPath: string
  claimId: string
  previousState: string
  state: ClaimWriteState
  changed: boolean
  kind: string
  subjectId: string
}

export type PromoteClaimBatchResult = {
  dbPath: string
  state: ClaimWriteState
  total: number
  changed: number
  items: PromoteClaimResult[]
  errors: Array<{ claimId: string; message: string }>
}

function isWriteState(v: string): v is ClaimWriteState {
  return (CLAIM_WRITE_STATES as readonly string[]).includes(v)
}

function parseState(raw: Record<string, unknown>): ClaimWriteState {
  const stateRaw =
    typeof raw.state === 'string'
      ? raw.state.trim()
      : typeof raw.to === 'string'
        ? raw.to.trim()
        : ''
  if (!stateRaw) throw new Error('invalid: state is required')
  if (!isWriteState(stateRaw)) {
    throw new Error(
      `invalid: state must be one of ${CLAIM_WRITE_STATES.join(', ')} (not released)`,
    )
  }
  return stateRaw
}

/**
 * Normalize POST body. Throws `invalid:…` for 400 responses.
 * Single: { claimId|id, state }
 * Batch (K29): { claimIds: string[], state } — prefer when claimIds present.
 */
export function normalizePromoteClaimInput(
  raw: Record<string, unknown>,
): PromoteClaimInput {
  const claimId =
    typeof raw.claimId === 'string'
      ? raw.claimId.trim()
      : typeof raw.id === 'string'
        ? raw.id.trim()
        : ''
  const state = parseState(raw)
  if (!claimId) throw new Error('invalid: claimId is required')
  if (claimId.includes('/') || claimId.includes('\\') || claimId.includes('..')) {
    throw new Error('invalid: claimId must not contain path segments')
  }
  return { claimId, state }
}

export function normalizePromoteClaimBatchInput(
  raw: Record<string, unknown>,
): PromoteClaimBatchInput {
  const state = parseState(raw)
  const rawIds = raw.claimIds ?? raw.ids
  if (!Array.isArray(rawIds) || rawIds.length < 1) {
    throw new Error('invalid: claimIds must be a non-empty string array')
  }
  const claimIds: string[] = []
  for (let i = 0; i < rawIds.length; i++) {
    const id = typeof rawIds[i] === 'string' ? String(rawIds[i]).trim() : ''
    if (!id) throw new Error(`invalid: claimIds[${i}] empty`)
    if (id.includes('/') || id.includes('\\') || id.includes('..')) {
      throw new Error(`invalid: claimIds[${i}] must not contain path segments`)
    }
    claimIds.push(id)
  }
  if (claimIds.length > 200) {
    throw new Error('invalid: claimIds max 200 per request')
  }
  return { claimIds, state }
}

export function isBatchPromoteBody(raw: Record<string, unknown>): boolean {
  return Array.isArray(raw.claimIds) || Array.isArray(raw.ids)
}

export function promoteClaimOnDb(
  db: SqliteDatabase,
  input: PromoteClaimInput,
  dbPath: string,
): PromoteClaimResult {
  const row = db
    .prepare(
      `SELECT id, kind, subject_id, state FROM claims WHERE id = ?`,
    )
    .get(input.claimId) as
    | { id: string; kind: string; subject_id: string; state: string }
    | undefined
  if (!row) {
    throw new Error(`invalid: claim not found: ${input.claimId}`)
  }
  if (row.state === 'released') {
    throw new Error(
      'invalid: cannot change released claim via promote API; republish instead',
    )
  }
  if (!isWriteState(row.state) && row.state !== 'released') {
    throw new Error(`invalid: claim has unsupported state ${row.state}`)
  }

  const previousState = row.state
  const changed = previousState !== input.state
  if (changed) {
    const now = new Date().toISOString()
    db.prepare(
      `UPDATE claims SET state = @state, updated_at = @updated_at WHERE id = @id`,
    ).run({
      id: input.claimId,
      state: input.state,
      updated_at: now,
    })
  }

  return {
    dbPath,
    claimId: input.claimId,
    previousState,
    state: input.state,
    changed,
    kind: row.kind,
    subjectId: row.subject_id,
  }
}

export function promoteClaimSync(
  input: PromoteClaimInput,
  options?: { root?: string; dbPath?: string },
): PromoteClaimResult {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: false })
  try {
    return promoteClaimOnDb(db, input, dbPath)
  } finally {
    db.close()
  }
}

/** K29: promote many claims in one transaction; per-id errors collected. */
export function promoteClaimBatchOnDb(
  db: SqliteDatabase,
  input: PromoteClaimBatchInput,
  dbPath: string,
): PromoteClaimBatchResult {
  const items: PromoteClaimResult[] = []
  const errors: Array<{ claimId: string; message: string }> = []
  const run = db.transaction(() => {
    for (const claimId of input.claimIds) {
      try {
        items.push(promoteClaimOnDb(db, { claimId, state: input.state }, dbPath))
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        errors.push({ claimId, message: message.replace(/^invalid:\s*/i, '') })
      }
    }
  })
  run()
  return {
    dbPath,
    state: input.state,
    total: input.claimIds.length,
    changed: items.filter((i) => i.changed).length,
    items,
    errors,
  }
}

export function promoteClaimBatchSync(
  input: PromoteClaimBatchInput,
  options?: { root?: string; dbPath?: string },
): PromoteClaimBatchResult {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: false })
  try {
    return promoteClaimBatchOnDb(db, input, dbPath)
  } finally {
    db.close()
  }
}
