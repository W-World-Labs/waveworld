/**
 * #48-F On-disk KnowledgeRelease store (write + verified read).
 *
 * Layout (root configurable):
 *   <root>/<releaseId>/release.json
 *
 * Atlas (later) should only call `loadKnowledgeRelease` — never ingest/candidate paths.
 */

import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { KnowledgeRelease } from '../types'
import { verifyKnowledgeRelease } from '../release'

export class ReleaseStoreError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ReleaseStoreError'
    this.code = code
  }
}

/** Reject path traversal / absolute segments in release ids. */
export function assertSafeReleaseId(id: string): void {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    throw new ReleaseStoreError('bad_id', 'release id must be 1..128 chars')
  }
  if (id !== id.trim()) {
    throw new ReleaseStoreError('bad_id', 'release id must not have leading/trailing space')
  }
  // allow alnum, dash, underscore, dot — no slashes
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
    throw new ReleaseStoreError('bad_id', `unsafe release id: ${id}`)
  }
  if (id.includes('..')) {
    throw new ReleaseStoreError('bad_id', 'release id must not contain ..')
  }
}

export function releaseDir(root: string, id: string): string {
  assertSafeReleaseId(id)
  const resolvedRoot = path.resolve(root)
  const dir = path.resolve(resolvedRoot, id)
  if (!dir.startsWith(resolvedRoot + path.sep) && dir !== resolvedRoot) {
    throw new ReleaseStoreError('path_escape', 'resolved path escapes store root')
  }
  return dir
}

export function releaseJsonPath(root: string, id: string): string {
  return path.join(releaseDir(root, id), 'release.json')
}

/**
 * Persist a KnowledgeRelease. Optionally re-verify before write (default true).
 */
export async function writeKnowledgeRelease(
  root: string,
  release: KnowledgeRelease,
  opts?: { verify?: boolean },
): Promise<{ dir: string; file: string }> {
  assertSafeReleaseId(release.id)
  if (release.id !== release.id) {
    /* noop keep ts happy */
  }
  if (opts?.verify !== false) {
    const err = await verifyKnowledgeRelease(release)
    if (err) throw new ReleaseStoreError('verify_failed', err)
  }
  if (release.state !== 'released') {
    throw new ReleaseStoreError('not_released', 'only state=released may be stored')
  }

  const dir = releaseDir(root, release.id)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'release.json')
  // Stable pretty JSON for humans; verify uses object fields not file formatting.
  const body = JSON.stringify(release, null, 2) + '\n'
  await writeFile(file, body, 'utf8')
  // Sidecar digest for quick integrity checks without parsing full body
  await writeFile(path.join(dir, 'sha256'), `${release.sha256}\n`, 'utf8')
  // Browser catalog index (Atlas static / CDN layout)
  await writeReleaseIndex(root)
  return { dir, file }
}

export type ReleaseIndexV1 = {
  schema: 'waveworld.knowledge-release-index/v1'
  generatedAt: string
  ids: string[]
}

/** Rewrite root `index.json` for browser fetch catalogs. */
export async function writeReleaseIndex(
  root: string,
  opts?: { generatedAt?: string },
): Promise<string> {
  const ids = await listKnowledgeReleaseIds(root)
  const index: ReleaseIndexV1 = {
    schema: 'waveworld.knowledge-release-index/v1',
    generatedAt: opts?.generatedAt ?? new Date().toISOString(),
    ids,
  }
  const indexPath = path.join(path.resolve(root), 'index.json')
  await mkdir(path.resolve(root), { recursive: true })
  await writeFile(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8')
  return indexPath
}

/**
 * Load a release by id. Verifies sha256 by default (Atlas-safe).
 */
export async function loadKnowledgeRelease(
  root: string,
  id: string,
  opts?: { verify?: boolean },
): Promise<KnowledgeRelease> {
  const file = releaseJsonPath(root, id)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new ReleaseStoreError('not_found', `release not found: ${id} (${msg})`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ReleaseStoreError('invalid_json', `release.json is not JSON: ${id}`)
  }

  const release = parsed as KnowledgeRelease
  if (!release || typeof release !== 'object' || release.id !== id) {
    throw new ReleaseStoreError(
      'id_mismatch',
      `release.id mismatch or missing (file id field vs ${id})`,
    )
  }

  if (opts?.verify !== false) {
    const err = await verifyKnowledgeRelease(release)
    if (err) throw new ReleaseStoreError('verify_failed', err)
  }
  return release
}

/** List release ids under root (directory names that contain release.json). */
export async function listKnowledgeReleaseIds(root: string): Promise<string[]> {
  const resolved = path.resolve(root)
  let entries: string[]
  try {
    entries = await readdir(resolved)
  } catch {
    return []
  }
  const ids: string[] = []
  for (const name of entries) {
    try {
      assertSafeReleaseId(name)
    } catch {
      continue
    }
    try {
      const st = await stat(path.join(resolved, name, 'release.json'))
      if (st.isFile()) ids.push(name)
    } catch {
      /* skip */
    }
  }
  return ids.sort((a, b) => a.localeCompare(b))
}
