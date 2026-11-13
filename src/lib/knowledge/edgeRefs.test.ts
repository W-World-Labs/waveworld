import { describe, expect, it } from 'vitest'
import {
  collectUniqueEdgeRefLocators,
  crawlLocatorUrls,
  edgeRefsLiveNetworkCrawlBulk,
  edgeRefsToProvisionalBindings,
  edgeRefsToProvisionalBindingsBulk,
  edgesToBulkItems,
  lookupBlobByContentSha,
  lookupBlobByLocator,
  type LiveLocatorFetchImpl,
} from './edgeRefs'
import { sha256Hex } from './hash'
import { validateClaim, validateEvidenceBinding, validateSourceSnapshot } from './validate'

const CAPTURED_AT = '2026-08-03T00:00:00.000Z'

describe('edgeRefsToProvisionalBindings — C2 bytes preference', () => {
  it('maps ConversionEdge.refs URLs to locator-only when no fixture bytes', async () => {
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
    expect(claim.statement.refCount).toBe(2)
    expect(claim.statement.bytesCapturedCount).toBe(0)
    expect(claim.statement.locatorOnlyCount).toBe(2)
    expect(sourceSnapshots).toHaveLength(2)
    expect(sourceSnapshots.every((s) => s.captureStatus === 'locator-only')).toBe(true)
    expect(sourceSnapshots.every((s) => s.provider === 'static-edge-ref')).toBe(true)
    expect(sourceSnapshots[0]!.contentSha256).toBe(await sha256Hex(refs[0]!))
    expect(evidenceBindings).toHaveLength(2)
    expect(evidenceBindings.every((b) => b.claimId === claim.id)).toBe(true)
    expect(evidenceBindings[0]!.locator).toEqual({ path: 'url' })
    expect(claim.state).not.toBe('released')
    expect(validateClaim(claim)).toBeNull()
    for (const s of sourceSnapshots) expect(validateSourceSnapshot(s)).toBeNull()
    for (const b of evidenceBindings) expect(validateEvidenceBinding(b)).toBeNull()
  })

  it('prefers bytes-captured (content sha) when fixture bytes exist for a locator', async () => {
    const withBytes = 'https://example.org/captured-paper'
    const locatorOnly = 'https://example.org/no-bytes-yet'
    const body = 'fixture body for rectenna paper\nη ≈ 0.55\n'
    const bodyBytes = new TextEncoder().encode(body)
    const expectedSha = await sha256Hex(bodyBytes)

    const { claim, sourceSnapshots, evidenceBindings } = await edgeRefsToProvisionalBindings(
      'edge-mixed-capture',
      [withBytes, locatorOnly],
      {
        createdAt: CAPTURED_AT,
        fixtureBytesByLocator: {
          [withBytes]: { bytes: body, contentType: 'text/plain; charset=utf-8' },
        },
      },
    )

    expect(claim.statement.refCount).toBe(2)
    expect(claim.statement.bytesCapturedCount).toBe(1)
    expect(claim.statement.locatorOnlyCount).toBe(1)

    const captured = sourceSnapshots.find((s) => s.locator === withBytes)!
    const provisional = sourceSnapshots.find((s) => s.locator === locatorOnly)!

    expect(captured.captureStatus).toBe('bytes-captured')
    expect(captured.contentSha256).toBe(expectedSha)
    expect(captured.contentSha256).not.toBe(await sha256Hex(withBytes))
    expect(captured.byteLength).toBe(bodyBytes.byteLength)
    expect(captured.contentType).toBe('text/plain; charset=utf-8')
    expect(captured.provider).toBe('static-edge-ref')

    expect(provisional.captureStatus).toBe('locator-only')
    expect(provisional.contentSha256).toBe(await sha256Hex(locatorOnly))
    expect(provisional.byteLength).toBeUndefined()

    const bindCaptured = evidenceBindings.find((b) => b.sourceSnapshotId === captured.id)!
    const bindProvisional = evidenceBindings.find((b) => b.sourceSnapshotId === provisional.id)!
    expect(bindCaptured.note).toMatch(/fixture\/captured bytes/i)
    expect(bindProvisional.note).toMatch(/locator-only/i)

    // Snapshot ids differ because content sha differs between capture modes.
    expect(captured.id).not.toBe(provisional.id)
    expect(validateSourceSnapshot(captured)).toBeNull()
    expect(validateSourceSnapshot(provisional)).toBeNull()
  })

  it('accepts Map and raw string/Uint8Array fixture values', async () => {
    const urlA = 'https://a.example/a'
    const urlB = 'https://b.example/b'
    const aText = 'aaa'
    const bBytes = new Uint8Array([1, 2, 3, 4])

    const { sourceSnapshots, claim } = await edgeRefsToProvisionalBindings(
      'edge-map-fixtures',
      [urlA, urlB],
      {
        createdAt: CAPTURED_AT,
        fixtureBytesByLocator: new Map<string, string | Uint8Array>([
          [urlA, aText],
          [urlB, bBytes],
        ]),
      },
    )

    expect(claim.statement.bytesCapturedCount).toBe(2)
    expect(claim.statement.locatorOnlyCount).toBe(0)
    expect(sourceSnapshots.every((s) => s.captureStatus === 'bytes-captured')).toBe(true)
    expect(sourceSnapshots[0]!.contentSha256).toBe(await sha256Hex(aText))
    expect(sourceSnapshots[1]!.contentSha256).toBe(await sha256Hex(bBytes))
    expect(sourceSnapshots[1]!.byteLength).toBe(4)
  })

  it('empty refs still yield a candidate claim shell', async () => {
    const { claim, sourceSnapshots, evidenceBindings } = await edgeRefsToProvisionalBindings(
      'edge-no-refs',
      [],
    )
    expect(claim.statement.refCount).toBe(0)
    expect(claim.statement.bytesCapturedCount).toBe(0)
    expect(claim.statement.locatorOnlyCount).toBe(0)
    expect(sourceSnapshots).toHaveLength(0)
    expect(evidenceBindings).toHaveLength(0)
  })
})

