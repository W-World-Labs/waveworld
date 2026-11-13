import { describe, expect, it } from 'vitest'
import {
  claimsForSubject,
  conflictSetsForSubject,
  exportMatrixGraphConflictSurface,
  indexClaimsBySubject,
  listSubjectConflictBadges,
  statementPreview,
  subjectClaimsPanelModel,
  subjectConflictBadge,
} from './claimsBySubject'
import {
  emitConflictSetsFromClaims,
  exportConflictSetVisibility,
} from '../conflictVisibility'
import { publishKnowledgeRelease } from '../publish/releasePublisher'
import type { Claim, ConflictSet, EvidenceBinding, SourceSnapshot } from '../types'
import { KNOWLEDGE_CONTRACT_VERSION } from '../types'
import { sha256Hex } from '../hash'

async function buildRelease() {
  const snap: SourceSnapshot = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'src-1',
    locator: 'https://doi.org/10.1000/test',
    locatorKind: 'doi',
    capturedAt: '2026-08-04T00:00:00.000Z',
    contentSha256: await sha256Hex('body'),
    captureStatus: 'bytes-captured',
    provider: 'crossref',
    title: 'Test paper',
  }
  const c1: Claim = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'cl-edge-a',
    kind: 'conversion.mechanism',
    subjectId: 'chemical-to-thermal-combustion',
    statement: { mechanism: 'oxidation' },
    state: 'validated',
    confidence: 0.8,
    createdAt: '2026-08-04T00:00:00.000Z',
  }
  const c2: Claim = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'cl-edge-a2',
    kind: 'conversion.efficiency',
    subjectId: 'chemical-to-thermal-combustion',
    statement: { eta: 0.35, unit: '1' },
    state: 'validated',
    confidence: 0.7,
    createdAt: '2026-08-04T00:00:00.000Z',
  }
  const cOther: Claim = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'cl-other',
    kind: 'conversion.edge',
    subjectId: 'other-edge',
    statement: { edgeId: 'other-edge' },
    state: 'validated',
    createdAt: '2026-08-04T00:00:00.000Z',
  }
  const bindings: EvidenceBinding[] = [
    {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'eb-1',
      claimId: 'cl-edge-a',
      sourceSnapshotId: 'src-1',
      support: 'supports',
      locator: { quote: 'combustion converts chemical to thermal' },
    },
    {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'eb-2',
      claimId: 'cl-edge-a2',
      sourceSnapshotId: 'src-1',
      support: 'supports',
    },
  ]
  const conflict: ConflictSet = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'cf-1',
    claimIds: ['cl-edge-a', 'cl-edge-a2'],
    reason: 'mechanism vs efficiency framing',
    state: 'released',
  }
  const { release } = await publishKnowledgeRelease({
    id: 'kr-matrix-j',
    releasedAt: '2026-08-04T15:00:00.000Z',
    claims: [c1, c2, cOther],
    evidenceBindings: bindings,
    sourceSnapshots: [snap],
    conflictSets: [conflict],
  })
  return release
}

describe('claimsBySubject (#48-J)', () => {
  it('indexes released claims by subject with bindings and conflicts', async () => {
    const release = await buildRelease()
    const idx = indexClaimsBySubject(release)
    expect(idx.releaseId).toBe('kr-matrix-j')
    expect(idx.claimCount).toBe(3)
    expect(idx.subjectCount).toBe(2)

    const views = claimsForSubject(idx, 'chemical-to-thermal-combustion')
    expect(views).toHaveLength(2)
    expect(views[0]!.claim.id).toBe('cl-edge-a')
    expect(views[0]!.bindings).toHaveLength(1)
    expect(views[0]!.bindings[0]!.snapshot?.locator).toContain('doi.org')
    expect(views[0]!.conflictSets.map((c) => c.id)).toEqual(['cf-1'])
    expect(views[0]!.conflictVisibility.map((r) => r.id)).toEqual(['cf-1'])
    expect(views[0]!.conflictVisibility[0]!.claimIds.sort()).toEqual([
      'cl-edge-a',
      'cl-edge-a2',
    ])
    expect(views[1]!.claim.kind).toBe('conversion.efficiency')

    expect(idx.conflictExport.conflictCount).toBe(1)
    expect(idx.conflictExport.conflicts[0]!.id).toBe('cf-1')
    expect(idx.conflictExport).toEqual(exportConflictSetVisibility(release))

    expect(claimsForSubject(idx, 'missing')).toEqual([])
  })

  it('statementPreview truncates long JSON', () => {
    const long = { a: 'x'.repeat(200) }
    const p = statementPreview(long, 40)
    expect(p.length).toBeLessThanOrEqual(40)
    expect(p.endsWith('…')).toBe(true)
  })
})

