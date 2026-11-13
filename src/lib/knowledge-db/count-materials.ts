/**
 * K41: materials counts by kind (public companion to K35 list filter).
 * Host: GET /api/v1/knowledge/materials/counts
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export const MATERIAL_COUNT_KINDS = [
  'forcefield_lj',
  'fluid_continuum',
  'device_product',
  'other',
] as const

export type MaterialCountsByKind = {
  forcefield_lj: number
  fluid_continuum: number
  device_product: number
  other: number
  total: number
  unknown: number
}

export function countMaterialsByKindOnDb(db: SqliteDatabase): MaterialCountsByKind {
  const rows = db
    .prepare(`SELECT kind, COUNT(*) AS c FROM materials GROUP BY kind`)
    .all() as Array<{ kind: string; c: number }>

  const out: MaterialCountsByKind = {
    forcefield_lj: 0,
    fluid_continuum: 0,
    device_product: 0,
    other: 0,
    total: 0,
    unknown: 0,
  }
  for (const r of rows) {
    const n = Number(r.c) || 0
    if (r.kind === 'forcefield_lj') out.forcefield_lj = n
    else if (r.kind === 'fluid_continuum') out.fluid_continuum = n
    else if (r.kind === 'device_product') out.device_product = n
    else if (r.kind === 'other') out.other = n
    else out.unknown += n
  }
  out.total =
    out.forcefield_lj +
    out.fluid_continuum +
    out.device_product +
    out.other +
    out.unknown
  return out
}

export function countMaterialsByKindSync(options?: {
  root?: string
  dbPath?: string
}): MaterialCountsByKind {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countMaterialsByKindOnDb(db)
  } finally {
    db.close()
  }
}

/** K49: materials counts by fidelity. */
export type MaterialCountsByFidelity = {
  quantitative: number
  qualitative: number
  /** fidelity IS NULL */
  unknown: number
  total: number
  other: number
}

export function countMaterialsByFidelityOnDb(
  db: SqliteDatabase,
): MaterialCountsByFidelity {
  const rows = db
    .prepare(
      `SELECT fidelity, COUNT(*) AS c FROM materials GROUP BY fidelity`,
    )
    .all() as Array<{ fidelity: string | null; c: number }>

  const out: MaterialCountsByFidelity = {
    quantitative: 0,
    qualitative: 0,
    unknown: 0,
    total: 0,
    other: 0,
  }
  for (const r of rows) {
    const n = Number(r.c) || 0
    if (r.fidelity === 'quantitative') out.quantitative = n
    else if (r.fidelity === 'qualitative') out.qualitative = n
    else if (r.fidelity == null || r.fidelity === '') out.unknown += n
    else out.other += n
  }
  out.total =
    out.quantitative + out.qualitative + out.unknown + out.other
  return out
}

export function countMaterialsByFidelitySync(options?: {
  root?: string
  dbPath?: string
}): MaterialCountsByFidelity {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countMaterialsByFidelityOnDb(db)
  } finally {
    db.close()
  }
}
