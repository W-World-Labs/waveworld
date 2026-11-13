/**
 * K5: ingest_cursors table is authority for OpenAlex/Crossref cursors.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  emptyCursorStore,
  type ScheduledCursorStore,
} from '../knowledge/ingest/dualSource.ts'
import {
  ingestCursorRowKey,
  loadIngestCursorsFromDb,
  loadIngestCursorsFromPath,
  parseIngestCursorRowKey,
  readIngestCursorCounts,
  saveIngestCursorsToDb,
  saveIngestCursorsToPath,
} from './ingest-cursors.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere } from './paths.ts'

const root = repoRootFromHere()
const temps: string[] = []

afterEach(() => {
  for (const p of temps) {
    try {
      fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(p + suffix)
      } catch {
        /* ignore */
      }
    }
  }
  temps.length = 0
})

function tempDb(): string {
  const p = path.join(
    os.tmpdir(),
    `waveworld-knowledge-cursors-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('ingest-cursors (K5)', () => {
  it('encodes provider|filter row keys', () => {
    expect(ingestCursorRowKey('openalex')).toBe('openalex')
    expect(ingestCursorRowKey('crossref', 'from-pub-date:2024')).toBe(
      'crossref|from-pub-date:2024',
    )
    expect(parseIngestCursorRowKey('openalex')).toEqual({
      provider: 'openalex',
    })
    expect(parseIngestCursorRowKey('crossref|from-pub-date:2024')).toEqual({
      provider: 'crossref',
      filter: 'from-pub-date:2024',
    })
    expect(parseIngestCursorRowKey('other')).toBeNull()
  })

  it('round-trips ScheduledCursorStore through ingest_cursors', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const db = openKnowledgeDb({ dbPath, root })
    try {
      expect(loadIngestCursorsFromDb(db)).toEqual(emptyCursorStore())

      const store: ScheduledCursorStore = {
        version: 1,
        cursors: [
          {
            provider: 'openalex',
            cursor: 'page-2-token',
            updatedAt: '2026-08-06T01:00:00.000Z',
            filter: 'from_publication_date:2024-01-01',
          },
          {
            provider: 'crossref',
            cursor: 'cursor:abc',
            updatedAt: '2026-08-06T01:01:00.000Z',
          },
        ],
      }
      const w = saveIngestCursorsToDb(db, store)
      expect(w.written).toBe(2)
      expect(readIngestCursorCounts(db).ingest_cursors).toBe(2)

      const loaded = loadIngestCursorsFromDb(db)
      expect(loaded.version).toBe(1)
      expect(loaded.cursors).toHaveLength(2)
      const oa = loaded.cursors.find((c) => c.provider === 'openalex')
      const cr = loaded.cursors.find((c) => c.provider === 'crossref')
      expect(oa?.cursor).toBe('page-2-token')
      expect(oa?.filter).toBe('from_publication_date:2024-01-01')
      expect(cr?.cursor).toBe('cursor:abc')
      expect(cr?.filter).toBeUndefined()

      // Advance openalex only; drop crossref → stale row deleted
      const advanced: ScheduledCursorStore = {
        version: 1,
        cursors: [
          {
            provider: 'openalex',
            cursor: 'page-3-token',
            updatedAt: '2026-08-06T02:00:00.000Z',
            filter: 'from_publication_date:2024-01-01',
          },
        ],
      }
      saveIngestCursorsToDb(db, advanced)
      const again = loadIngestCursorsFromDb(db)
      expect(again.cursors).toHaveLength(1)
      expect(again.cursors[0]?.cursor).toBe('page-3-token')
      expect(readIngestCursorCounts(db).ingest_cursors).toBe(1)
    } finally {
      db.close()
    }
  })

  it('path helpers migrate + persist', () => {
    const dbPath = tempDb()
    const store: ScheduledCursorStore = {
      version: 1,
      cursors: [
        {
          provider: 'openalex',
          cursor: 'z*',
          updatedAt: '2026-08-06T03:00:00.000Z',
        },
      ],
    }
    const saved = saveIngestCursorsToPath(store, { dbPath, root })
    expect(saved.written).toBe(1)
    const loaded = loadIngestCursorsFromPath({ dbPath, root })
    expect(loaded.store.cursors[0]?.cursor).toBe('z*')
  })
})
