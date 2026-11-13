/**
 * K42: conversion_edges counts by status (public companion to edge list).
 * K48: counts by efficiency_kind (conversion|transport).
 * Host: GET /api/v1/knowledge/edges/counts[?by=status|efficiency_kind]
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type EdgeCountsByStatus = {
  active: number
  inactive: number
  total: number
  other: number
}

export function countEdgesByStatusOnDb(db: SqliteDatabase): EdgeCountsByStatus {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS c FROM conversion_edges GROUP BY status`)
    .all() as Array<{ status: string; c: number }>

  const out: EdgeCountsByStatus = {
    active: 0,
    inactive: 0,
    total: 0,
    other: 0,
  }
  for (const r of rows) {
    const n = Number(r.c) || 0
    if (r.status === 'active') out.active = n
    else if (r.status === 'inactive') out.inactive = n
    else out.other += n
  }
  out.total = out.active + out.inactive + out.other
  return out
}

export function countEdgesByStatusSync(options?: {
  root?: string
  dbPath?: string
}): EdgeCountsByStatus {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countEdgesByStatusOnDb(db)
  } finally {
    db.close()
  }
}

/** K48: conversion_edges by efficiency_kind. */
export type EdgeCountsByEfficiencyKind = {
  conversion: number
  transport: number
  total: number
  other: number
}

export function countEdgesByEfficiencyKindOnDb(
  db: SqliteDatabase,
): EdgeCountsByEfficiencyKind {
  const rows = db
    .prepare(
      `SELECT efficiency_kind, COUNT(*) AS c FROM conversion_edges GROUP BY efficiency_kind`,
    )
    .all() as Array<{ efficiency_kind: string; c: number }>

  const out: EdgeCountsByEfficiencyKind = {
    conversion: 0,
    transport: 0,
    total: 0,
    other: 0,
  }
  for (const r of rows) {
    const n = Number(r.c) || 0
    if (r.efficiency_kind === 'conversion') out.conversion = n
    else if (r.efficiency_kind === 'transport') out.transport = n
    else out.other += n
  }
  out.total = out.conversion + out.transport + out.other
  return out
}

export function countEdgesByEfficiencyKindSync(options?: {
  root?: string
  dbPath?: string
}): EdgeCountsByEfficiencyKind {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countEdgesByEfficiencyKindOnDb(db)
  } finally {
    db.close()
  }
}
