/**
 * #48-K One-tick scheduled dual-source ingest (cursor-aware).
 *
 * Operator / cron runs one page per provider, advances cursors, merges by DOI.
 * Does not auto-publish KnowledgeRelease (still requires extract → gate → publish).
 */

import type { SourceSnapshot } from '../types'
import {
  ingestOpenAlexWorksPage,
  type OpenAlexIngestOptions,
} from './openalex'
import {
  ingestCrossrefWorksPage,
  CrossrefIngestError,
  type CrossrefIngestOptions,
} from './crossref'
import {
  advanceCursor,
  emptyCursorStore,
  getCursor,
  mergeSnapshotsByDoi,
  type DualMergeResult,
  type ScheduledCursorStore,
} from './dualSource'

export type IngestProvider = 'openalex' | 'crossref'

export type ScheduledIngestTickOptions = {
  providers?: IngestProvider[]
  /** Shared filter applied per provider when provider-specific unset. */
  filter?: string
  openalexFilter?: string
  crossrefFilter?: string
  openalex?: Omit<OpenAlexIngestOptions, 'cursor' | 'filter' | 'fetchImpl'>
  crossref?: Omit<CrossrefIngestOptions, 'cursor' | 'filter' | 'fetchImpl'>
  cursorStore?: ScheduledCursorStore
  /** Fixed clock for tests. */
  now?: string
  fetchImpl?: typeof fetch
  mailto?: string
}

export type ProviderTickResult = {
  provider: IngestProvider
  filter?: string
  snapshotCount: number
  nextCursor: string | null
  requestUrl: string
}

export type ScheduledIngestTickResult = {
  cursorStore: ScheduledCursorStore
  snapshots: SourceSnapshot[]
  merge: DualMergeResult
  pages: ProviderTickResult[]
  capturedAt: string
}

/**
 * Run one page for each requested provider, advance cursors, merge snapshots.
 */
export async function runScheduledIngestTick(
  opts: ScheduledIngestTickOptions = {},
): Promise<ScheduledIngestTickResult> {
  const providers = opts.providers ?? (['openalex', 'crossref'] as IngestProvider[])
  const capturedAt = opts.now ?? new Date().toISOString()
  let store = opts.cursorStore ?? emptyCursorStore()
  const pages: ProviderTickResult[] = []
  const lists: SourceSnapshot[][] = []

  for (const provider of providers) {
    if (provider === 'openalex') {
      const filter = opts.openalexFilter ?? opts.filter
      const cursor = getCursor(store, 'openalex', filter)
      const page = await ingestOpenAlexWorksPage({
        ...opts.openalex,
        filter,
        cursor,
        mailto: opts.mailto ?? opts.openalex?.mailto,
        capturedAt,
        fetchImpl: opts.fetchImpl,
      })
      store = advanceCursor(store, 'openalex', page.nextCursor, {
        filter,
        updatedAt: capturedAt,
      })
      lists.push(page.snapshots)
      pages.push({
        provider: 'openalex',
        filter,
        snapshotCount: page.snapshots.length,
        nextCursor: page.nextCursor,
        requestUrl: page.requestUrl,
      })
    } else {
      const filter = opts.crossrefFilter ?? opts.filter
      const cursor = getCursor(store, 'crossref', filter)
      const request = (pageCursor: string) =>
        ingestCrossrefWorksPage({
          ...opts.crossref,
          filter,
          cursor: pageCursor,
          mailto: opts.mailto ?? opts.crossref?.mailto,
          capturedAt,
          fetchImpl: opts.fetchImpl,
        })
      // A persisted Crossref cursor eventually dies upstream (404
      // cursor-invalid). Restart the chain from '*' once — the fresh
      // next-cursor then overwrites the dead one on advanceCursor.
      const page = await request(cursor).catch((err) => {
        if (err instanceof CrossrefIngestError && err.code === 'cursor_invalid' && cursor !== '*') {
          return request('*')
        }
        throw err
      })
      store = advanceCursor(store, 'crossref', page.nextCursor, {
        filter,
        updatedAt: capturedAt,
      })
      lists.push(page.snapshots)
      pages.push({
        provider: 'crossref',
        filter,
        snapshotCount: page.snapshots.length,
        nextCursor: page.nextCursor,
        requestUrl: page.requestUrl,
      })
    }
  }

  // OpenAlex first → preferred on DOI collide
  const merge = mergeSnapshotsByDoi(...lists)
  return {
    cursorStore: store,
    snapshots: merge.merged,
    merge,
    pages,
    capturedAt,
  }
}

/** Parse cursor store JSON; invalid → empty. */
export function parseCursorStore(raw: unknown): ScheduledCursorStore {
  if (!raw || typeof raw !== 'object') return emptyCursorStore()
  const v = raw as { version?: unknown; cursors?: unknown }
  if (v.version !== 1 || !Array.isArray(v.cursors)) return emptyCursorStore()
  return {
    version: 1,
    cursors: v.cursors.filter(
      (c): c is ScheduledCursorStore['cursors'][number] =>
        !!c &&
        typeof c === 'object' &&
        ((c as { provider?: string }).provider === 'openalex' ||
          (c as { provider?: string }).provider === 'crossref') &&
        typeof (c as { cursor?: string }).cursor === 'string' &&
        typeof (c as { updatedAt?: string }).updatedAt === 'string',
    ),
  }
}

export function serializeCursorStore(store: ScheduledCursorStore): string {
  return `${JSON.stringify(store, null, 2)}\n`
}
