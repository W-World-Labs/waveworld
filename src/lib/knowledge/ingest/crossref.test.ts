import { describe, expect, it, vi } from 'vitest'
import {
  CrossrefIngestError,
  ingestCrossrefWorksPage,
  sourceSnapshotFromCrossrefWork,
} from './crossref'
import {
  advanceCursor,
  doiFromSnapshot,
  emptyCursorStore,
  getCursor,
  mergeSnapshotsByDoi,
} from './dualSource'
import { sha256Hex } from '../hash'
import type { SourceSnapshot } from '../types'
import { KNOWLEDGE_CONTRACT_VERSION } from '../types'

const FIXTURE_ITEM = {
  DOI: '10.7717/peerj.4375',
  title: ['The state of OA: a large-scale analysis'],
  type: 'journal-article',
  URL: 'https://doi.org/10.7717/peerj.4375',
  license: [{ URL: 'https://creativecommons.org/licenses/by/4.0/' }],
  publisher: 'PeerJ',
}

const FIXTURE_PAGE = {
  status: 'ok',
  'message-type': 'work-list',
  message: {
    'items-per-page': 1,
    'total-results': 2,
    'next-cursor': 'cursor-page-2',
    items: [FIXTURE_ITEM],
  },
}

function jsonResponse(body: unknown, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(text, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function snap(
  partial: Partial<SourceSnapshot> & Pick<SourceSnapshot, 'id' | 'locator' | 'locatorKind' | 'provider'>,
): SourceSnapshot {
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    capturedAt: '2026-08-04T00:00:00.000Z',
    contentSha256: 'a'.repeat(64),
    captureStatus: 'bytes-captured',
    ...partial,
  }
}

describe('Crossref ingest (#48-I)', () => {
  it('sourceSnapshotFromCrossrefWork is bytes-captured with stable sha', async () => {
    const a = await sourceSnapshotFromCrossrefWork(FIXTURE_ITEM, {
      capturedAt: '2026-08-04T00:00:00.000Z',
      pageCursor: '*',
    })
    const b = await sourceSnapshotFromCrossrefWork(FIXTURE_ITEM, {
      capturedAt: '2026-08-04T00:00:00.000Z',
      pageCursor: '*',
    })
    expect(a.captureStatus).toBe('bytes-captured')
    expect(a.provider).toBe('crossref')
    expect(a.locatorKind).toBe('doi')
    expect(a.locator).toBe('https://doi.org/10.7717/peerj.4375')
    expect(a.contentSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(a.contentSha256).toBe(b.contentSha256)
    expect(a.byteLength).toBe(JSON.stringify(FIXTURE_ITEM).length)
    expect(a.cursor).toBe('*')
    expect(a.license).toContain('creativecommons.org')
    expect(a.id).toBe('src-crossref-10.7717_peerj.4375')
    expect(a.title).toContain('state of OA')
  })

  it('ingestCrossrefWorksPage builds snapshots and next cursor from fixture', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(FIXTURE_PAGE),
    )
    const page = await ingestCrossrefWorksPage({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      capturedAt: '2026-08-04T12:00:00.000Z',
      cursor: '*',
      rows: 1,
      filter: 'from-index-date:2018-01-01',
      mailto: 'test@example.com',
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [calledInput, calledInit] = fetchImpl.mock.calls[0] ?? []
    expect(calledInput).toBeDefined()
    const calledUrl = String(calledInput)
    expect(calledUrl).toContain('api.crossref.org/works')
    expect(calledUrl).toContain('cursor=*')
    expect(calledUrl).toContain('from-index-date')

    const headers = calledInit?.headers as Record<string, string>
    expect(headers['User-Agent']).toContain('mailto:test@example.com')

    expect(page.snapshots).toHaveLength(1)
    expect(page.nextCursor).toBe('cursor-page-2')
    expect(page.pageContentSha256).toBe(await sha256Hex(JSON.stringify(FIXTURE_PAGE)))
    expect(page.snapshots[0]!.provider).toBe('crossref')
    expect(page.meta.totalResults).toBe(2)
  })

  it('negative: HTTP error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'error' }, 503))
    await expect(
      ingestCrossrefWorksPage({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'http', name: 'CrossrefIngestError' })
  })

  it('negative: invalid JSON body', async () => {
    const fetchImpl = vi.fn(async () => new Response('not-json{', { status: 200 }))
    await expect(
      ingestCrossrefWorksPage({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'invalid_json' })
  })

  it('negative: missing message.items', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok', message: {} }))
    await expect(
      ingestCrossrefWorksPage({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'invalid_shape' })
  })

  it('negative: network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    await expect(
      ingestCrossrefWorksPage({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(CrossrefIngestError)
    await expect(
      ingestCrossrefWorksPage({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'network' })
  })

  it('empty items page is valid (zero snapshots)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        status: 'ok',
        message: { 'total-results': 0, items: [], 'next-cursor': null },
      }),
    )
    const page = await ingestCrossrefWorksPage({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      capturedAt: '2026-08-04T00:00:00.000Z',
    })
    expect(page.snapshots).toEqual([])
    expect(page.nextCursor).toBeNull()
  })
})

describe('dual-source merge + scheduled cursor (#48-I)', () => {
  it('mergeSnapshotsByDoi prefers first list and counts dups', () => {
    const openalex = [
      snap({
        id: 'src-openalex-W1',
        locator: 'https://doi.org/10.7717/peerj.4375',
        locatorKind: 'doi',
        provider: 'openalex',
      }),
    ]
    const crossref = [
      snap({
        id: 'src-crossref-10.7717_peerj.4375',
        locator: 'https://doi.org/10.7717/peerj.4375',
        locatorKind: 'doi',
        provider: 'crossref',
      }),
      snap({
        id: 'src-crossref-other',
        locator: 'https://doi.org/10.1000/other',
        locatorKind: 'doi',
        provider: 'crossref',
      }),
    ]
    const r = mergeSnapshotsByDoi(openalex, crossref)
    expect(r.merged).toHaveLength(2)
    expect(r.duplicatesDropped).toBe(1)
    expect(r.merged[0]!.provider).toBe('openalex')
    expect(r.byProvider.openalex).toBe(1)
    expect(r.byProvider.crossref).toBe(2)
    expect(doiFromSnapshot(r.merged[0]!)).toBe('10.7717/peerj.4375')
  })

  it('advanceCursor / getCursor round-trip for scheduled crawl', () => {
    let store = emptyCursorStore()
    expect(getCursor(store, 'crossref', 'from-index-date:2024-01-01')).toBe('*')
    store = advanceCursor(store, 'crossref', 'cursor-2', {
      filter: 'from-index-date:2024-01-01',
      updatedAt: '2026-08-04T10:00:00.000Z',
    })
    expect(getCursor(store, 'crossref', 'from-index-date:2024-01-01')).toBe('cursor-2')
    expect(getCursor(store, 'openalex')).toBe('*')
    store = advanceCursor(store, 'crossref', null, {
      filter: 'from-index-date:2024-01-01',
      updatedAt: '2026-08-04T11:00:00.000Z',
    })
    expect(getCursor(store, 'crossref', 'from-index-date:2024-01-01')).toBe('*')
  })
})
