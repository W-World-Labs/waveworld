import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claimIdForSimMaterial,
  createKnowledgeMaterialSync,
  normalizeCreateMaterialInput,
} from './create-material.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { listKnowledgeMaterials } from './read.ts'
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
    `k22-mat-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('createKnowledgeMaterial (K22)', () => {
  it('normalizes body and rejects bad id/name', () => {
    expect(() => normalizeCreateMaterialInput({})).toThrow(/id is required/)
    expect(() =>
      normalizeCreateMaterialInput({ id: 'mat:x', name: '' }),
    ).toThrow(/name is required/)
    expect(() =>
      normalizeCreateMaterialInput({ id: '../evil', name: 'x' }),
    ).toThrow(/path/)
    const ok = normalizeCreateMaterialInput({
      id: ' mat:demo ',
      name: ' Demo ',
      kind: 'other',
      properties: [{ key: 'density_kg_m3', unit: 'kg/m^3', valueNum: 1 }], // gitleaks:allow -- numeric material property identifier, not a credential.
    })
    expect(ok.id).toBe('mat:demo')
    expect(ok.name).toBe('Demo')
    expect(ok.properties).toHaveLength(1)
  })

  it('creates material + sim.material claim; list returns it; idempotent', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })

    const input = normalizeCreateMaterialInput({
      id: 'mat:k22-write-demo',
      name: 'K22 Write Demo',
      nameEn: 'K22 Write Demo',
      categoryId: 'k22-write',
      categoryLabel: 'K22 write tests',
      kind: 'other',
      fidelity: 'qualitative',
      properties: [
        { key: 'density_kg_m3', unit: 'kg/m^3', valueNum: 1234 }, // gitleaks:allow -- numeric material property identifier, not a credential.
      ],
    })

    const r1 = createKnowledgeMaterialSync(input, { root, dbPath })
    expect(r1.created).toBe(true)
    expect(r1.claimCreated).toBe(true)
    expect(r1.claimId).toBe(claimIdForSimMaterial('mat:k22-write-demo'))
    expect(r1.material.id).toBe('mat:k22-write-demo')
    expect(r1.material.name).toBe('K22 Write Demo')
    expect(r1.material.properties?.some((p) => p.key === 'density_kg_m3')).toBe( // gitleaks:allow -- numeric material property identifier, not a credential.
      true,
    )

    const listed = listKnowledgeMaterials(
      { q: 'k22-write-demo', limit: 10 },
      { dbPath },
    )
    expect(listed.total).toBeGreaterThanOrEqual(1)
    expect(listed.items.some((m) => m.id === 'mat:k22-write-demo')).toBe(true)

    const db = openKnowledgeDb({ dbPath, root, readonly: true })
    try {
      const claim = db
        .prepare(`SELECT kind, state, subject_id FROM claims WHERE id = ?`)
        .get(r1.claimId!) as {
        kind: string
        state: string
        subject_id: string
      }
      expect(claim.kind).toBe('sim.material')
      expect(claim.state).toBe('candidate')
      expect(claim.subject_id).toBe('mat:k22-write-demo')
    } finally {
      db.close()
    }

    const r2 = createKnowledgeMaterialSync(input, { root, dbPath })
    expect(r2.created).toBe(false)
    expect(r2.claimCreated).toBe(false)
  })
})
