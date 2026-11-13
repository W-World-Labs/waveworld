/**
 * #48-R Offline "live-like" knowledge pipeline.
 *
 * Chains the same stages a production ingest→release path would use, but with
 * injected OpenAlex/Crossref work fixtures (or bytes already shaped like API
 * results) and fixed ISO clocks — no live HTTP, no wall clock.
 *
 *   fixture works → SourceSnapshot (ingest helpers)
 *     → extractClaimsFromOpenAlexWork (or bibliographic fallback claims)
 *     → applyCheckClaims (via runOfflinePublishPipeline; C3)
 *     → publishKnowledgeRelease
 *     → optional writeKnowledgeRelease + fixed index.json
 *
 * Production timer / Caddy mount remain operator-owned (see knowledge-pipeline.md).
 */

import { extractClaimsFromOpenAlexWork } from './extract/openalexClaims'
import { mergeSnapshotsByDoi, type DualMergeResult } from './ingest/dualSource'
import { sourceSnapshotFromCrossrefWork } from './ingest/crossref'
import { sourceSnapshotFromOpenAlexWork } from './ingest/openalex'
import {
  OfflinePipelineError,
  runOfflinePublishPipeline,
  type OfflinePipelineResult,
} from './offlinePipeline'
import { writeKnowledgeRelease, writeReleaseIndex } from './store/releaseStore'
import {
  KNOWLEDGE_CONTRACT_VERSION,
  type Claim,
  type EvidenceBinding,
  type SourceSnapshot,
} from './types'
import { validateClaim, validateEvidenceBinding } from './validate'

/** Stable demo release id (safe for on-disk store path). */
export const LIVE_LIKE_RELEASE_ID = 'kr-live-like-48r'

export const LIVE_LIKE_CAPTURED_AT = '2026-08-04T12:00:00.000Z'
export const LIVE_LIKE_GATED_AT = '2026-08-04T15:00:00.000Z'
export const LIVE_LIKE_RELEASED_AT = '2026-08-04T18:00:00.000Z'

/**
 * OpenAlex work fixture with concepts + OA + abstract efficiency hits so
 * extract → gate exercises mechanism/OA pass and efficiency quarantine.
 * DOI matches {@link LIVE_LIKE_DEMO_CROSSREF_ITEM} for dual-source merge.
 */
export const LIVE_LIKE_DEMO_OPENALEX_WORK: Record<string, unknown> = {
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
  concepts: [
    {
      id: 'https://openalex.org/C123',
      display_name: 'Photovoltaics',
      score: 0.91,
      level: 1,
    },
    {
      id: 'https://openalex.org/C456',
      display_name: 'Energy conversion',
      score: 0.72,
      level: 1,
    },
  ],
  abstract_inverted_index: {
    The: [0],
    cell: [1],
    achieves: [2],
    '22%': [3],
    efficiency: [4],
    and: [5],
    COP: [6],
    '3.5': [7],
    under: [8],
    test: [9],
  },
}

/** Crossref work item sharing DOI with the OpenAlex demo work (dual-source). */
export const LIVE_LIKE_DEMO_CROSSREF_ITEM: Record<string, unknown> = {
  DOI: '10.7717/peerj.4375',
  title: ['The state of OA: a large-scale analysis'],
  type: 'journal-article',
  URL: 'https://doi.org/10.7717/peerj.4375',
  license: [{ URL: 'https://creativecommons.org/licenses/by/4.0/' }],
  publisher: 'PeerJ',
}

export type LiveLikeFixture = {
  /** OpenAlex work objects (API result items). */
  openAlexWorks?: Record<string, unknown>[]
  /** Crossref message.items-style objects. */
  crossrefItems?: Record<string, unknown>[]
  /**
   * When extract yields no claims, or always when provided, merge these into
   * the working set (e.g. hand-built efficiency candidates for gate tests).
   */
  extraClaims?: Claim[]
  extraBindings?: EvidenceBinding[]
  /**
   * When true (default), if OpenAlex extract is empty, emit bibliographic
   * `other` claims from fixture works/items so the chain still publishes.
   */
  fallbackBibliographicClaims?: boolean
}

export type LiveLikePipelineInput = {
  releaseId: string
  releasedAt: string
  /** Fixed capture time for SourceSnapshot.capturedAt / claim.createdAt. */
  capturedAt: string
  /** Fixed time for unified checkClaim gate Claim.updatedAt. */
  gateAt: string
  fixture: LiveLikeFixture
  verify?: boolean
}

export type LiveLikePipelineResult = OfflinePipelineResult & {
  openAlexSnapshots: SourceSnapshot[]
  crossrefSnapshots: SourceSnapshot[]
  /** After DOI merge (OpenAlex preferred when listed first). */
  mergedSnapshots: SourceSnapshot[]
  merge: DualMergeResult
  extractedClaimCount: number
  fallbackClaimCount: number
  /** How claims were obtained: extract, fallback, extra, or mix. */
  claimSource: 'extract' | 'fallback' | 'extra' | 'mixed'
}

