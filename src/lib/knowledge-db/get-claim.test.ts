import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createKnowledgeMaterialSync,
  normalizeCreateMaterialInput,
} from './create-material.ts'
import { getClaimSync } from './get-claim.ts'
import { migrateKnowledgeDb } from './migrate.ts'
import { promoteClaimSync } from './promote-claim.ts'
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
    `k32-claim-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('getClaim (K32)', () => {
  it('returns claim by id with statement; null when missing', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    const mat = createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k32-get',
        name: 'K32 Get',
        kind: 'other',
        createClaim: true,
      }),
      { root, dbPath },
    )
    const claimId = mat.claimId!
    expect(claimId).toBeTruthy()

    const item = getClaimSync(claimId, { root, dbPath })
    expect(item).not.toBeNull()
    expect(item!.id).toBe(claimId)
    expect(item!.subjectId).toBe('mat:k32-get')
    expect(item!.state).toBe('candidate')
    expect(item!.statement).toBeTruthy()

    expect(getClaimSync('claim:does-not-exist', { root, dbPath })).toBeNull()
  })

  it('reflects promote state change', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    const mat = createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k32-promote',
        name: 'K32 Promote',
        kind: 'other',
        createClaim: true,
      }),
      { root, dbPath },
    )
    const claimId = mat.claimId!
    promoteClaimSync({ claimId, state: 'validated' }, { root, dbPath })
    const item = getClaimSync(claimId, { root, dbPath })
    expect(item!.state).toBe('validated')
  })
})
