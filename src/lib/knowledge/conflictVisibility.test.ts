import { describe, expect, it } from 'vitest'
import {
  conflictSetFromFinding,
  conflictSetsForClaimId,
  conflictSetsFromFindings,
  emitConflictSetsFromClaims,
  exportConflictSetVisibility,
  listConflictSets,
} from './conflictVisibility'
import {
  blockedIdsForSilentCollapse,
  buildErrataConflictSet,
  resolveConflictWithoutDelete,
} from './integrity'
import { publishKnowledgeRelease } from './publish/releasePublisher'
import { verifyKnowledgeRelease } from './release'
import { KNOWLEDGE_CONTRACT_VERSION, type Claim } from './types'
import { validateConflictSet } from './validate'

const T0 = '2026-08-06T03:00:00.000Z'

function claim(
  id: string,
  state: Claim['state'],
  statement: Record<string, unknown>,
  opts?: Partial<Claim>,
): Claim {
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id,
    kind: opts?.kind ?? 'conversion.efficiency',
    subjectId: opts?.subjectId ?? 'edge-rectenna',
    statement,
    state,
    confidence: opts?.confidence ?? 0.8,
    createdAt: opts?.createdAt ?? T0,
    updatedAt: opts?.updatedAt,
  }
}

describe('conflictVisibility — emit from integrity (#48 C3)', () => {
  it('errata path: statement conflicts emit ConflictSet with both claim ids (no merge)', () => {
    const a = claim('eta-low', 'validated', { metric: 'eta', value: 0.2, unit: '1' })
    const b = claim('eta-high', 'validated', { metric: 'eta', value: 0.8, unit: '1' })
    const { findings, conflictSets } = emitConflictSetsFromClaims([a, b], {
      state: 'validated',
    })
    expect(findings.some((f) => f.kind === 'errata')).toBe(true)
    expect(conflictSets).toHaveLength(1)
    const cs = conflictSets[0]!
    expect(cs.id).toBe('conflict:errata:eta-high+eta-low')
    expect(cs.claimIds.sort()).toEqual(['eta-high', 'eta-low'])
    expect(validateConflictSet(cs)).toBeNull()
    // Original statements untouched — no silent overwrite
    expect(a.statement).toEqual({ metric: 'eta', value: 0.2, unit: '1' })
    expect(b.statement).toEqual({ metric: 'eta', value: 0.8, unit: '1' })
  })

  it('duplicate path: exact content emits ConflictSet listing all ids', () => {
    const stmt = { metric: 'eta', value: 0.33, unit: '1' }
    const a = claim('dup-a', 'validated', stmt)
    const b = claim('dup-b', 'validated', stmt)
    // Pure exact dups only (no third statement → no errata finding)
    const { findings, conflictSets } = emitConflictSetsFromClaims([a, b])
    expect(findings.some((f) => f.kind === 'duplicate')).toBe(true)
    expect(findings.every((f) => f.kind === 'duplicate')).toBe(true)
    expect(conflictSets).toHaveLength(1)
    expect(conflictSets[0]!.id).toBe('conflict:duplicate:dup-a+dup-b')
    expect(conflictSets[0]!.claimIds).toEqual(['dup-a', 'dup-b'])
    // Silent multi-include still blocked for extras, but ConflictSet keeps both
    const { blockedClaimIds } = blockedIdsForSilentCollapse([a, b])
    expect(blockedClaimIds).toEqual(['dup-b'])
    expect(conflictSets[0]!.claimIds).toContain('dup-b')
  })

  it('buildErrataConflictSet pairs align with findings→ConflictSet emission', () => {
    const original = claim('orig', 'released', { metric: 'eta', value: 0.4, unit: '1' })
    const correction = claim('fix', 'validated', { metric: 'eta', value: 0.42, unit: '1' })
    const built = buildErrataConflictSet(original, correction)
    expect(built.ok).toBe(true)
    if (!built.ok) throw new Error(built.error)
    const fromFinding = conflictSetFromFinding(built.finding)
    expect(fromFinding).not.toBeNull()
    expect(fromFinding!.claimIds.sort()).toEqual(built.conflictSet.claimIds.sort())
    expect(fromFinding!.id).toMatch(/^conflict:errata:/)
  })

  it('negative: single-id finding does not emit ConflictSet', () => {
    expect(
      conflictSetFromFinding({
        kind: 'retract',
        claimIds: ['only-one'],
        reason: 'solo',
      }),
    ).toBeNull()
    expect(
      conflictSetsFromFindings([
        { kind: 'retract', claimIds: ['only-one'], reason: 'solo' },
      ]),
    ).toEqual([])
  })
})

