import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countReleaseClaimsSync } from './count-release-claims.ts'
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
    `k53-rc-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countReleaseClaims (K53)', () => {
  it('counts memberships after insert', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countReleaseClaimsSync({ root, dbPath }).total).toBe(0)

    const db = openKnowledgeDb({ dbPath, root })
    const now = '2026-01-01T00:00:00.000Z'
    db.prepare(
      `INSERT INTO claims (
         id, contract_version, kind, subject_id, statement_json, state,
         confidence, created_at, updated_at
       ) VALUES (?, 1, 'conversion.efficiency', 'e:1', '{}', 'released',
         null, ?, null)`,
    ).run('claim:a', now)
    db.prepare(
      `INSERT INTO claims (
         id, contract_version, kind, subject_id, statement_json, state,
         confidence, created_at, updated_at
       ) VALUES (?, 1, 'conversion.efficiency', 'e:1', '{}', 'released',
         null, ?, null)`,
    ).run('claim:b', now)
    db.prepare(
      `INSERT INTO knowledge_releases (
         id, contract_version, released_at, state, sha256, export_relpath,
         meta_json, created_at
       ) VALUES (?, 1, ?, 'released', 'deadbeef', null, null, ?)`,
    ).run('rel:1', now, now)
    db.prepare(
      `INSERT INTO release_claims (release_id, claim_id) VALUES (?, ?)`,
    ).run('rel:1', 'claim:a')
    db.prepare(
      `INSERT INTO release_claims (release_id, claim_id) VALUES (?, ?)`,
    ).run('rel:1', 'claim:b')
    db.close()

    const c = countReleaseClaimsSync({ root, dbPath })
    expect(c.total).toBe(2)
    expect(c.distinctReleases).toBe(1)
    expect(c.distinctClaims).toBe(2)
  })
})
