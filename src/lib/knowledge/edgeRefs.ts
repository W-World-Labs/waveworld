import { sha256Hex } from './hash'
import {
  KNOWLEDGE_CONTRACT_VERSION,
  type Claim,
  type EvidenceBinding,
  type SourceSnapshot,
} from './types'

export interface EdgeRefsMigrationResult {
  claim: Claim
  sourceSnapshots: SourceSnapshot[]
  evidenceBindings: EvidenceBinding[]
}

/** Fixture payload for one locator: raw UTF-8 text or bytes, optional content type. */
export type EdgeRefFixtureBytes =
  | string
  | Uint8Array
  | {
      bytes: string | Uint8Array
      contentType?: string
    }

export interface EdgeRefsMigrationOptions {
  createdAt?: string
  claimId?: string
  /**
   * When present for a normalized URL, prefer `bytes-captured` SourceSnapshot
   * (`contentSha256` over actual payload bytes) instead of locator-only fingerprint.
   * Keys: normalized locators (trim). Values: string | Uint8Array | { bytes, contentType? }.
   */
  fixtureBytesByLocator?:
    | ReadonlyMap<string, EdgeRefFixtureBytes>
    | Readonly<Record<string, EdgeRefFixtureBytes>>
  /**
   * Live-crawl (or other) captured payloads. Same shape as fixtureBytesByLocator.
   * When both maps have a key, **capturedBytesByLocator wins** (live/crawl preferred).
   */
  capturedBytesByLocator?:
    | ReadonlyMap<string, EdgeRefFixtureBytes>
    | Readonly<Record<string, EdgeRefFixtureBytes>>
  /**
   * Override SourceSnapshot.provider (default `static-edge-ref`).
   * Live network crawl bulk sets `live-edge-ref-crawl`.
   */
  provider?: string
}

function normalizeUrl(url: string): string {
  return url.trim()
}

function utf8Bytes(data: string | Uint8Array): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  return data
}

function resolveFixtureEntry(
  map:
    | ReadonlyMap<string, EdgeRefFixtureBytes>
    | Readonly<Record<string, EdgeRefFixtureBytes>>
    | undefined,
  locator: string,
): { bytes: Uint8Array; contentType?: string } | undefined {
  if (!map) return undefined
  const entry =
    map instanceof Map
      ? map.get(locator)
      : (map as Readonly<Record<string, EdgeRefFixtureBytes>>)[locator]
  if (entry == null) return undefined
  if (typeof entry === 'string' || entry instanceof Uint8Array) {
    return { bytes: utf8Bytes(entry) }
  }
  return {
    bytes: utf8Bytes(entry.bytes),
    contentType: entry.contentType,
  }
}

/** Resolve payload for a locator: captured (live) wins over fixture. */
function resolveFixture(
  options: Pick<
    EdgeRefsMigrationOptions,
    'fixtureBytesByLocator' | 'capturedBytesByLocator'
  > | undefined,
  locator: string,
): { bytes: Uint8Array; contentType?: string } | undefined {
  if (!options) return undefined
  return (
    resolveFixtureEntry(options.capturedBytesByLocator, locator) ??
    resolveFixtureEntry(options.fixtureBytesByLocator, locator)
  )
}

/** Default max body size for live locator crawl (2 MiB). */
export const LIVE_LOCATOR_CRAWL_DEFAULT_MAX_BYTES = 2 * 1024 * 1024

/** Default per-request timeout for live locator crawl. */
export const LIVE_LOCATOR_CRAWL_DEFAULT_TIMEOUT_MS = 15_000

export type LiveLocatorFetchImpl = (
  input: string,
  init?: RequestInit,
) => Promise<Response>

export type LiveLocatorCrawlOptions = {
  /** Injectable fetch (required in unit tests; defaults to global fetch). */
  fetchImpl?: LiveLocatorFetchImpl
  /** Per-request timeout in ms (default 15_000). */
  timeoutMs?: number
  /** Max response body bytes to retain (default 2 MiB). Oversize → failed. */
  maxBytes?: number
  /** User-Agent header for polite crawl. */
  userAgent?: string
  /** Max concurrent fetches (default 1 = sequential). */
  concurrency?: number
}