export class LiveLikePipelineError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'LiveLikePipelineError'
    this.code = code
  }
}

function requireIso(field: string, value: string): void {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new LiveLikePipelineError(
      'missing_clock',
      `${field} ISO timestamp is required for deterministic live-like runs`,
    )
  }
}

function openAlexWorkId(work: Record<string, unknown>): string {
  const idRaw = typeof work.id === 'string' ? work.id : ''
  if (!idRaw) return 'unknown'
  return idRaw.replace(/^https?:\/\/openalex\.org\//i, '')
}

/**
 * Bibliographic fallback claims when extract has nothing useful.
 * Always `candidate` + `other` so checkClaim statement layer accepts them.
 */
export function buildBibliographicClaimsFromFixtures(
  openAlexWorks: Record<string, unknown>[],
  openAlexSnapshots: SourceSnapshot[],
  crossrefItems: Record<string, unknown>[],
  crossrefSnapshots: SourceSnapshot[],
  createdAt: string,
): { claims: Claim[]; evidenceBindings: EvidenceBinding[] } {
  const claims: Claim[] = []
  const evidenceBindings: EvidenceBinding[] = []

  for (let i = 0; i < openAlexWorks.length; i++) {
    const work = openAlexWorks[i]!
    const snap = openAlexSnapshots[i]
    if (!snap) continue
    const workId = openAlexWorkId(work)
    const claimId = `cl-fallback-openalex-${workId}`
    const c: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: claimId,
      kind: 'other',
      subjectId: `openalex:${workId}`,
      statement: {
        source: 'live-like.fallback',
        workTitle: typeof work.title === 'string' ? work.title : undefined,
        doi: typeof work.doi === 'string' ? work.doi : undefined,
      },
      state: 'candidate',
      confidence: 0.7,
      createdAt,
    }
    const err = validateClaim(c)
    if (err) throw new LiveLikePipelineError('invalid_fallback_claim', err)
    claims.push(c)
    const b: EvidenceBinding = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: `eb-${claimId}`,
      claimId,
      sourceSnapshotId: snap.id,
      support: 'supports',
      locator: { path: 'title' },
      note: 'offline live-like bibliographic fallback',
    }
    const bErr = validateEvidenceBinding(b)
    if (bErr) throw new LiveLikePipelineError('invalid_fallback_binding', bErr)
    evidenceBindings.push(b)
  }

  for (let i = 0; i < crossrefItems.length; i++) {
    const item = crossrefItems[i]!
    const snap = crossrefSnapshots[i]
    if (!snap) continue
    const doi =
      typeof item.DOI === 'string'
        ? item.DOI.toLowerCase()
        : typeof item.doi === 'string'
          ? String(item.doi).toLowerCase()
          : `item-${i}`
    const safe = doi.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const claimId = `cl-fallback-crossref-${safe}`
    // Skip if we already have an OpenAlex claim for the same DOI subject via extract/fallback
    if (claims.some((c) => c.id === claimId)) continue
    const titleArr = Array.isArray(item.title) ? item.title : []
    const title =
      typeof titleArr[0] === 'string'
        ? titleArr[0]
        : typeof item.title === 'string'
          ? item.title
          : undefined
    const c: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: claimId,
      kind: 'other',
      subjectId: `crossref:${safe}`,
      statement: {
        source: 'live-like.fallback',
        workTitle: title,
        doi: typeof item.DOI === 'string' ? item.DOI : undefined,
      },
      state: 'candidate',
      confidence: 0.7,
      createdAt,
    }
    const err = validateClaim(c)
    if (err) throw new LiveLikePipelineError('invalid_fallback_claim', err)
    claims.push(c)
    const b: EvidenceBinding = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: `eb-${claimId}`,
      claimId,
      sourceSnapshotId: snap.id,
      support: 'supports',
      locator: { path: 'title' },
      note: 'offline live-like bibliographic fallback (crossref)',
    }
    const bErr = validateEvidenceBinding(b)
    if (bErr) throw new LiveLikePipelineError('invalid_fallback_binding', bErr)
    evidenceBindings.push(b)
  }

  return { claims, evidenceBindings }
}

/**
 * Build SourceSnapshots + claims from fixtures (ingest + extract path), then
 * gate → publish in memory. No network / filesystem.
 */
