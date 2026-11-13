import { describe, expect, it, vi } from 'vitest'
import {
  BrowserCatalogError,
  browserCatalogIsSample,
  catalogDivergesFromDbWithoutSample,
  fetchLatestClaimsIndex,
  fetchLatestConflictSurface,
  fetchLatestReleased,
  fetchLatestReleasedMeta,
  fetchLatestSubjectClaimsPanel,
  fetchLatestSubjectConflictBadges,
  fetchReleaseIndex,
  fetchReleased,
} from './browserCatalog'
import { emitConflictSetsFromClaims } from '../conflictVisibility'
import { publishKnowledgeRelease } from '../publish/releasePublisher'
import type { Claim, EvidenceBinding, SourceSnapshot } from '../types'
import { KNOWLEDGE_CONTRACT_VERSION } from '../types'
import { sha256Hex } from '../hash'

async function sampleRelease() {
  const locator = 'https://example.test/h'
  const snap: SourceSnapshot = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'src-h',
    locator,
    locatorKind: 'url',
    capturedAt: '2026-08-04T00:00:00.000Z',
    contentSha256: await sha256Hex(locator),
    captureStatus: 'bytes-captured',
    provider: 'test',
  }
  const claim: Claim = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'cl-h',
    kind: 'conversion.mechanism',
    subjectId: 's',
    statement: { mechanism: 'x' },
    state: 'validated',
    confidence: 0.9,
    createdAt: '2026-08-04T00:00:00.000Z',
  }
  const binding: EvidenceBinding = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'eb-h',
    claimId: 'cl-h',
    sourceSnapshotId: 'src-h',
    support: 'supports',
  }
  const { release } = await publishKnowledgeRelease({
    id: 'kr-browser-1',
    releasedAt: '2026-08-04T12:00:00.000Z',
    claims: [claim],
    evidenceBindings: [binding],
    sourceSnapshots: [snap],
  })
  return release
}

