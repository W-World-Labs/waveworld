/**
 * Knowledge pipeline contracts (issue #48).
 * Versioned, evidence-bound facts. Atlas / matrix / graph must only consume
 * KnowledgeRelease records in lifecycle state `released`.
 *
 * Schema is additive: bump KNOWLEDGE_CONTRACT_VERSION when breaking fields change.
 */

/** Monotonic contract version for all knowledge pipeline records. */
export const KNOWLEDGE_CONTRACT_VERSION = 1 as const
export type KnowledgeContractVersion = typeof KNOWLEDGE_CONTRACT_VERSION

/**
 * Lifecycle for claims, conflict sets, and releases.
 * Transitions: candidate → quarantine → validated → released
 * (quarantine may return to candidate after rework; released is terminal).
 */
export const KNOWLEDGE_LIFECYCLE_STATES = [
  'candidate',
  'quarantine',
  'validated',
  'released',
] as const

export type KnowledgeLifecycleState = (typeof KNOWLEDGE_LIFECYCLE_STATES)[number]

/** Allowed forward/side transitions. `released` is immutable / terminal. */
export const LIFECYCLE_TRANSITIONS: Readonly<
  Record<KnowledgeLifecycleState, readonly KnowledgeLifecycleState[]>
> = {
  candidate: ['quarantine', 'validated'],
  quarantine: ['candidate', 'validated'],
  validated: ['released', 'quarantine'],
  released: [],
}

/** How a source locator is identified. */
export type SourceLocatorKind = 'url' | 'doi' | 'citation' | 'other'

/**
 * Whether raw source bytes were captured.
 * - locator-only: provisional (e.g. legacy ConversionEdge.refs URL list)
 * - bytes-captured: contentSha256 is over actual snapshot bytes
 */
export type SourceCaptureStatus = 'locator-only' | 'bytes-captured'

/**
 * Immutable capture of an external source at a point in time.
 * Downstream claims bind to this via EvidenceBinding, never to a live URL alone.
 */
export interface SourceSnapshot {
  contractVersion: KnowledgeContractVersion
  id: string
  /** Original locator (URL, DOI string, free-text citation, …). */
  locator: string
  locatorKind: SourceLocatorKind
  /** ISO-8601 capture time. */
  capturedAt: string
  /**
   * SHA-256 hex of raw payload bytes when captureStatus is `bytes-captured`.
   * For `locator-only`, hash of the normalized locator string (fingerprint only).
   */
  contentSha256: string
  captureStatus: SourceCaptureStatus
  contentType?: string
  byteLength?: number
  license?: string
  /** Incremental crawl cursor (Crossref from-index-date, OpenAlex cursor, …). */
  cursor?: string
  title?: string
  /** e.g. crossref | openalex | manual | static-edge-ref */
  provider?: string
}

/**
 * Machine-oriented claim kinds used by extractors / static migration / sim packs.
 * Must stay aligned with Knowledge DB `claims.kind` and `statement_json` shapes
 * documented in docs/knowledge-db.md §4.4 and docs/wlang.md Phase 1.
 */
export type ClaimKind =
  | 'conversion.edge'
  | 'conversion.efficiency'
  | 'conversion.mechanism'
  | 'conversion.formula'
  | 'conversion.device'
  | 'conversion.maturity'
  | 'sim.param_pack'
  | 'sim.material'
  | 'other'

/** Known kinds with a documented `statement_json` shape (K schema). */
export const CLAIM_KINDS_WITH_STATEMENT_SCHEMA = [
  'conversion.edge',
  'conversion.efficiency',
  'conversion.mechanism',
  'conversion.formula',
  'sim.param_pack',
  'sim.material',
  'other',
] as const satisfies readonly ClaimKind[]

/**
 * A factual assertion. Never “established” until lifecycle reaches `released`
 * and is included in a KnowledgeRelease.
 *
 * Persistence: Knowledge DB row `claims` stores the same fields with snake_case
 * columns; `statement` serializes to `statement_json` TEXT (JSON object).
 * See `claimToDbRow` / `claimFromDbRow` in `claimDb.ts`.
 */
export interface Claim {
  contractVersion: KnowledgeContractVersion
  id: string
  kind: ClaimKind | string
  /** Subject this claim is about (e.g. ConversionEdge.id, EnergyNode.id). */
  subjectId: string
  /**
   * Structured statement; must be JSON-serializable and order-stable when
   * canonicalized. Kind-specific shapes live in `statementSchema.ts` and map
   * 1:1 to DB column `statement_json`.
   */
  statement: Record<string, unknown>
  state: KnowledgeLifecycleState
  /** Optional score in [0, 1]. Low confidence → quarantine / human queue. */
  confidence?: number
  /** ISO-8601 */
  createdAt: string
  updatedAt?: string
}

/**
 * Knowledge DB `claims` table row shape (docs/sql/knowledge-schema.sql).
 * CamelCase Claim fields map here for ingest/publish bridges; codec does not
 * open SQLite (K track owns DB IO).
 */
export interface ClaimDbRow {
  id: string
  contract_version: number
  kind: string
  subject_id: string
  /** JSON text of Claim.statement — plain object, not array/primitive. */
  statement_json: string
  state: KnowledgeLifecycleState
  confidence: number | null
  created_at: string
  updated_at: string | null
}

/** How an evidence span relates to a claim. */
export type EvidenceSupport = 'supports' | 'refutes' | 'context'

/** Precise location inside a SourceSnapshot payload. */
export interface EvidenceLocator {
  page?: number | string
  section?: string
  quote?: string
  charStart?: number
  charEnd?: number
  /** JSON path or other structural path into structured sources. */
  path?: string
}

/**
 * Binds a Claim to a SourceSnapshot at a fact-level location.
 * Legacy edge `refs: string[]` map to bindings with only locator URL and no quote/page.
 */
export interface EvidenceBinding {
  contractVersion: KnowledgeContractVersion
  id: string
  claimId: string
  sourceSnapshotId: string
  locator?: EvidenceLocator
  support: EvidenceSupport
  note?: string
}

/**
 * Parallel non-overwriting claims that disagree.
 * Conflicts must not be silently collapsed; members stay visible.
 */
export interface ConflictSet {
  contractVersion: KnowledgeContractVersion
  id: string
  claimIds: string[]
  reason: string
  state: KnowledgeLifecycleState
  /** Optional resolution note; does not delete member claims. */
  resolution?: string
}

/**
 * Immutable published knowledge snapshot.
 * Atlas / matrix / graph MUST only load records with state `released`
 * and a verified `sha256` over the canonical payload (excluding `sha256` itself).
 */
export interface KnowledgeRelease {
  contractVersion: KnowledgeContractVersion
  id: string
  /** ISO-8601 release timestamp (included in hash). */
  releasedAt: string
  state: 'released'
  claims: Claim[]
  evidenceBindings: EvidenceBinding[]
  sourceSnapshots: SourceSnapshot[]
  /** Open conflicts may be listed for UI; they do not establish contested facts. */
  conflictSets: ConflictSet[]
  /**
   * SHA-256 hex of canonical JSON of this object with `sha256` omitted.
   * Verifiers recompute and compare.
   */
  sha256: string
}

/** Release body before digest is attached (pure build input/output intermediate). */
export type KnowledgeReleaseBody = Omit<KnowledgeRelease, 'sha256'>
