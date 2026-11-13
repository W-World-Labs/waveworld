/**
 * Browser-safe release meta helpers (no node:fs / releaseStore).
 * Shared by browserCatalog and Node releasedCatalog.
 */
import type { KnowledgeRelease } from '../types'

export type ReleaseMeta = {
  id: string
  releasedAt: string
  sha256: string
  claimCount: number
  snapshotCount: number
  bindingCount: number
  /** Open ConflictSet count (Matrix/Graph / CLI checkable). */
  conflictCount: number
}

export function releaseMeta(release: KnowledgeRelease): ReleaseMeta {
  return {
    id: release.id,
    releasedAt: release.releasedAt,
    sha256: release.sha256,
    claimCount: release.claims.length,
    snapshotCount: release.sourceSnapshots.length,
    bindingCount: release.evidenceBindings.length,
    conflictCount: (release.conflictSets ?? []).length,
  }
}