export async function runOfflineLiveLikePipeline(
  input: LiveLikePipelineInput,
): Promise<LiveLikePipelineResult> {
  requireIso('capturedAt', input.capturedAt)
  requireIso('gateAt', input.gateAt)
  requireIso('releasedAt', input.releasedAt)
  if (!input.releaseId?.trim()) {
    throw new LiveLikePipelineError('missing_release_id', 'releaseId is required')
  }

  const openAlexWorks = input.fixture.openAlexWorks ?? []
  const crossrefItems = input.fixture.crossrefItems ?? []
  const useFallback = input.fixture.fallbackBibliographicClaims !== false

  if (
    openAlexWorks.length === 0 &&
    crossrefItems.length === 0 &&
    !(input.fixture.extraClaims?.length)
  ) {
    throw new LiveLikePipelineError(
      'empty_fixture',
      'fixture must include openAlexWorks, crossrefItems, and/or extraClaims',
    )
  }

  const openAlexSnapshots: SourceSnapshot[] = []
  for (const work of openAlexWorks) {
    openAlexSnapshots.push(
      await sourceSnapshotFromOpenAlexWork(work, {
        capturedAt: input.capturedAt,
        pageCursor: '*',
      }),
    )
  }

  const crossrefSnapshots: SourceSnapshot[] = []
  for (const item of crossrefItems) {
    crossrefSnapshots.push(
      await sourceSnapshotFromCrossrefWork(item, {
        capturedAt: input.capturedAt,
        pageCursor: '*',
      }),
    )
  }

  // OpenAlex first: DOI merge keeps OpenAlex snap; extract bindings stay valid.
  const merge = mergeSnapshotsByDoi(openAlexSnapshots, crossrefSnapshots)

  const claims: Claim[] = []
  const evidenceBindings: EvidenceBinding[] = []
  let extractedClaimCount = 0
  let fallbackClaimCount = 0

  for (let i = 0; i < openAlexWorks.length; i++) {
    const work = openAlexWorks[i]!
    const snap = openAlexSnapshots[i]!
    const extracted = extractClaimsFromOpenAlexWork(work, snap, {
      createdAt: input.capturedAt,
    })
    claims.push(...extracted.claims)
    evidenceBindings.push(...extracted.evidenceBindings)
    extractedClaimCount += extracted.claims.length
  }

  if (extractedClaimCount === 0 && useFallback) {
    const fb = buildBibliographicClaimsFromFixtures(
      openAlexWorks,
      openAlexSnapshots,
      crossrefItems,
      crossrefSnapshots,
      input.capturedAt,
    )
    claims.push(...fb.claims)
    evidenceBindings.push(...fb.evidenceBindings)
    fallbackClaimCount = fb.claims.length
  }

  if (input.fixture.extraClaims?.length) {
    claims.push(...input.fixture.extraClaims)
    if (input.fixture.extraBindings?.length) {
      evidenceBindings.push(...input.fixture.extraBindings)
    }
  }

  if (claims.length === 0) {
    throw new LiveLikePipelineError(
      'no_claims',
      'no claims from extract, fallback, or extraClaims',
    )
  }

  let claimSource: LiveLikePipelineResult['claimSource']
  const hasExtract = extractedClaimCount > 0
  const hasFallback = fallbackClaimCount > 0
  const hasExtra = Boolean(input.fixture.extraClaims?.length)
  const sources = [hasExtract, hasFallback, hasExtra].filter(Boolean).length
  if (sources > 1) claimSource = 'mixed'
  else if (hasExtract) claimSource = 'extract'
  else if (hasFallback) claimSource = 'fallback'
  else claimSource = 'extra'

  let pipeline: OfflinePipelineResult
  try {
    pipeline = await runOfflinePublishPipeline({
      releaseId: input.releaseId,
      releasedAt: input.releasedAt,
      gateAt: input.gateAt,
      verify: input.verify,
      fixture: {
        claims,
        evidenceBindings,
        // Prefer merged list so dual-source de-dupe is reflected; extract still
        // binds OpenAlex ids which remain in the merge when OA is first.
        sourceSnapshots: merge.merged,
      },
    })
  } catch (e) {
    if (e instanceof OfflinePipelineError) {
      throw new LiveLikePipelineError(e.code, e.message)
    }
    throw e
  }

  return {
    ...pipeline,
    openAlexSnapshots,
    crossrefSnapshots,
    mergedSnapshots: merge.merged,
    merge,
    extractedClaimCount,
    fallbackClaimCount,
    claimSource,
  }
}

/**
 * Full offline live-like path including writeKnowledgeRelease + fixed index.
 * Default CLI root: `data/knowledge-releases-demo`.
 */
export async function runOfflineLiveLikeAndWrite(
  root: string,
  input: LiveLikePipelineInput,
  opts?: { indexGeneratedAt?: string },
): Promise<
  LiveLikePipelineResult & {
    dir: string
    file: string
    indexPath: string
  }
> {
  const result = await runOfflineLiveLikePipeline(input)
  const { dir, file } = await writeKnowledgeRelease(root, result.release)
  // writeKnowledgeRelease rewrites index with wall-clock generatedAt; overwrite.
  const indexPath = await writeReleaseIndex(root, {
    generatedAt: opts?.indexGeneratedAt ?? input.releasedAt,
  })
  return { ...result, dir, file, indexPath }
}

/**
 * Default demo fixture used by CLI and smoke tests (#48-R).
 */
export function buildDefaultLiveLikeFixture(): LiveLikeFixture {
  return {
    openAlexWorks: [LIVE_LIKE_DEMO_OPENALEX_WORK],
    crossrefItems: [LIVE_LIKE_DEMO_CROSSREF_ITEM],
    fallbackBibliographicClaims: true,
  }
}