describe('conflictVisibility — integrity → release (#48 C3)', () => {
  it('errata: both claims + ConflictSet id land in KnowledgeRelease (no silent merge)', async () => {
    const a = claim('eta-a', 'validated', { metric: 'eta', value: 0.25, unit: '1' })
    const b = claim('eta-b', 'validated', { metric: 'eta', value: 0.75, unit: '1' })
    const { conflictSets } = emitConflictSetsFromClaims([a, b], { state: 'validated' })
    expect(conflictSets).toHaveLength(1)
    const conflictId = conflictSets[0]!.id

    const { release, excludedClaimIds } = await publishKnowledgeRelease({
      id: 'kr-c3-errata',
      releasedAt: T0,
      claims: [a, b],
      evidenceBindings: [],
      sourceSnapshots: [],
      conflictSets,
    })

    expect(excludedClaimIds).toEqual([])
    expect(release.claims.map((c) => c.id).sort()).toEqual(['eta-a', 'eta-b'])
    expect(release.claims.every((c) => c.state === 'released')).toBe(true)
    expect(release.conflictSets.map((c) => c.id)).toEqual([conflictId])
    expect(release.conflictSets[0]!.claimIds.sort()).toEqual(['eta-a', 'eta-b'])
    expect(await verifyKnowledgeRelease(release)).toBeNull()

    // Visibility surface surfaces the same id
    const listed = listConflictSets(release)
    expect(listed).toHaveLength(1)
    expect(listed[0]!.id).toBe(conflictId)
    expect(listed[0]!.kind).toBe('errata')
    expect(listed[0]!.subjectIds).toEqual(['edge-rectenna'])
    expect(listed[0]!.claimIds).toEqual(['eta-a', 'eta-b'])

    const exported = exportConflictSetVisibility(release)
    expect(exported.releaseId).toBe('kr-c3-errata')
    expect(exported.sha256).toBe(release.sha256)
    expect(exported.conflictCount).toBe(1)
    expect(exported.conflicts[0]!.id).toBe(conflictId)

    expect(conflictSetsForClaimId(release, 'eta-a').map((c) => c.id)).toEqual([conflictId])
    expect(conflictSetsForClaimId(release, 'missing')).toEqual([])
  })

  it('duplicate: ConflictSet id exported; extra exact dup blocked from silent multi-include without dropping ConflictSet members', async () => {
    const stmt = { k: 'same-content' }
    const x1 = claim('x1', 'validated', stmt, { kind: 'conversion.mechanism' })
    const x2 = claim('x2', 'validated', stmt, { kind: 'conversion.mechanism' })
    const { conflictSets, findings } = emitConflictSetsFromClaims([x1, x2], {
      state: 'validated',
    })
    expect(findings[0]!.kind).toBe('duplicate')
    const conflictId = conflictSets[0]!.id
    expect(conflictId).toBe('conflict:duplicate:x1+x2')

    const { blockedClaimIds } = blockedIdsForSilentCollapse([x1, x2])
    expect(blockedClaimIds).toEqual(['x2'])

    // Publisher path that acknowledges ConflictSet: include both members + set
    // (visibility), not a silent one-id merge without a conflict record.
    const { release } = await publishKnowledgeRelease({
      id: 'kr-c3-dup',
      releasedAt: T0,
      claims: [x1, x2],
      evidenceBindings: [],
      sourceSnapshots: [],
      conflictSets,
    })
    expect(release.conflictSets.map((c) => c.id)).toEqual([conflictId])
    expect(release.conflictSets[0]!.claimIds).toEqual(['x1', 'x2'])
    const exp = exportConflictSetVisibility(release)
    expect(exp.conflicts[0]!.kind).toBe('duplicate')
    expect(exp.conflicts[0]!.claimIds).toEqual(['x1', 'x2'])
  })

  it('resolution note does not delete ConflictSet members after publish', async () => {
    const a = claim('r1', 'validated', { v: 1 })
    const b = claim('r2', 'validated', { v: 2 })
    const { conflictSets } = emitConflictSetsFromClaims([a, b], { state: 'validated' })
    const resolved = resolveConflictWithoutDelete(
      conflictSets[0]!,
      'prefer r2 pending remeasure',
    )
    expect(resolved.claimIds.sort()).toEqual(['r1', 'r2'])

    const { release } = await publishKnowledgeRelease({
      id: 'kr-c3-resolve',
      releasedAt: T0,
      claims: [a, b],
      evidenceBindings: [],
      sourceSnapshots: [],
      conflictSets: [resolved],
    })
    const row = listConflictSets(release)[0]!
    expect(row.claimIds).toEqual(['r1', 'r2'])
    expect(row.resolution).toMatch(/prefer r2/)
    expect(release.claims).toHaveLength(2)
  })

  it('trimGraph drops ConflictSet when a member claim is excluded (no orphan visibility)', async () => {
    const good = claim('keep', 'validated', { metric: 'eta', value: 0.3, unit: '1' })
    const quarantined = claim('q', 'quarantine', { metric: 'eta', value: 0.99, unit: '1' })
    // Force a set that references the quarantined claim
    const orphanSet = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'conflict:errata:keep+q',
      claimIds: ['keep', 'q'],
      reason: 'would_orphan',
      state: 'candidate' as const,
    }
    const { release } = await publishKnowledgeRelease({
      id: 'kr-c3-orphan',
      releasedAt: T0,
      claims: [good, quarantined],
      evidenceBindings: [],
      sourceSnapshots: [],
      conflictSets: [orphanSet],
    })
    // Only `keep` is publishable → ConflictSet trimmed (member q absent)
    expect(release.claims.map((c) => c.id)).toEqual(['keep'])
    expect(listConflictSets(release)).toEqual([])
    expect(exportConflictSetVisibility(release).conflictCount).toBe(0)
  })
})
