/**
 * #48-I Crossref minimal ingest → SourceSnapshot (bytes-captured).
 *
 * Dual-source companion to OpenAlex (`#48-B`). Does not publish releases or
 * touch Atlas UI. Live HTTP is injectable via `fetchImpl` for offline tests.
 *
 * API: https://api.crossref.org/swagger-ui/index.html
 * Cursor: `cursor=*` first page; next from `message['next-cursor']`.
 * Polite pool: mailto in User-Agent (Crossref request).
 */

import type { SourceSnapshot } from '../types'
import { KNOWLEDGE_CONTRACT_VERSION } from '../types'
import { sha256Hex } from '../hash'
import { validateSourceSnapshot } from '../validate'

export const CROSSREF_DEFAULT_BASE = 'https://api.crossref.org'

export type CrossrefIngestOptions = {
  /**
   * Crossref filter string, e.g. `from-index-date:2024-01-01`
   * (comma-separated filters supported by the API).
   */
  filter?: string
  /** Crossref cursor; use `*` for first page. */
  cursor?: string
  /** Rows per page (1–1000; default 20). */
  rows?: number
  /** mailto for Crossref polite User-Agent. */
  mailto?: string
  /** Free-text query (`query` / `query.bibliographic`). */
  query?: string
  baseUrl?: string
  /** Fixed capture time for deterministic tests (ISO-8601). */
  capturedAt?: string
  fetchImpl?: typeof fetch
}

export type CrossrefIngestPage = {
  snapshots: SourceSnapshot[]
  /** Cursor for the next page, or null if finished. */
  nextCursor: string | null
  meta: {
    totalResults?: number
    itemsPerPage?: number
  }
  pageBytes: Uint8Array
  pageContentSha256: string
  requestUrl: string
}

export class CrossrefIngestError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CrossrefIngestError'
    this.code = code
  }
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function normalizeDoi(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  return raw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim()
}

function firstTitle(item: Record<string, unknown>): string | undefined {
  const t = item.title
  if (Array.isArray(t) && typeof t[0] === 'string' && t[0].trim()) return t[0].trim()
  if (typeof t === 'string' && t.trim()) return t.trim()
  return undefined
}

function licenseFromItem(item: Record<string, unknown>): string | undefined {
  const lic = item.license
  if (!Array.isArray(lic) || lic.length === 0) return undefined
  const first = lic[0]
  if (!first || typeof first !== 'object') return undefined
  const url = (first as Record<string, unknown>).URL
  return typeof url === 'string' && url.trim() ? url.trim() : undefined
}

function buildListUrl(opts: CrossrefIngestOptions): string {
  const base = (opts.baseUrl ?? CROSSREF_DEFAULT_BASE).replace(/\/$/, '')
  const params = new URLSearchParams()
  params.set('rows', String(Math.min(Math.max(opts.rows ?? 20, 1), 1000)))
  params.set('cursor', opts.cursor ?? '*')
  if (opts.filter) params.set('filter', opts.filter)
  if (opts.query) params.set('query', opts.query)
  // Select reduces payload when recording fixtures (Crossref select is comma-separated).
  params.set(
    'select',
    'DOI,title,type,published,license,container-title,publisher,URL,abstract',
  )
  return `${base}/works?${params.toString()}`
}

/**
 * Build a SourceSnapshot from one Crossref work item + stable single-work JSON bytes.
 */
