/**
 * K2: seed efficiency claims + evidence from edge.efficiency / refs,
 * promote candidate → validated → released, and write a deterministic
 * knowledge_releases row (sha256 via buildKnowledgeRelease).
 *
 * @see docs/knowledge-db.md §6 K2
 * @see EPIC #52
 */
import { applyEfficiencyGates } from '../knowledge/gates/efficiency.ts'
import { sha256Hex } from '../knowledge/hash.ts'
import { buildKnowledgeRelease } from '../knowledge/release.ts'
import {
  KNOWLEDGE_CONTRACT_VERSION,
  type Claim,
  type EvidenceBinding,
  type KnowledgeRelease,
  type SourceSnapshot,
} from '../knowledge/types.ts'
import type { ConversionEdge, Quantity } from '../../data/ontology/types.ts'
import type { SqliteDatabase } from './load-sqlite.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

/** Stable seed release id (digest-stable when timestamps + edges fixed). */
export const SEED_EFFICIENCY_RELEASE_ID = 'kr-static-seed-efficiency-v1'

/** Fixed epoch for seed claim/snapshot timestamps (no wall clock). */
export const SEED_CLAIM_EPOCH = '2026-08-06T00:00:00.000Z'
export const SEED_GATE_AT = '2026-08-06T00:00:00.000Z'
export const SEED_RELEASED_AT = '2026-08-06T00:00:00.000Z'

export type EdgeEfficiencyLike = {
  id: string
  kind?: 'conversion' | 'transport' | string
  efficiency?: Quantity | null
  refs?: readonly string[] | null
}

export type SeedClaimsCounts = {
  claims: number
  claims_released: number
  claims_quarantine: number
  source_snapshots: number
  evidence_bindings: number
  release_claims: number
  knowledge_releases: number
}

export type SeedClaimsFromEdgesResult = {
  dbPath: string
  releaseId: string
  sha256: string
  counts: SeedClaimsCounts
  /** Edges that produced an efficiency claim (any lifecycle state). */
  edgeClaimCount: number
}

export function claimIdForEdgeEfficiency(edgeId: string): string {
  return `claim:eff:${edgeId}`
}

export function snapshotIdForLocator(contentSha256: string): string {
  return `snap:url:${contentSha256.slice(0, 24)}`
}

export function bindingIdForClaimSnapshot(
  claimId: string,
  snapshotId: string,
): string {
  return `bind:${claimId}:${snapshotId.slice(0, 32)}`
}

function num(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  return null
}

/**
 * Map static Quantity efficiency → conversion.efficiency statement.
 * COP (transport / max>1) uses metric=cop; else eta fraction in [0,1].
 */
export function efficiencyStatementFromQuantity(
  efficiency: Quantity,
  edgeKind?: string,
): Record<string, unknown> {
  const min = num(efficiency.min)
  const max = num(efficiency.max)
  const rawValue = num(efficiency.value)
  const looksLikeCop =
    edgeKind === 'transport' ||
    (min != null && min > 1) ||
    (max != null && max > 1)

  let value: number
  if (rawValue != null) {
    value = rawValue
  } else if (min != null && max != null) {
    value = (min + max) / 2
  } else if (max != null) {
    value = max
  } else if (min != null) {
    value = min
  } else {
    value = looksLikeCop ? 1 : 0
  }

  const unit =
    typeof efficiency.unit === 'string' && efficiency.unit.trim()
      ? efficiency.unit.trim()
      : '1'

  if (looksLikeCop) {
    return {
      metric: 'cop',
      value,
      unit: unit === '1' || unit === '' ? '1' : unit,
      etaMin: min ?? undefined,
      etaMax: max ?? undefined,
      symbol: efficiency.symbol ?? 'COP',
      note: efficiency.note,
      source: 'static-edge-efficiency',
    }
  }

  return {
    metric: 'eta',
    value,
    unit: unit === '1' || unit === '' ? '1' : unit,
    etaMin: min ?? undefined,
    etaMax: max ?? undefined,
    symbol: efficiency.symbol ?? 'η',
    note: efficiency.note,
    source: 'static-edge-efficiency',
  }
}

