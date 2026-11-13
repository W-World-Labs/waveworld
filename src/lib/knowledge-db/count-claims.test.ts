import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createKnowledgeMaterialSync,
  normalizeCreateMaterialInput,
} from './create-material.ts'
import { countClaimsByStateSync } from './count-claims.ts'
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
    `k34-counts-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countClaimsByState (K34)', () => {
  it('tallies candidate vs validated after promote', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    const empty = countClaimsByStateSync({ root, dbPath })
    expect(empty.total).toBe(0)
    expect(empty.candidate).toBe(0)

    const a = createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k34-a',
        name: 'K34 A',
        kind: 'other',
        createClaim: true,
      }),
      { root, dbPath },
    )
    const b = createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k34-b',
        name: 'K34 B',
        kind: 'other',
        createClaim: true,
      }),
      { root, dbPath },
    )
    const afterCreate = countClaimsByStateSync({ root, dbPath })
    expect(afterCreate.candidate).toBe(2)
    expect(afterCreate.total).toBe(2)

    promoteClaimSync({ claimId: a.claimId!, state: 'validated' }, { root, dbPath })
    const afterPromote = countClaimsByStateSync({ root, dbPath })
    expect(afterPromote.candidate).toBe(1)
    expect(afterPromote.validated).toBe(1)
    expect(afterPromote.released).toBe(0)
    expect(afterPromote.total).toBe(2)
    expect(b.claimId).toBeTruthy()
  })
})
