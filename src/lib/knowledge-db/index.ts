/**
 * Knowledge DB (SQLite) — EPIC #52.
 * Runtime authority for ontology skeleton + claims/releases.
 * @see docs/knowledge-db.md
 */

export {
  LIVE_KNOWLEDGE_BLOBS_BASENAME,
  LIVE_KNOWLEDGE_DATA_DIR,
  LIVE_KNOWLEDGE_DB_BASENAME,
  LIVE_KNOWLEDGE_RELEASES_BASENAME,
  defaultBlobsDir,
  defaultKnowledgeDbPath,
  defaultReleasesDir,
  defaultSchemaPath,
  ensureLiveKnowledgeDirs,
  ensureParentDir,
  liveKnowledgeBlobsDir,
  liveKnowledgeDbPath,
  liveKnowledgeReleasesDir,
  repoRootFromHere,
  resolveKnowledgeBlobsDir,
  resolveKnowledgeDataDir,
  resolveKnowledgeDbPath,
  resolveKnowledgeReleasesDir,
  resolveSafeKnowledgeBlobPath,
  resolveSchemaPath,
} from './paths.ts'

export { loadBetterSqlite3, type BetterSqlite3Ctor, type SqliteDatabase } from './load-sqlite.ts'

export {
  KNOWLEDGE_SCHEMA_MIGRATION_ID,
  knowledgeDbStatus,
  listAppliedMigrations,
  listTables,
  migrateKnowledgeDb,
  openKnowledgeDb,
  type MigrateResult,
} from './migrate.ts'

export {
  MATERIAL_ID_BY_NAME,
  MATERIAL_PROPERTY_SPECS,
  countStaticMaterialProperties,
  orderNodesParentsFirst,
  readSeedCounts,
  resolveMaterialId,
  seedKnowledgeDbFromStaticData,
  seedKnowledgeDbFromStaticSync,
  type SeedCounts,
  type SeedFromStaticResult,
} from './seed-from-static.ts'

export {
  SEED_CLAIM_EPOCH,
  SEED_EFFICIENCY_RELEASE_ID,
  SEED_GATE_AT,
  SEED_RELEASED_AT,
  bindingIdForClaimSnapshot,
  buildEdgeEfficiencyClaimBundle,
  claimIdForEdgeEfficiency,
  efficiencyStatementFromQuantity,
  persistEfficiencyReleaseToDb,
  promoteEdgeEfficiencyBundle,
  readClaimSeedCounts,
  seedEfficiencyClaimsFromEdges,
  seedEfficiencyClaimsFromEdgesSync,
  snapshotIdForLocator,
  type EdgeClaimBundle,
  type EdgeEfficiencyLike,
  type SeedClaimsCounts,
  type SeedClaimsFromEdgesResult,
} from './seed-claims-from-edges.ts'

export {
  defaultSeedDbPath,
  seedKnowledgeDbFromRepo,
  seedKnowledgeDbFromRepoFull,
  staticInventory,
} from './seed-from-static.repo.ts'

export {
  SEED_AIR_MATERIAL_CLAIM_ID,
  SEED_AIR_MATERIAL_SUBJECT_ID,
  SEED_LBM_JOB_KIND,
  SEED_LBM_PARAM_PACK_CLAIM_ID,
  SEED_LBM_PARAM_PACK_PARAMETERS,
  SEED_LBM_PARAM_PACK_SUBJECT_ID,
  SEED_LBM_PARAM_PACK_UNITS,
  SEED_SIM_PARAM_PACK_EPOCH,
  SEED_SIM_PARAM_PACK_RELEASE_ID,
  SEED_SIM_PARAM_PACK_RELEASED_AT,
  buildSeedSimParamPackRelease,
  persistSeedSimParamPackToDb,
  seedSimParamPackReleaseSync,
  type SeedSimParamPackResult,
} from './seed-sim-param-pack.ts'

export {
  DEFAULT_KNOWLEDGE_SOURCE,
  KNOWLEDGE_SEED_EDGES_DATA_PATH,
  KNOWLEDGE_SEED_ONLY_STATIC_PATHS,
  KNOWLEDGE_SOURCES,
  KNOWLEDGE_SOURCE_ENV,
  isKnowledgeSource,
  resolveKnowledgeSource,
  type KnowledgeSource,
} from './source.ts'

