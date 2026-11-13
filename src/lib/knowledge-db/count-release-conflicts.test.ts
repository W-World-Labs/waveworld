import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countReleaseConflictsSync } from './count-release-conflicts.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere } from './paths.ts'

const root = repoRootFromHere()
const temps: string[] = []
afterEach(() => {
  for (const p of temps) {
    for (const s of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(p + s) } catch { /* */ }
    }
  }
  temps.length = 0
})

function tempDb() {
  const p = path.join(os.tmpdir(), `k56-rcf-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)
  temps.push(p)
  return p
}

describe('countReleaseConflicts (K56)', () => {
  it('counts memberships after insert', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countReleaseConflictsSync({ root, dbPath }).total).toBe(0)
    const db = openKnowledgeDb({ dbPath, root })
    const now = '2026-01-01T00:00:00.000Z'
    db.prepare(`INSERT INTO conflict_sets (id, contract_version, subject_id, reason, resolution_note, state, created_at, updated_at) VALUES (?, 1, 'e:1', 'demo', null, 'open', ?, null)`).run('conf:1', now)
    db.prepare(`INSERT INTO conflict_sets (id, contract_version, subject_id, reason, resolution_note, state, created_at, updated_at) VALUES (?, 1, 'e:2', 'demo', null, 'open', ?, null)`).run('conf:2', now)
    db.prepare(`INSERT INTO knowledge_releases (id, contract_version, released_at, state, sha256, export_relpath, meta_json, created_at) VALUES (?, 1, ?, 'released', 'deadbeef', null, null, ?)`).run('rel:1', now, now)
    db.prepare(`INSERT INTO release_conflicts (release_id, conflict_id) VALUES (?, ?)`).run('rel:1', 'conf:1')
    db.prepare(`INSERT INTO release_conflicts (release_id, conflict_id) VALUES (?, ?)`).run('rel:1', 'conf:2')
    db.close()
    const c = countReleaseConflictsSync({ root, dbPath })
    expect(c.total).toBe(2)
    expect(c.distinctReleases).toBe(1)
    expect(c.distinctConflicts).toBe(2)
  })
})