describe('exportMatrixGraphConflictSurface (#48 C4 wire)', () => {
  it('wires list/export ConflictSet to Matrix/Graph surface without silent merge', async () => {
    const a: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'eta-lo',
      kind: 'conversion.efficiency',
      subjectId: 'edge-rectenna',
      statement: { metric: 'eta', value: 0.2, unit: '1' },
      state: 'validated',
      confidence: 0.7,
      createdAt: '2026-08-06T03:00:00.000Z',
    }
    const b: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'eta-hi',
      kind: 'conversion.efficiency',
      subjectId: 'edge-rectenna',
      statement: { metric: 'eta', value: 0.8, unit: '1' },
      state: 'validated',
      confidence: 0.7,
      createdAt: '2026-08-06T03:00:00.000Z',
    }
    const { conflictSets } = emitConflictSetsFromClaims([a, b], { state: 'validated' })
    expect(conflictSets).toHaveLength(1)
    const conflictId = conflictSets[0]!.id

    const { release } = await publishKnowledgeRelease({
      id: 'kr-c4-matrix',
      releasedAt: '2026-08-06T04:00:00.000Z',
      claims: [a, b],
      evidenceBindings: [],
      sourceSnapshots: [],
      conflictSets,
    })

    const surface = exportMatrixGraphConflictSurface(release)
    expect(surface.releaseId).toBe('kr-c4-matrix')
    expect(surface.sha256).toBe(release.sha256)
    expect(surface.conflictCount).toBe(1)
    expect(surface.conflicts[0]!.id).toBe(conflictId)
    expect(surface.conflicts[0]!.kind).toBe('errata')
    // Both contested claim ids remain — no silent merge winner
    expect(surface.conflicts[0]!.claimIds).toEqual(['eta-hi', 'eta-lo'])
    expect(surface.bySubject['edge-rectenna']).toEqual([conflictId])

    // JSON-serializable checkable surface (CLI / Graph can dump this)
    const json = JSON.parse(JSON.stringify(surface)) as typeof surface
    expect(json.conflicts[0]!.claimIds).toEqual(['eta-hi', 'eta-lo'])
    expect(json.conflictCount).toBe(1)

    // Index path shares the same export envelope
    const idx = indexClaimsBySubject(release)
    expect(idx.conflictExport.conflicts[0]!.claimIds).toEqual(['eta-hi', 'eta-lo'])
    for (const v of claimsForSubject(idx, 'edge-rectenna')) {
      expect(v.conflictVisibility[0]!.claimIds).toEqual(['eta-hi', 'eta-lo'])
      expect(v.claim.statement).toEqual(
        v.claim.id === 'eta-lo'
          ? { metric: 'eta', value: 0.2, unit: '1' }
          : { metric: 'eta', value: 0.8, unit: '1' },
      )
    }
  })

  it('empty conflict bag exports zero conflicts (no invented merge)', async () => {
    await buildRelease()
    // buildRelease has one conflict — strip path: publish without sets
    const solo: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'solo',
      kind: 'other',
      subjectId: 's1',
      statement: { n: 1 },
      state: 'validated',
      createdAt: '2026-08-06T00:00:00.000Z',
    }
    const { release: emptyCs } = await publishKnowledgeRelease({
      id: 'kr-c4-empty',
      releasedAt: '2026-08-06T00:00:00.000Z',
      claims: [solo],
      evidenceBindings: [],
      sourceSnapshots: [],
      conflictSets: [],
    })
    const surface = exportMatrixGraphConflictSurface(emptyCs)
    expect(surface.conflictCount).toBe(0)
    expect(surface.conflicts).toEqual([])
    expect(surface.bySubject).toEqual({})
  })
})

