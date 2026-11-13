import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countMaterialPropertiesSync } from './count-material-properties.ts'
import {
  createKnowledgeMaterialSync,
  normalizeCreateMaterialInput,
} from './create-material.ts'
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
    `k50-mp-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countMaterialProperties (K50)', () => {
  it('counts properties after material create with props', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countMaterialPropertiesSync({ root, dbPath }).total).toBe(0)

    createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k50',
        name: 'M',
        kind: 'other',
        createClaim: false,
      }),
      { root, dbPath },
    )
    const db = openKnowledgeDb({ dbPath, root })
    db.prepare(
      `INSERT INTO material_properties (
         id, material_id, key, value_num, value_text, unit,
         condition_json, fidelity, claim_id, sort_order
       ) VALUES (?, 'mat:k50', 'density', 1.2, null, 'g/cm3', null, null, null, 0)`,
    ).run('mp:1')
    db.prepare(
      `INSERT INTO material_properties (
         id, material_id, key, value_num, value_text, unit,
         condition_json, fidelity, claim_id, sort_order
       ) VALUES (?, 'mat:k50', 'note', null, 'hello', 'text', null, null, null, 1)`,
    ).run('mp:2')
    db.close()

    const c = countMaterialPropertiesSync({ root, dbPath })
    expect(c.total).toBe(2)
    expect(c.withNumeric).toBe(1)
    expect(c.textOnly).toBe(1)
    expect(c.distinctKeys).toBe(2)
  })
})