export {
  CONFLICT_LIST_STATES,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  claimRowToReleasedDto,
  countNonReleasedInPublicView,
  getKnowledgeConflictSet,
  getKnowledgeEdge,
  getKnowledgeMaterial,
  getKnowledgeNode,
  getKnowledgeRelease,
  getLatestKnowledgeRelease,
  getSourceSnapshot,
  listKnowledgeConflictSets,
  listKnowledgeEdges,
  listKnowledgeMaterials,
  listKnowledgeNodes,
  listKnowledgeReleases,
  listReleasedClaimsForSubject,
  listReleasedClaimsForSubjects,
  listSourceSnapshotsByContentSha,
  normalizeConflictListState,
  releasedClaimDtoToClaim,
  withKnowledgeDb,
  type ConflictListState,
  type KnowledgeConflictSetDto,
  type KnowledgeEdgeDto,
  type KnowledgeEdgeProductDto,
  type KnowledgeMaterialDto,
  type KnowledgeMaterialPropertyDto,
  type KnowledgeNodeDto,
  type KnowledgeReleaseDetailDto,
  type KnowledgeReleaseSummaryDto,
  type KnowledgeSourceSnapshotDto,
  type ListConflictsQuery,
  type ListConflictsResult,
  type ListEdgesQuery,
  type PageQuery,
  type PageResult,
  type ReadDbOptions,
  type ReleasedClaimDto,
} from './read.ts'

/** K13: local SQLite edge-detail p95 smoke (Host GET edges/:id path). */
export {
  EDGE_DETAIL_P95_BUDGET_MS,
  formatEdgeDetailP95Report,
  measureEdgeDetailP95,
  percentileNearestRank,
  resolveSmokeEdgeIds,
  type EdgeDetailP95Options,
  type EdgeDetailP95Report,
} from './edge-detail-p95-smoke.ts'

/** K14: live Host GET /api/v1/knowledge/edges/:id HTTP p95 smoke. */
export {
  DEFAULT_KNOWLEDGE_HTTP_P95_BASE,
  EDGE_DETAIL_HTTP_P95_BUDGET_MS,
  formatEdgeDetailHttpP95Report,
  measureEdgeDetailHttpP95,
  resolveHttpP95BudgetMs,
  resolveHttpSmokeEdgeIds,
  resolveKnowledgeHttpP95Base,
  type EdgeDetailHttpP95Options,
  type EdgeDetailHttpP95Report,
} from './edge-detail-http-p95-smoke.ts'

export {
  createKnowledgeAdapter,
  getKnowledgeAdapter,
  resetKnowledgeAdapterCache,
  type KnowledgeAdapter,
  type KnowledgeAdapterOptions,
  type StaticMaterialLike,
} from './adapter.ts'

export {
  DEFAULT_KNOWLEDGE_API_BASE,
  knowledgeEdgeDtoToConversionEdge,
  knowledgeNodeDtoToEnergyNode,
  loadAtlasOntology,
  loadAtlasOntologyFromAdapter,
  loadAtlasOntologyFromApi,
  loadAtlasOntologyStatic,
  type AtlasOntologyBundle,
  type AtlasOntologySource,
  type LoadAtlasOntologyOptions,
} from './atlas-ontology.ts'

export {
  emptyCursorStore,
  ingestCursorRowKey,
  loadIngestCursorsFromDb,
  loadIngestCursorsFromPath,
  parseIngestCursorRowKey,
  readIngestCursorCounts,
  saveIngestCursorsToDb,
  saveIngestCursorsToPath,
  type IngestCursorMeta,
} from './ingest-cursors.ts'

export {
  exportKnowledgeReleaseJson,
  persistKnowledgeReleaseToDb,
  publishKnowledgeReleaseToDb,
  upsertSourceSnapshots,
  type PersistReleaseInput,
  type PersistReleaseResult,
  type PublishReleaseToDbOptions,
  type PublishReleaseToDbResult,
} from './publish-release.ts'

export {
  resolveJobErrorStatus,
  resolveJobSpecFromKnowledge,
  type ResolveJobErrorCode,
  type ResolveJobErr,
  type ResolveJobInput,
  type ResolveJobOk,
  type ResolveJobOverrides,
  type ResolveJobProvenance,
  type ResolveJobRefs,
  type ResolveJobResult,
  type ResolvedJobSpec,
} from './resolve-job.ts'

