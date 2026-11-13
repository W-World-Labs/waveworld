import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countReleaseSnapshotsSync } from './count-release-snapshots.ts'
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
    `k54-rs-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countReleaseSnapshots (K54)', () => {
  it('counts memberships after insert', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countReleaseSnapshotsSync({ root, dbPath }).total).toBe(0)

    const db = openKnowledgeDb({ dbPath, root })
    const now = '2026-01-01T00:00:00.000Z'
    db.prepare(
      `INSERT INTO source_snapshots (
         id, contract_version, locator, locator_kind, captured_at,
         content_sha256, capture_status, content_type, byte_length,
         license, cursor, title, provider, blob_relpath
       ) VALUES (?, 1, 'https://ex/a', 'url', ?, 'aa', 'locator-only',
         null, null, null, null, null, null, null)`,
    ).run('snap:a', now)
    db.prepare(
      `INSERT INTO source_snapshots (
         id, contract_version, locator, locator_kind, captured_at,
         content_sha256, capture_status, content_type, byte_length,
         license, cursor, title, provider, blob_relpath
       ) VALUES (?, 1, 'https://ex/b', 'url', ?, 'bb', 'locator-only',
         null, null, null, null, null, null, null)`,
    ).run('snap:b', now)
    db.prepare(
      `INSERT INTO knowledge_releases (
         id, contract_version, released_at, state, sha256, export_relpath,
         meta_json, created_at
       ) VALUES (?, 1, ?, 'released', 'deadbeef', null, null, ?)`,
    ).run('rel:1', now, now)
    db.prepare(
      `INSERT INTO release_snapshots (release_id, source_snapshot_id) VALUES (?, ?)`,
    ).run('rel:1', 'snap:a')
    db.prepare(
      `INSERT INTO release_snapshots (release_id, source_snapshot_id) VALUES (?, ?)`,
    ).run('rel:1', 'snap:b')
    db.close()

    const c = countReleaseSnapshotsSync({ root, dbPath })
    expect(c.total).toBe(2)
    expect(c.distinctReleases).toBe(1)
    expect(c.distinctSnapshots).toBe(2)
  })
})
