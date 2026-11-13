/**
 * #48-B OpenAlex minimal ingest → SourceSnapshot (bytes-captured).
 *
 * Does not publish releases or touch Atlas UI. Live HTTP is injectable via
 * `fetchImpl` so unit tests stay offline and deterministic.
 *
 * API: https://docs.openalex.org/how-to-use-the-api/get-lists-of-entities
 */

import type { SourceSnapshot } from '../types'
import { KNOWLEDGE_CONTRACT_VERSION } from '../types'
import { sha256Hex } from '../hash'
import { validateSourceSnapshot } from '../validate'

export const OPENALEX_DEFAULT_BASE = 'https://api.openalex.org'

export type OpenAlexIngestOptions = {
  /** Filter query fragment, e.g. `from_publication_date:2024-01-01` */
  filter?: string
  /** OpenAlex cursor; use `*` for first page. */
  cursor?: string
  perPage?: number
  /** mailto for polite pool (OpenAlex polite pool). */
  mailto?: string
  baseUrl?: string
  /** Fixed capture time for deterministic tests (ISO-8601). */
  capturedAt?: string
  fetchImpl?: typeof fetch
}

export type OpenAlexIngestPage = {
  snapshots: SourceSnapshot[]
  /** Cursor for the next page, or null if finished. */
  nextCursor: string | null
  /** Meta from the API response (when present). */
  meta: {
    count?: number
    page?: number
    perPage?: number
  }
  /** Raw response bytes (entire HTTP body) for the page list request. */
  pageBytes: Uint8Array
  pageContentSha256: string
  requestUrl: string
}

export class OpenAlexIngestError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'OpenAlexIngestError'
    this.code = code
  }
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function buildListUrl(opts: OpenAlexIngestOptions): string {
  const base = (opts.baseUrl ?? OPENALEX_DEFAULT_BASE).replace(/\/$/, '')
  const params = new URLSearchParams()
  params.set('per-page', String(Math.min(Math.max(opts.perPage ?? 25, 1), 200)))
  params.set('cursor', opts.cursor ?? '*')
  if (opts.filter) params.set('filter', opts.filter)
  if (opts.mailto) params.set('mailto', opts.mailto)
  // Select a small field set to keep fixtures small when recording.
  params.set(
    'select',
    'id,doi,title,publication_date,primary_location,open_access,type,cited_by_count',
  )
  return `${base}/works?${params.toString()}`
}

/**
 * Build a SourceSnapshot from one OpenAlex work object + the raw work JSON
 * bytes (fact-level snapshot of that work document).
 */
export async function sourceSnapshotFromOpenAlexWork(
  work: Record<string, unknown>,
  opts: { capturedAt: string; pageCursor?: string },
): Promise<SourceSnapshot> {
  const idRaw = typeof work.id === 'string' ? work.id : ''
  if (!idRaw) {
    throw new OpenAlexIngestError('invalid_work', 'OpenAlex work missing id')
  }
  const openAlexId = idRaw.replace(/^https?:\/\/openalex\.org\//i, '')
  const doi =
    typeof work.doi === 'string'
      ? work.doi.replace(/^https?:\/\/doi\.org\//i, '')
      : undefined
  const title = typeof work.title === 'string' ? work.title : undefined
  const locator = doi ? `https://doi.org/${doi}` : idRaw
  const locatorKind = doi ? ('doi' as const) : ('url' as const)

  // Snapshot bytes = canonical single-work JSON (stable, not the whole list page).
  const raw = JSON.stringify(work)
  const bytes = utf8Bytes(raw)
  const contentSha256 = await sha256Hex(bytes)

  const primary = work.primary_location as Record<string, unknown> | undefined
  const source = primary?.source as Record<string, unknown> | undefined
  const license =
    (typeof primary?.license === 'string' && primary.license) ||
    (typeof source?.type === 'string' && `openalex-source:${source.type}`) ||
    undefined

  const snap: SourceSnapshot = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: `src-openalex-${openAlexId}`,
    locator,
    locatorKind,
    capturedAt: opts.capturedAt,
    contentSha256,
    captureStatus: 'bytes-captured',
    contentType: 'application/json; profile=openalex-work',
    byteLength: bytes.byteLength,
    license,
    cursor: opts.pageCursor,
    title,
    provider: 'openalex',
  }

  const err = validateSourceSnapshot(snap)
  if (err) {
    throw new OpenAlexIngestError('invalid_snapshot', err)
  }
  return snap
}

/**
 * Ingest one OpenAlex works page into SourceSnapshots.
 * Throws OpenAlexIngestError on HTTP/JSON failures (negative-test surface).
 */
export async function ingestOpenAlexWorksPage(
  opts: OpenAlexIngestOptions = {},
): Promise<OpenAlexIngestPage> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  if (!fetchImpl) {
    throw new OpenAlexIngestError('no_fetch', 'fetch is not available')
  }

  const requestUrl = buildListUrl(opts)
  const capturedAt = opts.capturedAt ?? new Date().toISOString()
  const pageCursor = opts.cursor ?? '*'

  let res: Response
  try {
    res = await fetchImpl(requestUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'WaveWorld-knowledge-ingest/0.1 (mailto:research@localhost)',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new OpenAlexIngestError('network', `OpenAlex request failed: ${msg}`)
  }

  const bodyText = await res.text()
  const pageBytes = utf8Bytes(bodyText)
  const pageContentSha256 = await sha256Hex(pageBytes)

  if (!res.ok) {
    throw new OpenAlexIngestError(
      'http',
      `OpenAlex HTTP ${res.status}: ${bodyText.slice(0, 200)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    throw new OpenAlexIngestError('invalid_json', 'OpenAlex response is not JSON')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new OpenAlexIngestError('invalid_json', 'OpenAlex response root is not an object')
  }

  const root = parsed as Record<string, unknown>
  const results = root.results
  if (!Array.isArray(results)) {
    throw new OpenAlexIngestError('invalid_shape', 'OpenAlex response missing results[]')
  }

  const metaRaw = (root.meta ?? {}) as Record<string, unknown>
  const nextCursor =
    typeof metaRaw.next_cursor === 'string' && metaRaw.next_cursor.length > 0
      ? metaRaw.next_cursor
      : null

  const snapshots: SourceSnapshot[] = []
  for (const item of results) {
    if (!item || typeof item !== 'object') {
      throw new OpenAlexIngestError('invalid_work', 'OpenAlex result item is not an object')
    }
    snapshots.push(
      await sourceSnapshotFromOpenAlexWork(item as Record<string, unknown>, {
        capturedAt,
        pageCursor,
      }),
    )
  }

  return {
    snapshots,
    nextCursor,
    meta: {
      count: typeof metaRaw.count === 'number' ? metaRaw.count : undefined,
      page: typeof metaRaw.page === 'number' ? metaRaw.page : undefined,
      perPage: typeof metaRaw.per_page === 'number' ? metaRaw.per_page : undefined,
    },
    pageBytes,
    pageContentSha256,
    requestUrl,
  }
}
