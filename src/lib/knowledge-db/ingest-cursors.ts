/**
 * K5: OpenAlex / Crossref ingest cursors in knowledge.db `ingest_cursors`.
 * DB is authority; JSON files may mirror for ops but are not sole truth.
 *
 * Row key: provider column = `openalex` | `crossref` when filter empty;
 * when a filter is set → `openalex|<filter>` / `crossref|<filter>`.
 * meta_json holds { version: 1, provider, filter? }.
 *
 * @see docs/knowledge-db.md §6 K5
 * @see EPIC #52
 */
import {
  emptyCursorStore,
  type ScheduledCursorStore,
  type ScheduledIngestCursor,
} from '../knowledge/ingest/dualSource.ts'
import type { SqliteDatabase } from './load-sqlite.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

const META_VERSION = 1 as const

export type IngestCursorMeta = {
  version: typeof META_VERSION
  /** Logical provider (openalex | crossref). */
  provider: ScheduledIngestCursor['provider']
  filter?: string
}

/** Encode PK for ingest_cursors.provider. */
export function ingestCursorRowKey(
  provider: ScheduledIngestCursor['provider'],
  filter?: string,
): string {
  const f = filter ?? ''
  return f.length > 0 ? `${provider}|${f}` : provider
}

/** Decode row key → logical provider + filter. */
export function parseIngestCursorRowKey(
  rowKey: string,
): { provider: ScheduledIngestCursor['provider']; filter?: string } | null {
  const pipe = rowKey.indexOf('|')
  if (pipe < 0) {
    if (rowKey === 'openalex' || rowKey === 'crossref') {
      return { provider: rowKey }
    }
    return null
  }
  const head = rowKey.slice(0, pipe)
  const filter = rowKey.slice(pipe + 1)
  if (head !== 'openalex' && head !== 'crossref') return null
  return { provider: head, filter: filter.length > 0 ? filter : undefined }
}

function parseMeta(
  metaJson: string | null,
  rowKey: string,
): IngestCursorMeta | null {
  const fromKey = parseIngestCursorRowKey(rowKey)
  if (!fromKey) return null
  if (!metaJson) {
    return {
      version: META_VERSION,
      provider: fromKey.provider,
      ...(fromKey.filter !== undefined ? { filter: fromKey.filter } : {}),
    }
  }
  try {
    const raw = JSON.parse(metaJson) as Partial<IngestCursorMeta>
    const provider =
      raw.provider === 'openalex' || raw.provider === 'crossref'
        ? raw.provider
        : fromKey.provider
    const filter =
      typeof raw.filter === 'string'
        ? raw.filter
        : fromKey.filter
    return {
      version: META_VERSION,
      provider,
      ...(filter !== undefined && filter.length > 0 ? { filter } : {}),
    }
  } catch {
    return {
      version: META_VERSION,
      provider: fromKey.provider,
      ...(fromKey.filter !== undefined ? { filter: fromKey.filter } : {}),
    }
  }
}

/**
 * Load scheduled cursor store from an open knowledge DB.
 */
export function loadIngestCursorsFromDb(
  db: SqliteDatabase,
): ScheduledCursorStore {
  const rows = db
    .prepare(
      `SELECT provider, cursor, updated_at, meta_json FROM ingest_cursors ORDER BY provider`,
    )
    .all() as Array<{
    provider: string
    cursor: string | null
    updated_at: string
    meta_json: string | null
  }>

  const cursors: ScheduledIngestCursor[] = []
  for (const row of rows) {
    const meta = parseMeta(row.meta_json, row.provider)
    if (!meta) continue
    cursors.push({
      provider: meta.provider,
      cursor: row.cursor && row.cursor.length > 0 ? row.cursor : '*',
      updatedAt: row.updated_at,
      ...(meta.filter !== undefined ? { filter: meta.filter } : {}),
    })
  }
  return { version: 1, cursors }
}

/**
 * Upsert full scheduled cursor store into ingest_cursors.
 * Removes DB rows for openalex/crossref keys not present in the store
 * (keeps unknown non-provider keys if any future rows appear).
 */
export function saveIngestCursorsToDb(
  db: SqliteDatabase,
  store: ScheduledCursorStore,
): { written: number } {
  const upsert = db.prepare(`
    INSERT INTO ingest_cursors (provider, cursor, updated_at, meta_json)
    VALUES (@provider, @cursor, @updated_at, @meta_json)
    ON CONFLICT(provider) DO UPDATE SET
      cursor = excluded.cursor,
      updated_at = excluded.updated_at,
      meta_json = excluded.meta_json
  `)

  const keys = new Set<string>()
  const run = db.transaction(() => {
    for (const c of store.cursors) {
      if (c.provider !== 'openalex' && c.provider !== 'crossref') continue
      const key = ingestCursorRowKey(c.provider, c.filter)
      keys.add(key)
      const meta: IngestCursorMeta = {
        version: META_VERSION,
        provider: c.provider,
        ...(c.filter !== undefined ? { filter: c.filter } : {}),
      }
      upsert.run({
        provider: key,
        cursor: c.cursor,
        updated_at: c.updatedAt,
        meta_json: JSON.stringify(meta),
      })
    }

    // Drop stale openalex/crossref cursor rows not in this store
    const existing = db
      .prepare(`SELECT provider FROM ingest_cursors`)
      .all() as Array<{ provider: string }>
    const del = db.prepare(`DELETE FROM ingest_cursors WHERE provider = ?`)
    for (const { provider } of existing) {
      if (!parseIngestCursorRowKey(provider)) continue
      if (!keys.has(provider)) del.run(provider)
    }
  })
  run()
  return { written: keys.size }
}

export function readIngestCursorCounts(db: SqliteDatabase): {
  ingest_cursors: number
} {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM ingest_cursors`)
    .get() as { c: number }
  return { ingest_cursors: row.c }
}

/**
 * Open (migrate) knowledge.db and load cursor store.
 */
export function loadIngestCursorsFromPath(options?: {
  dbPath?: string
  root?: string
}): { dbPath: string; store: ScheduledCursorStore } {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  migrateKnowledgeDb({ dbPath, root })
  const db = openKnowledgeDb({ dbPath, root })
  try {
    return { dbPath, store: loadIngestCursorsFromDb(db) }
  } finally {
    db.close()
  }
}

/**
 * Open (migrate) knowledge.db and persist cursor store.
 */
export function saveIngestCursorsToPath(
  store: ScheduledCursorStore,
  options?: { dbPath?: string; root?: string },
): { dbPath: string; written: number } {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  migrateKnowledgeDb({ dbPath, root })
  const db = openKnowledgeDb({ dbPath, root })
  try {
    const { written } = saveIngestCursorsToDb(db, store)
    return { dbPath, written }
  } finally {
    db.close()
  }
}

export { emptyCursorStore }
