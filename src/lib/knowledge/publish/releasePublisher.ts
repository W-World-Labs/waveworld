/**
 * #48-E Publisher: promote validated claims → released and assemble KnowledgeRelease.
 *
 * Never includes candidate/quarantine claims. Does not write Atlas storage —
 * pure in-memory publish for deterministic digest + tests.
 */

import type {
  Claim,
  ConflictSet,
  EvidenceBinding,
  KnowledgeRelease,
  SourceSnapshot,
} from '../types'
import { validateTransition } from '../validate'
import { buildKnowledgeRelease, verifyKnowledgeRelease } from '../release'

export type PublishInput = {
  id: string
  releasedAt: string
  claims: Claim[]
  evidenceBindings: EvidenceBinding[]
  sourceSnapshots: SourceSnapshot[]
  conflictSets?: ConflictSet[]
  /** When true (default), re-verify digest after build. */
  verify?: boolean
}

export type PublishResult = {
  release: KnowledgeRelease
  /** Claim ids promoted validated → released in this publish. */
  promotedClaimIds: string[]
  /** Claim ids excluded (candidate / quarantine / invalid transition). */
  excludedClaimIds: string[]
}

export class PublishError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'PublishError'
    this.code = code
  }
}

/**
 * Select claims eligible for a release and promote validated → released.
 * Released claims pass through unchanged.
 */
export function selectAndPromoteClaims(claims: Claim[]): {
  releasedClaims: Claim[]
  promotedClaimIds: string[]
  excludedClaimIds: string[]
} {
  const releasedClaims: Claim[] = []
  const promotedClaimIds: string[] = []
  const excludedClaimIds: string[] = []

  for (const c of claims) {
    if (c.state === 'released') {
      releasedClaims.push({ ...c, statement: { ...c.statement } })
      continue
    }
    if (c.state === 'validated') {
      const tErr = validateTransition('validated', 'released')
      if (tErr) {
        excludedClaimIds.push(c.id)
        continue
      }
      releasedClaims.push({
        ...c,
        statement: { ...c.statement },
        state: 'released',
        updatedAt: c.updatedAt,
      })
      promotedClaimIds.push(c.id)
      continue
    }
    // candidate | quarantine — never auto-publish
    excludedClaimIds.push(c.id)
  }

  return { releasedClaims, promotedClaimIds, excludedClaimIds }
}

function trimGraph(
  claims: Claim[],
  bindings: EvidenceBinding[],
  snapshots: SourceSnapshot[],
  conflicts: ConflictSet[],
): {
  claims: Claim[]
  evidenceBindings: EvidenceBinding[]
  sourceSnapshots: SourceSnapshot[]
  conflictSets: ConflictSet[]
} {
  const claimIds = new Set(claims.map((c) => c.id))
  const evidenceBindings = bindings
    .filter((b) => claimIds.has(b.claimId))
    .map((b) => ({ ...b, locator: b.locator ? { ...b.locator } : undefined }))

  const neededSnapshots = new Set(evidenceBindings.map((b) => b.sourceSnapshotId))
  // Also keep snapshots that are not bound? Prefer closed graph: only referenced.
  const sourceSnapshots = snapshots
    .filter((s) => neededSnapshots.has(s.id))
    .map((s) => ({ ...s }))

  // If claims have no bindings, still allow empty snapshot list (schema allows).
  // Conflicts only when every member claim is in the release.
  const conflictSets = conflicts
    .filter((c) => c.claimIds.length >= 2 && c.claimIds.every((id) => claimIds.has(id)))
    .map((c) => ({ ...c, claimIds: [...c.claimIds] }))

  return { claims, evidenceBindings, sourceSnapshots, conflictSets }
}

/**
 * Publish a KnowledgeRelease from a working set.
 * @throws PublishError when nothing is publishable or build/verify fails
 */
export async function publishKnowledgeRelease(input: PublishInput): Promise<PublishResult> {
  const { releasedClaims, promotedClaimIds, excludedClaimIds } = selectAndPromoteClaims(
    input.claims,
  )

  if (releasedClaims.length === 0) {
    throw new PublishError(
      'empty_release',
      `no publishable claims (excluded=${excludedClaimIds.length}; need validated or released)`,
    )
  }

  const trimmed = trimGraph(
    releasedClaims,
    input.evidenceBindings,
    input.sourceSnapshots,
    input.conflictSets ?? [],
  )

  let release: KnowledgeRelease
  try {
    release = await buildKnowledgeRelease({
      id: input.id,
      releasedAt: input.releasedAt,
      claims: trimmed.claims,
      evidenceBindings: trimmed.evidenceBindings,
      sourceSnapshots: trimmed.sourceSnapshots,
      conflictSets: trimmed.conflictSets,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new PublishError('build_failed', msg)
  }

  if (input.verify !== false) {
    const v = await verifyKnowledgeRelease(release)
    if (v) throw new PublishError('verify_failed', v)
  }

  return { release, promotedClaimIds, excludedClaimIds }
}
