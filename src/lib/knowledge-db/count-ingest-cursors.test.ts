import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countIngestCursorsSync } from './count-ingest-cursors.ts'
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
    `k60-ic-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countIngestCursors (K60)', () => {
  it('counts rows with and without cursor values', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countIngestCursorsSync({ root, dbPath }).total).toBe(0)

    const db = openKnowledgeDb({ dbPath, root })
    const now = '2026-01-01T00:00:00.000Z'
    db.prepare(
      `INSERT INTO ingest_cursors (provider, cursor, updated_at, meta_json)
       VALUES ('openalex', 'cur:1', ?, null)`,
    ).run(now)
    db.prepare(
      `INSERT INTO ingest_cursors (provider, cursor, updated_at, meta_json)
       VALUES ('crossref', null, ?, null)`,
    ).run(now)
    db.close()

    const c = countIngestCursorsSync({ root, dbPath })
    expect(c.total).toBe(2)
    expect(c.withCursor).toBe(1)
    expect(c.withoutCursor).toBe(1)
  })
})
