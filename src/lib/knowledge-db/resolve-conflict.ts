/**
 * K30: resolve (close) an open conflict_set with a resolution note.
 * Host: POST /api/v1/knowledge/conflicts/:id/resolve (registration key).
 *
 * Sets state='resolved', resolution_note, updated_at. Idempotent if already resolved
 * with the same note; re-resolve updates the note.
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'
import {
  getKnowledgeConflictSet,
  type KnowledgeConflictSetDto,
} from './read.ts'

export type ResolveConflictInput = {
  conflictId: string
  resolutionNote: string
}

export type ResolveConflictResult = {
  dbPath: string
  conflictId: string
  previousState: string
  state: 'resolved'
  changed: boolean
  resolutionNote: string
  item: KnowledgeConflictSetDto
}

/**
 * Normalize body. Throws `invalid:…` for 400 responses.
 */
export function normalizeResolveConflictInput(
  conflictId: string,
  raw: Record<string, unknown>,
): ResolveConflictInput {
  const id = conflictId.trim()
  if (!id) throw new Error('invalid: conflictId is required')
  if (id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error('invalid: conflictId must not contain path segments')
  }
  const note =
    typeof raw.resolutionNote === 'string'
      ? raw.resolutionNote.trim()
      : typeof raw.note === 'string'
        ? raw.note.trim()
        : typeof raw.resolution === 'string'
          ? raw.resolution.trim()
          : ''
  if (!note) throw new Error('invalid: resolutionNote is required')
  if (note.length > 4000) {
    throw new Error('invalid: resolutionNote max 4000 chars')
  }
  return { conflictId: id, resolutionNote: note }
}

export function resolveConflictOnDb(
  db: SqliteDatabase,
  input: ResolveConflictInput,
  dbPath: string,
): ResolveConflictResult {
  const row = db
    .prepare(
      `SELECT id, state, resolution_note FROM conflict_sets WHERE id = ?`,
    )
    .get(input.conflictId) as
    | { id: string; state: string; resolution_note: string | null }
    | undefined
  if (!row) {
    throw new Error(`invalid: conflict not found: ${input.conflictId}`)
  }
  const previousState = row.state
  const changed =
    previousState !== 'resolved' ||
    (row.resolution_note ?? '') !== input.resolutionNote
  if (changed) {
    const now = new Date().toISOString()
    db.prepare(
      `UPDATE conflict_sets
       SET state = 'resolved', resolution_note = @note, updated_at = @updated_at
       WHERE id = @id`,
    ).run({
      id: input.conflictId,
      note: input.resolutionNote,
      updated_at: now,
    })
  }
  const item = getKnowledgeConflictSet(input.conflictId, { dbPath })
  if (!item) {
    throw new Error(`resolve failed: ${input.conflictId} not readable after write`)
  }
  return {
    dbPath,
    conflictId: input.conflictId,
    previousState,
    state: 'resolved',
    changed,
    resolutionNote: input.resolutionNote,
    item,
  }
}

export function resolveConflictSync(
  input: ResolveConflictInput,
  options?: { root?: string; dbPath?: string },
): ResolveConflictResult {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: false })
  try {
    return resolveConflictOnDb(db, input, dbPath)
  } finally {
    db.close()
  }
}
