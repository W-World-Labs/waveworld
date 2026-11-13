import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countClaimsByKindSync } from './count-claims-by-kind.ts'
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
    `k46-claim-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countClaimsByKind (K46)', () => {
  it('groups known and other kinds', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countClaimsByKindSync({ root, dbPath }).total).toBe(0)

    const db = openKnowledgeDb({ dbPath, root })
    const now = '2026-01-01T00:00:00.000Z'
    const ins = db.prepare(
      `INSERT INTO claims (
         id, contract_version, kind, subject_id, statement_json, state, confidence, created_at, updated_at
       ) VALUES (?, 1, ?, ?, '{}', 'candidate', null, ?, null)`,
    )
    ins.run('c1', 'conversion.efficiency', 'edge:a', now)
    ins.run('c2', 'conversion.efficiency', 'edge:b', now)
    ins.run('c3', 'sim.material', 'mat:1', now)
    ins.run('c4', 'custom.kind', 'x:1', now)
    db.close()

    const c = countClaimsByKindSync({ root, dbPath })
    expect(c.conversion_efficiency).toBe(2)
    expect(c.sim_material).toBe(1)
    expect(c.sim_param_pack).toBe(0)
    expect(c.other).toBe(1)
    expect(c.total).toBe(4)
    expect(c.byKind['conversion.efficiency']).toBe(2)
    expect(c.byKind['custom.kind']).toBe(1)
  })
})
