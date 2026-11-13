/**
 * K50: material_properties totals (public companion to materials / K41).
 * Host: GET /api/v1/knowledge/materials/properties/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type MaterialPropertyCounts = {
  total: number
  /** properties with non-null value_num */
  withNumeric: number
  /** properties with null value_num (text-only) */
  textOnly: number
  /** distinct property keys */
  distinctKeys: number
}

export function countMaterialPropertiesOnDb(
  db: SqliteDatabase,
): MaterialPropertyCounts {
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM material_properties`)
    .get() as { c: number }
  const numRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM material_properties WHERE value_num IS NOT NULL`,
    )
    .get() as { c: number }
  const keyRow = db
    .prepare(
      `SELECT COUNT(DISTINCT key) AS c FROM material_properties`,
    )
    .get() as { c: number }
  const total = Number(totalRow?.c) || 0
  const withNumeric = Number(numRow?.c) || 0
  return {
    total,
    withNumeric,
    textOnly: total - withNumeric,
    distinctKeys: Number(keyRow?.c) || 0,
  }
}

export function countMaterialPropertiesSync(options?: {
  root?: string
  dbPath?: string
}): MaterialPropertyCounts {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countMaterialPropertiesOnDb(db)
  } finally {
    db.close()
  }
}
