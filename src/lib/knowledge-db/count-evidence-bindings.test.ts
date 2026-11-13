import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countEvidenceBindingsBySupportSync } from './count-evidence-bindings.ts'
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
    `k51-eb-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countEvidenceBindingsBySupport (K51)', () => {
  it('counts by support after inserts', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countEvidenceBindingsBySupportSync({ root, dbPath }).total).toBe(0)

    const db = openKnowledgeDb({ dbPath, root })
    const now = '2026-01-01T00:00:00.000Z'
    const sha =
      'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
    db.prepare(
      `INSERT INTO source_snapshots (
         id, contract_version, locator, locator_kind, captured_at,
         content_sha256, capture_status, content_type, byte_length,
         license, title, provider, blob_relpath
       ) VALUES (?, 1, ?, 'url', ?, ?, 'locator-only', null, null,
         null, 't', 'test', null)`,
    ).run('snap:k51', 'https://example.com/e', now, sha)
    db.prepare(
      `INSERT INTO claims (
         id, contract_version, kind, subject_id, statement_json, state,
         confidence, created_at, updated_at
       ) VALUES (?, 1, 'conversion.efficiency', 'e:1', '{}', 'candidate',
         null, ?, null)`,
    ).run('claim:k51', now)
    db.prepare(
      `INSERT INTO evidence_bindings (
         id, contract_version, claim_id, source_snapshot_id, support,
         locator_json, provider, created_at
       ) VALUES (?, 1, 'claim:k51', 'snap:k51', 'supports', null, null, ?)`,
    ).run('eb:1', now)
    db.prepare(
      `INSERT INTO evidence_bindings (
         id, contract_version, claim_id, source_snapshot_id, support,
         locator_json, provider, created_at
       ) VALUES (?, 1, 'claim:k51', 'snap:k51', 'refutes', null, null, ?)`,
    ).run('eb:2', now)
    db.close()

    const c = countEvidenceBindingsBySupportSync({ root, dbPath })
    expect(c.supports).toBe(1)
    expect(c.refutes).toBe(1)
    expect(c.context).toBe(0)
    expect(c.total).toBe(2)
  })
})
