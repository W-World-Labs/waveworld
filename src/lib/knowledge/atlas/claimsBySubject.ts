/**
 * #48-J Index released claims by subjectId for Matrix / Atlas deep views.
 * Pure functions over a verified KnowledgeRelease — no network.
 *
 * C4: Matrix/Graph ConflictSet export surface — `exportMatrixGraphConflictSurface`
 * materializes `exportConflictSetVisibility` / `listConflictSets` as a
 * serializable JSON envelope (no silent merge of contested claim ids).
 */

import {
  exportConflictSetVisibility,
  listConflictSets,
  type ConflictSetExport,
  type ConflictVisibilityRow,
} from '../conflictVisibility'
import type {
  Claim,
  ConflictSet,
  EvidenceBinding,
  KnowledgeRelease,
  SourceSnapshot,
} from '../types'

export type BindingWithSource = {
  binding: EvidenceBinding
  snapshot: SourceSnapshot | null
}

export type SubjectClaimView = {
  claim: Claim
  bindings: BindingWithSource[]
  /** Conflict sets that include this claim (open controversies). */
  conflictSets: ConflictSet[]
  /** Visibility rows for this claim (kind + subjectIds; same source as listConflictSets). */
  conflictVisibility: ConflictVisibilityRow[]
}

export type ClaimsBySubjectIndex = {
  releaseId: string
  releasedAt: string
  sha256: string
  /** subjectId → claim views (stable claim.id order) */
  bySubject: Map<string, SubjectClaimView[]>
  claimCount: number
  subjectCount: number
  /** Full release ConflictSet export (checkable Matrix/Graph surface). */
  conflictExport: ConflictSetExport
}

/**
 * Serializable Matrix/Graph / Controversies export surface for ConflictSets.
 * Built only from `exportConflictSetVisibility` — never collapses multi-member sets.
 */
export type MatrixGraphConflictSurface = ConflictSetExport & {
  /** subjectId → conflict ids touching claims on that subject (stable sort). */
  bySubject: Record<string, string[]>
}

/**
 * Build subject → claims+bindings+conflicts index from a released bag.
 * Only includes claims with state `released` (defense-in-depth).
 * Attaches ConflictSet visibility rows from `listConflictSets` (C4 wire).
 */
export function indexClaimsBySubject(release: KnowledgeRelease): ClaimsBySubjectIndex {
  const snapById = new Map(release.sourceSnapshots.map((s) => [s.id, s]))
  const bindingsByClaim = new Map<string, EvidenceBinding[]>()
  for (const b of release.evidenceBindings) {
    const arr = bindingsByClaim.get(b.claimId) ?? []
    arr.push(b)
    bindingsByClaim.set(b.claimId, arr)
  }
  const conflictsByClaim = new Map<string, ConflictSet[]>()
  for (const cs of release.conflictSets ?? []) {
    for (const cid of cs.claimIds) {
      const arr = conflictsByClaim.get(cid) ?? []
      arr.push(cs)
      conflictsByClaim.set(cid, arr)
    }
  }
  const visibilityByClaim = new Map<string, ConflictVisibilityRow[]>()
  for (const row of listConflictSets(release)) {
    for (const cid of row.claimIds) {
      const arr = visibilityByClaim.get(cid) ?? []
      arr.push(row)
      visibilityByClaim.set(cid, arr)
    }
  }

  const bySubject = new Map<string, SubjectClaimView[]>()
  const claims = [...release.claims]
    .filter((c) => c.state === 'released')
    .sort((a, b) => a.id.localeCompare(b.id))

  for (const claim of claims) {
    const bindings = (bindingsByClaim.get(claim.id) ?? [])
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((binding) => ({
        binding,
        snapshot: snapById.get(binding.sourceSnapshotId) ?? null,
      }))
    const view: SubjectClaimView = {
      claim,
      bindings,
      conflictSets: (conflictsByClaim.get(claim.id) ?? []).slice(),
      conflictVisibility: (visibilityByClaim.get(claim.id) ?? []).slice(),
    }
    const list = bySubject.get(claim.subjectId) ?? []
    list.push(view)
    bySubject.set(claim.subjectId, list)
  }

  const conflictExport = exportConflictSetVisibility(release)

  return {
    releaseId: release.id,
    releasedAt: release.releasedAt,
    sha256: release.sha256,
    bySubject,
    claimCount: claims.length,
    subjectCount: bySubject.size,
    conflictExport,
  }
}

export function claimsForSubject(
  index: ClaimsBySubjectIndex,
  subjectId: string,
): SubjectClaimView[] {
  return index.bySubject.get(subjectId) ?? []
}

/**
 * Deduped ConflictSets touching claims on one subject (stable id order).
 * Controversies / Matrix header path — no silent merge of multi-member sets.
 */
