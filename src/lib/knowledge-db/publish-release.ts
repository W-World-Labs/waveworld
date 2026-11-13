/**
 * K5: publish a KnowledgeRelease into knowledge.db (and optional static JSON).
 * DB row in knowledge_releases + membership tables is authority;
 * file export under public/knowledge-releases is optional CDN mirror.
 *
 * @see docs/knowledge-db.md §6 K5
 * @see EPIC #52
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  Claim,
  ConflictSet,
  EvidenceBinding,
  KnowledgeRelease,
  SourceSnapshot,
} from '../knowledge/types.ts'
import type { SqliteDatabase } from './load-sqlite.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export type PersistReleaseInput = {
  release: KnowledgeRelease
  /**
   * Extra claims to upsert (e.g. quarantine siblings). Defaults to
   * release.claims only.
   */
  allClaims?: Claim[]
  allBindings?: EvidenceBinding[]
  allSnapshots?: SourceSnapshot[]
  allConflicts?: ConflictSet[]
  /** Relative path recorded on knowledge_releases.export_relpath. */
  exportRelpath?: string | null
  meta?: Record<string, unknown>
  createdAt?: string
}

export type PersistReleaseResult = {
  releaseId: string
  sha256: string
  claimCount: number
  snapshotCount: number
  bindingCount: number
  conflictCount: number
}

/**
 * Upsert SourceSnapshot rows (ingest + publish share this shape).
 */
