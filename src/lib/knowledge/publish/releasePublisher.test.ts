import { describe, expect, it } from 'vitest'
import {
  PublishError,
  publishKnowledgeRelease,
  selectAndPromoteClaims,
} from './releasePublisher'
import { verifyKnowledgeRelease } from '../release'
import type { Claim, EvidenceBinding, SourceSnapshot } from '../types'
import { KNOWLEDGE_CONTRACT_VERSION } from '../types'
import { sha256Hex } from '../hash'

async function snap(id: string): Promise<SourceSnapshot> {
  const locator = `https://example.test/${id}`
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id,
    locator,
    locatorKind: 'url',
    capturedAt: '2026-08-04T00:00:00.000Z',
    contentSha256: await sha256Hex(locator),
    captureStatus: 'bytes-captured',
    byteLength: locator.length,
    provider: 'test',
  }
}

function claim(
  id: string,
  state: Claim['state'],
  kind = 'conversion.mechanism',
): Claim {
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id,
    kind,
    subjectId: 'sub-1',
    statement: { k: id },
    state,
    confidence: 0.9,
    createdAt: '2026-08-04T00:00:00.000Z',
  }
}

function binding(id: string, claimId: string, sourceSnapshotId: string): EvidenceBinding {
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id,
    claimId,
    sourceSnapshotId,
    support: 'supports',
    locator: { path: 'x' },
  }
}

describe('release publisher (#48-E)', () => {
  it('selectAndPromoteClaims promotes validated only', () => {
    const { releasedClaims, promotedClaimIds, excludedClaimIds } = selectAndPromoteClaims([
      claim('a', 'validated'),
      claim('b', 'candidate'),
      claim('c', 'quarantine'),
      claim('d', 'released'),
    ])
    expect(releasedClaims.map((c) => c.id).sort()).toEqual(['a', 'd'])
    expect(releasedClaims.find((c) => c.id === 'a')!.state).toBe('released')
    expect(promotedClaimIds).toEqual(['a'])
    expect(excludedClaimIds.sort()).toEqual(['b', 'c'])
  })

  it('publishes validated claims with bindings and deterministic sha', async () => {
    const s1 = await snap('src-1')
    const s2 = await snap('src-2')
    const claims = [claim('cl-1', 'validated'), claim('cl-2', 'validated')]
    const bindings = [
      binding('eb-1', 'cl-1', 'src-1'),
      binding('eb-2', 'cl-2', 'src-2'),
      binding('eb-orphan', 'cl-missing', 'src-1'),
    ]

    const a = await publishKnowledgeRelease({
      id: 'kr-test-1',
      releasedAt: '2026-08-04T12:00:00.000Z',
      claims,
      evidenceBindings: bindings,
      sourceSnapshots: [s1, s2, await snap('src-unused')],
    })
    const b = await publishKnowledgeRelease({
      id: 'kr-test-1',
      releasedAt: '2026-08-04T12:00:00.000Z',
      claims: [...claims].reverse(),
      evidenceBindings: [...bindings].reverse(),
      sourceSnapshots: [s2, s1, await snap('src-unused')],
    })

    expect(a.release.state).toBe('released')
    expect(a.release.claims).toHaveLength(2)
    expect(a.release.claims.every((c) => c.state === 'released')).toBe(true)
    expect(a.release.evidenceBindings.map((x) => x.id).sort()).toEqual(['eb-1', 'eb-2'])
    expect(a.release.sourceSnapshots.map((x) => x.id).sort()).toEqual(['src-1', 'src-2'])
    expect(a.release.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(a.release.sha256).toBe(b.release.sha256)
    expect(a.promotedClaimIds.sort()).toEqual(['cl-1', 'cl-2'])
    expect(await verifyKnowledgeRelease(a.release)).toBeNull()
  })

  it('negative: all quarantine/candidate → empty_release', async () => {
    await expect(
      publishKnowledgeRelease({
        id: 'kr-empty',
        releasedAt: '2026-08-04T12:00:00.000Z',
        claims: [claim('q', 'quarantine'), claim('c', 'candidate')],
        evidenceBindings: [],
        sourceSnapshots: [],
      }),
    ).rejects.toMatchObject({ code: 'empty_release', name: 'PublishError' })
  })

  it('negative: empty claims array', async () => {
    await expect(
      publishKnowledgeRelease({
        id: 'kr-empty2',
        releasedAt: '2026-08-04T12:00:00.000Z',
        claims: [],
        evidenceBindings: [],
        sourceSnapshots: [],
      }),
    ).rejects.toBeInstanceOf(PublishError)
  })

  it('pipeline smoke: gate-validated efficiency then publish', async () => {
    const { applyEfficiencyGate } = await import('../gates/efficiency')
    const s = await snap('src-eff')
    const gated = applyEfficiencyGate({
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'cl-eff',
      kind: 'conversion.efficiency',
      subjectId: 'sub',
      statement: { metric: 'eta', value: 0.4, unit: '1' },
      state: 'candidate',
      confidence: 0.8,
      createdAt: '2026-08-04T00:00:00.000Z',
    })
    expect(gated.claim.state).toBe('validated')

    const pub = await publishKnowledgeRelease({
      id: 'kr-eff',
      releasedAt: '2026-08-04T12:00:00.000Z',
      claims: [gated.claim],
      evidenceBindings: [binding('eb-eff', 'cl-eff', 'src-eff')],
      sourceSnapshots: [s],
    })
    expect(pub.release.claims[0]!.state).toBe('released')
    expect(pub.promotedClaimIds).toEqual(['cl-eff'])
  })
})
