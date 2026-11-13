import { describe, expect, it, vi } from 'vitest'
import {
  parseCursorStore,
  runScheduledIngestTick,
  serializeCursorStore,
} from './scheduledIngest'
import { emptyCursorStore, getCursor } from './dualSource'

const OA_WORK = {
  id: 'https://openalex.org/W1',
  doi: 'https://doi.org/10.1000/oa',
  title: 'OA work',
  primary_location: { license: 'cc-by' },
}

const CR_ITEM = {
  DOI: '10.1000/oa',
  title: ['Crossref same DOI'],
  URL: 'https://doi.org/10.1000/oa',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('scheduledIngest (#48-K)', () => {
  it('ticks both providers, advances cursors, prefers openalex on DOI dup', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('openalex')) {
        return jsonResponse({
          meta: { next_cursor: 'oa-2', count: 1 },
          results: [OA_WORK],
        })
      }
      if (u.includes('crossref')) {
        return jsonResponse({
          status: 'ok',
          message: {
            'next-cursor': 'cr-2',
            items: [CR_ITEM, { DOI: '10.1000/other', title: ['Other'] }],
          },
        })
      }
      return new Response('no', { status: 404 })
    }) as unknown as typeof fetch

    const r = await runScheduledIngestTick({
      fetchImpl,
      now: '2026-08-04T16:00:00.000Z',
      filter: 'from-index-date:2024-01-01',
      mailto: 'ops@example.com',
    })

    expect(r.pages).toHaveLength(2)
    expect(r.pages[0]!.provider).toBe('openalex')
    expect(r.pages[0]!.nextCursor).toBe('oa-2')
    expect(r.pages[1]!.provider).toBe('crossref')
    expect(r.merge.duplicatesDropped).toBe(1)
    expect(r.snapshots).toHaveLength(2)
    expect(r.snapshots[0]!.provider).toBe('openalex')
    expect(getCursor(r.cursorStore, 'openalex', 'from-index-date:2024-01-01')).toBe(
      'oa-2',
    )
    expect(getCursor(r.cursorStore, 'crossref', 'from-index-date:2024-01-01')).toBe(
      'cr-2',
    )
  })

  it('restarts crossref from * once when the persisted cursor died upstream', async () => {
    const deadStore = {
      version: 1,
      cursors: [{ provider: 'crossref', cursor: 'dead-cursor', filter: 'f', updatedAt: 'x' }],
    } as const
    const seen: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url)
      seen.push(decodeURIComponent(u))
      if (u.includes('cursor=dead-cursor')) {
        return jsonResponse({
          status: 'failed',
          'message-type': 'resource-failure',
          message: [{ type: 'cursor-invalid', value: 'dead-cursor' }],
        }, 404)
      }
      return jsonResponse({
        status: 'ok',
        message: { 'next-cursor': 'cr-fresh', items: [CR_ITEM] },
      })
    }) as unknown as typeof fetch

    const r = await runScheduledIngestTick({
      providers: ['crossref'],
      fetchImpl,
      cursorStore: deadStore as never,
      crossrefFilter: 'f',
      now: '2026-09-19T10:00:00.000Z',
      mailto: 'ops@example.com',
    })

    expect(seen).toHaveLength(2)
    expect(seen[0]).toContain('cursor=dead-cursor')
    expect(seen[1]).toContain('cursor=*')
    expect(r.pages[0]!.nextCursor).toBe('cr-fresh')
    expect(getCursor(r.cursorStore, 'crossref', 'f')).toBe('cr-fresh')
    expect(r.snapshots).toHaveLength(1)
  })

  it('does not retry cursor_invalid when the chain already started at *', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: 'failed', message: [{ type: 'cursor-invalid' }] }, 404),
    ) as unknown as typeof fetch
    await expect(
      runScheduledIngestTick({ providers: ['crossref'], fetchImpl, cursorStore: emptyCursorStore() }),
    ).rejects.toThrow('cursor-invalid')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('single provider openalex only', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ meta: { next_cursor: null }, results: [] }),
    ) as unknown as typeof fetch
    const r = await runScheduledIngestTick({
      providers: ['openalex'],
      fetchImpl,
      cursorStore: emptyCursorStore(),
      now: '2026-08-04T16:00:00.000Z',
    })
    expect(r.pages).toHaveLength(1)
    expect(r.snapshots).toEqual([])
    expect(getCursor(r.cursorStore, 'openalex')).toBe('*')
  })

  it('parseCursorStore / serialize round-trip', () => {
    const store = {
      version: 1 as const,
      cursors: [
        {
          provider: 'crossref' as const,
          cursor: 'abc',
          updatedAt: '2026-08-04T00:00:00.000Z',
          filter: 'from-index-date:2024-01-01',
        },
      ],
    }
    const raw = JSON.parse(serializeCursorStore(store))
    expect(parseCursorStore(raw)).toEqual(store)
    expect(parseCursorStore(null).cursors).toEqual([])
    expect(parseCursorStore({ version: 2, cursors: [] }).cursors).toEqual([])
  })
})