export function upsertSourceSnapshots(
  db: SqliteDatabase,
  snapshots: readonly SourceSnapshot[],
): number {
  if (snapshots.length === 0) return 0
  const upsert = db.prepare(`
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
      provider = excluded.provider
  `)
  const run = db.transaction(() => {
    for (const s of snapshots) {
      upsert.run({
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
  })
  run()
  return snapshots.length
}

/**
 * Persist a released KnowledgeRelease into knowledge.db.
 * Idempotent upsert by primary keys; rewrites membership for this release id.
 */
export function persistKnowledgeReleaseToDb(
  db: SqliteDatabase,
  input: PersistReleaseInput,
): PersistReleaseResult {
  const release = input.release
  if (release.state !== 'released') {
    throw new Error(
      `persistKnowledgeReleaseToDb: expected state=released, got ${release.state}`,
    )
  }

  const createdAt = input.createdAt ?? release.releasedAt
  const allClaims = input.allClaims ?? release.claims
  const allBindings = input.allBindings ?? release.evidenceBindings
  const allSnapshots = input.allSnapshots ?? release.sourceSnapshots
  const allConflicts = input.allConflicts ?? release.conflictSets ?? []

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
      provider = excluded.provider
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

  const upsertConflict = db.prepare(`
    INSERT INTO conflict_sets (
      id, contract_version, subject_id, reason, resolution_note, state,
      created_at, updated_at
    ) VALUES (
      @id, @contract_version, @subject_id, @reason, @resolution_note, @state,
      @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      contract_version = excluded.contract_version,
      subject_id = excluded.subject_id,
      reason = excluded.reason,
      resolution_note = excluded.resolution_note,
      state = excluded.state,
      updated_at = excluded.updated_at
  `)

  const insertConflictMember = db.prepare(`
    INSERT OR IGNORE INTO conflict_members (conflict_id, claim_id)
    VALUES (@conflict_id, @claim_id)
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
  const insertReleaseConflict = db.prepare(`
    INSERT OR IGNORE INTO release_conflicts (release_id, conflict_id)
    VALUES (@release_id, @conflict_id)
  `)

  const meta = {
    source: 'publish-release',
    claimCount: release.claims.length,
    snapshotCount: release.sourceSnapshots.length,
    bindingCount: release.evidenceBindings.length,
    conflictCount: release.conflictSets?.length ?? 0,
    ...(input.meta ?? {}),
  }

  const run = db.transaction(() => {
    for (const s of allSnapshots) {
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

    for (const c of allClaims) {
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

    for (const b of allBindings) {
      upsertBind.run({
        id: b.id,
        contract_version: b.contractVersion,
        claim_id: b.claimId,
        source_snapshot_id: b.sourceSnapshotId,
        support: b.support,
        locator_json: b.locator ? JSON.stringify(b.locator) : null,
        provider: b.note ?? null,
        created_at: createdAt,
      })
    }

    for (const conf of allConflicts) {
      // Schema uses open|resolved; map lifecycle released/validated → resolved.
      const confState =
        conf.state === 'released' || conf.state === 'validated'
          ? 'resolved'
          : 'open'
      upsertConflict.run({
        id: conf.id,
        contract_version: conf.contractVersion,
        subject_id: conf.claimIds[0] ?? conf.id,
        reason: conf.reason,
        resolution_note: conf.resolution ?? null,
        state: confState,
        created_at: createdAt,
        updated_at: createdAt,
      })
      for (const claimId of conf.claimIds) {
        insertConflictMember.run({
          conflict_id: conf.id,
          claim_id: claimId,
        })
      }
    }

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
      export_relpath: input.exportRelpath ?? null,
      meta_json: JSON.stringify(meta),
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
    for (const conf of release.conflictSets ?? []) {
      insertReleaseConflict.run({
        release_id: release.id,
        conflict_id: conf.id,
      })
    }
  })

  run()

  return {
    releaseId: release.id,
    sha256: release.sha256,
    claimCount: release.claims.length,
    snapshotCount: release.sourceSnapshots.length,
    bindingCount: release.evidenceBindings.length,
    conflictCount: release.conflictSets?.length ?? 0,
  }
}

/**
 * Optional static JSON export for CDN / browser catalog.
 * Writes `<exportRoot>/<releaseId>/release.json` + sha256 sidecar.
 * Does not rewrite index.json (caller may).
 */
export async function exportKnowledgeReleaseJson(
  exportRoot: string,
  release: KnowledgeRelease,
): Promise<{ dir: string; file: string; exportRelpath: string }> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(release.id)) {
    throw new Error(`unsafe release id for export: ${release.id}`)
  }
  const dir = path.resolve(exportRoot, release.id)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'release.json')
  await writeFile(file, `${JSON.stringify(release, null, 2)}\n`, 'utf8')
  await writeFile(path.join(dir, 'sha256'), `${release.sha256}\n`, 'utf8')
  const exportRelpath = path.posix.join(release.id, 'release.json')
  return { dir, file, exportRelpath }
}

export type PublishReleaseToDbOptions = {
  dbPath?: string
  root?: string
  /** When set, also write static JSON under this directory. */
  exportRoot?: string
  meta?: Record<string, unknown>
  createdAt?: string
  allClaims?: Claim[]
  allBindings?: EvidenceBinding[]
  allSnapshots?: SourceSnapshot[]
  allConflicts?: ConflictSet[]
}

export type PublishReleaseToDbResult = PersistReleaseResult & {
  dbPath: string
  exportFile?: string
  exportRelpath?: string | null
}

/**
 * High-level K5 publish: optional static export, then knowledge_releases row.
 */
export async function publishKnowledgeReleaseToDb(
  release: KnowledgeRelease,
  options?: PublishReleaseToDbOptions,
): Promise<PublishReleaseToDbResult> {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  migrateKnowledgeDb({ dbPath, root })

  let exportRelpath: string | null = null
  let exportFile: string | undefined
  if (options?.exportRoot) {
    const exp = await exportKnowledgeReleaseJson(options.exportRoot, release)
    exportRelpath = exp.exportRelpath
    exportFile = exp.file
  }

  const db = openKnowledgeDb({ dbPath, root })
  try {
    const persisted = persistKnowledgeReleaseToDb(db, {
      release,
      allClaims: options?.allClaims,
      allBindings: options?.allBindings,
      allSnapshots: options?.allSnapshots,
      allConflicts: options?.allConflicts,
      exportRelpath,
      meta: options?.meta,
      createdAt: options?.createdAt,
    })
    return {
      ...persisted,
      dbPath,
      exportFile,
      exportRelpath,
    }
  } finally {
    db.close()
  }
}
