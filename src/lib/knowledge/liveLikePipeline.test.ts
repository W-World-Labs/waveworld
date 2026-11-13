import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
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
} from './liveLikePipeline'
import { sourceSnapshotFromCrossrefWork } from './ingest/crossref'
import { sourceSnapshotFromOpenAlexWork } from './ingest/openalex'
import { loadKnowledgeRelease, listKnowledgeReleaseIds } from './store/releaseStore'
import { verifyKnowledgeRelease } from './release'
import { KNOWLEDGE_CONTRACT_VERSION, type Claim, type EvidenceBinding } from './types'

describe('offline live-like pipeline (#48-R)', () => {
  it('chains OpenAlex+Crossref fixtures → extract → gate → publish (deterministic)', async () => {
    const fixture = buildDefaultLiveLikeFixture()
    const a = await runOfflineLiveLikePipeline({
      releaseId: LIVE_LIKE_RELEASE_ID,
      releasedAt: LIVE_LIKE_RELEASED_AT,
      capturedAt: LIVE_LIKE_CAPTURED_AT,
      gateAt: LIVE_LIKE_GATED_AT,
      fixture,
    })
    const b = await runOfflineLiveLikePipeline({
      releaseId: LIVE_LIKE_RELEASE_ID,
      releasedAt: LIVE_LIKE_RELEASED_AT,
      capturedAt: LIVE_LIKE_CAPTURED_AT,
      gateAt: LIVE_LIKE_GATED_AT,
      fixture,
    })

    expect(a.claimSource).toBe('extract')
    expect(a.extractedClaimCount).toBeGreaterThanOrEqual(3)
    expect(a.openAlexSnapshots).toHaveLength(1)
    expect(a.crossrefSnapshots).toHaveLength(1)
    // Same DOI → Crossref snap dropped as duplicate (OpenAlex wins)
    expect(a.merge.duplicatesDropped).toBe(1)
    expect(a.mergedSnapshots).toHaveLength(1)
    expect(a.mergedSnapshots[0]!.provider).toBe('openalex')

    // Mechanism + OA pass gate; abstract efficiency (confidence 0.35) quarantines
    expect(a.release.claims.length).toBeGreaterThanOrEqual(2)
    expect(a.release.claims.every((c) => c.state === 'released')).toBe(true)
    expect(a.release.claims.some((c) => c.kind === 'conversion.mechanism')).toBe(true)
    expect(a.gatedOutClaimIds.length).toBeGreaterThanOrEqual(1)
    expect(
      a.gateResults.some(
        (r) =>
          r.claim.kind === 'conversion.efficiency' && r.transitionedTo === 'quarantine',
      ),
    ).toBe(true)

    expect(await verifyKnowledgeRelease(a.release)).toBeNull()
    expect(a.release.sha256).toBe(b.release.sha256)
    expect(a.release.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('crossref-only uses bibliographic fallback claims', async () => {
    const r = await runOfflineLiveLikePipeline({
      releaseId: 'kr-live-like-crossref-only',
      releasedAt: LIVE_LIKE_RELEASED_AT,
      capturedAt: LIVE_LIKE_CAPTURED_AT,
      gateAt: LIVE_LIKE_GATED_AT,
      fixture: {
        crossrefItems: [LIVE_LIKE_DEMO_CROSSREF_ITEM],
        fallbackBibliographicClaims: true,
      },
    })
    expect(r.claimSource).toBe('fallback')
    expect(r.fallbackClaimCount).toBe(1)
    expect(r.extractedClaimCount).toBe(0)
    expect(r.release.claims).toHaveLength(1)
    expect(r.release.claims[0]!.kind).toBe('other')
    expect(r.release.claims[0]!.state).toBe('released')
    expect(r.release.sourceSnapshots[0]!.provider).toBe('crossref')
  })

  it('accepts extraClaims when extract is empty', async () => {
    // Minimal work extracts nothing; extraClaims supply a publishable candidate.
    const minimalWork = {
      id: 'https://openalex.org/W999',
      title: 'no concepts',
    }
    const oaSnap = await sourceSnapshotFromOpenAlexWork(minimalWork, {
      capturedAt: LIVE_LIKE_CAPTURED_AT,
    })
    const claim: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'cl-extra-mech',
      kind: 'conversion.mechanism',
      subjectId: 'em-radio-to-electric-rectenna',
      statement: { mechanism: 'hand-built', source: 'extra' },
      state: 'candidate',
      confidence: 0.8,
      createdAt: LIVE_LIKE_CAPTURED_AT,
    }
    const binding: EvidenceBinding = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'eb-extra-mech',
      claimId: claim.id,
      sourceSnapshotId: oaSnap.id,
      support: 'supports',
      locator: { path: 'text' },
    }

    const r = await runOfflineLiveLikePipeline({
      releaseId: 'kr-live-like-extra',
      releasedAt: LIVE_LIKE_RELEASED_AT,
      capturedAt: LIVE_LIKE_CAPTURED_AT,
      gateAt: LIVE_LIKE_GATED_AT,
      fixture: {
        openAlexWorks: [minimalWork],
        extraClaims: [claim],
        extraBindings: [binding],
        fallbackBibliographicClaims: false,
      },
    })
    expect(r.claimSource).toBe('extra')
    expect(r.extractedClaimCount).toBe(0)
    expect(r.release.claims.map((c) => c.id)).toEqual(['cl-extra-mech'])
  })

  it('checkClaim reject path: schema-bad extraClaims quarantined before publish', async () => {
    const minimalWork = {
      id: 'https://openalex.org/W888',
      title: 'no extractable concepts',
    }
    const oaSnap = await sourceSnapshotFromOpenAlexWork(minimalWork, {
      capturedAt: LIVE_LIKE_CAPTURED_AT,
    })
    const good: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'cl-extra-good',
      kind: 'conversion.mechanism',
      subjectId: 'em-radio-to-electric-rectenna',
      statement: { mechanism: 'ok-extra', source: 'test' },
      state: 'candidate',
      confidence: 0.8,
      createdAt: LIVE_LIKE_CAPTURED_AT,
    }
    const bad: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'cl-extra-bad-schema',
      kind: 'conversion.mechanism',
      subjectId: 'em-visible-to-electric-photovoltaic',
      // Missing mechanism/source → statement layer fail under checkClaim
      statement: { note: 'invalid shape' },
      state: 'candidate',
      confidence: 0.95,
      createdAt: LIVE_LIKE_CAPTURED_AT,
    }
    const bindings: EvidenceBinding[] = [
      {
        contractVersion: KNOWLEDGE_CONTRACT_VERSION,
        id: 'eb-extra-good',
        claimId: good.id,
        sourceSnapshotId: oaSnap.id,
        support: 'supports',
        locator: { path: 'text' },
      },
      {
        contractVersion: KNOWLEDGE_CONTRACT_VERSION,
        id: 'eb-extra-bad',
        claimId: bad.id,
        sourceSnapshotId: oaSnap.id,
        support: 'supports',
        locator: { path: 'text' },
      },
    ]

    const r = await runOfflineLiveLikePipeline({
      releaseId: 'kr-live-like-reject',
      releasedAt: LIVE_LIKE_RELEASED_AT,
      capturedAt: LIVE_LIKE_CAPTURED_AT,
      gateAt: LIVE_LIKE_GATED_AT,
      fixture: {
        openAlexWorks: [minimalWork],
        extraClaims: [good, bad],
        extraBindings: bindings,
        fallbackBibliographicClaims: false,
      },
    })

    expect(r.claimSource).toBe('extra')
    expect(r.gatedOutClaimIds).toContain('cl-extra-bad-schema')
    expect(r.release.claims.map((c) => c.id)).toEqual(['cl-extra-good'])
    expect(r.publish.excludedClaimIds).toContain('cl-extra-bad-schema')
    const badGate = r.gateResults.find((g) => g.claim.id === 'cl-extra-bad-schema')
    expect(badGate?.transitionedTo).toBe('quarantine')
    expect(badGate?.verdict.ok).toBe(false)
  })

  it('requires fixed clocks', async () => {
    await expect(
      runOfflineLiveLikePipeline({
        releaseId: 'x',
        releasedAt: LIVE_LIKE_RELEASED_AT,
        capturedAt: '',
        gateAt: LIVE_LIKE_GATED_AT,
        fixture: buildDefaultLiveLikeFixture(),
      }),
    ).rejects.toBeInstanceOf(LiveLikePipelineError)

    await expect(
      runOfflineLiveLikePipeline({
        releaseId: 'x',
        releasedAt: LIVE_LIKE_RELEASED_AT,
        capturedAt: LIVE_LIKE_CAPTURED_AT,
        gateAt: '',
        fixture: buildDefaultLiveLikeFixture(),
      }),
    ).rejects.toMatchObject({ code: 'missing_clock' })
  })

  it('buildBibliographicClaimsFromFixtures yields valid candidate claims', async () => {
    const oaSnap = await sourceSnapshotFromOpenAlexWork(LIVE_LIKE_DEMO_OPENALEX_WORK, {
      capturedAt: LIVE_LIKE_CAPTURED_AT,
    })
    const crSnap = await sourceSnapshotFromCrossrefWork(LIVE_LIKE_DEMO_CROSSREF_ITEM, {
      capturedAt: LIVE_LIKE_CAPTURED_AT,
    })
    const { claims, evidenceBindings } = buildBibliographicClaimsFromFixtures(
      [LIVE_LIKE_DEMO_OPENALEX_WORK],
      [oaSnap],
      [LIVE_LIKE_DEMO_CROSSREF_ITEM],
      [crSnap],
      LIVE_LIKE_CAPTURED_AT,
    )
    expect(claims.length).toBe(2)
    expect(claims.every((c) => c.state === 'candidate')).toBe(true)
    expect(evidenceBindings).toHaveLength(2)
  })

  it('runOfflineLiveLikeAndWrite persists release + fixed index', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ww-live-like-'))
    const r = await runOfflineLiveLikeAndWrite(
      root,
      {
        releaseId: LIVE_LIKE_RELEASE_ID,
        releasedAt: LIVE_LIKE_RELEASED_AT,
        capturedAt: LIVE_LIKE_CAPTURED_AT,
        gateAt: LIVE_LIKE_GATED_AT,
        fixture: buildDefaultLiveLikeFixture(),
      },
      { indexGeneratedAt: LIVE_LIKE_RELEASED_AT },
    )

    expect(r.file.endsWith(`${path.sep}release.json`)).toBe(true)
    const loaded = await loadKnowledgeRelease(root, LIVE_LIKE_RELEASE_ID)
    expect(loaded.sha256).toBe(r.release.sha256)
    expect(await listKnowledgeReleaseIds(root)).toEqual([LIVE_LIKE_RELEASE_ID])

    const index = JSON.parse(await readFile(r.indexPath, 'utf8')) as {
      generatedAt: string
      ids: string[]
    }
    expect(index.generatedAt).toBe(LIVE_LIKE_RELEASED_AT)
    expect(index.ids).toEqual([LIVE_LIKE_RELEASE_ID])
  })
})