describe('subjectConflictBadge / conflictSetsForSubject (C residual publish UI wire)', () => {
  it('builds subject-level badge without silent merge; null when no conflicts', async () => {
    const a: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'eta-lo',
      kind: 'conversion.efficiency',
      subjectId: 'edge-rectenna',
      statement: { metric: 'eta', value: 0.2, unit: '1' },
      state: 'validated',
      confidence: 0.7,
      createdAt: '2026-08-06T03:00:00.000Z',
    }
    const b: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'eta-hi',
      kind: 'conversion.efficiency',
      subjectId: 'edge-rectenna',
      statement: { metric: 'eta', value: 0.8, unit: '1' },
      state: 'validated',
      confidence: 0.7,
      createdAt: '2026-08-06T03:00:00.000Z',
    }
    const solo: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'solo-ok',
      kind: 'other',
      subjectId: 'thermal',
      statement: { topic: 'heat' },
      state: 'validated',
      createdAt: '2026-08-06T03:00:00.000Z',
    }
    const { conflictSets } = emitConflictSetsFromClaims([a, b], { state: 'validated' })
    const conflictId = conflictSets[0]!.id
    const { release } = await publishKnowledgeRelease({
      id: 'kr-c-badge',
      releasedAt: '2026-08-06T04:00:00.000Z',
      claims: [a, b, solo],
      evidenceBindings: [],
      sourceSnapshots: [],
      conflictSets,
    })
    const idx = indexClaimsBySubject(release)
    const sets = conflictSetsForSubject(idx, 'edge-rectenna')
    expect(sets.map((c) => c.id)).toEqual([conflictId])
    const badge = subjectConflictBadge(idx, 'edge-rectenna')
    expect(badge).toEqual({
      subjectId: 'edge-rectenna',
      conflictCount: 1,
      conflictIds: [conflictId],
      contestedClaimIds: ['eta-hi', 'eta-lo'],
    })
    expect(subjectConflictBadge(idx, 'thermal')).toBeNull()
    expect(conflictSetsForSubject(idx, 'thermal')).toEqual([])
  })
})

describe('listSubjectConflictBadges (C residual hub list helper)', () => {
  it('lists only contested subjects in stable subjectId order; keeps multi-member ids', async () => {
    const a: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'eta-lo',
      kind: 'conversion.efficiency',
      subjectId: 'z-edge',
      statement: { metric: 'eta', value: 0.2, unit: '1' },
      state: 'validated',
      confidence: 0.7,
      createdAt: '2026-08-06T05:00:00.000Z',
    }
    const b: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'eta-hi',
      kind: 'conversion.efficiency',
      subjectId: 'z-edge',
      statement: { metric: 'eta', value: 0.9, unit: '1' },
      state: 'validated',
      confidence: 0.7,
      createdAt: '2026-08-06T05:00:00.000Z',
    }
    const c: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'view-a',
      kind: 'other',
      subjectId: 'a-controversy',
      statement: { topic: 'landauer' },
      state: 'validated',
      createdAt: '2026-08-06T05:00:00.000Z',
    }
    const d: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'view-b',
      kind: 'other',
      subjectId: 'a-controversy',
      statement: { topic: 'abstract-info' },
      state: 'validated',
      createdAt: '2026-08-06T05:00:00.000Z',
    }
    const solo: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'solo-ok',
      kind: 'other',
      subjectId: 'm-solo',
      statement: { topic: 'heat' },
      state: 'validated',
      createdAt: '2026-08-06T05:00:00.000Z',
    }
    const { conflictSets } = emitConflictSetsFromClaims([a, b, c, d], {
      state: 'validated',
    })
    expect(conflictSets.length).toBe(2)
    const { release } = await publishKnowledgeRelease({
      id: 'kr-c-list-badges',
      releasedAt: '2026-08-06T06:00:00.000Z',
      claims: [a, b, c, d, solo],
      evidenceBindings: [],
      sourceSnapshots: [],
      conflictSets,
    })
    const idx = indexClaimsBySubject(release)
    const listed = listSubjectConflictBadges(idx)
    // Contested subjects only; stable subjectId order (a-… before z-…)
    expect(listed.map((b) => b.subjectId)).toEqual(['a-controversy', 'z-edge'])
    expect(listed.every((b) => b.conflictCount >= 1)).toBe(true)
    expect(listed[0]!.contestedClaimIds).toEqual(['view-a', 'view-b'])
    expect(listed[1]!.contestedClaimIds).toEqual(['eta-hi', 'eta-lo'])
    // solo subject omitted — not a null placeholder
    expect(listed.some((b) => b.subjectId === 'm-solo')).toBe(false)
  })

  it('returns empty list when release has no ConflictSets', async () => {
    const solo: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'only',
      kind: 'other',
      subjectId: 's1',
      statement: { n: 1 },
      state: 'validated',
      createdAt: '2026-08-06T05:00:00.000Z',
    }
    const { release } = await publishKnowledgeRelease({
      id: 'kr-c-list-empty',
      releasedAt: '2026-08-06T06:00:00.000Z',
      claims: [solo],
      evidenceBindings: [],
      sourceSnapshots: [],
      conflictSets: [],
    })
    expect(listSubjectConflictBadges(indexClaimsBySubject(release))).toEqual([])
  })
})

