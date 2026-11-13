/**
 * Retract / errata / duplicate integrity helpers (#48 C2).
 *
 * Pure working-set rules — does not open SQLite or rewrite historical
 * KnowledgeRelease digests. Released claims stay terminal (validateTransition).
 *
 * Policies:
 * - Retract: requires `support: "refutes"` evidence; quarantines non-released
 *   claims only. Never mutates `released` in place.
 * - Errata: correction claim must not silently overwrite the original; both
 *   ids join a ConflictSet (visible controversy, not collapse).
 * - Duplicate: same subjectId+kind+canonical(statement) → flag; differing
 *   statements on same subject+kind → errata-class ConflictSet, not merge.
 */

import { canonicalJson } from './canonical'
import {
  KNOWLEDGE_CONTRACT_VERSION,
  type Claim,
  type ConflictSet,
  type EvidenceBinding,
  type EvidenceSupport,
  type KnowledgeLifecycleState,
} from './types'
import { validateTransition } from './validate'

export type IntegrityKind = 'retract' | 'errata' | 'duplicate'

export type IntegrityFinding = {
  kind: IntegrityKind
  claimIds: string[]
  reason: string
}

export type RetractApplyResult = {
  /** Claim after policy (unchanged when blocked / already released). */
  claim: Claim
  applied: boolean
  /** Set when policy refused the operation. */
  error?: string
  finding?: IntegrityFinding
}

export type ErrataConflictResult =
  | { ok: true; conflictSet: ConflictSet; finding: IntegrityFinding }
  | { ok: false; error: string }

/**
 * Content fingerprint for duplicate detection: subject + kind + statement.
 * Ignores id / state / timestamps so republished shells still collide.
 */
export function claimContentKey(claim: Claim): string {
  return [
    claim.subjectId,
    String(claim.kind),
    canonicalJson(claim.statement ?? {}),
  ].join('\u001f')
}

/**
 * Find exact content duplicates (same subject, kind, statement; distinct ids).
 * Does not merge or drop — callers decide quarantine / ConflictSet.
 */
export function findDuplicateClaims(claims: readonly Claim[]): IntegrityFinding[] {
  const byKey = new Map<string, string[]>()
  for (const c of claims) {
    const key = claimContentKey(c)
    const list = byKey.get(key) ?? []
    list.push(c.id)
    byKey.set(key, list)
  }
  const findings: IntegrityFinding[] = []
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue
    const unique = [...new Set(ids)].sort()
    if (unique.length < 2) continue
    findings.push({
      kind: 'duplicate',
      claimIds: unique,
      reason: `exact_duplicate_content:${unique.length}_claims`,
    })
  }
  return findings
}

/**
 * Same subjectId + kind with *different* statements → errata/conflict class
 * (disagreement), not a silent merge key.
 */
export function findStatementConflicts(claims: readonly Claim[]): IntegrityFinding[] {
  const bySubjectKind = new Map<string, Claim[]>()
  for (const c of claims) {
    const key = `${c.subjectId}\u001f${String(c.kind)}`
    const list = bySubjectKind.get(key) ?? []
    list.push(c)
    bySubjectKind.set(key, list)
  }
  const findings: IntegrityFinding[] = []
  for (const group of bySubjectKind.values()) {
    if (group.length < 2) continue
    const keys = new Set(group.map(claimContentKey))
    if (keys.size < 2) continue // pure duplicates handled elsewhere
    const ids = [...new Set(group.map((c) => c.id))].sort()
    findings.push({
      kind: 'errata',
      claimIds: ids,
      reason: 'statement_conflict:same_subject_kind_different_statement',
    })
  }
  return findings
}

/**
 * Build a non-overwriting ConflictSet for an errata pair.
 * Negative: refuses when ids collide, statements are identical (use duplicate),
 * or subject/kind mismatch.
 */
