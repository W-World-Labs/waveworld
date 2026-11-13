/**
 * #48 C1 — Fixed-SHA continuous integrity for the production-shaped publish path.
 *
 * Pins a golden KnowledgeRelease.sha256 for a frozen gate→publish fixture so
 * silent drift in canonical JSON, hash, promote/trim, or contract version fails
 * CI instead of only comparing two in-process runs (which can drift together).
 *
 * CI-scriptable: import `assertFixedPublishSha` / `runFixedPublishPath` and
 * throw on mismatch. No network, no wall clock, no disk.
 */

import { applyEfficiencyGate } from '../gates/efficiency'
import { sha256Hex } from '../hash'
import {
  KNOWLEDGE_CONTRACT_VERSION,
  type Claim,
  type EvidenceBinding,
  type KnowledgeRelease,
  type SourceSnapshot,
} from '../types'
import { verifyKnowledgeRelease } from '../release'
import {
  publishKnowledgeRelease,
  type PublishResult,
} from './releasePublisher'

/** Stable release id for the continuous fixed-SHA fixture. */
export const FIXED_PUBLISH_RELEASE_ID = 'kr-c1-fixed-sha'

export const FIXED_PUBLISH_CAPTURED_AT = '2026-08-06T00:00:00.000Z'
/** Frozen gate clock — must be passed to applyEfficiencyGate (avoids wall-clock updatedAt drift). */
export const FIXED_PUBLISH_GATED_AT = '2026-08-06T06:00:00.000Z'
export const FIXED_PUBLISH_RELEASED_AT = '2026-08-06T12:00:00.000Z'

export const FIXED_PUBLISH_LOCATOR = 'https://fixed-sha.waveworld.test/c1-paper'

/** Exact UTF-8 body used for snapshot contentSha256 (do not change without bumping golden). */
export const FIXED_PUBLISH_BODY_UTF8 = 'waveworld-c1-fixed-sha-fixture-v1'

/**
 * Pinned KnowledgeRelease.sha256 for FIXED_PUBLISH_* inputs.
 * Bump only with an intentional canonical/contract change + docs note.
 *
 * Preimage: releaseCanonicalPreimage(sortReleaseCollections(body)) then sha256Hex.
 * Includes claim.updatedAt = FIXED_PUBLISH_GATED_AT from the efficiency gate.
 */
export const FIXED_PUBLISH_GOLDEN_SHA256 =
  'e325471f6be6c0b59d588762d015f7eea0ec38b7c207cf513f5c1dd39c920ccd'

/** contentSha256 of FIXED_PUBLISH_BODY_UTF8 (bytes-captured snapshot). */
export const FIXED_PUBLISH_CONTENT_SHA256 =
  'fd2ac42abd2b797c9c5af61287018fbcdd2b883aa6c00711bb09a6ebac638d4d'

export type FixedPublishFixture = {
  claims: Claim[]
  evidenceBindings: EvidenceBinding[]
  sourceSnapshots: SourceSnapshot[]
}

/** Snapshot bytes for the frozen fixture (same every call). */
export function fixedPublishBodyBytes(): Uint8Array {
  return new TextEncoder().encode(FIXED_PUBLISH_BODY_UTF8)
}

/**
 * Build the frozen bytes-captured SourceSnapshot (async only for sha parity check).
 * contentSha256 is asserted against FIXED_PUBLISH_CONTENT_SHA256.
 */
export async function buildFixedPublishSnapshot(): Promise<SourceSnapshot> {
  const bytes = fixedPublishBodyBytes()
  const contentSha256 = await sha256Hex(bytes)
  if (contentSha256 !== FIXED_PUBLISH_CONTENT_SHA256) {
    throw new Error(
      `fixed-sha fixture content drift: expected ${FIXED_PUBLISH_CONTENT_SHA256}, got ${contentSha256}`,
    )
  }
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'snap-c1-fixed',
    locator: FIXED_PUBLISH_LOCATOR,
    locatorKind: 'url',
    capturedAt: FIXED_PUBLISH_CAPTURED_AT,
    contentSha256,
    captureStatus: 'bytes-captured',
    contentType: 'text/plain',
    byteLength: bytes.byteLength,
    provider: 'c1-fixed-sha',
  }
}