export type EdgeClaimBundle = {
  claims: Claim[]
  evidenceBindings: EvidenceBinding[]
  sourceSnapshots: SourceSnapshot[]
}

/**
 * Build candidate claims + locator-only snapshots/bindings from edges.
 * Snapshots are deduped by content hash of normalized URL (UNIQUE constraint).
 */
export async function buildEdgeEfficiencyClaimBundle(
  edges: readonly EdgeEfficiencyLike[],
  options?: { createdAt?: string },
): Promise<EdgeClaimBundle> {
  const createdAt = options?.createdAt ?? SEED_CLAIM_EPOCH
  const claims: Claim[] = []
  const evidenceBindings: EvidenceBinding[] = []
  const snapshotsById = new Map<string, SourceSnapshot>()

  // Pre-hash all unique URLs once
  const urlSet = new Set<string>()
  for (const e of edges) {
    for (const r of e.refs ?? []) {
      const u = String(r).trim()
      if (u) urlSet.add(u)
    }
  }
  const urlList = [...urlSet].sort()
  const hashEntries = await Promise.all(
    urlList.map(async (locator) => [locator, await sha256Hex(locator)] as const),
  )
  const hashByUrl = new Map(hashEntries)

  for (const edge of edges) {
    if (!edge.efficiency) continue
    const claimId = claimIdForEdgeEfficiency(edge.id)
    const statement = efficiencyStatementFromQuantity(
      edge.efficiency,
      edge.kind,
    )
    claims.push({
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: claimId,
      kind: 'conversion.efficiency',
      subjectId: edge.id,
      statement,
      state: 'candidate',
      confidence: 0.7,
      createdAt,
    })

    const urls = (edge.refs ?? []).map((r) => String(r).trim()).filter(Boolean)
    for (const locator of urls) {
      const contentSha256 = hashByUrl.get(locator)!
      const snapshotId = snapshotIdForLocator(contentSha256)
      if (!snapshotsById.has(snapshotId)) {
        snapshotsById.set(snapshotId, {
          contractVersion: KNOWLEDGE_CONTRACT_VERSION,
          id: snapshotId,
          locator,
          locatorKind: 'url',
          capturedAt: createdAt,
          contentSha256,
          captureStatus: 'locator-only',
          provider: 'static-edge-ref',
        })
      }
      evidenceBindings.push({
        contractVersion: KNOWLEDGE_CONTRACT_VERSION,
        id: bindingIdForClaimSnapshot(claimId, snapshotId),
        claimId,
        sourceSnapshotId: snapshotId,
        support: 'supports',
        locator: { path: 'url' },
        note: 'Migrated from ConversionEdge.refs; locator-only seed (K2)',
      })
    }
  }

  // Stable order for deterministic release digests
  claims.sort((a, b) => a.id.localeCompare(b.id))
  evidenceBindings.sort((a, b) => a.id.localeCompare(b.id))
  const sourceSnapshots = [...snapshotsById.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  )

  return { claims, evidenceBindings, sourceSnapshots }
}

/**
 * candidate → gate → validated → released for pass set; build release.
 */
