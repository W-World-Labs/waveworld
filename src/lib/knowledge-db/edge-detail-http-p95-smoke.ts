/**
 * K14: live Host `GET /api/v1/knowledge/edges/:id` HTTP p95 smoke (EPIC #52).
 *
 * Measures end-to-end Host HTTP latency (edge detail with released claims by
 * default) against a documented budget. Reports p50/p95/max and pass/fail.
 *
 * Budget: docs/knowledge-db.md §7.3 — live Host HTTP p95 &lt; 200ms (loopback
 * or same-origin Host). Override via EDGE_DETAIL_HTTP_P95_BUDGET_MS or options.
 */
import { percentileNearestRank } from './edge-detail-p95-smoke.ts'
import type {
  KnowledgeEdgeDto,
  KnowledgeEdgeProductDto,
  ReleasedClaimDto,
} from './read.ts'

/** Checklist target for live Host edge-detail HTTP reads (ms). */
export const EDGE_DETAIL_HTTP_P95_BUDGET_MS = 200

/** Query key used by the public edge cache for a release cachebuster. */
export const KNOWLEDGE_HTTP_P95_CACHEBUSTER_PARAM = 'ww_accept'

const CACHEBUSTER_RE = /^[0-9a-f]{64}$/
const EDGE_ID_RE = /^[^\u0000-\u001f\u007f/\\]+$/

/** Default Host base when probing production on this machine. */
export const DEFAULT_KNOWLEDGE_HTTP_P95_BASE = 'http://127.0.0.1:3001'

export type EdgeDetailHttpP95Options = {
  /** Host origin (no trailing slash). Default env WAVEWORLD_HOST_BASE or loopback. */
  baseUrl?: string
  /** Unique edge ids to cycle (default: first page of GET /edges). */
  edgeIds?: string[]
  /** Timed samples after warmup (default 40 — keep live probe light). */
  iterations?: number
  /** Untimed warm-up calls (default 5). */
  warmup?: number
  /** Max edges to sample from list when edgeIds omitted (default 20). */
  sampleEdgeCount?: number
  /** Pass when p95 &lt; budget (default EDGE_DETAIL_HTTP_P95_BUDGET_MS). */
  budgetMs?: number
  /** Embed released claims (Host default = true; use false → ?embed=0). */
  embedReleasedClaims?: boolean
  /** Explicit release cachebuster (64 lowercase hexadecimal characters). */
  cachebuster?: string
  /** fetch implementation (tests inject mock). */
  fetchImpl?: typeof fetch
  /** Per-request timeout ms (default 10_000). */
  timeoutMs?: number
}

export type EdgeDetailHttpP95Report = {
  baseUrl: string
  edgeIds: string[]
  edgeIdSummary: {
    count: number
    first: string
    last: string
  }
  edgeCount: number
  iterations: number
  warmup: number
  sampleCount: number
  samplesMs: number[]
  minMs: number
  maxMs: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  budgetMs: number
  /** true when p95Ms &lt; budgetMs */
  pass: boolean
  /** Explicit embed flag included for deployment evidence validation. */
  embed: boolean
  embedReleasedClaims: boolean
  /** The validated release cachebuster sent on every list/detail request. */
  cachebuster: string
  /** HTTP status of the last successful timed sample (usually 200). */
  lastStatus: number
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function validateCachebuster(cachebuster: string | undefined): string {
  if (typeof cachebuster !== 'string' || !CACHEBUSTER_RE.test(cachebuster)) {
    throw new Error(
      'edge-detail-http-p95-smoke: cachebuster is required and must be exactly 64 lowercase hexadecimal characters',
    )
  }
  return cachebuster
}

function isSafeEdgeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    EDGE_ID_RE.test(value)
  )
}

