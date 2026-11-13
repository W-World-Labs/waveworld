import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadKnowledgeRelease, listKnowledgeReleaseIds } from './store/releaseStore'
import { verifyKnowledgeRelease } from './release'
import { exportConflictSetVisibility } from './conflictVisibility'
import {
  conflictSetsForSubject,
  exportMatrixGraphConflictSurface,
  indexClaimsBySubject,
  listSubjectConflictBadges,
  subjectConflictBadge,
} from './atlas/claimsBySubject'
import {
  SAMPLE_CONFLICT_CLAIM_IDS,
  SAMPLE_CONFLICT_SEEDS,
  SAMPLE_CONFLICT_SET_ID,
  SAMPLE_CONFLICT_SUBJECT_ID,
  SAMPLE_CONTROVERSY_SUBJECT_IDS,
  SAMPLE_EDGE_CONFLICT_CLAIM_IDS,
  SAMPLE_EDGE_CONFLICT_SET_ID,
  SAMPLE_EDGE_CONFLICT_SUBJECT_ID,
  SAMPLE_EDGE_SUBJECT_IDS,
  SAMPLE_KNOWLEDGE_RELEASE_ID,
  SAMPLE_NODE_CONFLICT_CLAIM_IDS,
  SAMPLE_NODE_CONFLICT_SET_ID,
  SAMPLE_NODE_CONFLICT_SUBJECT_ID,
  SAMPLE_RELEASED_AT,
  SAMPLE_SUBJECT_ID,
  SAMPLE_SUBJECT_IDS,
  buildSampleKnowledgeRelease,
  buildSampleOfflineFixture,
  listSampleConflictSeeds,
  sampleConflictSeedForSurface,
  sampleConflictSetIds,
  sampleConflictSubjectIds,
  writeSampleKnowledgeRelease,
} from './sampleRelease'

