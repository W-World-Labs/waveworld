import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere } from './paths.ts'
import { reopenConflictSync } from './reopen-conflict.ts'
import { resolveConflictSync } from './resolve-conflict.ts'

const root = repoRootFromHere()
const temps: string[] = []
afterEach(() => {
  for (const p of temps) {
    for (const s of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(p + s)
      } catch {
        /* */
      }
    }
  }
  temps.length = 0
})

function tempDb() {
  const p = path.join(
    os.tmpdir(),
    `k39-reopen-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('reopenConflict (K39)', () => {
  it('reopens a resolved conflict and clears resolution_note', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    const id = 'conflict:k39-reopen-demo'
    const db = openKnowledgeDb({ dbPath, root })
    try {
      db.prepare(
        `INSERT INTO conflict_sets (
           id, contract_version, subject_id, reason, resolution_note, state, created_at, updated_at
         ) VALUES (?, 1, 'subj:k39', 'k39 test', NULL, 'open', ?, NULL)`,
      ).run(id, new Date().toISOString())
    } finally {
      db.close()
    }

    resolveConflictSync(
      { conflictId: id, resolutionNote: 'closed for reopen test' },
      { root, dbPath },
    )
    const reopened = reopenConflictSync(id, { root, dbPath })
    expect(reopened.state).toBe('open')
    expect(reopened.changed).toBe(true)
    expect(reopened.previousState).toBe('resolved')
    expect(reopened.item.state).toBe('open')

    const again = reopenConflictSync(id, { root, dbPath })
    expect(again.changed).toBe(false)
    expect(again.state).toBe('open')
  })
})
