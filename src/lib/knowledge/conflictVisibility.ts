/**
 * ConflictSet visibility surface (#48 C3).
 *
 * List/export helpers for Matrix / Graph / Controversies UI, plus integrity
 * finding → ConflictSet emission so errata/duplicate paths never silently
 * merge contested claim ids.
 *
 * Pure functions over Claim / ConflictSet / KnowledgeRelease — no SQLite,
 * no network, no knowledge-db ownership.
 */

import {
  findDuplicateClaims,
  findStatementConflicts,
  type IntegrityFinding,
  type IntegrityKind,
} from './integrity'
import {
  KNOWLEDGE_CONTRACT_VERSION,
  type Claim,
  type ConflictSet,
  type KnowledgeLifecycleState,
  type KnowledgeRelease,
} from './types'

/** Compact row for UI / export (one ConflictSet). */
export type ConflictVisibilityRow = {
  id: string
  claimIds: string[]
  reason: string
  state: KnowledgeLifecycleState
  resolution?: string
  /** Distinct subjectIds of member claims present in the release bag. */
  subjectIds: string[]
  /** Integrity class when known from reason / id prefix. */
  kind: IntegrityKind | 'other'
}

/** Stable export envelope for a release's open conflicts. */
export type ConflictSetExport = {
  releaseId: string
  releasedAt: string
  sha256: string
  conflictCount: number
  conflicts: ConflictVisibilityRow[]
}

export type EmitConflictSetsOptions = {
  /** Lifecycle state stamped on emitted ConflictSets (default `candidate`). */
  state?: KnowledgeLifecycleState
}

export type EmitConflictSetsResult = {
  findings: IntegrityFinding[]
  conflictSets: ConflictSet[]
}

function inferKind(cs: ConflictSet, finding?: IntegrityFinding): IntegrityKind | 'other' {
  if (finding) return finding.kind
  if (cs.id.startsWith('conflict:duplicate:') || /duplicate/i.test(cs.reason)) {
    return 'duplicate'
  }
  if (cs.id.startsWith('conflict:errata:') || /errata|statement_conflict/i.test(cs.reason)) {
    return 'errata'
  }
  if (cs.id.startsWith('conflict:retract:') || /retract/i.test(cs.reason)) {
    return 'retract'
  }
  return 'other'
}

function stableConflictId(kind: IntegrityKind, claimIds: string[]): string {
  const sorted = [...claimIds].sort()
  return `conflict:${kind}:${sorted.join('+')}`
}

/**
 * Convert one integrity finding into a multi-member ConflictSet.
 * Negative: findings with fewer than two claim ids are skipped (caller filters).
 */
export function conflictSetFromFinding(
  finding: IntegrityFinding,
  options?: EmitConflictSetsOptions,
): ConflictSet | null {
  const claimIds = [...new Set(finding.claimIds)].sort()
  if (claimIds.length < 2) return null
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: stableConflictId(finding.kind, claimIds),
    claimIds,
    reason: finding.reason,
    state: options?.state ?? 'candidate',
  }
}

/**
 * Turn integrity findings (errata / duplicate / retract multi-id) into ConflictSets.
 * Does not drop or merge claims — only emits visible controversy records.
 */
export function conflictSetsFromFindings(
  findings: readonly IntegrityFinding[],
  options?: EmitConflictSetsOptions,
): ConflictSet[] {
  const out: ConflictSet[] = []
  const seen = new Set<string>()
  for (const f of findings) {
    const cs = conflictSetFromFinding(f, options)
    if (!cs) continue
    if (seen.has(cs.id)) continue
    seen.add(cs.id)
    out.push(cs)
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Scan claims → duplicate + statement-conflict findings → ConflictSets.
 * Errata path: different statements on same subject+kind.
 * Duplicate path: exact content fingerprint across distinct ids.
 * Neither path collapses members to a single winning id.
 */
export function emitConflictSetsFromClaims(
  claims: readonly Claim[],
  options?: EmitConflictSetsOptions,
): EmitConflictSetsResult {
  const findings = [
    ...findDuplicateClaims(claims),
    ...findStatementConflicts(claims),
  ]
  return {
    findings,
    conflictSets: conflictSetsFromFindings(findings, options),
  }
}

/**
 * List ConflictSets on a release as visibility rows (stable id order).
 * Enriches with member subjectIds when claims are in the release bag.
 */
export function listConflictSets(release: KnowledgeRelease): ConflictVisibilityRow[] {
  const claimById = new Map(release.claims.map((c) => [c.id, c]))
  const rows = (release.conflictSets ?? []).map((cs) => {
    const subjectIds = [
      ...new Set(
        cs.claimIds
          .map((id) => claimById.get(id)?.subjectId)
          .filter((s): s is string => typeof s === 'string' && s.length > 0),
      ),
    ].sort()
    const row: ConflictVisibilityRow = {
      id: cs.id,
      claimIds: [...cs.claimIds].sort(),
      reason: cs.reason,
      state: cs.state,
      subjectIds,
      kind: inferKind(cs),
    }
    if (cs.resolution !== undefined) row.resolution = cs.resolution
    return row
  })
  return rows.sort((a, b) => a.id.localeCompare(b.id))
}

/** ConflictSets that include a given claim id (open controversies for that claim). */
export function conflictSetsForClaimId(
  release: KnowledgeRelease,
  claimId: string,
): ConflictSet[] {
  return (release.conflictSets ?? [])
    .filter((cs) => cs.claimIds.includes(claimId))
    .map((cs) => ({ ...cs, claimIds: [...cs.claimIds] }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Export ConflictSet visibility for a verified KnowledgeRelease.
 * UI / scripts consume this instead of inventing merge winners.
 */
export function exportConflictSetVisibility(release: KnowledgeRelease): ConflictSetExport {
  const conflicts = listConflictSets(release)
  return {
    releaseId: release.id,
    releasedAt: release.releasedAt,
    sha256: release.sha256,
    conflictCount: conflicts.length,
    conflicts,
  }
}