describe('browser catalog (#48-H)', () => {
  it('fetchReleaseIndex parses ids; 404 → empty', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('index.json')) {
        return new Response(JSON.stringify({ ids: ['kr-a', 'kr-b'] }), { status: 200 })
      }
      return new Response('no', { status: 404 })
    }) as unknown as typeof fetch
    const idx = await fetchReleaseIndex('/knowledge-releases', fetchImpl)
    expect(idx.ids).toEqual(['kr-a', 'kr-b'])
    expect(idx.sample).toBeUndefined()

    const empty = await fetchReleaseIndex('/missing', async () => new Response('', { status: 404 }))
    expect(empty.ids).toEqual([])
  })

  it('fetchReleased verifies digest', async () => {
    const release = await sampleRelease()
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('index.json')) {
        return new Response(JSON.stringify({ ids: [release.id] }), { status: 200 })
      }
      if (String(url).includes('release.json')) {
        return new Response(JSON.stringify(release), { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch

    const loaded = await fetchReleased(release.id, 'https://cdn.example/kr', {
      fetchImpl,
    })
    expect(loaded.sha256).toBe(release.sha256)

    const meta = await fetchLatestReleasedMeta('https://cdn.example/kr', fetchImpl)
    expect(meta?.id).toBe(release.id)
    expect(meta?.claimCount).toBe(1)
  })

  it('negative: bad id / verify fail', async () => {
    await expect(fetchReleased('../etc', '/x')).rejects.toMatchObject({ code: 'bad_id' })
    const release = await sampleRelease()
    const tampered = { ...release, sha256: '0'.repeat(64) }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(tampered), { status: 200 }))
    await expect(
      fetchReleased(release.id, '/kr', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(BrowserCatalogError)
  })

  it('fetchLatestClaimsIndex + fetchLatestConflictSurface wire publish → UI', async () => {
    const a: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'eta-a',
      kind: 'conversion.efficiency',
      subjectId: 'edge-x',
      statement: { metric: 'eta', value: 0.3, unit: '1' },
      state: 'validated',
      confidence: 0.8,
      createdAt: '2026-08-04T00:00:00.000Z',
    }
    const b: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'eta-b',
      kind: 'conversion.efficiency',
      subjectId: 'edge-x',
      statement: { metric: 'eta', value: 0.6, unit: '1' },
      state: 'validated',
      confidence: 0.8,
      createdAt: '2026-08-04T00:00:00.000Z',
    }
    const { conflictSets } = emitConflictSetsFromClaims([a, b], { state: 'validated' })
    const { release } = await publishKnowledgeRelease({
      id: 'kr-browser-conflict',
      releasedAt: '2026-08-04T12:00:00.000Z',
      claims: [a, b],
      evidenceBindings: [],
      sourceSnapshots: [],
      conflictSets,
    })
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('index.json')) {
        return new Response(JSON.stringify({ ids: [release.id] }), { status: 200 })
      }
      if (String(url).includes('release.json')) {
        return new Response(JSON.stringify(release), { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch

    const idx = await fetchLatestClaimsIndex('/knowledge-releases', fetchImpl)
    expect(idx).not.toBeNull()
    expect(idx!.claimCount).toBe(2)
    expect(idx!.conflictExport.conflictCount).toBe(1)
    expect(idx!.bySubject.get('edge-x')?.length).toBe(2)

    const surface = await fetchLatestConflictSurface('/knowledge-releases', fetchImpl)
    expect(surface).not.toBeNull()
    expect(surface!.conflictCount).toBe(1)
    expect(surface!.bySubject['edge-x']).toHaveLength(1)
    expect(surface!.conflicts[0]!.claimIds).toEqual(['eta-a', 'eta-b'])

    // Hub list SPA wire: contested subjects only; multi-member ids; no silent merge
    const badges = await fetchLatestSubjectConflictBadges(
      '/knowledge-releases',
      fetchImpl,
    )
    expect(badges).toHaveLength(1)
    expect(badges[0]!.subjectId).toBe('edge-x')
    expect(badges[0]!.conflictCount).toBe(1)
    expect(badges[0]!.contestedClaimIds).toEqual(['eta-a', 'eta-b'])

    // ReleasedClaimsPanel one-shot: views + subject badge
    const panel = await fetchLatestSubjectClaimsPanel(
      'edge-x',
      '/knowledge-releases',
      fetchImpl,
    )
    expect(panel).not.toBeNull()
    expect(panel!.subjectId).toBe('edge-x')
    expect(panel!.views).toHaveLength(2)
    expect(panel!.badge?.contestedClaimIds).toEqual(['eta-a', 'eta-b'])

    const missingPanel = await fetchLatestSubjectClaimsPanel(
      'no-such-subject',
      '/knowledge-releases',
      fetchImpl,
    )
    expect(missingPanel).toBeNull()

    const empty = await fetchLatestClaimsIndex('/empty', async () =>
      new Response(JSON.stringify({ ids: [] }), { status: 200 }),
    )
    expect(empty).toBeNull()

    const emptyBadges = await fetchLatestSubjectConflictBadges(
      '/empty',
      async () => new Response(JSON.stringify({ ids: [] }), { status: 200 }),
    )
    expect(emptyBadges).toEqual([])

    const emptyPanel = await fetchLatestSubjectClaimsPanel(
      'edge-x',
      '/empty',
      async () => new Response(JSON.stringify({ ids: [] }), { status: 200 }),
    )
    expect(emptyPanel).toBeNull()
  })

  it('keeps sample flags and stays silent on sample latest (#91)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('index.json')) {
        return new Response(
          JSON.stringify({
            ids: ['kr-sample-48o'],
            sample: true,
            demo: true,
            label: 'sample-not-production-truth',
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ id: 'kr-sample-48o' }), { status: 200 })
    }) as unknown as typeof fetch
    const idx = await fetchReleaseIndex('/knowledge-releases', fetchImpl)
    expect(idx.sample).toBe(true)
    expect(idx.demo).toBe(true)
    expect(idx.label).toBe('sample-not-production-truth')
    expect(browserCatalogIsSample(idx)).toBe(true)
    expect(await fetchLatestReleased('/knowledge-releases', fetchImpl)).toBeNull()
    expect(catalogDivergesFromDbWithoutSample(idx, 'kr-db-latest')).toBe(false)
    expect(
      catalogDivergesFromDbWithoutSample({ ids: ['kr-file'] }, 'kr-db-latest'),
    ).toBe(true)
  })
})
