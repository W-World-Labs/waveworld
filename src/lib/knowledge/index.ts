/**
 * Knowledge pipeline contracts (#48) — types, validation, deterministic release.
 * Atlas / matrix / graph must only consume KnowledgeRelease (state=released).
 */

export {
  CLAIM_KINDS_WITH_STATEMENT_SCHEMA,
  KNOWLEDGE_CONTRACT_VERSION,
  KNOWLEDGE_LIFECYCLE_STATES,
  LIFECYCLE_TRANSITIONS,
  type Claim,
  type ClaimDbRow,
  type ClaimKind,
  type ConflictSet,
  type EvidenceBinding,
  type EvidenceLocator,
  type EvidenceSupport,
  type KnowledgeContractVersion,
  type KnowledgeLifecycleState,
  type KnowledgeRelease,
  type KnowledgeReleaseBody,
  type SourceCaptureStatus,
  type SourceLocatorKind,
  type SourceSnapshot,
} from './types'

export {
  parseStatementJson,
  statementToJsonText,
  validateStatementForKind,
  type EdgeStatement,
  type EfficiencyStatement,
  type FormulaStatement,
  type MechanismStatement,
  type OtherStatement,
  type SimMaterialStatement,
  type SimParamPackStatement,
  type StatementConditions,
} from './statementSchema'

export {
  CLAIMS_TABLE_COLUMNS,
  claimDbRoundTrip,
  claimFromDbRow,
  claimToDbRow,
  type ClaimDbCodecError,
  type ClaimFromDbOk,
  type ClaimToDbOk,
} from './claimDb'

export {
  canTransition,
  isKnowledgeLifecycleState,
  validateClaim,
  validateConflictSet,
  validateEvidenceBinding,
  validateKnowledgeRelease,
  validateKnowledgeReleaseBody,
  validateSourceSnapshot,
  validateTransition,
} from './validate'

export { canonicalize, canonicalJson } from './canonical'
export { sha256Hex } from './hash'

export {
  buildKnowledgeRelease,
  computeReleaseSha256,
  releaseCanonicalPreimage,
  sortReleaseCollections,
  verifyKnowledgeRelease,
  type BuildReleaseInput,
} from './release'

export {
  buildEdgeRefsBlobStore,
  collectUniqueEdgeRefLocators,
  crawlLocatorUrls,
  edgeRefsLiveNetworkCrawlBulk,
  edgeRefsToProvisionalBindings,
  edgeRefsToProvisionalBindingsBulk,
  edgesToBulkItems,
  LIVE_LOCATOR_CRAWL_DEFAULT_MAX_BYTES,
  LIVE_LOCATOR_CRAWL_DEFAULT_TIMEOUT_MS,
  lookupBlobByContentSha,
  lookupBlobByLocator,
  type EdgeRefFixtureBytes,
  type EdgeRefsBlobLookup,
  type EdgeRefsBlobLookupEntry,
  type EdgeRefsBlobStore,
  type EdgeRefsBulkItem,
  type EdgeRefsBulkResult,
  type EdgeRefsMigrationOptions,
  type EdgeRefsMigrationResult,
  type LiveLocatorCrawlMapResult,
  type LiveLocatorCrawlOptions,
  type LiveLocatorCrawlOutcome,
  type LiveLocatorFetchImpl,
  type LiveNetworkCrawlBulkOptions,
  type LiveNetworkCrawlBulkResult,
} from './edgeRefs'

export {
  applyRetraction,
  blockedIdsForSilentCollapse,
  buildErrataConflictSet,
  claimContentKey,
  findDuplicateClaims,
  findStatementConflicts,
  hasRefuteEvidence,
  resolveConflictWithoutDelete,
  type ErrataConflictResult,
  type IntegrityFinding,
  type IntegrityKind,
  type RetractApplyResult,
} from './integrity'

