/**
 * #48-G Atlas-facing **read-only** access to on-disk KnowledgeRelease store.
 *
 * Hard rules:
 * - Only loads `released` digests via `loadKnowledgeRelease` (verify by default).
 * - Never opens ingest/candidate working sets.
 * - Never writes.
 */

import path from 'node:path'
import {
  exportConflictSetVisibility,
  type ConflictSetExport,
} from '../conflictVisibility'
import type { Claim, KnowledgeRelease } from '../types'
import {
  listKnowledgeReleaseIds,
  loadKnowledgeRelease,
  ReleaseStoreError,
} from '../store/releaseStore'
import { releaseMeta, type ReleaseMeta } from './releaseMeta'

export { releaseMeta, type ReleaseMeta } from './releaseMeta'

/** Env key for release store root (absolute or cwd-relative). */
export const KNOWLEDGE_RELEASES_DIR_ENV = 'KNOWLEDGE_RELEASES_DIR'

/** Default relative root when env unset (repo-local). */
export const DEFAULT_KNOWLEDGE_RELEASES_REL = 'data/knowledge-releases'

export type ReleasedCatalogOptions = {
  /** Override store root; default from env or DEFAULT_KNOWLEDGE_RELEASES_REL. */
  root?: string
  /** Verify digest on load (default true). */
  verify?: boolean
  cwd?: string
}

export function resolveKnowledgeReleasesRoot(opts?: ReleasedCatalogOptions): string {
  const cwd = opts?.cwd ?? process.cwd()
  if (opts?.root) {
    return path.isAbsolute(opts.root) ? opts.root : path.resolve(cwd, opts.root)
  }
  const fromEnv = process.env[KNOWLEDGE_RELEASES_DIR_ENV]?.trim()
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(cwd, fromEnv)
  }
  return path.resolve(cwd, DEFAULT_KNOWLEDGE_RELEASES_REL)
}

/**
 * CLI / Atlas checkable path: load a verified released bag and export
 * ConflictSet visibility (`exportConflictSetVisibility`).
 * Does not invent merge winners — multi-member sets stay multi-member.
 */
export async function exportReleasedConflictVisibility(
  id: string,
  opts?: ReleasedCatalogOptions,
): Promise<ConflictSetExport> {
  const release = await loadReleased(id, opts)
  return exportConflictSetVisibility(release)
}

/**
 * Latest release ConflictSet export, or null when the store is empty.
 */
export async function exportLatestReleasedConflictVisibility(
  opts?: ReleasedCatalogOptions,
): Promise<ConflictSetExport | null> {
  const release = await loadLatestReleased(opts)
  if (!release) return null
  return exportConflictSetVisibility(release)
}

/** List available release ids (sorted). Empty if root missing. */
export async function listReleasedIds(opts?: ReleasedCatalogOptions): Promise<string[]> {
  const root = resolveKnowledgeReleasesRoot(opts)
  return listKnowledgeReleaseIds(root)
}

/** Load one release by id (verified). */
export async function loadReleased(
  id: string,
  opts?: ReleasedCatalogOptions,
): Promise<KnowledgeRelease> {
  const root = resolveKnowledgeReleasesRoot(opts)
  return loadKnowledgeRelease(root, id, { verify: opts?.verify !== false })
}

/**
 * Load the lexicographically last release id (stable “latest” for demos).
 * Prefer explicit id in production.
 */
export async function loadLatestReleased(
  opts?: ReleasedCatalogOptions,
): Promise<KnowledgeRelease | null> {
  const ids = await listReleasedIds(opts)
  if (ids.length === 0) return null
  const id = ids[ids.length - 1]!
  return loadReleased(id, opts)
}

/** Claims of a given kind from a release (already state=released). */
export function claimsByKind(release: KnowledgeRelease, kind: string): Claim[] {
  return release.claims.filter((c) => c.kind === kind)
}

/**
 * Guard helper for Atlas: ensure claim is released (defense in depth if
 * a caller bypasses the store).
 */
export function assertReleasedClaim(claim: Claim): void {
  if (claim.state !== 'released') {
    throw new ReleaseStoreError(
      'not_released_claim',
      `Atlas refused claim ${claim.id} state=${claim.state}`,
    )
  }
}

export type CatalogSummary = {
  root: string
  ids: string[]
  latest: ReleaseMeta | null
}

/** One-shot summary for CLI / health. */
export async function summarizeReleasedCatalog(
  opts?: ReleasedCatalogOptions,
): Promise<CatalogSummary> {
  const root = resolveKnowledgeReleasesRoot(opts)
  const ids = await listKnowledgeReleaseIds(root)
  if (ids.length === 0) {
    return { root, ids: [], latest: null }
  }
  const latestId = ids[ids.length - 1]!
  const release = await loadKnowledgeRelease(root, latestId, {
    verify: opts?.verify !== false,
  })
  return { root, ids, latest: releaseMeta(release) }
}
