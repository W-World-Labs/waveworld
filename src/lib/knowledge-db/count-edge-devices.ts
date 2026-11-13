/**
 * K57: edge_devices totals (companion to edges counts).
 * Host: GET /api/v1/knowledge/edges/devices/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type EdgeDeviceCounts = {
  total: number
  /** distinct edge_id with ≥1 device */
  distinctEdges: number
}

export function countEdgeDevicesOnDb(db: SqliteDatabase): EdgeDeviceCounts {
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM edge_devices`)
    .get() as { c: number }
  const edgeRow = db
    .prepare(`SELECT COUNT(DISTINCT edge_id) AS c FROM edge_devices`)
    .get() as { c: number }
  return {
    total: Number(totalRow?.c) || 0,
    distinctEdges: Number(edgeRow?.c) || 0,
  }
}

export function countEdgeDevicesSync(options?: {
  root?: string
  dbPath?: string
}): EdgeDeviceCounts {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countEdgeDevicesOnDb(db)
  } finally {
    db.close()
  }
}