function validateExplicitEdgeIds(edgeIds: readonly string[]): string[] {
  if (edgeIds.length !== 20) {
    throw new Error(
      `edge-detail-http-p95-smoke: explicit edge ids must contain exactly 20 ids, got ${edgeIds.length}`,
    )
  }
  const invalid = edgeIds.findIndex((id) => !isSafeEdgeId(id))
  if (invalid >= 0) {
    throw new Error(
      `edge-detail-http-p95-smoke: unsafe or empty explicit edge id at index ${invalid}`,
    )
  }
  const unique = new Set(edgeIds)
  if (unique.size !== edgeIds.length) {
    throw new Error(
      'edge-detail-http-p95-smoke: explicit edge ids must be unique',
    )
  }
  return [...edgeIds]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isReleasedClaim(value: unknown): value is ReleasedClaimDto {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.subjectId === 'string' &&
    isRecord(value.statement) &&
    value.state === 'released' &&
    (value.confidence === null ||
      (typeof value.confidence === 'number' &&
        Number.isFinite(value.confidence))) &&
    typeof value.createdAt === 'string' &&
    isNullableString(value.updatedAt) &&
    (typeof value.contractVersion === 'number' &&
      Number.isInteger(value.contractVersion))
  )
}

function isKnowledgeEdgeProduct(
  value: unknown,
): value is KnowledgeEdgeProductDto {
  if (!isRecord(value)) return false
  return (
    isNullableString(value.vendor) &&
    isNullableString(value.vendorEn) &&
    typeof value.model === 'string' &&
    isNullableString(value.modelEn) &&
    isNullableString(value.spec) &&
    isNullableString(value.specEn)
  )
}

/**
 * Runtime contract for the Host `KnowledgeEdgeDto` response. The detail API
 * defaults to released-claim embedding; when embed=true, that field is
 * required and each claim is checked against the public DTO shape.
 */
function isKnowledgeEdgeItem(
  value: unknown,
  expectedId: string,
  embed: boolean,
): value is KnowledgeEdgeDto {
  if (!isRecord(value) || value.id !== expectedId) return false

  const requiredStrings = [
    'id',
    'fromNodeId',
    'toNodeId',
    'name',
    'principle',
    'efficiencyKind',
    'status',
  ]
  if (
    requiredStrings.some(
      (key) => typeof value[key] !== 'string' || !hasOwn(value, key),
    )
  ) {
    return false
  }

  const nullableStrings = ['nameEn', 'principleEn', 'maturity']
  if (nullableStrings.some((key) => !hasOwn(value, key) || !isNullableString(value[key]))) {
    return false
  }

  const requiredOpaqueFields = [
    'efficiency',
    'formula',
    'lossMechanisms',
    'apps',
    'consensus',
    'refs',
  ]
  if (requiredOpaqueFields.some((key) => !hasOwn(value, key))) return false
  if (
    !Array.isArray(value.devices) ||
    !value.devices.every((device) => typeof device === 'string') ||
    !Array.isArray(value.products) ||
    !value.products.every((product) => isKnowledgeEdgeProduct(product))
  ) {
    return false
  }

  if (!hasOwn(value, 'releasedClaims')) return !embed
  return (
    Array.isArray(value.releasedClaims) &&
    value.releasedClaims.every((claim) => isReleasedClaim(claim)) &&
    (!embed || Array.isArray(value.releasedClaims))
  )
}

function edgeIdSummary(edgeIds: readonly string[]): {
  count: number
  first: string
  last: string
} {
  return {
    count: edgeIds.length,
    first: edgeIds[0]!,
    last: edgeIds[edgeIds.length - 1]!,
  }
}

export function resolveKnowledgeHttpP95Base(
  explicit?: string | null,
): string {
  const fromArg = explicit?.trim()
  if (fromArg) return trimSlash(fromArg)
  const fromEnv =
    process.env.WAVEWORLD_HOST_BASE?.trim() ||
    process.env.KNOWLEDGE_HTTP_P95_BASE?.trim()
  if (fromEnv) return trimSlash(fromEnv)
  return DEFAULT_KNOWLEDGE_HTTP_P95_BASE
}

export function resolveHttpP95BudgetMs(explicit?: number): number {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) {
    return explicit
  }
  const env = process.env.EDGE_DETAIL_HTTP_P95_BUDGET_MS?.trim()
  if (env) {
    const n = Number(env)
    if (Number.isFinite(n) && n > 0) return n
  }
  return EDGE_DETAIL_HTTP_P95_BUDGET_MS
}

