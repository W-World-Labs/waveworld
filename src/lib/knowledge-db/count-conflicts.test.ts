import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countConflictsByStateSync } from './count-conflicts.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere } from './paths.ts'
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
    `k40-counts-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countConflictsByState (K40)', () => {
  it('tallies open vs resolved', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    const empty = countConflictsByStateSync({ root, dbPath })
    expect(empty.total).toBe(0)

    const db = openKnowledgeDb({ dbPath, root })
    try {
      const now = new Date().toISOString()
      for (const id of ['conflict:k40-a', 'conflict:k40-b']) {
        db.prepare(
          `INSERT INTO conflict_sets (
             id, contract_version, subject_id, reason, resolution_note, state, created_at, updated_at
           ) VALUES (?, 1, 'subj:k40', 'k40', NULL, 'open', ?, NULL)`,
        ).run(id, now)
      }
    } finally {
      db.close()
    }

    const twoOpen = countConflictsByStateSync({ root, dbPath })
    expect(twoOpen.open).toBe(2)
    expect(twoOpen.resolved).toBe(0)
    expect(twoOpen.total).toBe(2)

    resolveConflictSync(
      { conflictId: 'conflict:k40-a', resolutionNote: 'done' },
      { root, dbPath },
    )
    const mixed = countConflictsByStateSync({ root, dbPath })
    expect(mixed.open).toBe(1)
    expect(mixed.resolved).toBe(1)
    expect(mixed.total).toBe(2)
  })
})
