/**
 * K18/K20: seed open conflict_sets for Controversies UX demos.
 * Idempotent by fixed conflict ids. Does not invent claim bodies.
 *
 * K20: second subject so UI can list ≥2 open controversies.
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export const DEMO_CONFLICT_ID = 'demo-conflict-k18-open' as const
export const DEMO_CONFLICT_SUBJECT = 'edge:demo-efficiency-dispute' as const

/** K20: second open controversy (different subject). */
export const DEMO_CONFLICT_ID_K20 = 'demo-conflict-k20-open' as const
export const DEMO_CONFLICT_SUBJECT_K20 = 'edge:demo-impedance-mismatch' as const

/** K28: third open controversy for multi-row Controversies UX density. */
export const DEMO_CONFLICT_ID_K28 = 'demo-conflict-k28-open' as const
export const DEMO_CONFLICT_SUBJECT_K28 = 'edge:demo-material-property-dispute' as const

export const DEMO_CONFLICT_DEFS = [
  {
    id: DEMO_CONFLICT_ID,
    subjectId: DEMO_CONFLICT_SUBJECT,
    reason:
      'Demo open controversy for Controversies UX (K18). Not scientific adjudication.',
  },
  {
    id: DEMO_CONFLICT_ID_K20,
    subjectId: DEMO_CONFLICT_SUBJECT_K20,
    reason:
      'Second demo open controversy (K20) for multi-row Controversies UX. Not scientific adjudication.',
  },
  {
    id: DEMO_CONFLICT_ID_K28,
    subjectId: DEMO_CONFLICT_SUBJECT_K28,
    reason:
      'Third demo open controversy (K28) for Controversies list density. Not scientific adjudication.',
  },
] as const

export type SeedDemoConflictsResult = {
  dbPath: string
  /** True if any of the demo conflicts were newly inserted this call. */
  created: boolean
  /** Primary (K18) conflict id for back-compat callers. */
  conflictId: string
  claimIds: string[]
  /** All demo conflict ids present after seed. */
  conflictIds: string[]
  /** Per-conflict created flags. */
  createdById: Record<string, boolean>
}

export function seedDemoConflictSetsSync(options?: {
  dbPath?: string
  root?: string
}): SeedDemoConflictsResult {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root })
  try {
    return seedDemoConflictSetsOnDb(db, dbPath)
  } finally {
    db.close()
  }
}

export function seedDemoConflictSetsOnDb(
  db: SqliteDatabase,
  dbPath: string,
): SeedDemoConflictsResult {
  const claims = db
    .prepare(`SELECT id FROM claims WHERE state = 'released' ORDER BY id LIMIT 4`)
    .all() as Array<{ id: string }>
  const claimIds = claims.map((c) => c.id)
  const now = new Date().toISOString()
  const createdById: Record<string, boolean> = {}
  const conflictIds: string[] = []

  const insertSet = db.prepare(
    `INSERT INTO conflict_sets (
       id, contract_version, subject_id, reason, resolution_note, state, created_at, updated_at
     ) VALUES (?, 1, ?, ?, NULL, 'open', ?, NULL)`,
  )
  const insertMember = db.prepare(
    `INSERT OR IGNORE INTO conflict_members (conflict_id, claim_id) VALUES (?, ?)`,
  )
  const existsStmt = db.prepare(`SELECT id FROM conflict_sets WHERE id = ?`)

  for (let i = 0; i < DEMO_CONFLICT_DEFS.length; i++) {
    const def = DEMO_CONFLICT_DEFS[i]!
    conflictIds.push(def.id)
    const existing = existsStmt.get(def.id) as { id: string } | undefined
    if (existing) {
      createdById[def.id] = false
      // Ensure members if claims appeared later
      for (const id of claimIds) {
        insertMember.run(def.id, id)
      }
      continue
    }
    insertSet.run(def.id, def.subjectId, def.reason, now)
    createdById[def.id] = true
    // Distribute released claims across demo conflicts when available;
    // otherwise all conflicts share the same claim set.
    let pair = claimIds
    if (claimIds.length >= DEMO_CONFLICT_DEFS.length) {
      const stride = Math.max(1, Math.floor(claimIds.length / DEMO_CONFLICT_DEFS.length))
      pair = claimIds.slice(i * stride, i * stride + Math.max(2, stride))
      if (pair.length < 1) pair = claimIds
    }
    for (const id of pair) {
      insertMember.run(def.id, id)
    }
  }

  const primaryMembers = db
    .prepare(`SELECT claim_id AS id FROM conflict_members WHERE conflict_id = ?`)
    .all(DEMO_CONFLICT_ID) as Array<{ id: string }>

  return {
    dbPath,
    created: Object.values(createdById).some(Boolean),
    conflictId: DEMO_CONFLICT_ID,
    claimIds: primaryMembers.map((m) => m.id),
    conflictIds,
    createdById,
  }
}
