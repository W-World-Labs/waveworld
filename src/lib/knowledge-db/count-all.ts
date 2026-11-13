/**
 * K61: aggregate knowledge DB inventory counts for ops close-checklist.
 * K63: evidence envelope (dbPath, migrations, summary) for offline dump / #52 AC.
 * Host: GET /api/v1/knowledge/counts
 * Offline: scripts/knowledge/dump-inventory.ts · db-cli inventory
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { countClaimsByStateOnDb } from './count-claims.ts'
import { countConflictMembersOnDb } from './count-conflict-members.ts'
import { countConflictsByStateOnDb } from './count-conflicts.ts'
import { countEdgeDevicesOnDb } from './count-edge-devices.ts'
import { countEdgeProductsOnDb } from './count-edge-products.ts'
import { countEdgesByStatusOnDb } from './count-edges.ts'
import { countEvidenceBindingsBySupportOnDb } from './count-evidence-bindings.ts'
import { countIngestCursorsOnDb } from './count-ingest-cursors.ts'
import { countMaterialCategoriesOnDb } from './count-material-categories.ts'
import { countMaterialPropertiesOnDb } from './count-material-properties.ts'
import { countMaterialsByKindOnDb } from './count-materials.ts'
import { countNodesByParentOnDb } from './count-nodes.ts'
import { countReleaseBindingsOnDb } from './count-release-bindings.ts'
import { countReleaseClaimsOnDb } from './count-release-claims.ts'
import { countReleaseConflictsOnDb } from './count-release-conflicts.ts'
import { countReleaseSnapshotsOnDb } from './count-release-snapshots.ts'
import { countReleasesOnDb } from './count-releases.ts'
import { countSnapshotsByLocatorKindOnDb } from './count-snapshots.ts'
import { formatInventorySummary } from './format-inventory-summary.ts'
import {
  listAppliedMigrations,
  listTables,
  openKnowledgeDb,
} from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type KnowledgeInventoryCounts = {
  nodes: ReturnType<typeof countNodesByParentOnDb>
  edges: ReturnType<typeof countEdgesByStatusOnDb>
  edgeDevices: ReturnType<typeof countEdgeDevicesOnDb>
  edgeProducts: ReturnType<typeof countEdgeProductsOnDb>
  materials: ReturnType<typeof countMaterialsByKindOnDb>
  materialCategories: ReturnType<typeof countMaterialCategoriesOnDb>
  materialProperties: ReturnType<typeof countMaterialPropertiesOnDb>
  claims: ReturnType<typeof countClaimsByStateOnDb>
  evidenceBindings: ReturnType<typeof countEvidenceBindingsBySupportOnDb>
  conflicts: ReturnType<typeof countConflictsByStateOnDb>
  conflictMembers: ReturnType<typeof countConflictMembersOnDb>
  snapshots: ReturnType<typeof countSnapshotsByLocatorKindOnDb>
  releases: ReturnType<typeof countReleasesOnDb>
  releaseClaims: ReturnType<typeof countReleaseClaimsOnDb>
  releaseSnapshots: ReturnType<typeof countReleaseSnapshotsOnDb>
  releaseBindings: ReturnType<typeof countReleaseBindingsOnDb>
  releaseConflicts: ReturnType<typeof countReleaseConflictsOnDb>
  ingestCursors: ReturnType<typeof countIngestCursorsOnDb>
}

/** Flat totals for close-checklist one-liners / Gitea comments. */
export type KnowledgeInventorySummary = {
  nodes: number
  edges: number
  edgeDevices: number
  edgeProducts: number
  materials: number
  materialCategories: number
  materialProperties: number
  claims: number
  claimsReleased: number
  evidenceBindings: number
  conflicts: number
  conflictsOpen: number
  conflictMembers: number
  snapshots: number
  releases: number
  releasesWithExport: number
  releaseClaims: number
  releaseSnapshots: number
  releaseBindings: number
  releaseConflicts: number
  ingestCursors: number
}

