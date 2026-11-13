import { canonicalJson } from './canonical'
import { sha256Hex } from './hash'
import {
  KNOWLEDGE_CONTRACT_VERSION,
  type Claim,
  type ConflictSet,
  type EvidenceBinding,
  type KnowledgeRelease,
  type KnowledgeReleaseBody,
  type SourceSnapshot,
} from './types'
import { validateKnowledgeReleaseBody } from './validate'

export interface BuildReleaseInput {
  id: string
  releasedAt: string
  claims: Claim[]
  evidenceBindings: EvidenceBinding[]
  sourceSnapshots: SourceSnapshot[]
  conflictSets?: ConflictSet[]
}

/**
 * Sort release collections so equal multisets yield identical canonical JSON
 * regardless of caller insertion order.
 */
export function sortReleaseCollections(body: KnowledgeReleaseBody): KnowledgeReleaseBody {
  return {
    ...body,
    claims: [...body.claims].sort((a, b) => a.id.localeCompare(b.id)),
    evidenceBindings: [...body.evidenceBindings].sort((a, b) => a.id.localeCompare(b.id)),
    sourceSnapshots: [...body.sourceSnapshots].sort((a, b) => a.id.localeCompare(b.id)),
    conflictSets: [...body.conflictSets].sort((a, b) => a.id.localeCompare(b.id)),
  }
}

/** Canonical preimage string for a release body (no sha256 field). */
export function releaseCanonicalPreimage(body: KnowledgeReleaseBody): string {
  const sorted = sortReleaseCollections(body)
  // Explicit field set — never accidentally include sha256 or extra keys.
  return canonicalJson({
    claims: sorted.claims,
    conflictSets: sorted.conflictSets,
    contractVersion: sorted.contractVersion,
    evidenceBindings: sorted.evidenceBindings,
    id: sorted.id,
    releasedAt: sorted.releasedAt,
    sourceSnapshots: sorted.sourceSnapshots,
    state: sorted.state,
  })
}

/** Compute KnowledgeRelease.sha256 from a validated body. */
export async function computeReleaseSha256(body: KnowledgeReleaseBody): Promise<string> {
  return sha256Hex(releaseCanonicalPreimage(body))
}

/**
 * Pure-ish build: fixed input → deterministic KnowledgeRelease with SHA-256.
 * - Forces state to `released`
 * - Requires every claim already in lifecycle `released`
 * - Sorts collections before hashing so input order does not affect digest
 * - Does not mutate inputs
 */
export async function buildKnowledgeRelease(input: BuildReleaseInput): Promise<KnowledgeRelease> {
  const body: KnowledgeReleaseBody = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: input.id,
    releasedAt: input.releasedAt,
    state: 'released',
    claims: input.claims.map((c) => ({ ...c, statement: { ...c.statement } })),
    evidenceBindings: input.evidenceBindings.map((b) => ({ ...b, locator: b.locator ? { ...b.locator } : undefined })),
    sourceSnapshots: input.sourceSnapshots.map((s) => ({ ...s })),
    conflictSets: (input.conflictSets ?? []).map((c) => ({ ...c, claimIds: [...c.claimIds] })),
  }

  const sorted = sortReleaseCollections(body)
  const err = validateKnowledgeReleaseBody(sorted)
  if (err) throw new Error(err)

  const sha256 = await computeReleaseSha256(sorted)
  return { ...sorted, sha256 }
}

/**
 * Recompute digest and compare. Returns null when ok, else an error message.
 */
export async function verifyKnowledgeRelease(release: KnowledgeRelease): Promise<string | null> {
  const { sha256, ...rest } = release
  const body = rest as KnowledgeReleaseBody
  const err = validateKnowledgeReleaseBody(body)
  if (err) return err
  const expected = await computeReleaseSha256(body)
  if (expected !== sha256) {
    return `KnowledgeRelease: sha256 mismatch (expected ${expected}, got ${sha256})`
  }
  return null
}
