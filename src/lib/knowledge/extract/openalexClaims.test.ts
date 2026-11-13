import { describe, expect, it } from 'vitest'
import {
  abstractFromInvertedIndex,
  extractClaimsFromOpenAlexWork,
  extractEfficiencyStatements,
  OpenAlexExtractError,
} from './openalexClaims'
import { sourceSnapshotFromOpenAlexWork } from '../ingest/openalex'
import { KNOWLEDGE_CONTRACT_VERSION } from '../types'

const WORK = {
  id: 'https://openalex.org/W2741809807',
  doi: 'https://doi.org/10.7717/peerj.4375',
  title: 'The state of OA',
  open_access: { is_oa: true, oa_status: 'gold' },
  concepts: [
    { id: 'https://openalex.org/C123', display_name: 'Photovoltaics', score: 0.91, level: 1 },
    { id: 'https://openalex.org/C456', display_name: 'Energy conversion', score: 0.72, level: 1 },
    { id: 'https://openalex.org/C789', display_name: 'Noise', score: 0.1, level: 2 },
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

describe('OpenAlex claim extractor (#48-C)', () => {
  it('abstractFromInvertedIndex rebuilds word order', () => {
    const text = abstractFromInvertedIndex({
      Hello: [0],
      world: [1],
    })
    expect(text).toBe('Hello world')
  })

  it('extractEfficiencyStatements finds percent and COP', () => {
    const hits = extractEfficiencyStatements('The device reaches 22% efficiency with COP 3.5 in lab.')
    expect(hits.some((h) => h.metric === 'percent' && Math.abs(h.value - 0.22) < 1e-9)).toBe(true)
    expect(hits.some((h) => h.metric === 'cop' && h.value === 3.5)).toBe(true)
  })

  it('extracts mechanism + OA + efficiency claims with bindings', async () => {
    const snap = await sourceSnapshotFromOpenAlexWork(WORK, {
      capturedAt: '2026-08-04T00:00:00.000Z',
      pageCursor: '*',
    })
    const { claims, evidenceBindings } = extractClaimsFromOpenAlexWork(WORK, snap)

    expect(claims.length).toBeGreaterThanOrEqual(3)
    expect(claims.every((c) => c.state === 'candidate')).toBe(true)
    expect(claims.every((c) => c.contractVersion === KNOWLEDGE_CONTRACT_VERSION)).toBe(true)

    const mechanisms = claims.filter((c) => c.kind === 'conversion.mechanism')
    expect(mechanisms.length).toBeGreaterThanOrEqual(2)
    expect(mechanisms[0]!.statement.mechanism).toBe('Photovoltaics')

    const oa = claims.find((c) => c.kind === 'other' && c.statement.isOpenAccess === true)
    expect(oa).toBeTruthy()

    const eff = claims.filter((c) => c.kind === 'conversion.efficiency')
    expect(eff.length).toBeGreaterThanOrEqual(1)

    expect(evidenceBindings).toHaveLength(claims.length)
    for (const b of evidenceBindings) {
      expect(b.sourceSnapshotId).toBe(snap.id)
      expect(claims.some((c) => c.id === b.claimId)).toBe(true)
      expect(b.support).toBe('supports')
    }
  })

  it('negative: missing snapshot id', async () => {
    const snap = await sourceSnapshotFromOpenAlexWork(WORK, {
      capturedAt: '2026-08-04T00:00:00.000Z',
    })
    expect(() =>
      extractClaimsFromOpenAlexWork(WORK, { ...snap, id: '' }),
    ).toThrow(OpenAlexExtractError)
  })

  it('negative: provider mismatch', async () => {
    const snap = await sourceSnapshotFromOpenAlexWork(WORK, {
      capturedAt: '2026-08-04T00:00:00.000Z',
    })
    expect(() =>
      extractClaimsFromOpenAlexWork(WORK, { ...snap, provider: 'crossref' }),
    ).toThrowError(/provider/)
  })

  it('work with no concepts/abstract still may emit OA only or empty', async () => {
    const minimal = {
      id: 'https://openalex.org/W1',
      title: 'x',
    }
    const snap = await sourceSnapshotFromOpenAlexWork(minimal, {
      capturedAt: '2026-08-04T00:00:00.000Z',
    })
    const { claims, evidenceBindings } = extractClaimsFromOpenAlexWork(minimal, snap)
    expect(claims).toEqual([])
    expect(evidenceBindings).toEqual([])
  })
})