export async function promoteEdgeEfficiencyBundle(
  bundle: EdgeClaimBundle,
  options?: {
    gateAt?: string
    releasedAt?: string
    releaseId?: string
  },
): Promise<{
  allClaims: Claim[]
  releasedClaims: Claim[]
  quarantineClaims: Claim[]
  release: KnowledgeRelease
  gatedOutClaimIds: string[]
}> {
  const gateAt = options?.gateAt ?? SEED_GATE_AT
  const releasedAt = options?.releasedAt ?? SEED_RELEASED_AT
  const releaseId = options?.releaseId ?? SEED_EFFICIENCY_RELEASE_ID

  const gated = applyEfficiencyGates(bundle.claims, gateAt)
  const allClaims: Claim[] = []
  const releasedClaims: Claim[] = []
  const quarantineClaims: Claim[] = []
  const gatedOutClaimIds: string[] = []

  for (const r of gated) {
    if (r.transitionedTo === 'validated') {
      const released: Claim = {
        ...r.claim,
        state: 'released',
        updatedAt: releasedAt,
      }
      allClaims.push(released)
      releasedClaims.push(released)
    } else if (r.transitionedTo === 'quarantine') {
      allClaims.push(r.claim)
      quarantineClaims.push(r.claim)
      gatedOutClaimIds.push(r.claim.id)
    } else {
      allClaims.push(r.claim)
      gatedOutClaimIds.push(r.claim.id)
    }
  }

  allClaims.sort((a, b) => a.id.localeCompare(b.id))
  releasedClaims.sort((a, b) => a.id.localeCompare(b.id))

  const releasedIds = new Set(releasedClaims.map((c) => c.id))
  const evidenceBindings = bundle.evidenceBindings.filter((b) =>
    releasedIds.has(b.claimId),
  )
  const snapIds = new Set(evidenceBindings.map((b) => b.sourceSnapshotId))
  const sourceSnapshots = bundle.sourceSnapshots.filter((s) =>
    snapIds.has(s.id),
  )

  if (releasedClaims.length === 0) {
    throw new Error(
      'seed-claims-from-edges: no claims passed gate to release (empty release)',
    )
  }

  const release = await buildKnowledgeRelease({
    id: releaseId,
    releasedAt,
    claims: releasedClaims,
    evidenceBindings,
    sourceSnapshots,
    conflictSets: [],
  })

  return {
    allClaims,
    releasedClaims,
    quarantineClaims,
    release,
    gatedOutClaimIds,
  }
}

function countTable(db: SqliteDatabase, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as {
    c: number
  }
  return row.c
}

export function readClaimSeedCounts(db: SqliteDatabase): SeedClaimsCounts {
  const released = db
    .prepare(`SELECT COUNT(*) AS c FROM claims WHERE state = 'released'`)
    .get() as { c: number }
  const quarantine = db
    .prepare(`SELECT COUNT(*) AS c FROM claims WHERE state = 'quarantine'`)
    .get() as { c: number }
  return {
    claims: countTable(db, 'claims'),
    claims_released: released.c,
    claims_quarantine: quarantine.c,
    source_snapshots: countTable(db, 'source_snapshots'),
    evidence_bindings: countTable(db, 'evidence_bindings'),
    release_claims: countTable(db, 'release_claims'),
    knowledge_releases: countTable(db, 'knowledge_releases'),
  }
}

/**
 * Persist claims / snapshots / bindings / release into an open DB.
 * Idempotent upsert by primary keys; rewrites release membership for the seed release.
 */
