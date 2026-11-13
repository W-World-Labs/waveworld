import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { listKnowledgeConflictSets } from './read.ts'
import { repoRootFromHere } from './paths.ts'
import {
  DEMO_CONFLICT_ID,
  DEMO_CONFLICT_ID_K20,
  DEMO_CONFLICT_ID_K28,
  DEMO_CONFLICT_SUBJECT_K20,
  DEMO_CONFLICT_SUBJECT_K28,
  seedDemoConflictSetsSync,
} from './seed-demo-conflicts.ts'

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
    `k20-demo-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('seedDemoConflictSets (K18+K20+K28)', () => {
  it('is idempotent and lists ≥3 open demo conflicts', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    const r1 = seedDemoConflictSetsSync({ root, dbPath })
    expect(r1.created).toBe(true)
    expect(r1.conflictId).toBe(DEMO_CONFLICT_ID)
    expect(r1.conflictIds).toEqual([
      DEMO_CONFLICT_ID,
      DEMO_CONFLICT_ID_K20,
      DEMO_CONFLICT_ID_K28,
    ])
    expect(r1.createdById[DEMO_CONFLICT_ID]).toBe(true)
    expect(r1.createdById[DEMO_CONFLICT_ID_K20]).toBe(true)
    expect(r1.createdById[DEMO_CONFLICT_ID_K28]).toBe(true)

    const r2 = seedDemoConflictSetsSync({ root, dbPath })
    expect(r2.created).toBe(false)

    const listed = listKnowledgeConflictSets({ state: 'open' }, { dbPath })
    expect(listed.total).toBe(3)
    const ids = listed.items.map((x) => x.id).sort()
    expect(ids).toEqual(
      [DEMO_CONFLICT_ID, DEMO_CONFLICT_ID_K20, DEMO_CONFLICT_ID_K28].sort(),
    )
    const k20 = listed.items.find((x) => x.id === DEMO_CONFLICT_ID_K20)
    expect(k20?.state).toBe('open')
    expect(k20?.subjectId).toBe(DEMO_CONFLICT_SUBJECT_K20)
    const k28 = listed.items.find((x) => x.id === DEMO_CONFLICT_ID_K28)
    expect(k28?.subjectId).toBe(DEMO_CONFLICT_SUBJECT_K28)
  })

  it('attaches existing released claims when present', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    const db = openKnowledgeDb({ dbPath, root })
    const now = new Date().toISOString()
    for (const id of [
      'claim-demo-1',
      'claim-demo-2',
      'claim-demo-3',
      'claim-demo-4',
      'claim-demo-5',
      'claim-demo-6',
    ]) {
      db.prepare(
        `INSERT INTO claims (
           id, contract_version, kind, subject_id, statement_json, state,
           confidence, created_at, updated_at
         ) VALUES (?, 1, 'efficiency', 'edge:x', '{}', 'released', 0.5, ?, NULL)`,
      ).run(id, now)
    }
    db.close()
    const r = seedDemoConflictSetsSync({ root, dbPath })
    expect(r.created).toBe(true)
    expect(r.claimIds.length).toBeGreaterThanOrEqual(2)
    const one = listKnowledgeConflictSets({ state: 'open' }, { dbPath })
    expect(one.total).toBe(3)
    const k18 = one.items.find((x) => x.id === DEMO_CONFLICT_ID)
    const k20 = one.items.find((x) => x.id === DEMO_CONFLICT_ID_K20)
    const k28 = one.items.find((x) => x.id === DEMO_CONFLICT_ID_K28)
    expect(k18?.claimIds?.length).toBeGreaterThanOrEqual(1)
    expect(k20?.claimIds?.length).toBeGreaterThanOrEqual(1)
    expect(k28?.claimIds?.length).toBeGreaterThanOrEqual(1)
  })
})
