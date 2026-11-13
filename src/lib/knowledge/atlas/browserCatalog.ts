/**
 * #48-H Browser-safe catalog: fetch static release index + release.json.
 *
 * Layout (served as static files or CDN):
 *   <base>/index.json
 *   <base>/<id>/release.json
 *
 * Never talks to ingest/candidate working sets.
 */

import type { KnowledgeRelease } from '../types'
import { verifyKnowledgeRelease } from '../release'
import {
  exportMatrixGraphConflictSurface,
  indexClaimsBySubject,
  listSubjectConflictBadges,
  subjectClaimsPanelModel,
  type ClaimsBySubjectIndex,
  type MatrixGraphConflictSurface,
  type SubjectClaimsPanelModel,
  type SubjectConflictBadge,
} from './claimsBySubject'
import { releaseMeta, type ReleaseMeta } from './releaseMeta'

export const DEFAULT_BROWSER_RELEASES_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { VITE_KNOWLEDGE_RELEASES_URL?: string } }).env
      ?.VITE_KNOWLEDGE_RELEASES_URL) ||
  '/knowledge-releases'

export type BrowserIndex = {
  schema?: string
  generatedAt?: string
  ids: string[]
  /** True when this catalog is a demo/sample bag, not production truth (#70 / #81). */
  sample?: boolean
  demo?: boolean
  label?: string
}

export function browserCatalogIsSample(index: BrowserIndex | null | undefined): boolean {
  if (!index) return true
  if (index.sample === true || index.demo === true) return true
  if (index.label === 'sample-not-production-truth') return true
  return index.ids.length === 1 && index.ids[0] === 'kr-sample-48o'
}

export class BrowserCatalogError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'BrowserCatalogError'
    this.code = code
  }
}

function joinUrl(base: string, ...parts: string[]): string {
  const b = base.replace(/\/+$/, '')
  const rest = parts.map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean)
  return [b, ...rest].join('/')
}

export async function fetchReleaseIndex(
  baseUrl: string = DEFAULT_BROWSER_RELEASES_BASE,
  fetchImpl: typeof fetch = fetch,
): Promise<BrowserIndex> {
  const url = joinUrl(baseUrl, 'index.json')
  let res: Response
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new BrowserCatalogError('network', `index fetch failed: ${msg}`)
  }
  if (res.status === 404) {
    return { ids: [] }
  }
  if (!res.ok) {
    throw new BrowserCatalogError('http', `index HTTP ${res.status}`)
  }
  let parsed: unknown
  try {
    parsed = await res.json()
  } catch {
    throw new BrowserCatalogError('invalid_json', 'index.json is not JSON')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new BrowserCatalogError('invalid_shape', 'index root not object')
  }
  const ids = (parsed as { ids?: unknown }).ids
  if (!Array.isArray(ids)) {
    throw new BrowserCatalogError('invalid_shape', 'index.ids missing')
  }
  const rec = parsed as {
    schema?: unknown
    generatedAt?: unknown
    sample?: unknown
    demo?: unknown
    label?: unknown
  }
  return {
    schema: typeof rec.schema === 'string' ? rec.schema : undefined,
    generatedAt: typeof rec.generatedAt === 'string' ? rec.generatedAt : undefined,
    sample: rec.sample === true ? true : undefined,
    demo: rec.demo === true ? true : undefined,
    label: typeof rec.label === 'string' ? rec.label : undefined,
    ids: ids.filter((x): x is string => typeof x === 'string'),
  }
}

export async function fetchReleased(
  id: string,
  baseUrl: string = DEFAULT_BROWSER_RELEASES_BASE,
  opts?: { verify?: boolean; fetchImpl?: typeof fetch },
): Promise<KnowledgeRelease> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
    throw new BrowserCatalogError('bad_id', `unsafe id: ${id}`)
  }
  const fetchImpl = opts?.fetchImpl ?? fetch
  const url = joinUrl(baseUrl, id, 'release.json')
  let res: Response
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new BrowserCatalogError('network', `release fetch failed: ${msg}`)
  }
  if (!res.ok) {
    throw new BrowserCatalogError('http', `release HTTP ${res.status}`)
  }
  let release: KnowledgeRelease
  try {
    release = (await res.json()) as KnowledgeRelease
  } catch {
    throw new BrowserCatalogError('invalid_json', 'release.json is not JSON')
  }
  if (!release || release.id !== id) {
    throw new BrowserCatalogError('id_mismatch', 'release.id mismatch')
  }
  if (opts?.verify !== false) {
    const err = await verifyKnowledgeRelease(release)
    if (err) throw new BrowserCatalogError('verify_failed', err)
  }
  return release
}