describe('edgeRefsToProvisionalBindingsBulk — residual bulk helper', () => {
  it('aggregates fixture bytes vs locator-only across edges (no network)', async () => {
    const shared = 'https://example.org/shared-paper'
    const onlyA = 'https://example.org/a-only'
    const bulk = await edgeRefsToProvisionalBindingsBulk(
      [
        { id: 'edge-a', refs: [shared, onlyA] },
        { id: 'edge-b', refs: [shared] },
        { id: 'edge-empty', refs: [] },
      ],
      {
        createdAt: CAPTURED_AT,
        fixtureBytesByLocator: {
          [shared]: 'captured shared body',
        },
      },
    )
    expect(bulk.edgeCount).toBe(3)
    expect(bulk.totalBytesCaptured).toBe(2) // shared on edge-a + edge-b
    expect(bulk.totalLocatorOnly).toBe(1) // onlyA
    expect(bulk.results).toHaveLength(3)
    expect(bulk.results.every((r) => r.claim.state === 'candidate')).toBe(true)
    expect(bulk.results[2]!.sourceSnapshots).toHaveLength(0)

    // Reverse blob lookup: shared fixture → bytes + both edge ids
    const sharedSha = await sha256Hex('captured shared body')
    const bySha = lookupBlobByContentSha(bulk.blobStore, sharedSha)
    expect(bySha).toBeDefined()
    expect(bySha!.locator).toBe(shared)
    expect(bySha!.captureStatus).toBe('bytes-captured')
    expect(bySha!.bytes).toBeDefined()
    expect(new TextDecoder().decode(bySha!.bytes!)).toBe('captured shared body')
    expect(bySha!.edgeIds.sort()).toEqual(['edge-a', 'edge-b'])
    expect(lookupBlobByLocator(bulk.blobStore, shared)?.contentSha256).toBe(sharedSha)

    // Locator-only: reverse yields locator fingerprint, no bytes
    const onlySha = await sha256Hex(onlyA)
    const onlyHit = lookupBlobByContentSha(bulk.blobStore, onlySha)
    expect(onlyHit?.captureStatus).toBe('locator-only')
    expect(onlyHit?.bytes).toBeUndefined()
    expect(onlyHit?.edgeIds).toEqual(['edge-a'])
    expect(lookupBlobByContentSha(bulk.blobStore, '0'.repeat(64))).toBeUndefined()
  })
})