export function conflictSetsForSubject(
  index: ClaimsBySubjectIndex,
  subjectId: string,
): ConflictSet[] {
  const byId = new Map<string, ConflictSet>()
  for (const view of claimsForSubject(index, subjectId)) {
    for (const cs of view.conflictSets) {
      if (!byId.has(cs.id)) byId.set(cs.id, cs)
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Compact subject-level conflict badge for ReleasedClaimsPanel / Matrix deep view.
 * `null` when the subject has no open ConflictSets (panel stays silent).
 */
export type SubjectConflictBadge = {
  subjectId: string
  conflictCount: number
  conflictIds: string[]
  /** Union of member claim ids across sets (sorted; no silent merge winner). */
  contestedClaimIds: string[]
}

/**
 * Build a UI badge model for one subject from a published claims index.
 * Pure publish → UI wire; consumers must list all contestedClaimIds.
 */
export function subjectConflictBadge(
  index: ClaimsBySubjectIndex,
  subjectId: string,
): SubjectConflictBadge | null {
  const sets = conflictSetsForSubject(index, subjectId)
  if (sets.length === 0) return null
  const contested = new Set<string>()
  for (const cs of sets) {
    for (const id of cs.claimIds) contested.add(id)
  }
  return {
    subjectId,
    conflictCount: sets.length,
    conflictIds: sets.map((s) => s.id),
    contestedClaimIds: [...contested].sort((a, b) => a.localeCompare(b)),
  }
}

/**
 * Controversies hub / Matrix list residual: all subjects with open ConflictSets.
 * Stable subjectId order; subjects with no conflicts are omitted (not null rows).
 * No silent merge — each badge keeps full contestedClaimIds.
 */
export function listSubjectConflictBadges(
  index: ClaimsBySubjectIndex,
): SubjectConflictBadge[] {
  const subjectIds = [...index.bySubject.keys()].sort((a, b) => a.localeCompare(b))
  const out: SubjectConflictBadge[] = []
  for (const sid of subjectIds) {
    const badge = subjectConflictBadge(index, sid)
    if (badge) out.push(badge)
  }
  return out
}

/**
 * One-shot panel model for ReleasedClaimsPanel (Matrix/Graph/Controversies deep view).
 * Pure publish → UI wire: claims for one subject + optional subject-level conflict badge.
 * `null` when the subject has no released claims (panel stays silent).
 */
export type SubjectClaimsPanelModel = {
  releaseId: string
  releasedAt: string
  sha256: string
  subjectId: string
  /** Released claim rows for this subject (stable claim.id order). */
  views: SubjectClaimView[]
  /**
   * Subject-level ConflictSet badge when any open set touches this subject.
   * `null` when quiet — consumers must not invent a merge winner from views alone.
   */
  badge: SubjectConflictBadge | null
}

/**
 * Build the ReleasedClaimsPanel data model from a published claims index.
 * Silent (`null`) when subject has no released claims.
 */
export function subjectClaimsPanelModel(
  index: ClaimsBySubjectIndex,
  subjectId: string,
): SubjectClaimsPanelModel | null {
  const views = claimsForSubject(index, subjectId)
  if (views.length === 0) return null
  return {
    releaseId: index.releaseId,
    releasedAt: index.releasedAt,
    sha256: index.sha256,
    subjectId,
    views,
    badge: subjectConflictBadge(index, subjectId),
  }
}

/**
 * Matrix / Graph / Controversies checkable export path for ConflictSets.
 * Pure: same envelope as `exportConflictSetVisibility` plus subject → conflict id map.
 * Callers must not collapse multi-member `claimIds` into a single winner.
 */
export function exportMatrixGraphConflictSurface(
  release: KnowledgeRelease,
): MatrixGraphConflictSurface {
  const exported = exportConflictSetVisibility(release)
  const bySubject: Record<string, string[]> = {}
  for (const row of exported.conflicts) {
    for (const sid of row.subjectIds) {
      const arr = bySubject[sid] ?? []
      if (!arr.includes(row.id)) arr.push(row.id)
      bySubject[sid] = arr
    }
  }
  for (const sid of Object.keys(bySubject)) {
    bySubject[sid] = [...bySubject[sid]!].sort((a, b) => a.localeCompare(b))
  }
  // Stable key order for JSON consumers
  const sortedKeys = Object.keys(bySubject).sort((a, b) => a.localeCompare(b))
  const ordered: Record<string, string[]> = {}
  for (const k of sortedKeys) ordered[k] = bySubject[k]!

  return {
    releaseId: exported.releaseId,
    releasedAt: exported.releasedAt,
    sha256: exported.sha256,
    conflictCount: exported.conflictCount,
    conflicts: exported.conflicts,
    bySubject: ordered,
  }
}

/** Compact statement preview for UI (no HTML). */
export function statementPreview(statement: Record<string, unknown>, maxLen = 160): string {
  try {
    const s = JSON.stringify(statement)
    return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}…`
  } catch {
    return '{}'
  }
}