export function buildErrataConflictSet(
  original: Claim,
  correction: Claim,
  options?: { id?: string; reason?: string; state?: KnowledgeLifecycleState },
): ErrataConflictResult {
  if (!original?.id || !correction?.id) {
    return { ok: false, error: 'errata: both claims required' }
  }
  if (original.id === correction.id) {
    return { ok: false, error: 'errata: correction must be a distinct claim id' }
  }
  if (original.subjectId !== correction.subjectId) {
    return { ok: false, error: 'errata: subjectId mismatch (not same fact subject)' }
  }
  if (String(original.kind) !== String(correction.kind)) {
    return { ok: false, error: 'errata: kind mismatch' }
  }
  if (claimContentKey(original) === claimContentKey(correction)) {
    return {
      ok: false,
      error: 'errata: statements identical — use findDuplicateClaims, not silent overwrite',
    }
  }

  const claimIds = [original.id, correction.id].sort()
  const reason =
    options?.reason ??
    `errata:correction_of_${original.id}_by_${correction.id}`
  const conflictSet: ConflictSet = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: options?.id ?? `conflict:errata:${claimIds.join('+')}`,
    claimIds,
    reason,
    state: options?.state ?? 'candidate',
  }
  const finding: IntegrityFinding = {
    kind: 'errata',
    claimIds,
    reason,
  }
  return { ok: true, conflictSet, finding }
}

function isRefuteSupport(support: EvidenceSupport | string | undefined): boolean {
  return support === 'refutes'
}

/**
 * Apply a retraction signal to a working-set claim.
 *
 * Negative / hard rules:
 * - `released` is terminal → never applied; returns error
 * - Evidence must be `support: "refutes"` (supports/context alone is insufficient)
 * - Does not delete the claim; only transitions toward quarantine when allowed
 */
export function applyRetraction(
  claim: Claim,
  evidence: { support: EvidenceSupport | string; note?: string; bindingId?: string },
  nowIso?: string,
): RetractApplyResult {
  if (!isRefuteSupport(evidence.support)) {
    return {
      claim,
      applied: false,
      error: 'retract: requires evidence support "refutes" (supports/context insufficient)',
    }
  }

  if (claim.state === 'released') {
    return {
      claim,
      applied: false,
      error: 'retract: released is terminal; cannot mutate historical claim in place',
      finding: {
        kind: 'retract',
        claimIds: [claim.id],
        reason: 'retract_signal_on_released:emit_conflict_or_new_release_only',
      },
    }
  }

  if (claim.state === 'quarantine') {
    // Already held; treat as applied no-op with finding.
    return {
      claim,
      applied: true,
      finding: {
        kind: 'retract',
        claimIds: [claim.id],
        reason: evidence.note ?? 'retract:already_quarantine',
      },
    }
  }

  const tErr = validateTransition(claim.state, 'quarantine')
  if (tErr) {
    return {
      claim,
      applied: false,
      error: `retract:transition:${tErr}`,
    }
  }

  const next: Claim = {
    ...claim,
    state: 'quarantine',
    updatedAt: nowIso ?? new Date().toISOString(),
  }
  return {
    claim: next,
    applied: true,
    finding: {
      kind: 'retract',
      claimIds: [claim.id],
      reason: evidence.note ?? `retract:refutes${evidence.bindingId ? `:${evidence.bindingId}` : ''}`,
    },
  }
}

/**
 * Guard: a release publisher must not silently drop one of two conflicting
 * statements. Returns blocked claim ids that need ConflictSet visibility.
 */
export function blockedIdsForSilentCollapse(
  claims: readonly Claim[],
): { blockedClaimIds: string[]; findings: IntegrityFinding[] } {
  const findings = [
    ...findDuplicateClaims(claims),
    ...findStatementConflicts(claims),
  ]
  const blocked = new Set<string>()
  for (const f of findings) {
    // Exact duplicates: keep first id (stable sort), block the rest from
    // *silent* multi-include without ConflictSet — publisher must acknowledge.
    if (f.kind === 'duplicate') {
      const sorted = [...f.claimIds].sort()
      for (const id of sorted.slice(1)) blocked.add(id)
    }
    // Statement conflicts: block *none* from existence but flag all — both must
    // remain visible via ConflictSet. Callers use findings, not auto-drop.
  }
  return { blockedClaimIds: [...blocked].sort(), findings }
}

/**
 * Refuse to treat a ConflictSet as a single winning claim.
 * Negative: resolution note alone must not delete member claim ids.
 */
export function resolveConflictWithoutDelete(
  conflict: ConflictSet,
  resolution: string,
): ConflictSet {
  return {
    ...conflict,
    claimIds: [...conflict.claimIds],
    resolution,
    // Members stay; state may move to validated once humans accept coexistence.
    state: conflict.state === 'released' ? 'released' : conflict.state,
  }
}

/**
 * Detect whether a binding list already carries refute evidence for a claim.
 */
export function hasRefuteEvidence(
  claimId: string,
  bindings: readonly EvidenceBinding[],
): boolean {
  return bindings.some((b) => b.claimId === claimId && b.support === 'refutes')
}