/** K18/K20: demo open conflict_sets for Controversies UX (≥2 subjects). */
export {
  DEMO_CONFLICT_DEFS,
  DEMO_CONFLICT_ID,
  DEMO_CONFLICT_ID_K20,
  DEMO_CONFLICT_ID_K28,
  DEMO_CONFLICT_SUBJECT,
  DEMO_CONFLICT_SUBJECT_K20,
  DEMO_CONFLICT_SUBJECT_K28,
  seedDemoConflictSetsOnDb,
  seedDemoConflictSetsSync,
  type SeedDemoConflictsResult,
} from './seed-demo-conflicts.ts'

/** K22: materials create write path (+ candidate sim.material claim). */
export {
  claimIdForSimMaterial,
  createKnowledgeMaterialOnDb,
  createKnowledgeMaterialSync,
  normalizeCreateMaterialInput,
  propertyIdForMaterial,
  type CreateMaterialInput,
  type CreateMaterialPropertyInput,
  type CreateMaterialResult,
  type MaterialKind,
} from './create-material.ts'

/** K23: conversion edges create write path (+ candidate conversion.efficiency claim). */
export {
  claimIdForConversionEfficiency,
  createKnowledgeEdgeOnDb,
  createKnowledgeEdgeSync,
  normalizeCreateEdgeInput,
  type CreateEdgeInput,
  type CreateEdgeResult,
  type EfficiencyKind,
} from './create-edge.ts'

/** K24: energy nodes create write path. */
export {
  createKnowledgeNodeOnDb,
  createKnowledgeNodeSync,
  normalizeCreateNodeInput,
  type CreateNodeInput,
  type CreateNodeResult,
} from './create-node.ts'

/** K26/K29: claim lifecycle promote (single + batch). */
export {
  CLAIM_WRITE_STATES,
  isBatchPromoteBody,
  normalizePromoteClaimBatchInput,
  normalizePromoteClaimInput,
  promoteClaimBatchOnDb,
  promoteClaimBatchSync,
  promoteClaimOnDb,
  promoteClaimSync,
  type ClaimWriteState,
  type PromoteClaimBatchInput,
  type PromoteClaimBatchResult,
  type PromoteClaimInput,
  type PromoteClaimResult,
} from './promote-claim.ts'

/** K27: list claims by state (ops / promote companion). */
export {
  CLAIM_LIST_STATES,
  listClaimsOnDb,
  listClaimsSync,
  type ClaimListState,
  type KnowledgeClaimListItem,
  type ListClaimsQuery,
  type ListClaimsResult,
} from './list-claims.ts'

/** K32: get single claim by id (ops companion to K27 list). */
export {
  getClaimOnDb,
  getClaimSync,
  type GetClaimResult,
} from './get-claim.ts'

/** K34: claim counts by lifecycle state. */
export {
  CLAIM_COUNT_STATES,
  countClaimsByStateOnDb,
  countClaimsByStateSync,
  type ClaimCountState,
  type ClaimCountsByState,
} from './count-claims.ts'

/** K46: claim counts by kind. */
export {
  CLAIM_COUNT_KIND_BUCKETS,
  countClaimsByKindOnDb,
  countClaimsByKindSync,
  type ClaimCountsByKind,
} from './count-claims-by-kind.ts'

/** K30: resolve (close) open conflict_sets. */
export {
  normalizeResolveConflictInput,
  resolveConflictOnDb,
  resolveConflictSync,
  type ResolveConflictInput,
  type ResolveConflictResult,
} from './resolve-conflict.ts'

/** K39: reopen resolved conflict_sets. */
export {
  reopenConflictOnDb,
  reopenConflictSync,
  type ReopenConflictResult,
} from './reopen-conflict.ts'

/** K40: conflict counts by state. */
export {
  countConflictsByStateOnDb,
  countConflictsByStateSync,
  type ConflictCountsByState,
} from './count-conflicts.ts'

/** K41: materials counts by kind; K49 by fidelity. */
export {
  MATERIAL_COUNT_KINDS,
  countMaterialsByFidelityOnDb,
  countMaterialsByFidelitySync,
  countMaterialsByKindOnDb,
  countMaterialsByKindSync,
  type MaterialCountsByFidelity,
  type MaterialCountsByKind,
} from './count-materials.ts'

/** K50: material_properties totals. */
export {
  countMaterialPropertiesOnDb,
  countMaterialPropertiesSync,
  type MaterialPropertyCounts,
} from './count-material-properties.ts'

