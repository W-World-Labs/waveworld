/**
 * K39: reopen a resolved conflict_set (clear resolution, state=open).
 * Host: POST /api/v1/knowledge/conflicts/:id/reopen (registration key).
 * Companion to K30 resolve.
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'
import {
  getKnowledgeConflictSet,
  type KnowledgeConflictSetDto,
} from './read.ts'

export type ReopenConflictResult = {
  dbPath: string
  conflictId: string
  previousState: string
  state: 'open'
  changed: boolean
  item: KnowledgeConflictSetDto
}

export function reopenConflictOnDb(
  db: SqliteDatabase,
  conflictId: string,
  dbPath: string,
): ReopenConflictResult {
  const id = conflictId.trim()
  if (!id) throw new Error('invalid: conflictId is required')
  if (id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error('invalid: conflictId must not contain path segments')
  }
  const row = db
    .prepare(`SELECT id, state FROM conflict_sets WHERE id = ?`)
    .get(id) as { id: string; state: string } | undefined
  if (!row) {
    throw new Error(`invalid: conflict not found: ${id}`)
  }
  const previousState = row.state
  const changed = previousState !== 'open'
  if (changed) {
    const now = new Date().toISOString()
    db.prepare(
      `UPDATE conflict_sets
       SET state = 'open', resolution_note = NULL, updated_at = @updated_at
       WHERE id = @id`,
    ).run({ id, updated_at: now })
  }
  const item = getKnowledgeConflictSet(id, { dbPath })
  if (!item) {
    throw new Error(`reopen failed: ${id} not readable after write`)
  }
  return {
    dbPath,
    conflictId: id,
    previousState,
    state: 'open',
    changed,
    item,
  }
}

export function reopenConflictSync(
  conflictId: string,
  options?: { root?: string; dbPath?: string },
): ReopenConflictResult {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: false })
  try {
    return reopenConflictOnDb(db, conflictId, dbPath)
  } finally {
    db.close()
  }
}
