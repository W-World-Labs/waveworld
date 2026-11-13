import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizePromoteClaimBatchInput,
  normalizePromoteClaimInput,
  promoteClaimBatchSync,
  promoteClaimSync,
} from './promote-claim.ts'
import { createKnowledgeMaterialSync, normalizeCreateMaterialInput } from './create-material.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { claimIdForSimMaterial } from './create-material.ts'
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
    `k26-promo-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('promoteClaim (K26)', () => {
  it('normalizes body and rejects bad fields', () => {
    expect(() => normalizePromoteClaimInput({})).toThrow(/state is required/)
    expect(() =>
      normalizePromoteClaimInput({ claimId: 'c1', state: 'released' }),
    ).toThrow(/not released/)
    expect(() =>
      normalizePromoteClaimInput({ state: 'validated' }),
    ).toThrow(/claimId/)
    const ok = normalizePromoteClaimInput({
      id: ' claim:x ',
      to: ' validated ',
    })
    expect(ok.claimId).toBe('claim:x')
    expect(ok.state).toBe('validated')
  })

  it('promotes candidate → validated; idempotent; blocks released', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    const mat = createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k26-promo',
        name: 'K26 Promo',
        kind: 'other',
        createClaim: true,
      }),
      { root, dbPath },
    )
    const claimId = mat.claimId!
    expect(claimId).toBe(claimIdForSimMaterial('mat:k26-promo'))

    const r1 = promoteClaimSync(
      { claimId, state: 'validated' },
      { root, dbPath },
    )
    expect(r1.changed).toBe(true)
    expect(r1.previousState).toBe('candidate')
    expect(r1.state).toBe('validated')

    const r2 = promoteClaimSync(
      { claimId, state: 'validated' },
      { root, dbPath },
    )
    expect(r2.changed).toBe(false)

    const db = openKnowledgeDb({ dbPath, root, readonly: false })
    try {
      db.prepare(`UPDATE claims SET state = 'released' WHERE id = ?`).run(claimId)
    } finally {
      db.close()
    }
    expect(() =>
      promoteClaimSync({ claimId, state: 'validated' }, { root, dbPath }),
    ).toThrow(/released/)
  })

  it('K29 batch promotes multiple claims', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    const a = createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k29-a',
        name: 'K29 A',
        kind: 'other',
        createClaim: true,
      }),
      { root, dbPath },
    )
    const b = createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k29-b',
        name: 'K29 B',
        kind: 'other',
        createClaim: true,
      }),
      { root, dbPath },
    )
    const batch = normalizePromoteClaimBatchInput({
      claimIds: [a.claimId!, b.claimId!, 'missing-claim'],
      state: 'validated',
    })
    const r = promoteClaimBatchSync(batch, { root, dbPath })
    expect(r.total).toBe(3)
    expect(r.changed).toBe(2)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]!.claimId).toBe('missing-claim')
    expect(r.items.every((i) => i.state === 'validated')).toBe(true)
  })
})
