/**
 * #48-C Extractor: OpenAlex work JSON → candidate Claims + EvidenceBindings.
 *
 * Does not promote lifecycle beyond `candidate` and never builds a KnowledgeRelease.
 */

import type { Claim, EvidenceBinding, SourceSnapshot } from '../types'
import { KNOWLEDGE_CONTRACT_VERSION } from '../types'
import { validateClaim, validateEvidenceBinding } from '../validate'

export type OpenAlexExtractResult = {
  claims: Claim[]
  evidenceBindings: EvidenceBinding[]
}

export class OpenAlexExtractError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'OpenAlexExtractError'
    this.code = code
  }
}

/** Rebuild a rough abstract from OpenAlex inverted index (if present). */
export function abstractFromInvertedIndex(inv: unknown): string | null {
  if (!inv || typeof inv !== 'object' || Array.isArray(inv)) return null
  const map = inv as Record<string, unknown>
  const positions: { word: string; pos: number }[] = []
  for (const [word, idxs] of Object.entries(map)) {
    if (!Array.isArray(idxs)) continue
    for (const i of idxs) {
      if (typeof i === 'number' && Number.isFinite(i)) {
        positions.push({ word, pos: i })
      }
    }
  }
  if (positions.length === 0) return null
  positions.sort((a, b) => a.pos - b.pos)
  return positions.map((p) => p.word).join(' ')
}

/**
 * Pull efficiency-like numbers from free text (η / % efficiency / COP).
 * Conservative: only explicit patterns; returns candidate statements only.
 */
export function extractEfficiencyStatements(text: string): Array<{
  metric: 'eta' | 'percent' | 'cop'
  value: number
  quote: string
}> {
  const out: Array<{ metric: 'eta' | 'percent' | 'cop'; value: number; quote: string }> = []
  const patterns: Array<{ metric: 'eta' | 'percent' | 'cop'; re: RegExp }> = [
    { metric: 'eta', re: /(?:η|eta)\s*[=≈~]?\s*([01](?:\.\d+)?|\d{1,2}(?:\.\d+)?\s*%)/gi },
    {
      metric: 'percent',
      re: /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:efficiency|conversion|yield)/gi,
    },
    { metric: 'cop', re: /\bCOP\s*[=≈~]?\s*(\d+(?:\.\d+)?)/gi },
  ]
  for (const { metric, re } of patterns) {
    let m: RegExpExecArray | null
    const r = new RegExp(re.source, re.flags)
    while ((m = r.exec(text)) !== null) {
      const raw = m[1]!.trim()
      let value = parseFloat(raw.replace('%', ''))
      if (!Number.isFinite(value)) continue
      if (raw.includes('%') || metric === 'percent') {
        // normalize percent to 0–1 fraction when clearly a percent
        if (value > 1) value = value / 100
      }
      if (metric === 'eta' || metric === 'percent') {
        if (value < 0 || value > 1) continue
      }
      if (metric === 'cop' && (value <= 0 || value > 20)) continue
      out.push({ metric, value, quote: m[0].slice(0, 120) })
    }
  }
  return out
}

function openAlexWorkId(work: Record<string, unknown>): string {
  const idRaw = typeof work.id === 'string' ? work.id : ''
  if (!idRaw) throw new OpenAlexExtractError('invalid_work', 'OpenAlex work missing id')
  return idRaw.replace(/^https?:\/\/openalex\.org\//i, '')
}

function bind(
  claimId: string,
  snapshotId: string,
  locator: EvidenceBinding['locator'],
  note?: string,
): EvidenceBinding {
  const b: EvidenceBinding = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: `eb-${claimId}`,
    claimId,
    sourceSnapshotId: snapshotId,
    locator,
    support: 'supports',
    note,
  }
  const err = validateEvidenceBinding(b)
  if (err) throw new OpenAlexExtractError('invalid_binding', err)
  return b
}

function claim(
  partial: Omit<Claim, 'contractVersion' | 'state'> & { state?: Claim['state'] },
): Claim {
  const c: Claim = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    state: partial.state ?? 'candidate',
    id: partial.id,
    kind: partial.kind,
    subjectId: partial.subjectId,
    statement: partial.statement,
    confidence: partial.confidence,
    createdAt: partial.createdAt,
    updatedAt: partial.updatedAt,
  }
  const err = validateClaim(c)
  if (err) throw new OpenAlexExtractError('invalid_claim', err)
  return c
}