export {
  conflictSetFromFinding,
  conflictSetsForClaimId,
  conflictSetsFromFindings,
  emitConflictSetsFromClaims,
  exportConflictSetVisibility,
  listConflictSets,
  type ConflictSetExport,
  type ConflictVisibilityRow,
  type EmitConflictSetsOptions,
  type EmitConflictSetsResult,
} from './conflictVisibility'

export {
  OPENALEX_DEFAULT_BASE,
  OpenAlexIngestError,
  ingestOpenAlexWorksPage,
  sourceSnapshotFromOpenAlexWork,
  type OpenAlexIngestOptions,
  type OpenAlexIngestPage,
} from './ingest/openalex'

export {
  CROSSREF_DEFAULT_BASE,
  CrossrefIngestError,
  ingestCrossrefWorksPage,
  sourceSnapshotFromCrossrefWork,
  type CrossrefIngestOptions,
  type CrossrefIngestPage,
} from './ingest/crossref'

export {
  advanceCursor,
  doiFromSnapshot,
  emptyCursorStore,
  getCursor,
  mergeSnapshotsByDoi,
  type DualMergeResult,
  type ScheduledCursorStore,
  type ScheduledIngestCursor,
} from './ingest/dualSource'

export {
  parseCursorStore,
  runScheduledIngestTick,
  serializeCursorStore,
  type IngestProvider,
  type ProviderTickResult,
  type ScheduledIngestTickOptions,
  type ScheduledIngestTickResult,
} from './ingest/scheduledIngest'

export {
  OpenAlexExtractError,
  abstractFromInvertedIndex,
  extractClaimsFromOpenAlexWork,
  extractEfficiencyStatements,
  type OpenAlexExtractResult,
} from './extract/openalexClaims'

export {
  COP_MAX,
  ETA_MAX,
  ETA_MIN,
  applyEfficiencyGate,
  applyEfficiencyGates,
  evaluateEfficiencyGate,
  isEfficiencyKind,
  type GateApplyResult,
  type GateVerdict,
} from './gates/efficiency'

export {
  applyCheckClaim,
  applyCheckClaims,
  checkClaim,
  type CheckClaimLayer,
  type CheckClaimResult,
} from './gates/checkClaim'

export {
  PublishError,
  publishKnowledgeRelease,
  selectAndPromoteClaims,
  type PublishInput,
  type PublishResult,
} from './publish/releasePublisher'

export {
  FIXED_PUBLISH_BODY_UTF8,
  FIXED_PUBLISH_CAPTURED_AT,
  FIXED_PUBLISH_CONTENT_SHA256,
  FIXED_PUBLISH_GATED_AT,
  FIXED_PUBLISH_GOLDEN_SHA256,
  FIXED_PUBLISH_LOCATOR,
  FIXED_PUBLISH_RELEASED_AT,
  FIXED_PUBLISH_RELEASE_ID,
  assertFixedPublishSha,
  buildFixedPublishBinding,
  buildFixedPublishFixture,
  buildFixedPublishSnapshot,
  buildFixedPublishValidatedClaim,
  checkFixedPublishSha,
  fixedPublishBodyBytes,
  runFixedPublishPath,
  type FixedPublishAssertFail,
  type FixedPublishAssertOk,
  type FixedPublishFixture,
} from './publish/fixedShaFixture'

export {
  ReleaseStoreError,
  assertSafeReleaseId,
  listKnowledgeReleaseIds,
  loadKnowledgeRelease,
  releaseDir,
  releaseJsonPath,
  writeKnowledgeRelease,
} from './store/releaseStore'

export {
  DEFAULT_KNOWLEDGE_RELEASES_REL,
  KNOWLEDGE_RELEASES_DIR_ENV,
  assertReleasedClaim,
  claimsByKind,
  exportLatestReleasedConflictVisibility,
  exportReleasedConflictVisibility,
  listReleasedIds,
  loadLatestReleased,
  loadReleased,
  releaseMeta,
  resolveKnowledgeReleasesRoot,
  summarizeReleasedCatalog,
  type CatalogSummary,
  type ReleaseMeta,
  type ReleasedCatalogOptions,
} from './atlas/releasedCatalog'