export function persistEfficiencyReleaseToDb(
  db: SqliteDatabase,
  input: {
    allClaims: Claim[]
    release: KnowledgeRelease
    allBindings: EvidenceBinding[]
    allSnapshots: SourceSnapshot[]
    createdAt?: string
  },
): SeedClaimsCounts {
  const createdAt = input.createdAt ?? SEED_CLAIM_EPOCH
  const release = input.release

  const upsertSnap = db.prepare(`
    INSERT INTO source_snapshots (
      id, contract_version, locator, locator_kind, captured_at,
      content_sha256, capture_status, content_type, byte_length, license,
      cursor, title, provider, blob_relpath
    ) VALUES (
      @id, @contract_version, @locator, @locator_kind, @captured_at,
      @content_sha256, @capture_status, @content_type, @byte_length, @license,
      @cursor, @title, @provider, @blob_relpath
    )
    ON CONFLICT(id) DO UPDATE SET
      locator = excluded.locator,
      locator_kind = excluded.locator_kind,
      captured_at = excluded.captured_at,
      content_sha256 = excluded.content_sha256,
      capture_status = excluded.capture_status,
      content_type = excluded.content_type,
      byte_length = excluded.byte_length,
      license = excluded.license,
      cursor = excluded.cursor,
      title = excluded.title,
      provider = excluded.provider,
      blob_relpath = excluded.blob_relpath
  `)

  const upsertClaim = db.prepare(`
    INSERT INTO claims (
      id, contract_version, kind, subject_id, statement_json, state,
      confidence, created_at, updated_at
    ) VALUES (
      @id, @contract_version, @kind, @subject_id, @statement_json, @state,
      @confidence, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      contract_version = excluded.contract_version,
      kind = excluded.kind,
      subject_id = excluded.subject_id,
      statement_json = excluded.statement_json,
      state = excluded.state,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at
  `)

  const upsertBind = db.prepare(`
    INSERT INTO evidence_bindings (
      id, contract_version, claim_id, source_snapshot_id, support,
      locator_json, provider, created_at
    ) VALUES (
      @id, @contract_version, @claim_id, @source_snapshot_id, @support,
      @locator_json, @provider, @created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      contract_version = excluded.contract_version,
      claim_id = excluded.claim_id,
      source_snapshot_id = excluded.source_snapshot_id,
      support = excluded.support,
      locator_json = excluded.locator_json,
      provider = excluded.provider
  `)

  const upsertRelease = db.prepare(`
    INSERT INTO knowledge_releases (
      id, contract_version, released_at, state, sha256, export_relpath,
      meta_json, created_at
    ) VALUES (
      @id, @contract_version, @released_at, @state, @sha256, @export_relpath,
      @meta_json, @created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      contract_version = excluded.contract_version,
      released_at = excluded.released_at,
      state = excluded.state,
      sha256 = excluded.sha256,
      export_relpath = excluded.export_relpath,
      meta_json = excluded.meta_json
  `)

  const insertReleaseClaim = db.prepare(`
    INSERT OR IGNORE INTO release_claims (release_id, claim_id)
    VALUES (@release_id, @claim_id)
  `)
  const insertReleaseSnap = db.prepare(`
    INSERT OR IGNORE INTO release_snapshots (release_id, source_snapshot_id)
    VALUES (@release_id, @source_snapshot_id)
  `)
  const insertReleaseBind = db.prepare(`
    INSERT OR IGNORE INTO release_bindings (release_id, binding_id)
    VALUES (@release_id, @binding_id)
  `)

  const run = db.transaction(() => {
    for (const s of input.allSnapshots) {
      upsertSnap.run({
        id: s.id,
        contract_version: s.contractVersion,
        locator: s.locator,
        locator_kind: s.locatorKind,
        captured_at: s.capturedAt,
        content_sha256: s.contentSha256,
        capture_status: s.captureStatus,
        content_type: s.contentType ?? null,
        byte_length: s.byteLength ?? null,
        license: s.license ?? null,
        cursor: s.cursor ?? null,
        title: s.title ?? null,
        provider: s.provider ?? null,
        blob_relpath: null,
      })
    }

    for (const c of input.allClaims) {
      upsertClaim.run({
        id: c.id,
        contract_version: c.contractVersion,
        kind: c.kind,
        subject_id: c.subjectId,
        statement_json: JSON.stringify(c.statement),
        state: c.state,
        confidence: c.confidence ?? null,
        created_at: c.createdAt,
        updated_at: c.updatedAt ?? null,
      })
    }

    for (const b of input.allBindings) {
      upsertBind.run({
        id: b.id,
        contract_version: b.contractVersion,
        claim_id: b.claimId,
        source_snapshot_id: b.sourceSnapshotId,
        support: b.support,
        locator_json: b.locator ? JSON.stringify(b.locator) : null,
        provider: 'static-edge-ref',
        created_at: createdAt,
      })
    }

    // Rewrite membership for this seed release (idempotent re-seed)
    db.prepare(`DELETE FROM release_claims WHERE release_id = ?`).run(release.id)
    db.prepare(`DELETE FROM release_snapshots WHERE release_id = ?`).run(
      release.id,
    )
    db.prepare(`DELETE FROM release_bindings WHERE release_id = ?`).run(
      release.id,
    )
    db.prepare(`DELETE FROM release_conflicts WHERE release_id = ?`).run(
      release.id,
    )

    upsertRelease.run({
      id: release.id,
      contract_version: release.contractVersion,
      released_at: release.releasedAt,
      state: release.state,
      sha256: release.sha256,
      export_relpath: null,
      meta_json: JSON.stringify({
        source: 'seed-from-static-edge-efficiency',
        claimCount: release.claims.length,
        snapshotCount: release.sourceSnapshots.length,
        bindingCount: release.evidenceBindings.length,
      }),
      created_at: createdAt,
    })

    for (const c of release.claims) {
      insertReleaseClaim.run({ release_id: release.id, claim_id: c.id })
    }
    for (const s of release.sourceSnapshots) {
      insertReleaseSnap.run({
        release_id: release.id,
        source_snapshot_id: s.id,
      })
    }
    for (const b of release.evidenceBindings) {
      insertReleaseBind.run({ release_id: release.id, binding_id: b.id })
    }
  })

  run()
  return readClaimSeedCounts(db)
}