describe('subjectClaimsPanelModel (C residual ReleasedClaimsPanel wire)', () => {
  it('packages views + subject badge; null when subject quiet', async () => {
    const a: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'eta-lo',
      kind: 'conversion.efficiency',
      subjectId: 'edge-panel',
      statement: { metric: 'eta', value: 0.25, unit: '1' },
      state: 'validated',
      confidence: 0.7,
      createdAt: '2026-08-06T07:00:00.000Z',
    }
    const b: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'eta-hi',
      kind: 'conversion.efficiency',
      subjectId: 'edge-panel',
      statement: { metric: 'eta', value: 0.75, unit: '1' },
      state: 'validated',
      confidence: 0.7,
      createdAt: '2026-08-06T07:00:00.000Z',
    }
    const solo: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'solo-thermal',
      kind: 'other',
      subjectId: 'thermal',
      statement: { topic: 'heat' },
      state: 'validated',
      createdAt: '2026-08-06T07:00:00.000Z',
    }
    const { conflictSets } = emitConflictSetsFromClaims([a, b], { state: 'validated' })
    const conflictId = conflictSets[0]!.id
    const { release } = await publishKnowledgeRelease({
      id: 'kr-c-panel-model',
      releasedAt: '2026-08-06T08:00:00.000Z',
      claims: [a, b, solo],
      evidenceBindings: [],
      sourceSnapshots: [],
      conflictSets,
    })
    const idx = indexClaimsBySubject(release)

    const contested = subjectClaimsPanelModel(idx, 'edge-panel')
    expect(contested).not.toBeNull()
    expect(contested!.releaseId).toBe('kr-c-panel-model')
    expect(contested!.subjectId).toBe('edge-panel')
    expect(contested!.views.map((v) => v.claim.id)).toEqual(['eta-hi', 'eta-lo'])
    expect(contested!.badge).toEqual({
      subjectId: 'edge-panel',
      conflictCount: 1,
      conflictIds: [conflictId],
      contestedClaimIds: ['eta-hi', 'eta-lo'],
    })
    // multi-member preserved on each claim row — no silent merge
    expect(contested!.views.every((v) => v.conflictSets.length === 1)).toBe(true)

    const quiet = subjectClaimsPanelModel(idx, 'thermal')
    expect(quiet).not.toBeNull()
    expect(quiet!.views).toHaveLength(1)
    expect(quiet!.badge).toBeNull()

    expect(subjectClaimsPanelModel(idx, 'missing-subject')).toBeNull()
  })
})
