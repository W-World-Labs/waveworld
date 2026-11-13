import { describe, expect, it } from 'vitest'
import { verifyKnowledgeRelease } from '../release'
import {
  FIXED_PUBLISH_CONTENT_SHA256,
  FIXED_PUBLISH_GOLDEN_SHA256,
  FIXED_PUBLISH_RELEASE_ID,
  assertFixedPublishSha,
  buildFixedPublishFixture,
  buildFixedPublishValidatedClaim,
  checkFixedPublishSha,
  runFixedPublishPath,
} from './fixedShaFixture'
import { publishKnowledgeRelease } from './releasePublisher'

describe('C1 fixed-SHA publish continuous integrity', () => {
  it('pins exact golden KnowledgeRelease.sha256 (not only a===b)', async () => {
    const a = await runFixedPublishPath()
    const b = await runFixedPublishPath()

    expect(a.release.sha256).toBe(FIXED_PUBLISH_GOLDEN_SHA256)
    expect(b.release.sha256).toBe(FIXED_PUBLISH_GOLDEN_SHA256)
    expect(a.release.sha256).toBe(b.release.sha256)
    expect(a.release.id).toBe(FIXED_PUBLISH_RELEASE_ID)
    expect(a.release.claims).toHaveLength(1)
    expect(a.release.claims[0]!.state).toBe('released')
    expect(a.promotedClaimIds).toEqual(['claim-c1-fixed'])
    expect(await verifyKnowledgeRelease(a.release)).toBeNull()
  })

  it('assertFixedPublishSha is CI-scriptable and green on golden', async () => {
    const r = await assertFixedPublishSha()
    expect(r.ok).toBe(true)
    expect(r.sha256).toBe(FIXED_PUBLISH_GOLDEN_SHA256)
    expect(r.promotedClaimIds).toEqual(['claim-c1-fixed'])
    expect(r.release.sourceSnapshots[0]!.contentSha256).toBe(FIXED_PUBLISH_CONTENT_SHA256)
    expect(r.release.sourceSnapshots[0]!.captureStatus).toBe('bytes-captured')
  })

  it('checkFixedPublishSha reports ok without throw', async () => {
    const r = await checkFixedPublishSha()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sha256).toBe(FIXED_PUBLISH_GOLDEN_SHA256)
  })

  it('gate→publish order independence still matches golden', async () => {
    const fixture = await buildFixedPublishFixture()
    // Duplicate validated claim shell must not be needed; reverse empty extras
    const pub = await publishKnowledgeRelease({
      id: FIXED_PUBLISH_RELEASE_ID,
      releasedAt: '2026-08-06T12:00:00.000Z',
      claims: [...fixture.claims],
      evidenceBindings: [...fixture.evidenceBindings],
      sourceSnapshots: [...fixture.sourceSnapshots],
    })
    expect(pub.release.sha256).toBe(FIXED_PUBLISH_GOLDEN_SHA256)
  })

  it('negative: statement drift fails golden (no silent accept)', async () => {
    const fixture = await buildFixedPublishFixture()
    const drifted = {
      ...fixture.claims[0]!,
      statement: { metric: 'eta', value: 0.43, unit: '1' },
    }
    const pub = await publishKnowledgeRelease({
      id: FIXED_PUBLISH_RELEASE_ID,
      releasedAt: '2026-08-06T12:00:00.000Z',
      claims: [drifted],
      evidenceBindings: fixture.evidenceBindings,
      sourceSnapshots: fixture.sourceSnapshots,
    })
    expect(pub.release.sha256).not.toBe(FIXED_PUBLISH_GOLDEN_SHA256)
    expect(await verifyKnowledgeRelease(pub.release)).toBeNull() // still self-consistent
  })

  it('efficiency gate still yields validated for fixed candidate', () => {
    const claim = buildFixedPublishValidatedClaim()
    expect(claim.state).toBe('validated')
    expect(claim.statement).toEqual({ metric: 'eta', value: 0.42, unit: '1' })
  })
})
