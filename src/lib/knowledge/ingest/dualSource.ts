/**
 * #48-I dual-source helpers: merge OpenAlex + Crossref snapshots by DOI.
 * No network; pure merge for scheduled dual crawls.
 */

import type { SourceSnapshot } from '../types'

/** Extract normalized DOI from a snapshot locator when present. */
export function doiFromSnapshot(snap: SourceSnapshot): string | null {
  if (snap.locatorKind === 'doi') {
    return snap.locator.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase()
  }
  const m = snap.locator.match(/doi\.org\/(.+)$/i)
  return m?.[1] ? m[1].toLowerCase() : null
}

export type DualMergeResult = {
  /** Prefer first occurrence per DOI; non-DOI snaps always kept. */
  merged: SourceSnapshot[]
  /** Second-provider snaps dropped as DOI duplicates. */
  duplicatesDropped: number
  byProvider: Record<string, number>
}

/**
 * Merge snapshot lists from multiple providers.
 * When the same DOI appears more than once, keep the first (call order =
 * priority). Non-DOI locators are never collapsed.
 */
export function mergeSnapshotsByDoi(
  ...lists: SourceSnapshot[][]
): DualMergeResult {
  const seen = new Set<string>()
  const merged: SourceSnapshot[] = []
  let duplicatesDropped = 0
  const byProvider: Record<string, number> = {}

  for (const list of lists) {
    for (const snap of list) {
      const provider = snap.provider ?? 'unknown'
      byProvider[provider] = (byProvider[provider] ?? 0) + 1
      const doi = doiFromSnapshot(snap)
      if (doi) {
        if (seen.has(doi)) {
          duplicatesDropped += 1
          continue
        }
        seen.add(doi)
      }
      merged.push(snap)
    }
  }

  return { merged, duplicatesDropped, byProvider }
}

/**
 * Cursor state for a scheduled single-provider crawl (serialize to disk).
 * Callers own the write path (e.g. data/knowledge-ingest/cursors.json).
 */
export type ScheduledIngestCursor = {
  provider: 'openalex' | 'crossref'
  /** Opaque cursor string (`*` = start). */
  cursor: string
  /** ISO-8601 last successful page. */
  updatedAt: string
  /** Optional filter that produced this cursor chain. */
  filter?: string
}

export type ScheduledCursorStore = {
  version: 1
  cursors: ScheduledIngestCursor[]
}

export function emptyCursorStore(): ScheduledCursorStore {
  return { version: 1, cursors: [] }
}

export function getCursor(
  store: ScheduledCursorStore,
  provider: ScheduledIngestCursor['provider'],
  filter?: string,
): string {
  const hit = store.cursors.find(
    (c) => c.provider === provider && (c.filter ?? '') === (filter ?? ''),
  )
  return hit?.cursor ?? '*'
}

export function advanceCursor(
  store: ScheduledCursorStore,
  provider: ScheduledIngestCursor['provider'],
  nextCursor: string | null,
  opts: { filter?: string; updatedAt?: string } = {},
): ScheduledCursorStore {
  const filter = opts.filter
  const updatedAt = opts.updatedAt ?? new Date().toISOString()
  const cursor = nextCursor && nextCursor.length > 0 ? nextCursor : '*'
  const rest = store.cursors.filter(
    (c) => !(c.provider === provider && (c.filter ?? '') === (filter ?? '')),
  )
  return {
    version: 1,
    cursors: [
      ...rest,
      {
        provider,
        cursor,
        updatedAt,
        ...(filter !== undefined ? { filter } : {}),
      },
    ],
  }
}
