import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createKnowledgeMaterialSync,
  normalizeCreateMaterialInput,
} from './create-material.ts'
import { listClaimsSync } from './list-claims.ts'
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
    `k27-claims-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('listClaims (K27)', () => {
  it('filters by state candidate vs validated', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    const mat = createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k27-list',
        name: 'K27 List',
        kind: 'other',
        createClaim: true,
      }),
      { root, dbPath },
    )
    const claimId = mat.claimId!

    const cand = listClaimsSync({ state: 'candidate', q: 'k27-list' }, { root, dbPath })
    expect(cand.total).toBeGreaterThanOrEqual(1)
    expect(cand.items.some((c) => c.id === claimId)).toBe(true)

    promoteClaimSync({ claimId, state: 'validated' }, { root, dbPath })
    const stillCand = listClaimsSync(
      { state: 'candidate', q: 'k27-list' },
      { root, dbPath },
    )
    expect(stillCand.items.some((c) => c.id === claimId)).toBe(false)

    const val = listClaimsSync({ state: 'validated', q: 'k27-list' }, { root, dbPath })
    expect(val.items.some((c) => c.id === claimId && c.state === 'validated')).toBe(
      true,
    )
  })

  it('state=all returns claims across lifecycle states', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    const mat = createKnowledgeMaterialSync(
      normalizeCreateMaterialInput({
        id: 'mat:k27-list-all',
        name: 'K27 List All',
        kind: 'other',
        createClaim: true,
      }),
      { root, dbPath },
    )
    const claimId = mat.claimId!
    promoteClaimSync({ claimId, state: 'validated' }, { root, dbPath })

    const all = listClaimsSync(
      { state: 'all', q: 'k27-list-all' },
      { root, dbPath },
    )
    expect(all.state).toBe('all')
    expect(all.items.some((c) => c.id === claimId && c.state === 'validated')).toBe(
      true,
    )
  })

  it('rejects an unknown state fail-closed instead of silently empty', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(() =>
      listClaimsSync({ state: 'bogus' as never }, { root, dbPath }),
    ).toThrow(/invalid: state must be one of/)
    // whitespace-only falls back to the candidate default
    const blank = listClaimsSync({ state: '  ' as never }, { root, dbPath })
    expect(blank.state).toBe('candidate')
  })
})