describe('sample KnowledgeRelease (#48-O multi-edge + #48-Q controversies + C conflict seeds)', () => {
  it('fixture has ≥6 edge + ≥2 controversy/node candidates + triple conflict seed pairs', async () => {
    const fixture = await buildSampleOfflineFixture()
    // 6 edges + 2× thermal + 2× information-energy + 2nd rectenna η = 11
    expect(fixture.claims.length).toBeGreaterThanOrEqual(11)
    expect(fixture.claims.every((c) => c.state === 'candidate')).toBe(true)
    const kinds = new Set(fixture.claims.map((c) => c.kind))
    expect(kinds.has('conversion.efficiency')).toBe(true)
    expect(kinds.has('conversion.mechanism')).toBe(true)
    expect(kinds.has('other')).toBe(true)
    const subjects = new Set(fixture.claims.map((c) => c.subjectId))
    // Conflict seeds: information-energy + thermal + rectenna each have 2 claims
    expect(subjects.size).toBeLessThan(fixture.claims.length)
    for (const id of SAMPLE_SUBJECT_IDS) {
      expect(subjects.has(id)).toBe(true)
    }
    expect(SAMPLE_EDGE_SUBJECT_IDS.length).toBeGreaterThanOrEqual(6)
    expect(SAMPLE_CONTROVERSY_SUBJECT_IDS.length).toBeGreaterThanOrEqual(2)
    for (const id of SAMPLE_EDGE_SUBJECT_IDS) {
      expect(subjects.has(id)).toBe(true)
    }
    for (const id of SAMPLE_CONTROVERSY_SUBJECT_IDS) {
      expect(subjects.has(id)).toBe(true)
    }
    // Controversies UI subjects: real controversy id + related energy node
    expect(subjects.has('information-energy')).toBe(true)
    expect(subjects.has('thermal')).toBe(true)
    const conflictMembers = fixture.claims.filter(
      (c) => c.subjectId === SAMPLE_CONFLICT_SUBJECT_ID,
    )
    expect(conflictMembers.map((c) => c.id).sort()).toEqual(
      [...SAMPLE_CONFLICT_CLAIM_IDS].sort(),
    )
    // Different statements (errata path), not exact duplicate
    expect(JSON.stringify(conflictMembers[0]!.statement)).not.toBe(
      JSON.stringify(conflictMembers[1]!.statement),
    )
    const edgeMembers = fixture.claims.filter(
      (c) => c.subjectId === SAMPLE_EDGE_CONFLICT_SUBJECT_ID,
    )
    expect(edgeMembers.map((c) => c.id).sort()).toEqual(
      [...SAMPLE_EDGE_CONFLICT_CLAIM_IDS].sort(),
    )
    expect(JSON.stringify(edgeMembers[0]!.statement)).not.toBe(
      JSON.stringify(edgeMembers[1]!.statement),
    )
    const nodeMembers = fixture.claims.filter(
      (c) => c.subjectId === SAMPLE_NODE_CONFLICT_SUBJECT_ID,
    )
    expect(nodeMembers.map((c) => c.id).sort()).toEqual(
      [...SAMPLE_NODE_CONFLICT_CLAIM_IDS].sort(),
    )
    expect(JSON.stringify(nodeMembers[0]!.statement)).not.toBe(
      JSON.stringify(nodeMembers[1]!.statement),
    )
    expect(fixture.evidenceBindings).toHaveLength(fixture.claims.length)
    expect(fixture.sourceSnapshots).toHaveLength(fixture.claims.length)
  })

  it('builds a verified multi-subject released bag with triple ConflictSet seeds via offline pipeline', async () => {
    const a = await buildSampleKnowledgeRelease()
    const b = await buildSampleKnowledgeRelease()

    expect(a.id).toBe(SAMPLE_KNOWLEDGE_RELEASE_ID)
    expect(a.state).toBe('released')
    expect(a.claims.length).toBeGreaterThanOrEqual(11)
    expect(a.claims.every((c) => c.state === 'released')).toBe(true)
    expect(a.claims.some((c) => c.subjectId === SAMPLE_SUBJECT_ID)).toBe(true)
    expect(a.claims.some((c) => c.kind === 'conversion.efficiency')).toBe(true)
    expect(a.claims.some((c) => c.kind === 'conversion.mechanism')).toBe(true)
    expect(a.claims.some((c) => c.kind === 'other')).toBe(true)

    const subjects = new Set(a.claims.map((c) => c.subjectId))
    expect(subjects.size).toBeLessThan(a.claims.length)
    for (const id of SAMPLE_SUBJECT_IDS) {
      expect(subjects.has(id)).toBe(true)
    }
    for (const id of SAMPLE_CONTROVERSY_SUBJECT_IDS) {
      expect(subjects.has(id)).toBe(true)
    }

    // C conflict seeds: multi-member ConflictSets keep both claim ids
    expect(a.conflictSets.length).toBeGreaterThanOrEqual(3)
    const cs = a.conflictSets.find((c) => c.id === SAMPLE_CONFLICT_SET_ID)
    expect(cs).toBeDefined()
    expect([...cs!.claimIds].sort()).toEqual([...SAMPLE_CONFLICT_CLAIM_IDS].sort())
    expect(cs!.state).toBe('released')
    const edgeCs = a.conflictSets.find((c) => c.id === SAMPLE_EDGE_CONFLICT_SET_ID)
    expect(edgeCs).toBeDefined()
    expect([...edgeCs!.claimIds].sort()).toEqual(
      [...SAMPLE_EDGE_CONFLICT_CLAIM_IDS].sort(),
    )
    const nodeCs = a.conflictSets.find((c) => c.id === SAMPLE_NODE_CONFLICT_SET_ID)
    expect(nodeCs).toBeDefined()
    expect([...nodeCs!.claimIds].sort()).toEqual(
      [...SAMPLE_NODE_CONFLICT_CLAIM_IDS].sort(),
    )
    // No silent collapse — all member pairs remain as released claims
    for (const id of [
      ...SAMPLE_CONFLICT_CLAIM_IDS,
      ...SAMPLE_EDGE_CONFLICT_CLAIM_IDS,
      ...SAMPLE_NODE_CONFLICT_CLAIM_IDS,
    ]) {
      expect(a.claims.some((c) => c.id === id)).toBe(true)
    }

    const vis = exportConflictSetVisibility(a)
    expect(vis.conflictCount).toBeGreaterThanOrEqual(3)
    expect(vis.conflicts.some((r) => r.id === SAMPLE_CONFLICT_SET_ID)).toBe(true)
    expect(vis.conflicts.some((r) => r.id === SAMPLE_EDGE_CONFLICT_SET_ID)).toBe(
      true,
    )
    expect(vis.conflicts.some((r) => r.id === SAMPLE_NODE_CONFLICT_SET_ID)).toBe(
      true,
    )

    expect(a.evidenceBindings.length).toBe(a.claims.length)
    expect(a.sourceSnapshots.length).toBe(a.claims.length)
    expect(a.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(a.sha256).toBe(b.sha256)
    expect(await verifyKnowledgeRelease(a)).toBeNull()

    const idx = indexClaimsBySubject(a)
    expect(idx.claimCount).toBe(a.claims.length)
    expect(idx.subjectCount).toBe(subjects.size)
    expect(idx.bySubject.get(SAMPLE_EDGE_SUBJECT_IDS[1])?.length).toBe(1)
    expect(idx.bySubject.get(SAMPLE_CONFLICT_SUBJECT_ID)?.length).toBe(2)
    expect(idx.bySubject.get(SAMPLE_EDGE_CONFLICT_SUBJECT_ID)?.length).toBe(2)
    expect(idx.bySubject.get(SAMPLE_NODE_CONFLICT_SUBJECT_ID)?.length).toBe(2)
    // Controversies / ReleasedClaimsPanel conflict badge path
    const infoViews = idx.bySubject.get(SAMPLE_CONFLICT_SUBJECT_ID) ?? []
    expect(infoViews.every((v) => v.conflictSets.length >= 1)).toBe(true)
    expect(infoViews.every((v) => v.conflictVisibility.length >= 1)).toBe(true)
    expect(idx.conflictExport.conflictCount).toBeGreaterThanOrEqual(3)

    // Publish UI wire: subject-level badge helpers
    const infoBadge = subjectConflictBadge(idx, SAMPLE_CONFLICT_SUBJECT_ID)
    expect(infoBadge).not.toBeNull()
    expect(infoBadge!.conflictIds).toContain(SAMPLE_CONFLICT_SET_ID)
    expect(infoBadge!.contestedClaimIds).toEqual(
      [...SAMPLE_CONFLICT_CLAIM_IDS].sort(),
    )
    const edgeBadge = subjectConflictBadge(idx, SAMPLE_EDGE_CONFLICT_SUBJECT_ID)
    expect(edgeBadge).not.toBeNull()
    expect(edgeBadge!.conflictIds).toContain(SAMPLE_EDGE_CONFLICT_SET_ID)
    expect(conflictSetsForSubject(idx, SAMPLE_EDGE_CONFLICT_SUBJECT_ID).map((c) => c.id)).toContain(
      SAMPLE_EDGE_CONFLICT_SET_ID,
    )
    const nodeBadge = subjectConflictBadge(idx, SAMPLE_NODE_CONFLICT_SUBJECT_ID)
    expect(nodeBadge).not.toBeNull()
    expect(nodeBadge!.conflictIds).toContain(SAMPLE_NODE_CONFLICT_SET_ID)
    expect(nodeBadge!.contestedClaimIds).toEqual(
      [...SAMPLE_NODE_CONFLICT_CLAIM_IDS].sort(),
    )

    // Hub list residual: only contested subjects, stable order, multi-member ids
    const hubBadges = listSubjectConflictBadges(idx)
    expect(hubBadges.map((b) => b.subjectId).sort()).toEqual(
      sampleConflictSubjectIds(),
    )
    expect(hubBadges.every((b) => b.contestedClaimIds.length >= 2)).toBe(true)
    expect(hubBadges.some((b) => b.subjectId === SAMPLE_NODE_CONFLICT_SUBJECT_ID)).toBe(
      true,
    )

    // C residual helper after thermal: registry drives release assertions
    expect(sampleConflictSetIds()).toEqual(
      [
        SAMPLE_CONFLICT_SET_ID,
        SAMPLE_EDGE_CONFLICT_SET_ID,
        SAMPLE_NODE_CONFLICT_SET_ID,
      ].sort(),
    )

    const surface = exportMatrixGraphConflictSurface(a)
    for (const seed of listSampleConflictSeeds()) {
      expect(a.conflictSets.some((c) => c.id === seed.conflictSetId)).toBe(true)
      expect(surface.bySubject[seed.subjectId]).toContain(seed.conflictSetId)
    }
    expect(surface.bySubject[SAMPLE_CONFLICT_SUBJECT_ID]).toContain(
      SAMPLE_CONFLICT_SET_ID,
    )
    expect(surface.bySubject[SAMPLE_EDGE_CONFLICT_SUBJECT_ID]).toContain(
      SAMPLE_EDGE_CONFLICT_SET_ID,
    )
    expect(surface.bySubject[SAMPLE_NODE_CONFLICT_SUBJECT_ID]).toContain(
      SAMPLE_NODE_CONFLICT_SET_ID,
    )
  })

  it('listSampleConflictSeeds registry covers controversy + thermal node + edge', () => {
    expect(SAMPLE_CONFLICT_SEEDS).toHaveLength(3)
    expect(listSampleConflictSeeds().map((s) => s.surface)).toEqual([
      'controversy',
      'relatedNode',
      'matrixEdge',
    ])
    const thermal = sampleConflictSeedForSurface('relatedNode')
    expect(thermal).toBeDefined()
    expect(thermal!.subjectId).toBe(SAMPLE_NODE_CONFLICT_SUBJECT_ID)
    expect(thermal!.conflictSetId).toBe(SAMPLE_NODE_CONFLICT_SET_ID)
    expect([...thermal!.claimIds].sort()).toEqual(
      [...SAMPLE_NODE_CONFLICT_CLAIM_IDS].sort(),
    )
    expect(sampleConflictSeedForSurface('controversy')!.subjectId).toBe(
      SAMPLE_CONFLICT_SUBJECT_ID,
    )
    expect(sampleConflictSeedForSurface('matrixEdge')!.subjectId).toBe(
      SAMPLE_EDGE_CONFLICT_SUBJECT_ID,
    )
    // Clones are independent of the const registry
    const listed = listSampleConflictSeeds()
    ;(listed[0]!.claimIds as string[]).push('must-not-mutate-registry')
    expect(SAMPLE_CONFLICT_SEEDS[0]!.claimIds).not.toContain(
      'must-not-mutate-registry',
    )
  })

  it('writeSampleKnowledgeRelease updates index.json with fixed generatedAt', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ww-sample-48o-'))
    const { release, file, indexPath } = await writeSampleKnowledgeRelease(root)

    expect(file.endsWith(`${path.sep}release.json`)).toBe(true)
    const loaded = await loadKnowledgeRelease(root, SAMPLE_KNOWLEDGE_RELEASE_ID)
    expect(loaded.sha256).toBe(release.sha256)
    expect(loaded.claims.length).toBeGreaterThanOrEqual(11)
    expect(loaded.conflictSets.length).toBeGreaterThanOrEqual(3)
    expect(await listKnowledgeReleaseIds(root)).toEqual([SAMPLE_KNOWLEDGE_RELEASE_ID])

    const index = JSON.parse(await readFile(indexPath, 'utf8')) as {
      schema: string
      generatedAt: string
      ids: string[]
    }
    expect(index.schema).toBe('waveworld.knowledge-release-index/v1')
    expect(index.generatedAt).toBe(SAMPLE_RELEASED_AT)
    expect(index.ids).toEqual([SAMPLE_KNOWLEDGE_RELEASE_ID])
  })
})
