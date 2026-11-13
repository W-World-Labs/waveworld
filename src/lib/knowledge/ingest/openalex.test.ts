import { describe, expect, it, vi } from 'vitest'
import {
  OpenAlexIngestError,
  ingestOpenAlexWorksPage,
  sourceSnapshotFromOpenAlexWork,
} from './openalex'
import { sha256Hex } from '../hash'

const FIXTURE_WORK = {
  id: 'https://openalex.org/W2741809807',
  doi: 'https://doi.org/10.7717/peerj.4375',
  title: 'The state of OA: a large-scale analysis of the prevalence and impact of Open Access articles',
  publication_date: '2018-02-13',
  type: 'article',
  cited_by_count: 1234,
  primary_location: {
    license: 'cc-by',
    source: { type: 'journal', display_name: 'PeerJ' },
  },
  open_access: { is_oa: true, oa_status: 'gold' },
}

const FIXTURE_PAGE = {
  meta: {
    count: 1,
    db_response_time_ms: 12,
    page: 1,
    per_page: 1,
    next_cursor: 'cursor-page-2',
  },
  results: [FIXTURE_WORK],
}

function jsonResponse(body: unknown, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(text, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('OpenAlex ingest (#48-B)', () => {
  it('sourceSnapshotFromOpenAlexWork is bytes-captured with stable sha', async () => {
    const a = await sourceSnapshotFromOpenAlexWork(FIXTURE_WORK, {
      capturedAt: '2026-08-04T00:00:00.000Z',
      pageCursor: '*',
    })
    const b = await sourceSnapshotFromOpenAlexWork(FIXTURE_WORK, {
      capturedAt: '2026-08-04T00:00:00.000Z',
      pageCursor: '*',
    })
    expect(a.captureStatus).toBe('bytes-captured')
    expect(a.provider).toBe('openalex')
    expect(a.locatorKind).toBe('doi')
    expect(a.locator).toBe('https://doi.org/10.7717/peerj.4375')
    expect(a.contentSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(a.contentSha256).toBe(b.contentSha256)
    expect(a.byteLength).toBe(JSON.stringify(FIXTURE_WORK).length)
    expect(a.cursor).toBe('*')
    expect(a.license).toBe('cc-by')
    expect(a.id).toBe('src-openalex-W2741809807')
  })

  it('ingestOpenAlexWorksPage builds snapshots and next cursor from fixture', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(FIXTURE_PAGE),
    )
    const page = await ingestOpenAlexWorksPage({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      capturedAt: '2026-08-04T12:00:00.000Z',
      cursor: '*',
      perPage: 1,
      filter: 'from_publication_date:2018-01-01',
      mailto: 'test@example.com',
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [calledInput] = fetchImpl.mock.calls[0] ?? []
    expect(calledInput).toBeDefined()
    const calledUrl = String(calledInput)
    expect(calledUrl).toContain('api.openalex.org/works')
    expect(calledUrl).toContain('cursor=*')
    expect(calledUrl).toContain('mailto=test')

    expect(page.snapshots).toHaveLength(1)
    expect(page.nextCursor).toBe('cursor-page-2')
    expect(page.pageContentSha256).toBe(await sha256Hex(JSON.stringify(FIXTURE_PAGE)))
    expect(page.snapshots[0]!.captureStatus).toBe('bytes-captured')
    expect(page.snapshots[0]!.provider).toBe('openalex')
  })

  it('negative: HTTP error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 503))
    await expect(
      ingestOpenAlexWorksPage({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'http', name: 'OpenAlexIngestError' })
  })

  it('negative: invalid JSON body', async () => {
    const fetchImpl = vi.fn(async () => new Response('not-json{', { status: 200 }))
    await expect(
      ingestOpenAlexWorksPage({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'invalid_json' })
  })

  it('negative: missing results array', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ meta: {} }))
    await expect(
      ingestOpenAlexWorksPage({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'invalid_shape' })
  })

  it('negative: network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    await expect(
      ingestOpenAlexWorksPage({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(OpenAlexIngestError)
    await expect(
      ingestOpenAlexWorksPage({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'network' })
  })

  it('empty results page is valid (zero snapshots)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ meta: { count: 0, next_cursor: null }, results: [] }),
    )
    const page = await ingestOpenAlexWorksPage({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      capturedAt: '2026-08-04T00:00:00.000Z',
    })
    expect(page.snapshots).toEqual([])
    expect(page.nextCursor).toBeNull()
  })
})