/**
 * Full K2 path on an open DB: edges → claims → release rows.
 */
export async function seedEfficiencyClaimsFromEdges(
  db: SqliteDatabase,
  edges: readonly EdgeEfficiencyLike[],
  options?: {
    createdAt?: string
    gateAt?: string
    releasedAt?: string
    releaseId?: string
  },
): Promise<{
  counts: SeedClaimsCounts
  release: KnowledgeRelease
  edgeClaimCount: number
  gatedOutClaimIds: string[]
}> {
  const bundle = await buildEdgeEfficiencyClaimBundle(edges, {
    createdAt: options?.createdAt,
  })
  const promoted = await promoteEdgeEfficiencyBundle(bundle, options)
  const counts = persistEfficiencyReleaseToDb(db, {
    allClaims: promoted.allClaims,
    release: promoted.release,
    allBindings: bundle.evidenceBindings,
    allSnapshots: bundle.sourceSnapshots,
    createdAt: options?.createdAt,
  })
  return {
    counts,
    release: promoted.release,
    edgeClaimCount: bundle.claims.length,
    gatedOutClaimIds: promoted.gatedOutClaimIds,
  }
}

/**
 * Open/migrate DB, seed efficiency claims from provided edges.
 */
export async function seedEfficiencyClaimsFromEdgesSync(options: {
  dbPath?: string
  root?: string
  skipMigrate?: boolean
  edges: readonly EdgeEfficiencyLike[] | readonly ConversionEdge[]
  createdAt?: string
  gateAt?: string
  releasedAt?: string
  releaseId?: string
}): Promise<SeedClaimsFromEdgesResult> {
  const root = options.root ?? repoRootFromHere()
  const dbPath = options.dbPath ?? resolveKnowledgeDbPath(root)

  if (!options.skipMigrate) {
    migrateKnowledgeDb({ dbPath, root })
  }

  const db = openKnowledgeDb({ dbPath, root })
  try {
    const result = await seedEfficiencyClaimsFromEdges(db, options.edges, {
      createdAt: options.createdAt,
      gateAt: options.gateAt,
      releasedAt: options.releasedAt,
      releaseId: options.releaseId,
    })
    return {
      dbPath,
      releaseId: result.release.id,
      sha256: result.release.sha256,
      counts: result.counts,
      edgeClaimCount: result.edgeClaimCount,
    }
  } finally {
    db.close()
  }
}