describe('C2 static ConversionEdge.refs bulk fixture crawl (no network)', () => {
  it('crawls all static EDGES.refs via bulk + reverse blob lookup coverage', async () => {
    const { EDGES } = await import('../../data/ontology/edges')
    const items = edgesToBulkItems(EDGES)
    expect(items.length).toBeGreaterThan(100)
    expect(items.every((e) => typeof e.id === 'string' && e.id.length > 0)).toBe(true)

    // Fixture a known real locator from the first edge that has refs (deterministic, no network).
    const firstWithRefs = items.find((e) => (e.refs?.length ?? 0) > 0)!
    expect(firstWithRefs).toBeDefined()
    const fixtureUrl = firstWithRefs.refs![0]!
    const fixtureBody = `fixture-crawl-body for ${fixtureUrl}\n`
    const fixtureSha = await sha256Hex(fixtureBody)

    const bulk = await edgeRefsToProvisionalBindingsBulk(items, {
      createdAt: CAPTURED_AT,
      fixtureBytesByLocator: {
        [fixtureUrl]: { bytes: fixtureBody, contentType: 'text/plain; charset=utf-8' },
      },
    })

    expect(bulk.edgeCount).toBe(items.length)
    expect(bulk.results).toHaveLength(items.length)
    expect(bulk.results.every((r) => r.claim.state === 'candidate')).toBe(true)
    expect(bulk.results.every((r) => r.claim.kind === 'conversion.edge')).toBe(true)

    const totalRefs = items.reduce((n, e) => n + (e.refs?.length ?? 0), 0)
    const snapCount = bulk.results.reduce((n, r) => n + r.sourceSnapshots.length, 0)
    const bindCount = bulk.results.reduce((n, r) => n + r.evidenceBindings.length, 0)
    expect(snapCount).toBe(totalRefs)
    expect(bindCount).toBe(totalRefs)
    expect(bulk.totalBytesCaptured + bulk.totalLocatorOnly).toBe(totalRefs)
    expect(bulk.totalBytesCaptured).toBeGreaterThanOrEqual(1)
    expect(bulk.totalLocatorOnly).toBe(totalRefs - bulk.totalBytesCaptured)

    // Every snapshot validates; provider is static-edge-ref
    for (const r of bulk.results) {
      expect(validateClaim(r.claim)).toBeNull()
      for (const s of r.sourceSnapshots) {
        expect(validateSourceSnapshot(s)).toBeNull()
        expect(s.provider).toBe('static-edge-ref')
      }
      for (const b of r.evidenceBindings) expect(validateEvidenceBinding(b)).toBeNull()
    }

    // Reverse index covers unique locators
    expect(bulk.blobStore.uniqueLocatorCount).toBeGreaterThan(0)
    expect(bulk.blobStore.uniqueShaCount).toBe(bulk.blobStore.uniqueLocatorCount)
    expect(bulk.blobStore.bySha.size).toBe(bulk.blobStore.uniqueShaCount)

    // Fixture URL: reverse contentSha → raw bytes + locator + ≥1 edge
    const hit = lookupBlobByContentSha(bulk.blobStore, fixtureSha)
    expect(hit).toBeDefined()
    expect(hit!.locator).toBe(fixtureUrl)
    expect(hit!.captureStatus).toBe('bytes-captured')
    expect(hit!.contentType).toMatch(/text\/plain/)
    expect(new TextDecoder().decode(hit!.bytes!)).toBe(fixtureBody)
    expect(hit!.edgeIds.length).toBeGreaterThanOrEqual(1)
    expect(hit!.edgeIds).toContain(firstWithRefs.id)
    expect(hit!.claimIds.some((id) => id.includes(firstWithRefs.id))).toBe(true)
    expect(lookupBlobByLocator(bulk.blobStore, fixtureUrl)?.contentSha256).toBe(fixtureSha)

    // A non-fixtured ref from the same edge stays locator-only in reverse index
    if ((firstWithRefs.refs?.length ?? 0) > 1) {
      const other = firstWithRefs.refs![1]!
      const otherSha = await sha256Hex(other)
      const otherHit = lookupBlobByContentSha(bulk.blobStore, otherSha)
      expect(otherHit?.captureStatus).toBe('locator-only')
      expect(otherHit?.bytes).toBeUndefined()
      expect(otherHit?.locator).toBe(other)
    }
  })
})

/** Deterministic mock fetch for live crawl unit tests (no real network). */
function mockFetchMap(
  bodies: Record<string, { body: string; status?: number; contentType?: string }>,
): LiveLocatorFetchImpl {
  return async (input: string) => {
    const hit = bodies[input]
    if (!hit) {
      return new Response('not found', { status: 404, statusText: 'Not Found' })
    }
    return new Response(hit.body, {
      status: hit.status ?? 200,
      statusText: 'OK',
      headers: {
        'content-type': hit.contentType ?? 'text/plain; charset=utf-8',
      },
    })
  }
}

