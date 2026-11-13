import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countReleasesSync } from './count-releases.ts'
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
    `k45-rel-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countReleases (K45)', () => {
  it('counts total and export presence', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countReleasesSync({ root, dbPath })).toEqual({
      total: 0,
      withExport: 0,
      withoutExport: 0,
    })

    const db = openKnowledgeDb({ dbPath, root })
    const now = '2026-01-01T00:00:00.000Z'
    db.prepare(
      `INSERT INTO knowledge_releases (
         id, contract_version, released_at, state, sha256, export_relpath, meta_json, created_at
       ) VALUES (?, 1, ?, 'released', ?, ?, null, ?)`,
    ).run('rel-a', now, 'a'.repeat(64), 'exports/a.json', now)
    db.prepare(
      `INSERT INTO knowledge_releases (
         id, contract_version, released_at, state, sha256, export_relpath, meta_json, created_at
       ) VALUES (?, 1, ?, 'released', ?, null, null, ?)`,
    ).run('rel-b', now, 'b'.repeat(64), now)
    db.close()

    const c = countReleasesSync({ root, dbPath })
    expect(c.total).toBe(2)
    expect(c.withExport).toBe(1)
    expect(c.withoutExport).toBe(1)
  })
})
