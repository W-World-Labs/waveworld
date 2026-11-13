/**
 * K51: evidence_bindings counts by support relation.
 * Host: GET /api/v1/knowledge/evidence-bindings/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type EvidenceBindingCountsBySupport = {
  supports: number
  refutes: number
  context: number
  total: number
  other: number
}

export function countEvidenceBindingsBySupportOnDb(
  db: SqliteDatabase,
): EvidenceBindingCountsBySupport {
  const rows = db
    .prepare(
      `SELECT support, COUNT(*) AS c FROM evidence_bindings GROUP BY support`,
    )
    .all() as Array<{ support: string; c: number }>

  const out: EvidenceBindingCountsBySupport = {
    supports: 0,
    refutes: 0,
    context: 0,
    total: 0,
    other: 0,
  }
  for (const r of rows) {
    const n = Number(r.c) || 0
    if (r.support === 'supports') out.supports = n
    else if (r.support === 'refutes') out.refutes = n
    else if (r.support === 'context') out.context = n
    else out.other += n
  }
  out.total = out.supports + out.refutes + out.context + out.other
  return out
}

export function countEvidenceBindingsBySupportSync(options?: {
  root?: string
  dbPath?: string
}): EvidenceBindingCountsBySupport {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countEvidenceBindingsBySupportOnDb(db)
  } finally {
    db.close()
  }
}
