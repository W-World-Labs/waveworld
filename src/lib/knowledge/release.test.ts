import { describe, expect, it } from 'vitest'
import { edgeRefsToProvisionalBindings } from './edgeRefs'
import { sha256Hex } from './hash'
import {
  buildKnowledgeRelease,
  computeReleaseSha256,
  releaseCanonicalPreimage,
  verifyKnowledgeRelease,
} from './release'
import {
  KNOWLEDGE_CONTRACT_VERSION,
  type Claim,
  type EvidenceBinding,
  type SourceSnapshot,
} from './types'
import {
  canTransition,
  validateClaim,
  validateKnowledgeReleaseBody,
  validateTransition,
} from './validate'

const CAPTURED_AT = '2026-08-03T00:00:00.000Z'
const RELEASED_AT = '2026-08-03T12:00:00.000Z'

async function fixtureSnapshot(id: string, locator: string): Promise<SourceSnapshot> {
  const bytes = new TextEncoder().encode(`fixture-body:${locator}`)
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id,
    locator,
    locatorKind: 'url',
    capturedAt: CAPTURED_AT,
    contentSha256: await sha256Hex(bytes),
    captureStatus: 'bytes-captured',
    contentType: 'text/plain',
    byteLength: bytes.byteLength,
    provider: 'test',
  }
}

function releasedClaim(partial: Partial<Claim> & Pick<Claim, 'id' | 'subjectId'>): Claim {
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    kind: 'conversion.efficiency',
    statement: { etaMin: 0.1, etaMax: 0.8 },
    state: 'released',
    createdAt: CAPTURED_AT,
    ...partial,
  }
}

function binding(partial: Pick<EvidenceBinding, 'id' | 'claimId' | 'sourceSnapshotId'>): EvidenceBinding {
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    support: 'supports',
    locator: { page: 1, quote: 'η = 10–80%' },
    ...partial,
  }
}

describe('knowledge lifecycle state machine', () => {
  it('allows candidate → quarantine → validated → released', () => {
    expect(canTransition('candidate', 'quarantine')).toBe(true)
    expect(canTransition('quarantine', 'validated')).toBe(true)
    expect(canTransition('validated', 'released')).toBe(true)
    expect(validateTransition('candidate', 'validated')).toBeNull()
  })

  it('forbids skipping quarantine path incorrectly and terminal released', () => {
    expect(canTransition('candidate', 'released')).toBe(false)
    expect(canTransition('released', 'validated')).toBe(false)
    expect(validateTransition('released', 'candidate')).toMatch(/terminal/)
    expect(validateTransition('quarantine', 'released')).toMatch(/disallowed/)
  })

  it('validateClaim rejects bad confidence and state', () => {
    const bad = releasedClaim({ id: 'c1', subjectId: 'e1', confidence: 1.5, state: 'candidate' })
    expect(validateClaim({ ...bad, confidence: 1.5 })).toMatch(/confidence/)
    expect(validateClaim({ ...bad, state: 'nope' })).toMatch(/state/)
  })
})