function edgeDetailUrl(
  baseUrl: string,
  edgeId: string,
  embed: boolean,
  cachebuster?: string,
): string {
  const path = `${trimSlash(baseUrl)}/api/v1/knowledge/edges/${encodeURIComponent(edgeId)}`
  const params = new URLSearchParams()
  params.set('embed', embed ? 'true' : '0')
  if (cachebuster !== undefined) {
    params.set(KNOWLEDGE_HTTP_P95_CACHEBUSTER_PARAM, cachebuster)
  }
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

function edgesListUrl(
  baseUrl: string,
  limit: number,
  cachebuster?: string,
): string {
  const params = new URLSearchParams({
    limit: String(limit),
    status: 'active',
  })
  if (cachebuster !== undefined) {
    params.set(KNOWLEDGE_HTTP_P95_CACHEBUSTER_PARAM, cachebuster)
  }
  return `${trimSlash(baseUrl)}/api/v1/knowledge/edges?${params.toString()}`
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ac.signal,
    })
    const text = await res.text()
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    return { status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

function isEdgeListBody(
  body: unknown,
): body is { items: unknown[] } {
  if (!isRecord(body)) return false
  const items = (body as { items?: unknown }).items
  return Array.isArray(items)
}

/**
 * Resolve edge ids for HTTP smoke: explicit list, or first page of active edges.
 */
export async function resolveHttpSmokeEdgeIds(
  options: Pick<
    EdgeDetailHttpP95Options,
    | 'baseUrl'
    | 'edgeIds'
    | 'sampleEdgeCount'
    | 'cachebuster'
    | 'fetchImpl'
    | 'timeoutMs'
  > = {},
): Promise<string[]> {
  const cachebuster = validateCachebuster(options.cachebuster)
  if (options.edgeIds !== undefined) {
    return validateExplicitEdgeIds(options.edgeIds)
  }
  const baseUrl = resolveKnowledgeHttpP95Base(options.baseUrl)
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 10_000
  const requestedLimit = options.sampleEdgeCount ?? 20
  if (requestedLimit !== 20) {
    throw new Error(
      'edge-detail-http-p95-smoke: sampleEdgeCount must be exactly 20',
    )
  }
  const limit = 20
  const { status, body } = await fetchJson(
    edgesListUrl(baseUrl, limit, cachebuster),
    fetchImpl,
    timeoutMs,
  )
  if (status !== 200) {
    const snippet =
      typeof body === 'string'
        ? body.slice(0, 180)
        : JSON.stringify(body).slice(0, 180)
    throw new Error(
      `edge-detail-http-p95-smoke: list edges HTTP ${status} base=${baseUrl} body=${snippet}`,
    )
  }
  if (!isEdgeListBody(body)) {
    throw new Error(
      `edge-detail-http-p95-smoke: list edges unexpected JSON base=${baseUrl}`,
    )
  }
  if (body.items.length !== 20) {
    throw new Error(
      `edge-detail-http-p95-smoke: list edges must contain exactly 20 items, got ${body.items.length}`,
    )
  }
  const ids = body.items.map((item, index) => {
    const id = isRecord(item) ? item.id : undefined
    if (!isSafeEdgeId(id)) {
      throw new Error(
        `edge-detail-http-p95-smoke: list edges contains unsafe or empty id at index ${index}`,
      )
    }
    return id
  })
  if (new Set(ids).size !== ids.length) {
    throw new Error(
      'edge-detail-http-p95-smoke: list edges must contain 20 unique ids',
    )
  }
  if (ids.length !== 20) {
    throw new Error(
      `edge-detail-http-p95-smoke: list edges must contain exactly 20 ids, got ${ids.length}`,
    )
  }
  return ids
}

/**
 * Run timed Host `GET /api/v1/knowledge/edges/:id` samples.
 * Does not throw on budget miss — set `pass` false so callers can assert
 * with measured numbers in the failure message.
 */
export async function measureEdgeDetailHttpP95(
  options: EdgeDetailHttpP95Options = {},
): Promise<EdgeDetailHttpP95Report> {
  const baseUrl = resolveKnowledgeHttpP95Base(options.baseUrl)
  const fetchImpl = options.fetchImpl ?? fetch
  const embed = options.embedReleasedClaims !== false
  const cachebuster = validateCachebuster(options.cachebuster)
  const iterations = Math.max(1, options.iterations ?? 40)
  const warmup = Math.max(0, options.warmup ?? 5)
  const budgetMs = resolveHttpP95BudgetMs(options.budgetMs)
  const timeoutMs = options.timeoutMs ?? 10_000
  const edgeIds = await resolveHttpSmokeEdgeIds({
    baseUrl,
    edgeIds: options.edgeIds,
    sampleEdgeCount: options.sampleEdgeCount,
    cachebuster,
    fetchImpl,
    timeoutMs,
  })

  const callOnce = async (
    edgeId: string,
    timed: boolean,
  ): Promise<{ status: number; ms: number }> => {
    const t0 = timed ? performance.now() : 0
    const url = edgeDetailUrl(baseUrl, edgeId, embed, cachebuster)
    const { status, body } = await fetchJson(url, fetchImpl, timeoutMs)
    if (status !== 200) {
      const snippet =
        typeof body === 'string'
          ? body.slice(0, 180)
          : JSON.stringify(body).slice(0, 180)
      throw new Error(
        `edge-detail-http-p95-smoke: edge HTTP ${status} id=${edgeId} base=${baseUrl} body=${snippet}`,
      )
    }
    const item = isRecord(body) ? body.item : undefined
    if (!isKnowledgeEdgeItem(item, edgeId, embed)) {
      throw new Error(
        `edge-detail-http-p95-smoke: edge item shape/id/embed invalid id=${edgeId} base=${baseUrl}`,
      )
    }
    // Stop the timed sample only after the body was read, parsed, and its item
    // shape was validated. This is the end-to-end latency seen by the caller.
    return { status, ms: timed ? performance.now() - t0 : 0 }
  }

  for (let i = 0; i < warmup; i++) {
    await callOnce(edgeIds[i % edgeIds.length]!, false)
  }

  const samplesMs: number[] = []
  let lastStatus = 200
  for (let i = 0; i < iterations; i++) {
    const edgeId = edgeIds[i % edgeIds.length]!
    const { status, ms } = await callOnce(edgeId, true)
    lastStatus = status
    samplesMs.push(ms)
  }

  const sorted = [...samplesMs].sort((a, b) => a - b)
  const p50Ms = percentileNearestRank(sorted, 50)
  const p95Ms = percentileNearestRank(sorted, 95)
  const minMs = sorted[0]!
  const maxMs = sorted[sorted.length - 1]!
  const meanMs = mean(samplesMs)
  const pass = p95Ms < budgetMs

  return {
    baseUrl,
    edgeIds,
    iterations,
    warmup,
    samplesMs,
    minMs,
    maxMs,
    meanMs,
    p50Ms,
    p95Ms,
    budgetMs,
    pass,
    edgeIdSummary: edgeIdSummary(edgeIds),
    edgeCount: edgeIds.length,
    sampleCount: samplesMs.length,
    embed,
    embedReleasedClaims: embed,
    cachebuster,
    lastStatus,
  }
}

/** One-line summary for test failures / CI logs. */
export function formatEdgeDetailHttpP95Report(
  report: EdgeDetailHttpP95Report,
): string {
  const fmt = (n: number) => n.toFixed(3)
  return (
    `edge-detail HTTP p95 smoke: pass=${report.pass} ` +
    `p50=${fmt(report.p50Ms)}ms p95=${fmt(report.p95Ms)}ms ` +
    `max=${fmt(report.maxMs)}ms mean=${fmt(report.meanMs)}ms ` +
    `budget=${report.budgetMs}ms n=${report.iterations} ` +
    `sampleCount=${report.sampleCount} edges=${report.edgeCount} ` +
    `embed=${report.embed} cachebuster=${report.cachebuster} ` +
    `status=${report.lastStatus} base=${report.baseUrl}`
  )
}