/**
 * Candidate efficiency claim → efficiency gate → validated (production gate step).
 * Uses FIXED_PUBLISH_GATED_AT so updatedAt never depends on wall clock.
 */
export function buildFixedPublishValidatedClaim(): Claim {
  const gated = applyEfficiencyGate(
    {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'claim-c1-fixed',
      kind: 'conversion.efficiency',
      subjectId: 'em-radio-to-electric-rectenna',
      statement: { metric: 'eta', value: 0.42, unit: '1' },
      state: 'candidate',
      confidence: 0.85,
      createdAt: FIXED_PUBLISH_CAPTURED_AT,
    },
    FIXED_PUBLISH_GATED_AT,
  )
  if (gated.claim.state !== 'validated') {
    const reasons = gated.verdict.ok ? 'ok' : gated.verdict.reasons.join(',')
    throw new Error(
      `fixed-sha fixture gate failed: expected validated, got ${gated.claim.state} (${reasons})`,
    )
  }
  return gated.claim
}

export function buildFixedPublishBinding(): EvidenceBinding {
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'bind-c1-fixed',
    claimId: 'claim-c1-fixed',
    sourceSnapshotId: 'snap-c1-fixed',
    support: 'supports',
    locator: { path: 'abstract', quote: 'eta=0.42 fixed C1' },
  }
}

/** Full frozen working-set for publishKnowledgeRelease. */
export async function buildFixedPublishFixture(): Promise<FixedPublishFixture> {
  return {
    claims: [buildFixedPublishValidatedClaim()],
    evidenceBindings: [buildFixedPublishBinding()],
    sourceSnapshots: [await buildFixedPublishSnapshot()],
  }
}

/**
 * Production-shaped path: efficiency gate (inside fixture) → publishKnowledgeRelease → verify.
 */
export async function runFixedPublishPath(): Promise<PublishResult> {
  const fixture = await buildFixedPublishFixture()
  return publishKnowledgeRelease({
    id: FIXED_PUBLISH_RELEASE_ID,
    releasedAt: FIXED_PUBLISH_RELEASED_AT,
    claims: fixture.claims,
    evidenceBindings: fixture.evidenceBindings,
    sourceSnapshots: fixture.sourceSnapshots,
    verify: true,
  })
}

export type FixedPublishAssertOk = {
  ok: true
  sha256: string
  release: KnowledgeRelease
  promotedClaimIds: string[]
}

export type FixedPublishAssertFail = {
  ok: false
  error: string
  actualSha256?: string
  expectedSha256: string
}

/**
 * CI-scriptable continuous integrity check.
 * Recomputes the fixed publish path and requires exact golden sha256.
 */
export async function assertFixedPublishSha(): Promise<FixedPublishAssertOk> {
  const expectedSha256 = FIXED_PUBLISH_GOLDEN_SHA256
  let pub: PublishResult
  try {
    pub = await runFixedPublishPath()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`fixed-sha publish path failed: ${msg}`)
  }

  const v = await verifyKnowledgeRelease(pub.release)
  if (v) {
    throw new Error(`fixed-sha verify failed: ${v}`)
  }

  const actual = pub.release.sha256
  if (actual !== expectedSha256) {
    throw new Error(
      `fixed-sha golden mismatch (silent digest drift?): expected ${expectedSha256}, got ${actual}`,
    )
  }

  if (pub.release.id !== FIXED_PUBLISH_RELEASE_ID) {
    throw new Error(`fixed-sha release id drift: ${pub.release.id}`)
  }
  if (pub.release.contractVersion !== KNOWLEDGE_CONTRACT_VERSION) {
    throw new Error(
      `fixed-sha contractVersion drift: ${pub.release.contractVersion} !== ${KNOWLEDGE_CONTRACT_VERSION}`,
    )
  }

  return {
    ok: true,
    sha256: actual,
    release: pub.release,
    promotedClaimIds: pub.promotedClaimIds,
  }
}

/** Non-throwing variant for reporters / soft checks. */
export async function checkFixedPublishSha(): Promise<
  FixedPublishAssertOk | FixedPublishAssertFail
> {
  try {
    return await assertFixedPublishSha()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const m = msg.match(/got ([a-f0-9]{64})/)
    return {
      ok: false,
      error: msg,
      actualSha256: m?.[1],
      expectedSha256: FIXED_PUBLISH_GOLDEN_SHA256,
    }
  }
}