export type LiveLocatorCrawlOutcome = {
  locator: string
  status: 'bytes-captured' | 'failed' | 'skipped'
  httpStatus?: number
  contentType?: string
  byteLength?: number
  contentSha256?: string
  error?: string
}

export type LiveLocatorCrawlMapResult = {
  /** Successful captures as EdgeRef fixture payloads (for bulk migration). */
  capturedBytesByLocator: Record<string, { bytes: Uint8Array; contentType?: string }>
  outcomes: LiveLocatorCrawlOutcome[]
  captured: number
  failed: number
  skipped: number
}

/**
 * Live-fetch URL locators into payload bytes (injectable fetch; offline-safe tests).
 * Does **not** touch Knowledge DB — returns an in-memory map suitable for
 * `edgeRefsToProvisionalBindingsBulk` / reverse blob index.
 */
export async function crawlLocatorUrls(
  locators: readonly string[],
  options?: LiveLocatorCrawlOptions,
): Promise<LiveLocatorCrawlMapResult> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'crawlLocatorUrls: fetchImpl required (no global fetch available)',
    )
  }
  const timeoutMs = options?.timeoutMs ?? LIVE_LOCATOR_CRAWL_DEFAULT_TIMEOUT_MS
  const maxBytes = options?.maxBytes ?? LIVE_LOCATOR_CRAWL_DEFAULT_MAX_BYTES
  const userAgent =
    options?.userAgent ?? 'WaveWorld-knowledge-edge-ref-crawl/1.0 (+local)'
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 1, 8))

  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of locators) {
    const loc = normalizeUrl(raw)
    if (!loc || seen.has(loc)) continue
    seen.add(loc)
    unique.push(loc)
  }

  const capturedBytesByLocator: Record<
    string,
    { bytes: Uint8Array; contentType?: string }
  > = {}
  const outcomes: LiveLocatorCrawlOutcome[] = new Array(unique.length)
  let captured = 0
  let failed = 0
  let skipped = 0

  async function crawlOne(locator: string, index: number): Promise<void> {
    if (!/^https?:\/\//i.test(locator)) {
      outcomes[index] = {
        locator,
        status: 'skipped',
        error: 'unsupported-scheme',
      }
      skipped++
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(locator, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: '*/*',
          'User-Agent': userAgent,
        },
      })
      const httpStatus = res.status
      if (!res.ok) {
        outcomes[index] = {
          locator,
          status: 'failed',
          httpStatus,
          error: `http-${httpStatus}`,
        }
        failed++
        return
      }
      const contentType =
        res.headers.get('content-type')?.split(';')[0]?.trim() || undefined
      const contentLengthHeader = res.headers.get('content-length')
      if (contentLengthHeader) {
        const cl = Number(contentLengthHeader)
        if (Number.isFinite(cl) && cl > maxBytes) {
          outcomes[index] = {
            locator,
            status: 'failed',
            httpStatus,
            contentType,
            error: `body-too-large-header:${cl}`,
          }
          failed++
          return
        }
      }
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.byteLength > maxBytes) {
        outcomes[index] = {
          locator,
          status: 'failed',
          httpStatus,
          contentType,
          byteLength: buf.byteLength,
          error: `body-too-large:${buf.byteLength}`,
        }
        failed++
        return
      }
      const contentSha256 = await sha256Hex(buf)
      capturedBytesByLocator[locator] = {
        bytes: buf,
        ...(contentType ? { contentType } : {}),
      }
      outcomes[index] = {
        locator,
        status: 'bytes-captured',
        httpStatus,
        contentType,
        byteLength: buf.byteLength,
        contentSha256,
      }
      captured++
    } catch (err) {
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'timeout'
            : err.message
          : String(err)
      outcomes[index] = {
        locator,
        status: 'failed',
        error: message,
      }
      failed++
    } finally {
      clearTimeout(timer)
    }
  }

  let next = 0
  async function worker(): Promise<void> {
    while (next < unique.length) {
      const i = next++
      await crawlOne(unique[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  return {
    capturedBytesByLocator,
    outcomes: outcomes.filter(Boolean),
    captured,
    failed,
    skipped,
  }
}

export type LiveNetworkCrawlBulkOptions = EdgeRefsMigrationOptions &
  LiveLocatorCrawlOptions & {
    /**
     * When true (default), skip HTTP for locators already present in
     * fixtureBytesByLocator / capturedBytesByLocator.
     */
    skipAlreadyCaptured?: boolean
  }

export type LiveNetworkCrawlBulkResult = EdgeRefsBulkResult & {
  crawl: {
    attempted: number
    captured: number
    failed: number
    skipped: number
    outcomes: LiveLocatorCrawlOutcome[]
    /** Unique locators that remain locator-only after this crawl. */
    remainingLocatorOnly: string[]
  }
  /** Snapshot totals before applying live captures (fixtures only). */
  before: { totalBytesCaptured: number; totalLocatorOnly: number }
  /** Snapshot totals after live captures merged. */
  after: { totalBytesCaptured: number; totalLocatorOnly: number }
}

/**
 * Collect unique normalized URL locators from bulk edge items.
 */
export function collectUniqueEdgeRefLocators(
  edges: readonly EdgeRefsBulkItem[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const e of edges) {
    for (const raw of e.refs ?? []) {
      const loc = normalizeUrl(raw)
      if (!loc || seen.has(loc)) continue
      seen.add(loc)
      out.push(loc)
    }
  }
  return out
}

/**
 * Live network crawl of ConversionEdge.refs → reduce locator-only debt + reverse blob index.
 *
 * Flow:
 * 1. Baseline bulk with fixtures only (before counts)
 * 2. HTTP-fetch remaining locator-only URLs (injectable fetch)
 * 3. Re-run bulk with captured bytes → more `bytes-captured`, reverse index retains raw bytes
 *
 * Does **not** own Knowledge DB seed/blob tables (#52); reverse index is in-memory `blobStore`.
 */
export async function edgeRefsLiveNetworkCrawlBulk(
  edges: readonly EdgeRefsBulkItem[],
  options?: LiveNetworkCrawlBulkOptions,
): Promise<LiveNetworkCrawlBulkResult> {
  const baseline = await edgeRefsToProvisionalBindingsBulk(edges, {
    createdAt: options?.createdAt,
    fixtureBytesByLocator: options?.fixtureBytesByLocator,
    capturedBytesByLocator: options?.capturedBytesByLocator,
    provider: options?.provider,
  })

  const allLocators = collectUniqueEdgeRefLocators(edges)
  const skipAlready = options?.skipAlreadyCaptured !== false
  const toFetch: string[] = []
  const preSkipped: LiveLocatorCrawlOutcome[] = []

  for (const loc of allLocators) {
    const already = resolveFixture(
      {
        fixtureBytesByLocator: options?.fixtureBytesByLocator,
        capturedBytesByLocator: options?.capturedBytesByLocator,
      },
      loc,
    )
    if (skipAlready && already) {
      preSkipped.push({
        locator: loc,
        status: 'skipped',
        error: 'already-captured',
        contentSha256: await sha256Hex(already.bytes),
        byteLength: already.bytes.byteLength,
        contentType: already.contentType,
      })
      continue
    }
    toFetch.push(loc)
  }

  const crawlMap = await crawlLocatorUrls(toFetch, {
    fetchImpl: options?.fetchImpl,
    timeoutMs: options?.timeoutMs,
    maxBytes: options?.maxBytes,
    userAgent: options?.userAgent,
    concurrency: options?.concurrency,
  })

  // Merge pre-supplied captured + live results (live wins on key clash).
  const mergedCaptured: Record<string, EdgeRefFixtureBytes> = {}
  if (options?.capturedBytesByLocator) {
    if (options.capturedBytesByLocator instanceof Map) {
      for (const [k, v] of options.capturedBytesByLocator) mergedCaptured[k] = v
    } else {
      Object.assign(mergedCaptured, options.capturedBytesByLocator)
    }
  }
  for (const [k, v] of Object.entries(crawlMap.capturedBytesByLocator)) {
    mergedCaptured[k] = v
  }

  const afterBulk = await edgeRefsToProvisionalBindingsBulk(edges, {
    createdAt: options?.createdAt,
    fixtureBytesByLocator: options?.fixtureBytesByLocator,
    capturedBytesByLocator: mergedCaptured,
    provider: options?.provider ?? 'live-edge-ref-crawl',
  })

  const remainingLocatorOnly: string[] = []
  for (const [loc, sha] of afterBulk.blobStore.shaByLocator) {
    const entry = afterBulk.blobStore.bySha.get(sha)
    if (entry?.captureStatus === 'locator-only') remainingLocatorOnly.push(loc)
  }
  remainingLocatorOnly.sort()

  return {
    ...afterBulk,
    crawl: {
      attempted: toFetch.length,
      captured: crawlMap.captured,
      failed: crawlMap.failed,
      skipped: crawlMap.skipped + preSkipped.length,
      outcomes: [...preSkipped, ...crawlMap.outcomes],
      remainingLocatorOnly,
    },
    before: {
      totalBytesCaptured: baseline.totalBytesCaptured,
      totalLocatorOnly: baseline.totalLocatorOnly,
    },
    after: {
      totalBytesCaptured: afterBulk.totalBytesCaptured,
      totalLocatorOnly: afterBulk.totalLocatorOnly,
    },
  }
}

/**
 * Map legacy ConversionEdge.refs (URL list) into provisional knowledge records.
 *
 * Capture preference (#48 C2):
 * - If `capturedBytesByLocator` / `fixtureBytesByLocator` supplies payload for a URL
 *   → `captureStatus: "bytes-captured"` and `contentSha256` is SHA-256 of those bytes.
 * - Otherwise → `locator-only` with `contentSha256` = fingerprint of the normalized URL.
 *
 * Limits still apply when no fixture/crawl bytes exist:
 * - EvidenceBinding.locator has only the URL path marker — no page/quote/span
 * - Claim is a coarse `conversion.edge` shell; fact-level extraction is later work
 *
 * These provisional records must stay `candidate` until real snapshots +
 * validation promote them. Atlas must not consume them until a KnowledgeRelease.
 */
export async function edgeRefsToProvisionalBindings(
  edgeId: string,
  refs: readonly string[] | undefined | null,
  options?: EdgeRefsMigrationOptions,
): Promise<EdgeRefsMigrationResult> {
  const createdAt = options?.createdAt ?? '1970-01-01T00:00:00.000Z'
  const claimId = options?.claimId ?? `claim:edge:${edgeId}`
  const provider = options?.provider ?? 'static-edge-ref'
  const urls = (refs ?? []).map(normalizeUrl).filter(Boolean)

  const sourceSnapshots: SourceSnapshot[] = []
  const evidenceBindings: EvidenceBinding[] = []
  let bytesCapturedCount = 0
  let locatorOnlyCount = 0

  for (let i = 0; i < urls.length; i++) {
    const locator = urls[i]!
    const fixture = resolveFixture(options, locator)

    let contentSha256: string
    let captureStatus: SourceSnapshot['captureStatus']
    let byteLength: number | undefined
    let contentType: string | undefined
    let note: string

    if (fixture) {
      contentSha256 = await sha256Hex(fixture.bytes)
      captureStatus = 'bytes-captured'
      byteLength = fixture.bytes.byteLength
      contentType = fixture.contentType ?? 'application/octet-stream'
      note =
        'Migrated from ConversionEdge.refs with fixture/captured bytes; contentSha256 is payload hash'
      bytesCapturedCount++
    } else {
      contentSha256 = await sha256Hex(locator)
      captureStatus = 'locator-only'
      note =
        'Migrated from ConversionEdge.refs; locator-only, no content snapshot yet'
      locatorOnlyCount++
    }

    const snapshotId = `snap:edge-ref:${edgeId}:${contentSha256.slice(0, 16)}`
    const snapshot: SourceSnapshot = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: snapshotId,
      locator,
      locatorKind: 'url',
      capturedAt: createdAt,
      contentSha256,
      captureStatus,
      provider,
      ...(byteLength != null ? { byteLength } : {}),
      ...(contentType != null ? { contentType } : {}),
    }
    sourceSnapshots.push(snapshot)
    evidenceBindings.push({
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: `bind:${claimId}:${i}`,
      claimId,
      sourceSnapshotId: snapshotId,
      support: 'supports',
      locator: { path: 'url' },
      note,
    })
  }

  const claim: Claim = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: claimId,
    kind: 'conversion.edge',
    subjectId: edgeId,
    statement: {
      edgeId,
      source: 'static-edge-refs',
      refCount: urls.length,
      bytesCapturedCount,
      locatorOnlyCount,
    },
    state: 'candidate',
    createdAt,
  }

  return { claim, sourceSnapshots, evidenceBindings }
}

/** Minimal edge shape for bulk static refs migration (no ontology import). */
export type EdgeRefsBulkItem = {
  id: string
  refs?: readonly string[] | null
}

/**
 * In-memory reverse index for provisional edge-ref crawl results.
 * Enables released-fact style reverse lookup: contentSha256 → locator (+ bytes when captured).
 * Payload bytes retained from fixture and/or live crawl maps — not Knowledge DB.
 */
export type EdgeRefsBlobStore = {
  /** Unique content hashes seen in this crawl. */
  uniqueShaCount: number
  /** Unique locators (normalized URLs) seen. */
  uniqueLocatorCount: number
  /** contentSha256 → entry (locator, capture status, reverse edge/claim/snapshot ids). */
  bySha: Map<string, EdgeRefsBlobLookupEntry>
  /** normalized locator → contentSha256 used for that locator in this crawl. */
  shaByLocator: Map<string, string>
}

export type EdgeRefsBlobLookupEntry = {
  contentSha256: string
  locator: string
  captureStatus: SourceSnapshot['captureStatus']
  /** Raw payload when `bytes-captured`; absent for locator-only fingerprints. */
  bytes?: Uint8Array
  byteLength?: number
  contentType?: string
  snapshotIds: string[]
  edgeIds: string[]
  claimIds: string[]
}

export type EdgeRefsBlobLookup = {
  contentSha256: string
  locator: string
  captureStatus: SourceSnapshot['captureStatus']
  /** Present only for bytes-captured entries that retained payload in the store. */
  bytes?: Uint8Array
  byteLength?: number
  contentType?: string
  snapshotIds: string[]
  edgeIds: string[]
  claimIds: string[]
}

export type EdgeRefsBulkResult = {
  results: EdgeRefsMigrationResult[]
  /** Sum of bytes-captured snapshots across all edges. */
  totalBytesCaptured: number
  /** Sum of locator-only snapshots across all edges. */
  totalLocatorOnly: number
  edgeCount: number
  /**
   * Reverse blob index for this crawl: contentSha256 → locator (+ optional bytes).
   * Populated from migration snapshots and fixture/captured byte maps.
   */
  blobStore: EdgeRefsBlobStore
}

/**
 * Project static ontology edges into bulk migration items (`id` + `refs` only).
 * Keeps edgeRefs free of ontology type imports at call sites that already have edge lists.
 */
export function edgesToBulkItems(
  edges: readonly { id: string; refs?: readonly string[] | null }[],
): EdgeRefsBulkItem[] {
  return edges.map((e) => ({ id: e.id, refs: e.refs ?? null }))
}

/**
 * Build reverse index from bulk migration results.
 * When fixture/captured byte maps are supplied, bytes-captured entries retain payload
 * so callers can reverse-lookup raw bytes + locator by contentSha256.
 */
export function buildEdgeRefsBlobStore(
  results: readonly EdgeRefsMigrationResult[],
  options?: Pick<
    EdgeRefsMigrationOptions,
    'fixtureBytesByLocator' | 'capturedBytesByLocator'
  >,
): EdgeRefsBlobStore {
  const bySha = new Map<string, EdgeRefsBlobLookupEntry>()
  const shaByLocator = new Map<string, string>()

  for (const r of results) {
    const edgeId = r.claim.subjectId
    const claimId = r.claim.id
    for (const snap of r.sourceSnapshots) {
      const sha = snap.contentSha256
      const locator = snap.locator
      shaByLocator.set(locator, sha)

      let entry = bySha.get(sha)
      if (!entry) {
        const fixture = resolveFixture(options, locator)
        const bytes =
          snap.captureStatus === 'bytes-captured' && fixture
            ? fixture.bytes
            : undefined
        entry = {
          contentSha256: sha,
          locator,
          captureStatus: snap.captureStatus,
          ...(bytes ? { bytes, byteLength: bytes.byteLength } : {}),
          ...(snap.byteLength != null && !bytes ? { byteLength: snap.byteLength } : {}),
          ...(snap.contentType != null ? { contentType: snap.contentType } : {}),
          ...(fixture?.contentType != null && !snap.contentType
            ? { contentType: fixture.contentType }
            : {}),
          snapshotIds: [],
          edgeIds: [],
          claimIds: [],
        }
        bySha.set(sha, entry)
      } else if (
        entry.captureStatus === 'bytes-captured' &&
        entry.bytes == null
      ) {
        const fixture = resolveFixture(options, locator)
        if (fixture) {
          entry.bytes = fixture.bytes
          entry.byteLength = fixture.bytes.byteLength
          if (fixture.contentType != null) entry.contentType = fixture.contentType
        }
      }

      if (!entry.snapshotIds.includes(snap.id)) entry.snapshotIds.push(snap.id)
      if (!entry.edgeIds.includes(edgeId)) entry.edgeIds.push(edgeId)
      if (!entry.claimIds.includes(claimId)) entry.claimIds.push(claimId)
    }
  }

  return {
    uniqueShaCount: bySha.size,
    uniqueLocatorCount: shaByLocator.size,
    bySha,
    shaByLocator,
  }
}

/**
 * Reverse lookup: contentSha256 → locator (+ raw bytes when captured in this crawl).
 * Returns undefined when the hash was not produced by the crawl / store.
 */
export function lookupBlobByContentSha(
  store: EdgeRefsBlobStore,
  contentSha256: string,
): EdgeRefsBlobLookup | undefined {
  const entry = store.bySha.get(contentSha256)
  if (!entry) return undefined
  return {
    contentSha256: entry.contentSha256,
    locator: entry.locator,
    captureStatus: entry.captureStatus,
    ...(entry.bytes ? { bytes: entry.bytes } : {}),
    ...(entry.byteLength != null ? { byteLength: entry.byteLength } : {}),
    ...(entry.contentType != null ? { contentType: entry.contentType } : {}),
    snapshotIds: [...entry.snapshotIds],
    edgeIds: [...entry.edgeIds],
    claimIds: [...entry.claimIds],
  }
}

/**
 * Reverse lookup by normalized locator → contentSha256 entry (same store).
 */
export function lookupBlobByLocator(
  store: EdgeRefsBlobStore,
  locator: string,
): EdgeRefsBlobLookup | undefined {
  const sha = store.shaByLocator.get(normalizeUrl(locator))
  if (!sha) return undefined
  return lookupBlobByContentSha(store, sha)
}

/**
 * Batch map static ConversionEdge.refs → provisional knowledge records.
 * Fixture/captured bytes only here — **no network**. For live HTTP reduction of
 * locator-only debt use `edgeRefsLiveNetworkCrawlBulk`. Remaining locator-only
 * debt stays explicit in statement counts for operators.
 *
 * Also builds a reverse blob index (`blobStore`) so any snapshot from this
 * crawl can be resolved contentSha256 → locator (+ bytes when payload-supplied).
 */
export async function edgeRefsToProvisionalBindingsBulk(
  edges: readonly EdgeRefsBulkItem[],
  options?: EdgeRefsMigrationOptions,
): Promise<EdgeRefsBulkResult> {
  const results: EdgeRefsMigrationResult[] = []
  let totalBytesCaptured = 0
  let totalLocatorOnly = 0

  for (const edge of edges) {
    const r = await edgeRefsToProvisionalBindings(edge.id, edge.refs, options)
    results.push(r)
    const bc = Number(r.claim.statement.bytesCapturedCount ?? 0)
    const lo = Number(r.claim.statement.locatorOnlyCount ?? 0)
    totalBytesCaptured += Number.isFinite(bc) ? bc : 0
    totalLocatorOnly += Number.isFinite(lo) ? lo : 0
  }

  const blobStore = buildEdgeRefsBlobStore(results, options)

  return {
    results,
    totalBytesCaptured,
    totalLocatorOnly,
    edgeCount: edges.length,
    blobStore,
  }
}
