/**
 * K46: claims counts by kind (ops companion to K34 by-state + K27 list).
 * Host: GET /api/v1/knowledge/claims/counts?by=kind (registration key).
 *
 * Known buckets for common seed kinds; everything else → other + byKind map.
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export const CLAIM_COUNT_KIND_BUCKETS = [
  'conversion.efficiency',
  'sim.material',
  'sim.param_pack',
] as const

export type ClaimCountsByKind = {
  /** conversion.efficiency */
  conversion_efficiency: number
  /** sim.material */
  sim_material: number
  /** sim.param_pack */
  sim_param_pack: number
  /** all other kinds summed */
  other: number
  total: number
  /** full kind → count map (including known buckets) */
  byKind: Record<string, number>
}

export function countClaimsByKindOnDb(db: SqliteDatabase): ClaimCountsByKind {
  const rows = db
    .prepare(`SELECT kind, COUNT(*) AS c FROM claims GROUP BY kind`)
    .all() as Array<{ kind: string; c: number }>

  const byKind: Record<string, number> = {}
  let conversion_efficiency = 0
  let sim_material = 0
  let sim_param_pack = 0
  let other = 0
  let total = 0
  for (const r of rows) {
    const n = Number(r.c) || 0
    const k = r.kind ?? ''
    byKind[k] = n
    total += n
    if (k === 'conversion.efficiency') conversion_efficiency = n
    else if (k === 'sim.material') sim_material = n
    else if (k === 'sim.param_pack') sim_param_pack = n
    else other += n
  }
  return {
    conversion_efficiency,
    sim_material,
    sim_param_pack,
    other,
    total,
    byKind,
  }
}

export function countClaimsByKindSync(options?: {
  root?: string
  dbPath?: string
}): ClaimCountsByKind {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countClaimsByKindOnDb(db)
  } finally {
    db.close()
  }
}