export async function sourceSnapshotFromCrossrefWork(
  item: Record<string, unknown>,
  opts: { capturedAt: string; pageCursor?: string },
): Promise<SourceSnapshot> {
  const doi = normalizeDoi(item.DOI)
  const url =
    typeof item.URL === 'string' && item.URL.trim()
      ? item.URL.trim()
      : doi
        ? `https://doi.org/${doi}`
        : undefined
  if (!doi && !url) {
    throw new CrossrefIngestError('invalid_work', 'Crossref work missing DOI and URL')
  }

  const locator = doi ? `https://doi.org/${doi}` : (url as string)
  const locatorKind = doi ? ('doi' as const) : ('url' as const)
  const idSuffix = doi
    ? doi.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
    : await sha256Hex(utf8Bytes(locator)).then((h) => h.slice(0, 16))

  const raw = JSON.stringify(item)
  const bytes = utf8Bytes(raw)
  const contentSha256 = await sha256Hex(bytes)

  const snap: SourceSnapshot = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: `src-crossref-${idSuffix}`,
    locator,
    locatorKind,
    capturedAt: opts.capturedAt,
    contentSha256,
    captureStatus: 'bytes-captured',
    contentType: 'application/json; profile=crossref-work',
    byteLength: bytes.byteLength,
    license: licenseFromItem(item),
    cursor: opts.pageCursor,
    title: firstTitle(item),
    provider: 'crossref',
  }

  const err = validateSourceSnapshot(snap)
  if (err) {
    throw new CrossrefIngestError('invalid_snapshot', err)
  }
  return snap
}

/**
 * Ingest one Crossref works page into SourceSnapshots.
 * Throws CrossrefIngestError on HTTP/JSON failures (negative-test surface).
 */
export async function ingestCrossrefWorksPage(
  opts: CrossrefIngestOptions = {},
): Promise<CrossrefIngestPage> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  if (!fetchImpl) {
    throw new CrossrefIngestError('no_fetch', 'fetch is not available')
  }

  const requestUrl = buildListUrl(opts)
  const capturedAt = opts.capturedAt ?? new Date().toISOString()
  const pageCursor = opts.cursor ?? '*'
  const mailto = opts.mailto ?? 'research@localhost'
  const ua = `WaveWorld-knowledge-ingest/0.1 (mailto:${mailto}; https://github.com/W-World-Labs/waveworld)`

  let res: Response
  try {
    res = await fetchImpl(requestUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': ua,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new CrossrefIngestError('network', `Crossref request failed: ${msg}`)
  }

  const bodyText = await res.text()
  const pageBytes = utf8Bytes(bodyText)
  const pageContentSha256 = await sha256Hex(pageBytes)

  if (!res.ok) {
    // Crossref cursors expire — a persisted cursor eventually returns
    // 404 cursor-invalid forever. Tag it distinctly so the scheduler can
    // restart from '*' instead of failing every tick identically.
    const cursorInvalid = bodyText.includes('cursor-invalid')
    throw new CrossrefIngestError(
      cursorInvalid ? 'cursor_invalid' : 'http',
      `Crossref HTTP ${res.status}: ${bodyText.slice(0, 200)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    throw new CrossrefIngestError('invalid_json', 'Crossref response is not JSON')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new CrossrefIngestError('invalid_json', 'Crossref response root is not an object')
  }

  const root = parsed as Record<string, unknown>
  const message = root.message
  if (!message || typeof message !== 'object') {
    throw new CrossrefIngestError('invalid_shape', 'Crossref response missing message object')
  }
  const msg = message as Record<string, unknown>
  const items = msg.items
  if (!Array.isArray(items)) {
    throw new CrossrefIngestError('invalid_shape', 'Crossref message missing items[]')
  }

  const nextRaw = msg['next-cursor']
  const nextCursor =
    typeof nextRaw === 'string' && nextRaw.length > 0 && nextRaw !== pageCursor
      ? nextRaw
      : typeof nextRaw === 'string' && nextRaw.length > 0
        ? nextRaw
        : null

  const snapshots: SourceSnapshot[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      throw new CrossrefIngestError('invalid_work', 'Crossref item is not an object')
    }
    snapshots.push(
      await sourceSnapshotFromCrossrefWork(item as Record<string, unknown>, {
        capturedAt,
        pageCursor,
      }),
    )
  }

  return {
    snapshots,
    nextCursor,
    meta: {
      totalResults:
        typeof msg['total-results'] === 'number' ? msg['total-results'] : undefined,
      itemsPerPage:
        typeof msg['items-per-page'] === 'number' ? msg['items-per-page'] : undefined,
    },
    pageBytes,
    pageContentSha256,
    requestUrl,
  }
}
