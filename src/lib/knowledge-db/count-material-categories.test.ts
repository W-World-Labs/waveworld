import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countMaterialCategoriesSync } from './count-material-categories.ts'
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
    `k59-mc-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countMaterialCategories (K59)', () => {
  it('counts categories and empty vs with-materials', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countMaterialCategoriesSync({ root, dbPath }).total).toBe(0)

    const db = openKnowledgeDb({ dbPath, root })
    const now = '2026-01-01T00:00:00.000Z'
    db.prepare(
      `INSERT INTO material_categories (id, label, label_en, cross_check, sort_order)
       VALUES ('cat:1', 'A', null, null, 0)`,
    ).run()
    db.prepare(
      `INSERT INTO material_categories (id, label, label_en, cross_check, sort_order)
       VALUES ('cat:2', 'B', null, null, 1)`,
    ).run()
    db.prepare(
      `INSERT INTO materials (
         id, category_id, name, name_en, formula, kind, fidelity,
         forcefield, notes, source_text, meta_json, created_at, updated_at
       ) VALUES ('m:1', 'cat:1', 'M', null, null, 'other', null,
         null, null, null, null, ?, ?)`,
    ).run(now, now)
    db.close()

    const c = countMaterialCategoriesSync({ root, dbPath })
    expect(c.total).toBe(2)
    expect(c.withMaterials).toBe(1)
    expect(c.empty).toBe(1)
  })
})