/** K51: evidence_bindings counts by support. */
export {
  countEvidenceBindingsBySupportOnDb,
  countEvidenceBindingsBySupportSync,
  type EvidenceBindingCountsBySupport,
} from './count-evidence-bindings.ts'

/** K52: conflict_members membership totals. */
export {
  countConflictMembersOnDb,
  countConflictMembersSync,
  type ConflictMemberCounts,
} from './count-conflict-members.ts'

/** K53: release_claims membership totals. */
export {
  countReleaseClaimsOnDb,
  countReleaseClaimsSync,
  type ReleaseClaimCounts,
} from './count-release-claims.ts'

/** K54: release_snapshots membership totals. */
export {
  countReleaseSnapshotsOnDb,
  countReleaseSnapshotsSync,
  type ReleaseSnapshotCounts,
} from './count-release-snapshots.ts'

/** K55: release_bindings membership totals. */
export {
  countReleaseBindingsOnDb,
  countReleaseBindingsSync,
  type ReleaseBindingCounts,
} from './count-release-bindings.ts'

/** K56: release_conflicts membership totals. */
export {
  countReleaseConflictsOnDb,
  countReleaseConflictsSync,
  type ReleaseConflictCounts,
} from './count-release-conflicts.ts'

/** K57: edge_devices totals. */
export {
  countEdgeDevicesOnDb,
  countEdgeDevicesSync,
  type EdgeDeviceCounts,
} from './count-edge-devices.ts'

/** K58: edge_products totals. */
export {
  countEdgeProductsOnDb,
  countEdgeProductsSync,
  type EdgeProductCounts,
} from './count-edge-products.ts'

/** K59: material_categories totals. */
export {
  countMaterialCategoriesOnDb,
  countMaterialCategoriesSync,
  type MaterialCategoryCounts,
} from './count-material-categories.ts'

/** K60: ingest_cursors totals. */
export {
  countIngestCursorsOnDb,
  countIngestCursorsSync,
  type IngestCursorCounts,
} from './count-ingest-cursors.ts'

/** K42: edges counts by status; K48 by efficiency_kind. */
export {
  countEdgesByEfficiencyKindOnDb,
  countEdgesByEfficiencyKindSync,
  countEdgesByStatusOnDb,
  countEdgesByStatusSync,
  type EdgeCountsByEfficiencyKind,
  type EdgeCountsByStatus,
} from './count-edges.ts'

/** K43: nodes counts by parent (roots vs children). */
export {
  countNodesByParentOnDb,
  countNodesByParentSync,
  type NodeCountsByParent,
} from './count-nodes.ts'

/** K44: snapshots counts by locator_kind; K47 by capture_status. */
export {
  SNAPSHOT_LOCATOR_KINDS,
  countSnapshotsByCaptureStatusOnDb,
  countSnapshotsByCaptureStatusSync,
  countSnapshotsByLocatorKindOnDb,
  countSnapshotsByLocatorKindSync,
  type SnapshotCountsByCaptureStatus,
  type SnapshotCountsByLocatorKind,
} from './count-snapshots.ts'

/** K45: knowledge_releases totals + export presence. */
export {
  countReleasesOnDb,
  countReleasesSync,
  type ReleaseCounts,
} from './count-releases.ts'

/** K61: aggregate inventory counts; K63: evidence envelope for offline dump. */
export {
  buildKnowledgeInventoryEvidenceOnDb,
  countKnowledgeInventoryOnDb,
  countKnowledgeInventorySync,
  dumpKnowledgeInventoryEvidenceSync,
  summarizeKnowledgeInventory,
  type KnowledgeInventoryCounts,
  type KnowledgeInventoryEvidence,
  type KnowledgeInventorySummary,
} from './count-all.ts'

/** K63: pure compact formatters for inventory totals (Gitea/checklist paste). */
export {
  extractInventoryTotals,
  formatInventoryMarkdown,
  formatInventorySummary,
  type InventoryTotals,
} from './format-inventory-summary.ts'
/** K64 floors + K65 paste helpers for offline close-checklist. */
export {
  checkInventoryFloors,
  formatInventoryFloorMarkdown,
  formatInventoryFloorReport,
  KNOWLEDGE_INVENTORY_FLOORS,
  type InventoryFloorCheckResult,
  type InventoryFloorField,
  type InventoryFloorViolation,
} from './check-inventory-floors.ts'