/**
 * Latest release from index (last entry), or null if empty.
 * Sample/demo bags are not production truth (#91): return null unless allowSample.
 */
export async function fetchLatestReleased(
  baseUrl: string = DEFAULT_BROWSER_RELEASES_BASE,
  fetchImpl: typeof fetch = fetch,
  opts?: { allowSample?: boolean },
): Promise<KnowledgeRelease | null> {
  const index = await fetchReleaseIndex(baseUrl, fetchImpl)
  if (index.ids.length === 0) return null
  if (browserCatalogIsSample(index) && !opts?.allowSample) return null
  const id = index.ids[index.ids.length - 1]!
  return fetchReleased(id, baseUrl, { fetchImpl })
}

/** Fail if a non-sample catalog id disagrees with the knowledge-db latest release. */
export function catalogDivergesFromDbWithoutSample(
  index: BrowserIndex,
  dbLatestId: string | null | undefined,
): boolean {
  if (browserCatalogIsSample(index)) return false
  const last = index.ids[index.ids.length - 1]
  if (!last || !dbLatestId) return false
  return last !== dbLatestId
}

export async function fetchLatestReleasedMeta(
  baseUrl: string = DEFAULT_BROWSER_RELEASES_BASE,
  fetchImpl: typeof fetch = fetch,
): Promise<ReleaseMeta | null> {
  const release = await fetchLatestReleased(baseUrl, fetchImpl)
  return release ? releaseMeta(release) : null
}

/**
 * Publish → UI wire: latest released bag as subject-indexed claims
 * (includes per-claim ConflictSet visibility for Controversies/Matrix).
 * `null` when catalog empty.
 */
export async function fetchLatestClaimsIndex(
  baseUrl: string = DEFAULT_BROWSER_RELEASES_BASE,
  fetchImpl: typeof fetch = fetch,
): Promise<ClaimsBySubjectIndex | null> {
  const release = await fetchLatestReleased(baseUrl, fetchImpl)
  if (!release) return null
  return indexClaimsBySubject(release)
}

/**
 * Publish → UI wire: Matrix/Graph/Controversies ConflictSet surface for latest release.
 * Multi-member claimIds stay multi-member; `null` when catalog empty.
 */
export async function fetchLatestConflictSurface(
  baseUrl: string = DEFAULT_BROWSER_RELEASES_BASE,
  fetchImpl: typeof fetch = fetch,
): Promise<MatrixGraphConflictSurface | null> {
  const release = await fetchLatestReleased(baseUrl, fetchImpl)
  if (!release) return null
  return exportMatrixGraphConflictSurface(release)
}

/**
 * Publish → UI wire: Controversies/Matrix hub list of subject conflict badges.
 * Latest release → `listSubjectConflictBadges` (stable subjectId order; omits quiet
 * subjects; multi-member contestedClaimIds — no silent merge).
 * Empty array when catalog empty or no open ConflictSets (not null).
 */
export async function fetchLatestSubjectConflictBadges(
  baseUrl: string = DEFAULT_BROWSER_RELEASES_BASE,
  fetchImpl: typeof fetch = fetch,
): Promise<SubjectConflictBadge[]> {
  const release = await fetchLatestReleased(baseUrl, fetchImpl)
  if (!release) return []
  return listSubjectConflictBadges(indexClaimsBySubject(release))
}

/**
 * Publish → UI wire: one-shot ReleasedClaimsPanel model for a subject.
 * Latest release → `subjectClaimsPanelModel` (views + optional subject conflict badge).
 * `null` when catalog empty or subject has no released claims (panel silent).
 */
export async function fetchLatestSubjectClaimsPanel(
  subjectId: string,
  baseUrl: string = DEFAULT_BROWSER_RELEASES_BASE,
  fetchImpl: typeof fetch = fetch,
): Promise<SubjectClaimsPanelModel | null> {
  const release = await fetchLatestReleased(baseUrl, fetchImpl)
  if (!release) return null
  return subjectClaimsPanelModel(indexClaimsBySubject(release), subjectId)
}
