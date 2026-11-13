import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  countMaterialsByFidelitySync,
  countMaterialsByKindSync,
} from './count-materials.ts'
import {
  createKnowledgeMaterialSync,
  normalizeCreateMaterialInput,
} from './create-material.ts'
import { migrateKnowledgeDb } from './migrate.ts'
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
    `k41-mat-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countMaterialsByKind (K41)', () => {
  it('tallies by kind after creates', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countMaterialsByKindSync({ root, dbPath }).total).toBe(0)

    createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k41-a',
        name: 'A',
        kind: 'other',
        createClaim: false,
      }),
      { root, dbPath },
    )
    createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k41-b',
        name: 'B',
        kind: 'forcefield_lj',
        createClaim: false,
      }),
      { root, dbPath },
    )
    const c = countMaterialsByKindSync({ root, dbPath })
    expect(c.other).toBe(1)
    expect(c.forcefield_lj).toBe(1)
    expect(c.total).toBe(2)
  })
})

describe('countMaterialsByFidelity (K49)', () => {
  it('tallies quantitative/qualitative/unknown', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countMaterialsByFidelitySync({ root, dbPath }).total).toBe(0)

    createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k49-q',
        name: 'Q',
        kind: 'other',
        fidelity: 'quantitative',
        createClaim: false,
      }),
      { root, dbPath },
    )
    createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k49-l',
        name: 'L',
        kind: 'other',
        fidelity: 'qualitative',
        createClaim: false,
      }),
      { root, dbPath },
    )
    createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k49-u',
        name: 'U',
        kind: 'other',
        createClaim: false,
      }),
      { root, dbPath },
    )
    const c = countMaterialsByFidelitySync({ root, dbPath })
    expect(c.quantitative).toBe(1)
    expect(c.qualitative).toBe(1)
    expect(c.unknown).toBe(1)
    expect(c.total).toBe(3)
  })
})
