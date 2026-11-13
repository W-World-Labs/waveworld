import { describe, expect, it } from 'vitest'
import {
  applyRetraction,
  blockedIdsForSilentCollapse,
  buildErrataConflictSet,
  claimContentKey,
  findDuplicateClaims,
  findStatementConflicts,
  hasRefuteEvidence,
  resolveConflictWithoutDelete,
} from './integrity'
import { publishKnowledgeRelease } from './publish/releasePublisher'
import { KNOWLEDGE_CONTRACT_VERSION, type Claim, type EvidenceBinding } from './types'
import { validateConflictSet, validateTransition } from './validate'

const T0 = '2026-08-06T00:00:00.000Z'

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

describe('integrity — retract (#48 C2 negative)', () => {
  it('negative: supports/context evidence is insufficient for retract', () => {
    const c = claim('c1', 'validated', { metric: 'eta', value: 0.5, unit: '1' })
    const a = applyRetraction(c, { support: 'supports', note: 'still good' })
    expect(a.applied).toBe(false)
    expect(a.error).toMatch(/refutes/)
    expect(a.claim.state).toBe('validated')
    expect(a.claim).toEqual(c)

    const b = applyRetraction(c, { support: 'context' })
    expect(b.applied).toBe(false)
    expect(b.error).toMatch(/refutes/)
  })

  it('negative: cannot mutate released claim in place (terminal)', () => {
    const c = claim('c-rel', 'released', { metric: 'eta', value: 0.4, unit: '1' })
    const r = applyRetraction(c, {
      support: 'refutes',
      note: 'paper retracted 2024',
      bindingId: 'eb-retract',
    })
    expect(r.applied).toBe(false)
    expect(r.error).toMatch(/terminal/)
    expect(r.claim.state).toBe('released')
    expect(r.claim.statement).toEqual(c.statement)
    expect(r.finding?.kind).toBe('retract')
    // State machine agrees: released has no outbound transitions
    expect(validateTransition('released', 'quarantine')).toMatch(/terminal/)
  })

  it('applies retract: candidate/validated → quarantine with refute evidence', () => {
    const cand = claim('c-cand', 'candidate', { metric: 'eta', value: 0.9, unit: '1' })
    const r1 = applyRetraction(cand, { support: 'refutes', note: 'withdrawn abstract' }, T0)
    expect(r1.applied).toBe(true)
    expect(r1.claim.state).toBe('quarantine')
    expect(r1.claim.updatedAt).toBe(T0)
    expect(r1.finding?.kind).toBe('retract')

    const val = claim('c-val', 'validated', { metric: 'eta', value: 0.55, unit: '1' })
    const r2 = applyRetraction(val, { support: 'refutes' }, T0)
    expect(r2.applied).toBe(true)
    expect(r2.claim.state).toBe('quarantine')
  })

  it('negative: retracted (quarantine) claim is excluded from publish', async () => {
    const good = claim('c-good', 'validated', { metric: 'eta', value: 0.3, unit: '1' })
    const bad = claim('c-bad', 'validated', { metric: 'eta', value: 0.99, unit: '1' })
    const retracted = applyRetraction(bad, { support: 'refutes', note: 'erratum withdraws η' }, T0)
    expect(retracted.claim.state).toBe('quarantine')

    const pub = await publishKnowledgeRelease({
      id: 'kr-retract-neg',
      releasedAt: T0,
      claims: [good, retracted.claim],
      evidenceBindings: [],
      sourceSnapshots: [],
    })
    expect(pub.release.claims.map((c) => c.id)).toEqual(['c-good'])
    expect(pub.excludedClaimIds).toContain('c-bad')
    expect(pub.release.claims.every((c) => c.state === 'released')).toBe(true)
  })

  it('hasRefuteEvidence detects refute bindings only', () => {
    const bindings: EvidenceBinding[] = [
      {
        contractVersion: KNOWLEDGE_CONTRACT_VERSION,
        id: 'b1',
        claimId: 'c1',
        sourceSnapshotId: 's1',
        support: 'supports',
      },
      {
        contractVersion: KNOWLEDGE_CONTRACT_VERSION,
        id: 'b2',
        claimId: 'c1',
        sourceSnapshotId: 's2',
        support: 'refutes',
      },
    ]
    expect(hasRefuteEvidence('c1', bindings)).toBe(true)
    expect(hasRefuteEvidence('c-missing', bindings)).toBe(false)
    expect(hasRefuteEvidence('c1', [bindings[0]!])).toBe(false)
  })
})

