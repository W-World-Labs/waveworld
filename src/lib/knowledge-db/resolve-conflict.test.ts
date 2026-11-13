import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { listKnowledgeConflictSets } from './read.ts'
import { repoRootFromHere } from './paths.ts'
import {
  normalizeResolveConflictInput,
  resolveConflictSync,
} from './resolve-conflict.ts'
import { seedDemoConflictSetsSync, DEMO_CONFLICT_ID } from './seed-demo-conflicts.ts'

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
    `k30-resolve-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('resolveConflict (K30)', () => {
  it('normalizes body', () => {
    expect(() =>
      normalizeResolveConflictInput('c1', {}),
    ).toThrow(/resolutionNote/)
    const ok = normalizeResolveConflictInput(' c1 ', {
      note: '  closed as duplicate  ',
    })
    expect(ok.conflictId).toBe('c1')
    expect(ok.resolutionNote).toBe('closed as duplicate')
  })

  it('resolves open demo conflict; open list drops it', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    seedDemoConflictSetsSync({ root, dbPath })
    const openBefore = listKnowledgeConflictSets({ state: 'open' }, { dbPath })
    expect(openBefore.total).toBeGreaterThanOrEqual(1)

    const r = resolveConflictSync(
      {
        conflictId: DEMO_CONFLICT_ID,
        resolutionNote: 'K30 test resolve — not scientific adjudication',
      },
      { root, dbPath },
    )
    expect(r.changed).toBe(true)
    expect(r.previousState).toBe('open')
    expect(r.state).toBe('resolved')
    expect(r.item.state).toBe('resolved')

    const openAfter = listKnowledgeConflictSets({ state: 'open' }, { dbPath })
    expect(openAfter.items.some((x) => x.id === DEMO_CONFLICT_ID)).toBe(false)

    const r2 = resolveConflictSync(
      {
        conflictId: DEMO_CONFLICT_ID,
        resolutionNote: 'K30 test resolve — not scientific adjudication',
      },
      { root, dbPath },
    )
    expect(r2.changed).toBe(false)
  })

  it('§7.2: resolve touches only conflict_sets.state; member claims stay byte-identical', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })

    // Seed claims + a conflict set with members directly so the fixture has
    // known content/state/timestamps (independent of demo-seed claim pick).
    const seed = openKnowledgeDb({ root, dbPath })
    try {
      const insertClaim = seed.prepare(
        `INSERT INTO claims (
           id, contract_version, kind, subject_id, statement_json,
           state, confidence, created_at, updated_at
         ) VALUES (?, 1, 'efficiency', 'edge:resolve-invariant', ?, 'released', 0.9,
                   '2026-01-02T03:04:05.000Z', '2026-01-03T03:04:05.000Z')`,
      )
      insertClaim.run('claim-member-a', '{"value":0.42,"unit":"fraction"}')
      insertClaim.run('claim-member-b', '{"value":0.55,"unit":"fraction"}')
      insertClaim.run('claim-outsider', '{"value":0.90,"unit":"fraction"}')
      seed
        .prepare(
          `INSERT INTO conflict_sets (
             id, contract_version, subject_id, reason, resolution_note,
             state, created_at, updated_at
           ) VALUES ('conflict-invariant', 1, 'edge:resolve-invariant',
                     'fixture dispute for §7.2', NULL, 'open',
                     '2026-01-02T03:04:05.000Z', NULL)`,
        )
        .run()
      const insertMember = seed.prepare(
        `INSERT INTO conflict_members (conflict_id, claim_id) VALUES ('conflict-invariant', ?)`,
      )
      insertMember.run('claim-member-a')
      insertMember.run('claim-member-b')
    } finally {
      seed.close()
    }

    const dump = (tables: string[]) => {
      const db = openKnowledgeDb({ root, dbPath, readonly: true })
      try {
        return Object.fromEntries(
          tables.map((t) => [
            t,
            (db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all() as unknown[]).map(
              (r) => JSON.stringify(r),
            ),
          ]),
        )
      } finally {
        db.close()
      }
    }

    const before = dump(['claims', 'conflict_members', 'evidence_bindings'])
    const setsBefore = dump(['conflict_sets']).conflict_sets!

    const r = resolveConflictSync(
      {
        conflictId: 'conflict-invariant',
        resolutionNote: '§7.2 invariant resolve — members untouched',
      },
      { root, dbPath },
    )
    expect(r.changed).toBe(true)
    expect(r.state).toBe('resolved')

    const after = dump(['claims', 'conflict_members', 'evidence_bindings'])
    // Member claims (and the non-member claim) are byte-identical: content,
    // state, confidence, and both timestamps all unchanged.
    expect(after.claims).toEqual(before.claims)
    expect(after.claims).toHaveLength(3)
    // Membership rows are not rewritten either.
    expect(after.conflict_members).toEqual(before.conflict_members)
    expect(after.conflict_members).toHaveLength(2)
    expect(after.evidence_bindings).toEqual(before.evidence_bindings)

    // The only mutation is on the conflict_sets row itself, and only on
    // state / resolution_note / updated_at.
    const setsAfter = dump(['conflict_sets']).conflict_sets!
    expect(setsAfter).toHaveLength(1)
    const prevRow = JSON.parse(setsBefore[0]!) as Record<string, unknown>
    const nextRow = JSON.parse(setsAfter[0]!) as Record<string, unknown>
    expect(nextRow.state).toBe('resolved')
    expect(nextRow.resolution_note).toBe(
      '§7.2 invariant resolve — members untouched',
    )
    for (const col of [
      'id',
      'contract_version',
      'subject_id',
      'reason',
      'created_at',
    ]) {
      expect(nextRow[col]).toEqual(prevRow[col])
    }
  })
})