describe('crawlLocatorUrls + edgeRefsLiveNetworkCrawlBulk — C2b live network', () => {
  it('crawlLocatorUrls captures bytes and reports failures offline via fetchImpl', async () => {
    const ok = 'https://example.org/paper-ok'
    const bad = 'https://example.org/paper-404'
    const body = 'live crawl body v1\n'
    const map = await crawlLocatorUrls([ok, bad, ok], {
      fetchImpl: mockFetchMap({
        [ok]: { body, contentType: 'text/html; charset=utf-8' },
      }),
    })
    expect(map.captured).toBe(1)
    expect(map.failed).toBe(1)
    expect(map.outcomes).toHaveLength(2) // deduped unique locators
    expect(map.capturedBytesByLocator[ok]?.bytes).toBeDefined()
    expect(new TextDecoder().decode(map.capturedBytesByLocator[ok]!.bytes)).toBe(body)
    expect(map.outcomes.find((o) => o.locator === ok)?.status).toBe('bytes-captured')
    expect(map.outcomes.find((o) => o.locator === ok)?.contentSha256).toBe(
      await sha256Hex(body),
    )
    expect(map.outcomes.find((o) => o.locator === bad)?.status).toBe('failed')
    expect(map.outcomes.find((o) => o.locator === bad)?.error).toMatch(/http-404/)
  })

  it('skips non-http schemes', async () => {
    const map = await crawlLocatorUrls(['ftp://legacy.example/x', 'not-a-url'], {
      fetchImpl: mockFetchMap({}),
    })
    expect(map.captured).toBe(0)
    expect(map.skipped).toBe(2)
    expect(map.outcomes.every((o) => o.status === 'skipped')).toBe(true)
  })

  it('live crawl reduces locator-only counts and reverse index retains bytes', async () => {
    const shared = 'https://example.org/shared-live'
    const onlyA = 'https://example.org/a-live'
    const failUrl = 'https://example.org/fail-live'
    const sharedBody = 'shared live payload'
    const onlyBody = 'only-a live payload'

    const edges = [
      { id: 'edge-a', refs: [shared, onlyA, failUrl] },
      { id: 'edge-b', refs: [shared] },
    ]

    const live = await edgeRefsLiveNetworkCrawlBulk(edges, {
      createdAt: CAPTURED_AT,
      fetchImpl: mockFetchMap({
        [shared]: { body: sharedBody, contentType: 'text/plain' },
        [onlyA]: { body: onlyBody, contentType: 'text/plain' },
        // failUrl → 404
      }),
    })

    // Before: all 4 ref slots locator-only (shared counted twice across edges)
    expect(live.before.totalLocatorOnly).toBe(4)
    expect(live.before.totalBytesCaptured).toBe(0)

    // After: shared×2 + onlyA captured; failUrl still locator-only on edge-a
    expect(live.after.totalBytesCaptured).toBe(3)
    expect(live.after.totalLocatorOnly).toBe(1)
    expect(live.totalBytesCaptured).toBe(3)
    expect(live.totalLocatorOnly).toBe(1)
    expect(live.crawl.captured).toBe(2) // unique locators
    expect(live.crawl.failed).toBe(1)
    expect(live.crawl.remainingLocatorOnly).toEqual([failUrl])

    // Provider tagged as live crawl
    for (const r of live.results) {
      for (const s of r.sourceSnapshots) {
        expect(s.provider).toBe('live-edge-ref-crawl')
        expect(validateSourceSnapshot(s)).toBeNull()
      }
      expect(validateClaim(r.claim)).toBeNull()
    }

    // Reverse blob index: contentSha → locator + raw bytes
    const sharedSha = await sha256Hex(sharedBody)
    const bySha = lookupBlobByContentSha(live.blobStore, sharedSha)
    expect(bySha).toBeDefined()
    expect(bySha!.locator).toBe(shared)
    expect(bySha!.captureStatus).toBe('bytes-captured')
    expect(new TextDecoder().decode(bySha!.bytes!)).toBe(sharedBody)
    expect(bySha!.edgeIds.sort()).toEqual(['edge-a', 'edge-b'])
    expect(lookupBlobByLocator(live.blobStore, shared)?.contentSha256).toBe(sharedSha)

    const onlySha = await sha256Hex(onlyBody)
    expect(lookupBlobByContentSha(live.blobStore, onlySha)?.bytes).toBeDefined()

    // Failed locator remains fingerprint-only (no bytes)
    const failSha = await sha256Hex(failUrl)
    const failHit = lookupBlobByContentSha(live.blobStore, failSha)
    expect(failHit?.captureStatus).toBe('locator-only')
    expect(failHit?.bytes).toBeUndefined()
  })

  it('prefers fixture/captured skip over re-fetch; live still reduces residual', async () => {
    const fixtured = 'https://example.org/already'
    const liveUrl = 'https://example.org/need-live'
    const fixtureBody = 'fixture already here'
    const liveBody = 'fetched live'

    const live = await edgeRefsLiveNetworkCrawlBulk(
      [{ id: 'edge-mix', refs: [fixtured, liveUrl] }],
      {
        createdAt: CAPTURED_AT,
        fixtureBytesByLocator: { [fixtured]: fixtureBody },
        fetchImpl: mockFetchMap({
          [liveUrl]: { body: liveBody },
          // If re-fetched, would still work — assert skip via crawl.outcomes
          [fixtured]: { body: 'should-not-use' },
        }),
      },
    )

    expect(live.before.totalBytesCaptured).toBe(1)
    expect(live.before.totalLocatorOnly).toBe(1)
    expect(live.after.totalBytesCaptured).toBe(2)
    expect(live.after.totalLocatorOnly).toBe(0)
    expect(live.crawl.attempted).toBe(1)
    expect(live.crawl.captured).toBe(1)
    expect(live.crawl.skipped).toBe(1)
    expect(live.crawl.outcomes.find((o) => o.locator === fixtured)?.error).toBe(
      'already-captured',
    )

    const fixSha = await sha256Hex(fixtureBody)
    expect(lookupBlobByContentSha(live.blobStore, fixSha)?.bytes).toBeDefined()
    const liveSha = await sha256Hex(liveBody)
    expect(lookupBlobByContentSha(live.blobStore, liveSha)?.locator).toBe(liveUrl)
  })

  it('live crawl over static EDGES subset reduces locator-only vs baseline', async () => {
    const { EDGES } = await import('../../data/ontology/edges')
    const items = edgesToBulkItems(EDGES).filter((e) => (e.refs?.length ?? 0) > 0).slice(0, 12)
    expect(items.length).toBeGreaterThan(5)

    const unique = collectUniqueEdgeRefLocators(items)
    expect(unique.length).toBeGreaterThan(0)

    // Capture first 3 unique URLs via mock network; leave the rest locator-only.
    const captureN = Math.min(3, unique.length)
    const bodies: Record<string, { body: string; contentType?: string }> = {}
    for (let i = 0; i < captureN; i++) {
      const u = unique[i]!
      bodies[u] = { body: `live-EDGES-body:${u}\n`, contentType: 'text/plain' }
    }

    const live = await edgeRefsLiveNetworkCrawlBulk(items, {
      createdAt: CAPTURED_AT,
      fetchImpl: mockFetchMap(bodies),
      concurrency: 2,
    })

    expect(live.edgeCount).toBe(items.length)
    expect(live.before.totalLocatorOnly).toBeGreaterThan(live.after.totalLocatorOnly)
    expect(live.after.totalBytesCaptured).toBeGreaterThan(live.before.totalBytesCaptured)
    expect(live.crawl.captured).toBe(captureN)
    expect(live.crawl.remainingLocatorOnly.length).toBe(unique.length - captureN)

    // Reverse index covers every captured unique locator with bytes
    for (let i = 0; i < captureN; i++) {
      const u = unique[i]!
      const body = bodies[u]!.body
      const sha = await sha256Hex(body)
      const hit = lookupBlobByContentSha(live.blobStore, sha)
      expect(hit?.locator).toBe(u)
      expect(hit?.captureStatus).toBe('bytes-captured')
      expect(new TextDecoder().decode(hit!.bytes!)).toBe(body)
      expect(lookupBlobByLocator(live.blobStore, u)?.contentSha256).toBe(sha)
    }

    // All snapshots validate
    for (const r of live.results) {
      expect(validateClaim(r.claim)).toBeNull()
      for (const s of r.sourceSnapshots) expect(validateSourceSnapshot(s)).toBeNull()
      for (const b of r.evidenceBindings) expect(validateEvidenceBinding(b)).toBeNull()
    }
  })
})
