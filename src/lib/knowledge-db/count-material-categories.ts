/**
 * K59: material_categories totals (companion to materials counts).
 * Host: GET /api/v1/knowledge/materials/categories/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type MaterialCategoryCounts = {
  total: number
  /** categories referenced by ≥1 material */
  withMaterials: number
  /** categories with no materials */
  empty: number
}

export function countMaterialCategoriesOnDb(
  db: SqliteDatabase,
): MaterialCategoryCounts {
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM material_categories`)
    .get() as { c: number }
  const withRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM material_categories c
       WHERE EXISTS (
         SELECT 1 FROM materials m WHERE m.category_id = c.id
       )`,
    )
    .get() as { c: number }
  const total = Number(totalRow?.c) || 0
  const withMaterials = Number(withRow?.c) || 0
  return {
    total,
    withMaterials,
    empty: total - withMaterials,
  }
}

export function countMaterialCategoriesSync(options?: {
  root?: string
  dbPath?: string
}): MaterialCategoryCounts {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countMaterialCategoriesOnDb(db)
  } finally {
    db.close()
  }
}