/**
 * Extract candidate claims from an OpenAlex work + its SourceSnapshot.
 * All claims are `candidate` and require later validation gates before release.
 */
export function extractClaimsFromOpenAlexWork(
  work: Record<string, unknown>,
  snapshot: SourceSnapshot,
  opts?: { createdAt?: string },
): OpenAlexExtractResult {
  if (!snapshot?.id) {
    throw new OpenAlexExtractError('invalid_snapshot', 'SourceSnapshot.id required')
  }
  if (snapshot.provider && snapshot.provider !== 'openalex') {
    throw new OpenAlexExtractError(
      'provider_mismatch',
      `expected provider openalex, got ${snapshot.provider}`,
    )
  }

  const createdAt = opts?.createdAt ?? snapshot.capturedAt
  const workId = openAlexWorkId(work)
  const subjectId = `openalex:${workId}`
  const claims: Claim[] = []
  const evidenceBindings: EvidenceBinding[] = []

  // 1) Mechanism / topic concepts
  const concepts = Array.isArray(work.concepts) ? work.concepts : []
  const ranked = concepts
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      name: typeof c.display_name === 'string' ? c.display_name : '',
      score: typeof c.score === 'number' ? c.score : 0,
      level: typeof c.level === 'number' ? c.level : undefined,
      id: typeof c.id === 'string' ? c.id : undefined,
    }))
    .filter((c) => c.name.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  for (let i = 0; i < ranked.length; i++) {
    const c = ranked[i]!
    const claimId = `cl-openalex-${workId}-mechanism-${i}`
    claims.push(
      claim({
        id: claimId,
        kind: 'conversion.mechanism',
        subjectId,
        statement: {
          source: 'openalex.concepts',
          mechanism: c.name,
          score: c.score,
          level: c.level,
          conceptId: c.id,
          workTitle: typeof work.title === 'string' ? work.title : undefined,
        },
        confidence: Math.min(1, Math.max(0, c.score)),
        createdAt,
      }),
    )
    evidenceBindings.push(
      bind(claimId, snapshot.id, {
        path: `concepts[${i}].display_name`,
        quote: c.name,
      }),
    )
  }

  // 2) Open-access context claim (not energy efficiency — still useful pipeline smoke)
  const oa = work.open_access as Record<string, unknown> | undefined
  if (oa && typeof oa.is_oa === 'boolean') {
    const claimId = `cl-openalex-${workId}-oa`
    claims.push(
      claim({
        id: claimId,
        kind: 'other',
        subjectId,
        statement: {
          source: 'openalex.open_access',
          isOpenAccess: oa.is_oa,
          oaStatus: typeof oa.oa_status === 'string' ? oa.oa_status : undefined,
        },
        confidence: 0.9,
        createdAt,
      }),
    )
    evidenceBindings.push(
      bind(claimId, snapshot.id, { path: 'open_access.is_oa' }, 'bibliographic OA flag'),
    )
  }

  // 3) Efficiency-like numbers from abstract (if any)
  const abstractText =
    (typeof work.abstract === 'string' && work.abstract) ||
    abstractFromInvertedIndex(work.abstract_inverted_index) ||
    ''
  if (abstractText) {
    const hits = extractEfficiencyStatements(abstractText)
    hits.slice(0, 5).forEach((hit, i) => {
      const claimId = `cl-openalex-${workId}-eff-${i}`
      claims.push(
        claim({
          id: claimId,
          kind: 'conversion.efficiency',
          subjectId,
          statement: {
            source: 'openalex.abstract',
            metric: hit.metric,
            value: hit.value,
            unit: hit.metric === 'cop' ? '1' : '1',
            note: 'regex extraction from abstract; requires validation gate',
          },
          confidence: 0.35,
          createdAt,
        }),
      )
      evidenceBindings.push(
        bind(claimId, snapshot.id, {
          path: work.abstract ? 'abstract' : 'abstract_inverted_index',
          quote: hit.quote,
        }),
      )
    })
  }

  return { claims, evidenceBindings }
}