export {
  BrowserCatalogError,
  DEFAULT_BROWSER_RELEASES_BASE,
  fetchLatestClaimsIndex,
  fetchLatestConflictSurface,
  fetchLatestReleased,
  fetchLatestReleasedMeta,
  fetchLatestSubjectClaimsPanel,
  fetchLatestSubjectConflictBadges,
  fetchReleaseIndex,
  fetchReleased,
  type BrowserIndex,
} from './atlas/browserCatalog'

export {
  claimsForSubject,
  conflictSetsForSubject,
  exportMatrixGraphConflictSurface,
  indexClaimsBySubject,
  listSubjectConflictBadges,
  statementPreview,
  subjectClaimsPanelModel,
  subjectConflictBadge,
  type BindingWithSource,
  type ClaimsBySubjectIndex,
  type MatrixGraphConflictSurface,
  type SubjectClaimView,
  type SubjectClaimsPanelModel,
  type SubjectConflictBadge,
} from './atlas/claimsBySubject'

export {
  writeReleaseIndex,
  type ReleaseIndexV1,
} from './store/releaseStore'

export {
  OfflinePipelineError,
  mergeConflictSetsForPublish,
  runOfflinePublishAndWrite,
  runOfflinePublishPipeline,
  type OfflinePipelineFixture,
  type OfflinePipelineInput,
  type OfflinePipelineResult,
} from './offlinePipeline'

export {
  SAMPLE_CAPTURED_AT,
  SAMPLE_CONFLICT_CLAIM_IDS,
  SAMPLE_CONFLICT_SEEDS,
  SAMPLE_CONFLICT_SET_ID,
  SAMPLE_CONFLICT_SUBJECT_ID,
  SAMPLE_CONTROVERSY_SUBJECT_IDS,
  SAMPLE_EDGE_CONFLICT_CLAIM_IDS,
  SAMPLE_EDGE_CONFLICT_SET_ID,
  SAMPLE_EDGE_CONFLICT_SUBJECT_ID,
  SAMPLE_EDGE_SUBJECT_IDS,
  SAMPLE_GATED_AT,
  SAMPLE_KNOWLEDGE_RELEASE_ID,
  SAMPLE_NODE_CONFLICT_CLAIM_IDS,
  SAMPLE_NODE_CONFLICT_SET_ID,
  SAMPLE_NODE_CONFLICT_SUBJECT_ID,
  SAMPLE_RELEASED_AT,
  SAMPLE_SUBJECT_ID,
  SAMPLE_SUBJECT_IDS,
  buildSampleKnowledgeRelease,
  buildSampleOfflineFixture,
  listSampleConflictSeeds,
  sampleConflictSeedForSurface,
  sampleConflictSetIds,
  sampleConflictSubjectIds,
  writeSampleKnowledgeRelease,
  type SampleConflictSeed,
  type SampleConflictSeedSurface,
} from './sampleRelease'

export {
  LIVE_LIKE_CAPTURED_AT,
  LIVE_LIKE_DEMO_CROSSREF_ITEM,
  LIVE_LIKE_DEMO_OPENALEX_WORK,
  LIVE_LIKE_GATED_AT,
  LIVE_LIKE_RELEASE_ID,
  LIVE_LIKE_RELEASED_AT,
  LiveLikePipelineError,
  buildBibliographicClaimsFromFixtures,
  buildDefaultLiveLikeFixture,
  runOfflineLiveLikeAndWrite,
  runOfflineLiveLikePipeline,
  type LiveLikeFixture,
  type LiveLikePipelineInput,
  type LiveLikePipelineResult,
} from './liveLikePipeline'