/** Offline dump / ops evidence envelope (K63). */
export type KnowledgeInventoryEvidence = {
  source: 'db'
  generatedAt: string
  dbPath: string
  exists: boolean
  migrations: string[]
  tableCount: number
  tables: string[]
  counts: KnowledgeInventoryCounts
  summary: KnowledgeInventorySummary
  /** Compact one-liner for Gitea/checklist paste (from formatInventorySummary). */
  summaryLine: string
}

export function countKnowledgeInventoryOnDb(
  db: SqliteDatabase,
): KnowledgeInventoryCounts {
  return {
    nodes: countNodesByParentOnDb(db),
    edges: countEdgesByStatusOnDb(db),
    edgeDevices: countEdgeDevicesOnDb(db),
    edgeProducts: countEdgeProductsOnDb(db),
    materials: countMaterialsByKindOnDb(db),
    materialCategories: countMaterialCategoriesOnDb(db),
    materialProperties: countMaterialPropertiesOnDb(db),
    claims: countClaimsByStateOnDb(db),
    evidenceBindings: countEvidenceBindingsBySupportOnDb(db),
    conflicts: countConflictsByStateOnDb(db),
    conflictMembers: countConflictMembersOnDb(db),
    snapshots: countSnapshotsByLocatorKindOnDb(db),
    releases: countReleasesOnDb(db),
    releaseClaims: countReleaseClaimsOnDb(db),
    releaseSnapshots: countReleaseSnapshotsOnDb(db),
    releaseBindings: countReleaseBindingsOnDb(db),
    releaseConflicts: countReleaseConflictsOnDb(db),
    ingestCursors: countIngestCursorsOnDb(db),
  }
}

export function summarizeKnowledgeInventory(
  counts: KnowledgeInventoryCounts,
): KnowledgeInventorySummary {
  return {
    nodes: counts.nodes.total,
    edges: counts.edges.total,
    edgeDevices: counts.edgeDevices.total,
    edgeProducts: counts.edgeProducts.total,
    materials: counts.materials.total,
    materialCategories: counts.materialCategories.total,
    materialProperties: counts.materialProperties.total,
    claims: counts.claims.total,
    claimsReleased: counts.claims.released,
    evidenceBindings: counts.evidenceBindings.total,
    conflicts: counts.conflicts.total,
    conflictsOpen: counts.conflicts.open,
    conflictMembers: counts.conflictMembers.total,
    snapshots: counts.snapshots.total,
    releases: counts.releases.total,
    releasesWithExport: counts.releases.withExport,
    releaseClaims: counts.releaseClaims.total,
    releaseSnapshots: counts.releaseSnapshots.total,
    releaseBindings: counts.releaseBindings.total,
    releaseConflicts: counts.releaseConflicts.total,
    ingestCursors: counts.ingestCursors.total,
  }
}

export function buildKnowledgeInventoryEvidenceOnDb(
  db: SqliteDatabase,
  options: { dbPath: string; generatedAt?: string },
): KnowledgeInventoryEvidence {
  const counts = countKnowledgeInventoryOnDb(db)
  const tables = listTables(db)
  return {
    source: 'db',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    dbPath: options.dbPath,
    exists: true,
    migrations: listAppliedMigrations(db),
    tableCount: tables.length,
    tables,
    counts,
    summary: summarizeKnowledgeInventory(counts),
    summaryLine: formatInventorySummary(counts),
  }
}

export function countKnowledgeInventorySync(options?: {
  root?: string
  dbPath?: string
}): KnowledgeInventoryCounts {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return countKnowledgeInventoryOnDb(db)
  } finally {
    db.close()
  }
}

/** K63: full evidence dump for offline close-checklist (path + migrations + summary). */
export function dumpKnowledgeInventoryEvidenceSync(options?: {
  root?: string
  dbPath?: string
  generatedAt?: string
}): KnowledgeInventoryEvidence {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    return buildKnowledgeInventoryEvidenceOnDb(db, {
      dbPath,
      generatedAt: options?.generatedAt,
    })
  } finally {
    db.close()
  }
}
