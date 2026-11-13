import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  countSnapshotsByCaptureStatusSync,
  countSnapshotsByLocatorKindSync,
} from './count-snapshots.ts'
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
    `k44-snap-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countSnapshotsByLocatorKind (K44)', () => {
  it('counts by locator_kind after insert', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countSnapshotsByLocatorKindSync({ root, dbPath }).total).toBe(0)

    const db = openKnowledgeDb({ dbPath, root })
    const sha =
      'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
    db.prepare(
      `INSERT INTO source_snapshots (
         id, contract_version, locator, locator_kind, captured_at,
         content_sha256, capture_status, content_type, byte_length,
         license, title, provider, blob_relpath
       ) VALUES (?, 1, ?, 'url', ?, ?, 'locator-only', null, null,
         null, 't1', 'test', null)`,
    ).run('snap-u', 'https://example.com/a', '2026-01-01T00:00:00.000Z', sha)
    db.prepare(
      `INSERT INTO source_snapshots (
         id, contract_version, locator, locator_kind, captured_at,
         content_sha256, capture_status, content_type, byte_length,
         license, title, provider, blob_relpath
       ) VALUES (?, 1, ?, 'doi', ?, ?, 'bytes-captured', 'text/plain', 12,
         null, 't2', 'test', 'ab/cd.bin')`,
    ).run(
      'snap-d',
      '10.1000/xyz',
      '2026-01-02T00:00:00.000Z',
      '112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00',
    )
    db.close()

    const c = countSnapshotsByLocatorKindSync({ root, dbPath })
    expect(c.url).toBe(1)
    expect(c.doi).toBe(1)
    expect(c.citation).toBe(0)
    expect(c.other).toBe(0)
    expect(c.total).toBe(2)

    const cap = countSnapshotsByCaptureStatusSync({ root, dbPath })
    expect(cap.locator_only).toBe(1)
    expect(cap.bytes_captured).toBe(1)
    expect(cap.total).toBe(2)
  })
})

describe('countSnapshotsByCaptureStatus (K47)', () => {
  it('empty db is zero', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countSnapshotsByCaptureStatusSync({ root, dbPath })).toEqual({
      locator_only: 0,
      bytes_captured: 0,
      total: 0,
      other: 0,
    })
  })
})