describe('buildKnowledgeRelease — deterministic SHA-256', () => {
  it('fixed input snapshot yields the same KnowledgeRelease.sha256', async () => {
    const snap = await fixtureSnapshot('snap-1', 'https://example.org/paper')
    const claim = releasedClaim({ id: 'claim-1', subjectId: 'em-radio-to-electric-rectenna' })
    const bind = binding({ id: 'bind-1', claimId: 'claim-1', sourceSnapshotId: 'snap-1' })

    const a = await buildKnowledgeRelease({
      id: 'kr-test-1',
      releasedAt: RELEASED_AT,
      claims: [claim],
      evidenceBindings: [bind],
      sourceSnapshots: [snap],
    })
    const b = await buildKnowledgeRelease({
      id: 'kr-test-1',
      releasedAt: RELEASED_AT,
      claims: [claim],
      evidenceBindings: [bind],
      sourceSnapshots: [snap],
    })

    expect(a.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(a.sha256).toBe(b.sha256)
    expect(a.state).toBe('released')
    expect(await verifyKnowledgeRelease(a)).toBeNull()
  })

  it('collection order does not affect digest', async () => {
    const s1 = await fixtureSnapshot('snap-a', 'https://a.example')
    const s2 = await fixtureSnapshot('snap-b', 'https://b.example')
    const c1 = releasedClaim({ id: 'claim-a', subjectId: 'edge-a' })
    const c2 = releasedClaim({ id: 'claim-b', subjectId: 'edge-b' })
    const b1 = binding({ id: 'bind-a', claimId: 'claim-a', sourceSnapshotId: 'snap-a' })
    const b2 = binding({ id: 'bind-b', claimId: 'claim-b', sourceSnapshotId: 'snap-b' })

    const forward = await buildKnowledgeRelease({
      id: 'kr-order',
      releasedAt: RELEASED_AT,
      claims: [c1, c2],
      evidenceBindings: [b1, b2],
      sourceSnapshots: [s1, s2],
    })
    const reverse = await buildKnowledgeRelease({
      id: 'kr-order',
      releasedAt: RELEASED_AT,
      claims: [c2, c1],
      evidenceBindings: [b2, b1],
      sourceSnapshots: [s2, s1],
    })

    expect(forward.sha256).toBe(reverse.sha256)
    const { sha256: _fwdSha, ...forwardBody } = forward
    const { sha256: _revSha, ...reverseBody } = reverse
    expect(releaseCanonicalPreimage(forwardBody)).toBe(releaseCanonicalPreimage(reverseBody))
  })

  it('rejects non-released claims in a release', async () => {
    const snap = await fixtureSnapshot('snap-1', 'https://example.org/x')
    const claim = releasedClaim({ id: 'claim-1', subjectId: 'e1', state: 'validated' })
    await expect(
      buildKnowledgeRelease({
        id: 'kr-bad',
        releasedAt: RELEASED_AT,
        claims: [claim],
        evidenceBindings: [binding({ id: 'b1', claimId: 'claim-1', sourceSnapshotId: 'snap-1' })],
        sourceSnapshots: [snap],
      }),
    ).rejects.toThrow(/not released/)
  })

  it('verifyKnowledgeRelease detects tampering', async () => {
    const snap = await fixtureSnapshot('snap-1', 'https://example.org/y')
    const release = await buildKnowledgeRelease({
      id: 'kr-tamper',
      releasedAt: RELEASED_AT,
      claims: [releasedClaim({ id: 'claim-1', subjectId: 'e1' })],
      evidenceBindings: [binding({ id: 'b1', claimId: 'claim-1', sourceSnapshotId: 'snap-1' })],
      sourceSnapshots: [snap],
    })
    const tampered = {
      ...release,
      claims: [{ ...release.claims[0]!, statement: { etaMin: 0.99, etaMax: 0.99 } }],
    }
    expect(await verifyKnowledgeRelease(tampered)).toMatch(/sha256 mismatch/)
  })

  it('computeReleaseSha256 matches buildKnowledgeRelease', async () => {
    const snap = await fixtureSnapshot('snap-1', 'https://example.org/z')
    const input = {
      id: 'kr-match',
      releasedAt: RELEASED_AT,
      claims: [releasedClaim({ id: 'claim-1', subjectId: 'e1' })],
      evidenceBindings: [binding({ id: 'b1', claimId: 'claim-1', sourceSnapshotId: 'snap-1' })],
      sourceSnapshots: [snap],
    }
    const release = await buildKnowledgeRelease(input)
    const { sha256: _drop, ...body } = release
    expect(await computeReleaseSha256(body)).toBe(release.sha256)
    expect(validateKnowledgeReleaseBody(body)).toBeNull()
  })
})

describe('edgeRefs → EvidenceBinding migration', () => {
  it('maps ConversionEdge.refs URLs to locator-only when no fixture bytes (legacy path)', async () => {
    const refs = [
      'https://onlinelibrary.wiley.com/doi/full/10.4218/etrij.2023-0290',
      'https://en.wikipedia.org/wiki/Rectenna',
    ]
    const { claim, sourceSnapshots, evidenceBindings } = await edgeRefsToProvisionalBindings(
      'em-radio-to-electric-rectenna',
      refs,
      { createdAt: CAPTURED_AT },
    )

    expect(claim.state).toBe('candidate')
    expect(claim.kind).toBe('conversion.edge')
    expect(claim.subjectId).toBe('em-radio-to-electric-rectenna')
    expect(claim.statement.bytesCapturedCount).toBe(0)
    expect(claim.statement.locatorOnlyCount).toBe(2)
    expect(sourceSnapshots).toHaveLength(2)
    expect(sourceSnapshots.every((s) => s.captureStatus === 'locator-only')).toBe(true)
    expect(sourceSnapshots.every((s) => s.provider === 'static-edge-ref')).toBe(true)
    expect(evidenceBindings).toHaveLength(2)
    expect(evidenceBindings.every((b) => b.claimId === claim.id)).toBe(true)
    expect(evidenceBindings[0]!.locator).toEqual({ path: 'url' })
    // Provisional claims must not pass release body validation as released.
    expect(claim.state).not.toBe('released')
  })

  it('prefers bytes-captured content sha when fixtureBytesByLocator supplies payload', async () => {
    const url = 'https://example.org/with-bytes'
    const body = 'captured-ref-body'
    const { sourceSnapshots, claim } = await edgeRefsToProvisionalBindings(
      'edge-fixture-bytes',
      [url],
      {
        createdAt: CAPTURED_AT,
        fixtureBytesByLocator: { [url]: body },
      },
    )
    expect(sourceSnapshots).toHaveLength(1)
    expect(sourceSnapshots[0]!.captureStatus).toBe('bytes-captured')
    expect(sourceSnapshots[0]!.contentSha256).toBe(await sha256Hex(body))
    expect(claim.statement.bytesCapturedCount).toBe(1)
    expect(claim.statement.locatorOnlyCount).toBe(0)
  })

  it('empty refs still yield a candidate claim shell', async () => {
    const { claim, sourceSnapshots, evidenceBindings } = await edgeRefsToProvisionalBindings(
      'edge-no-refs',
      [],
    )
    expect(claim.statement.refCount).toBe(0)
    expect(sourceSnapshots).toHaveLength(0)
    expect(evidenceBindings).toHaveLength(0)
  })
})
