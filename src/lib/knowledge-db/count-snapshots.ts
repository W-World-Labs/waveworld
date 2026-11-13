/**
 * K44: source_snapshots counts by locator_kind (public companion to K19 reverse index).
 * Host: GET /api/v1/knowledge/snapshots/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export const SNAPSHOT_LOCATOR_KINDS = [
  'url',
  'doi',
  'citation',
  'other',
] as const

export type SnapshotCountsByLocatorKind = {
  url: number
  doi: number
  citation: number
  other: number
  total: number
  unknown: number
}

export function countSnapshotsByLocatorKindOnDb(
  db: SqliteDatabase,
): SnapshotCountsByLocatorKind {
  const rows = db
    .prepare(
      `SELECT locator_kind, COUNT(*) AS c FROM source_snapshots GROUP BY locator_kind`,
    )
    .all() as Array<{ locator_kind: string; c: number }>

  const out: SnapshotCountsByLocatorKind = {
    url: 0,
    doi: 0,
    citation: 0,
    other: 0,
    total: 0,
    unknown: 0,
  }
  for (const r of rows) {
    const n = Number(r.c) || 0
    if (r.locator_kind === 'url') out.url = n
    else if (r.locator_kind === 'doi') out.doi = n
    else if (r.locator_kind === 'citation') out.citation = n
    else if (r.locator_kind === 'other') out.other = n
    else out.unknown += n
  }
  out.total = out.url + out.doi + out.citation + out.other + out.unknown
  return out
}

export function countSnapshotsByLocatorKindSync(options?: {
  root?: string
  dbPath?: string
}): SnapshotCountsByLocatorKind {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countSnapshotsByLocatorKindOnDb(db)
  } finally {
    db.close()
  }
}

/** K47: source_snapshots counts by capture_status. */
export type SnapshotCountsByCaptureStatus = {
  locator_only: number
  bytes_captured: number
  total: number
  other: number
}

export function countSnapshotsByCaptureStatusOnDb(
  db: SqliteDatabase,
): SnapshotCountsByCaptureStatus {
  const rows = db
    .prepare(
      `SELECT capture_status, COUNT(*) AS c FROM source_snapshots GROUP BY capture_status`,
    )
    .all() as Array<{ capture_status: string; c: number }>

  const out: SnapshotCountsByCaptureStatus = {
    locator_only: 0,
    bytes_captured: 0,
    total: 0,
    other: 0,
  }
  for (const r of rows) {
    const n = Number(r.c) || 0
    if (r.capture_status === 'locator-only') out.locator_only = n
    else if (r.capture_status === 'bytes-captured') out.bytes_captured = n
    else out.other += n
  }
  out.total = out.locator_only + out.bytes_captured + out.other
  return out
}

export function countSnapshotsByCaptureStatusSync(options?: {
  root?: string
  dbPath?: string
}): SnapshotCountsByCaptureStatus {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countSnapshotsByCaptureStatusOnDb(db)
  } finally {
    db.close()
  }
}
