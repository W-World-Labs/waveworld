import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countConflictMembersSync } from './count-conflict-members.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere } from './paths.ts'

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
    `k52-cm-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countConflictMembers (K52)', () => {
  it('counts memberships after insert', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countConflictMembersSync({ root, dbPath }).total).toBe(0)

    const db = openKnowledgeDb({ dbPath, root })
    const now = '2026-01-01T00:00:00.000Z'
    db.prepare(
      `INSERT INTO claims (
         id, contract_version, kind, subject_id, statement_json, state,
         confidence, created_at, updated_at
       ) VALUES (?, 1, 'conversion.efficiency', 'e:1', '{}', 'candidate',
         null, ?, null)`,
    ).run('claim:a', now)
    db.prepare(
      `INSERT INTO claims (
         id, contract_version, kind, subject_id, statement_json, state,
         confidence, created_at, updated_at
       ) VALUES (?, 1, 'conversion.efficiency', 'e:1', '{}', 'candidate',
         null, ?, null)`,
    ).run('claim:b', now)
    db.prepare(
      `INSERT INTO conflict_sets (
         id, contract_version, subject_id, reason, resolution_note, state,
         created_at, updated_at
       ) VALUES (?, 1, 'e:1', 'demo', null, 'open', ?, null)`,
    ).run('conf:1', now)
    db.prepare(
      `INSERT INTO conflict_members (conflict_id, claim_id) VALUES (?, ?)`,
    ).run('conf:1', 'claim:a')
    db.prepare(
      `INSERT INTO conflict_members (conflict_id, claim_id) VALUES (?, ?)`,
    ).run('conf:1', 'claim:b')
    db.close()

    const c = countConflictMembersSync({ root, dbPath })
    expect(c.total).toBe(2)
    expect(c.conflictsWithMembers).toBe(1)
    expect(c.distinctClaims).toBe(2)
  })
})