describe('integrity — errata (#48 C2 negative)', () => {
  it('negative: refuses same id, subject mismatch, kind mismatch, identical statement', () => {
    const a = claim('a', 'released', { metric: 'eta', value: 0.4, unit: '1' })
    expect(buildErrataConflictSet(a, a).ok).toBe(false)
    expect((buildErrataConflictSet(a, a) as { error: string }).error).toMatch(/distinct/)

    const otherSub = claim('b', 'validated', { metric: 'eta', value: 0.5, unit: '1' }, {
      subjectId: 'other-edge',
    })
    expect(buildErrataConflictSet(a, otherSub).ok).toBe(false)

    const otherKind = claim('c', 'validated', { metric: 'eta', value: 0.5, unit: '1' }, {
      kind: 'conversion.mechanism',
    })
    expect(buildErrataConflictSet(a, otherKind).ok).toBe(false)

    const sameStmt = claim('d', 'validated', { metric: 'eta', value: 0.4, unit: '1' })
    const dup = buildErrataConflictSet(a, sameStmt)
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toMatch(/identical|duplicate/i)
  })

  it('builds ConflictSet keeping both claim ids (no silent overwrite)', () => {
    const original = claim('orig', 'released', { metric: 'eta', value: 0.4, unit: '1' })
    const correction = claim('fix', 'validated', { metric: 'eta', value: 0.42, unit: '1' })
    const r = buildErrataConflictSet(original, correction)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    expect(r.conflictSet.claimIds.sort()).toEqual(['fix', 'orig'])
    expect(r.conflictSet.reason).toMatch(/errata/)
    expect(validateConflictSet(r.conflictSet)).toBeNull()
    // Original statement unchanged
    expect(original.statement).toEqual({ metric: 'eta', value: 0.4, unit: '1' })
    expect(correction.statement).toEqual({ metric: 'eta', value: 0.42, unit: '1' })
  })

  it('negative: resolution note does not delete member claim ids', () => {
    const original = claim('o1', 'released', { v: 1 })
    const correction = claim('o2', 'released', { v: 2 })
    const built = buildErrataConflictSet(original, correction, { state: 'validated' })
    expect(built.ok).toBe(true)
    if (!built.ok) throw new Error(built.error)
    const resolved = resolveConflictWithoutDelete(built.conflictSet, 'prefer o2 after remeasure')
    expect(resolved.claimIds.sort()).toEqual(['o1', 'o2'])
    expect(resolved.resolution).toMatch(/prefer o2/)
    expect(resolved.claimIds).toHaveLength(2)
  })

  it('findStatementConflicts flags different values; does not merge keys', () => {
    const a = claim('a', 'validated', { metric: 'eta', value: 0.1, unit: '1' })
    const b = claim('b', 'validated', { metric: 'eta', value: 0.9, unit: '1' })
    const findings = findStatementConflicts([a, b])
    expect(findings).toHaveLength(1)
    expect(findings[0]!.kind).toBe('errata')
    expect(findings[0]!.claimIds.sort()).toEqual(['a', 'b'])
    // Content keys remain distinct — no collapse
    expect(claimContentKey(a)).not.toBe(claimContentKey(b))
  })
})

describe('integrity — duplicate (#48 C2 negative)', () => {
  it('detects exact content duplicates across distinct ids', () => {
    const stmt = { metric: 'eta', value: 0.33, unit: '1' }
    const a = claim('dup-a', 'candidate', stmt)
    const b = claim('dup-b', 'validated', stmt)
    const c = claim('other', 'candidate', { metric: 'eta', value: 0.1, unit: '1' })
    const findings = findDuplicateClaims([a, b, c])
    expect(findings).toHaveLength(1)
    expect(findings[0]!.kind).toBe('duplicate')
    expect(findings[0]!.claimIds).toEqual(['dup-a', 'dup-b'])
  })

  it('negative: silent multi-include of exact duplicates is blocked for extras', () => {
    const stmt = { k: 'same' }
    const claims = [
      claim('x1', 'validated', stmt, { kind: 'conversion.mechanism' }),
      claim('x2', 'validated', stmt, { kind: 'conversion.mechanism' }),
      claim('x3', 'validated', stmt, { kind: 'conversion.mechanism' }),
    ]
    const { blockedClaimIds, findings } = blockedIdsForSilentCollapse(claims)
    expect(findings.some((f) => f.kind === 'duplicate')).toBe(true)
    // Keep lexicographically first id; block the rest
    expect(blockedClaimIds).toEqual(['x2', 'x3'])
    expect(blockedClaimIds).not.toContain('x1')
  })

  it('statement conflicts are findings but do not auto-drop either side', () => {
    const a = claim('s1', 'validated', { metric: 'eta', value: 0.2, unit: '1' })
    const b = claim('s2', 'validated', { metric: 'eta', value: 0.8, unit: '1' })
    const { blockedClaimIds, findings } = blockedIdsForSilentCollapse([a, b])
    expect(findings.some((f) => f.kind === 'errata')).toBe(true)
    expect(blockedClaimIds).toEqual([])
  })
})
