/**
 * Knowledge DB path resolution (EPIC #52).
 * Separate from tasks.db — see docs/knowledge-db.md.
 *
 * Production first-class layout (K15):
 *   /var/lib/waveworld/knowledge.db
 *   /var/lib/waveworld/knowledge-blobs/
 *   /var/lib/waveworld/knowledge-releases/
 * Override with KNOWLEDGE_DB_PATH / KNOWLEDGE_BLOBS_DIR / WAVEWORLD_KNOWLEDGE_DATA_DIR
 * or WAVEWORLD_USE_LIVE_KNOWLEDGE_DATA=1.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** WaveWorld repository root. */
export function repoRootFromHere(fromFileUrl = import.meta.url): string {
  // src/lib/knowledge-db → ../../../
  const here = path.dirname(fileURLToPath(fromFileUrl))
  return path.resolve(here, '../../..')
}

/** Canonical production data root for knowledge.* (not tasks.db). */
export const LIVE_KNOWLEDGE_DATA_DIR = '/var/lib/waveworld' as const

export const LIVE_KNOWLEDGE_DB_BASENAME = 'knowledge.db' as const
export const LIVE_KNOWLEDGE_BLOBS_BASENAME = 'knowledge-blobs' as const
export const LIVE_KNOWLEDGE_RELEASES_BASENAME = 'knowledge-releases' as const

export function defaultKnowledgeDbPath(root = repoRootFromHere()): string {
  return path.join(root, 'data', 'knowledge.db')
}

export function defaultSchemaPath(root = repoRootFromHere()): string {
  return path.join(root, 'docs', 'sql', 'knowledge-schema.sql')
}

export function defaultBlobsDir(root = repoRootFromHere()): string {
  return path.join(root, 'data', 'knowledge-blobs')
}

export function defaultReleasesDir(root = repoRootFromHere()): string {
  return path.join(root, 'data', 'knowledge-releases')
}

export function liveKnowledgeDbPath(dataDir: string = LIVE_KNOWLEDGE_DATA_DIR): string {
  return path.join(dataDir, LIVE_KNOWLEDGE_DB_BASENAME)
}

export function liveKnowledgeBlobsDir(dataDir: string = LIVE_KNOWLEDGE_DATA_DIR): string {
  return path.join(dataDir, LIVE_KNOWLEDGE_BLOBS_BASENAME)
}

export function liveKnowledgeReleasesDir(dataDir: string = LIVE_KNOWLEDGE_DATA_DIR): string {
  return path.join(dataDir, LIVE_KNOWLEDGE_RELEASES_BASENAME)
}

type EnvLike = Record<string, string | undefined>

function envFlagTrue(raw: string | undefined): boolean {
  if (!raw) return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

/**
 * Resolve the knowledge data directory used for live first-class paths.
 * Priority:
 *   1. WAVEWORLD_KNOWLEDGE_DATA_DIR (explicit)
 *   2. LIVE_KNOWLEDGE_DATA_DIR when WAVEWORLD_USE_LIVE_KNOWLEDGE_DATA is truthy
 *   3. LIVE_KNOWLEDGE_DATA_DIR when live knowledge.db already exists there
 *   4. null → callers fall back to repo `data/`
 */
export function resolveKnowledgeDataDir(
  env: EnvLike = process.env,
  options?: { existsSync?: (p: string) => boolean },
): string | null {
  const exists = options?.existsSync ?? ((p: string) => fs.existsSync(p))
  const explicit = env.WAVEWORLD_KNOWLEDGE_DATA_DIR?.trim()
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit)
  }
  const forceLive = envFlagTrue(env.WAVEWORLD_USE_LIVE_KNOWLEDGE_DATA)
  if (forceLive) return LIVE_KNOWLEDGE_DATA_DIR
  const liveDb = liveKnowledgeDbPath(LIVE_KNOWLEDGE_DATA_DIR)
  if (exists(liveDb)) return LIVE_KNOWLEDGE_DATA_DIR
  return null
}

/**
 * Resolve DB file path.
 * Env priority:
 *   1. KNOWLEDGE_DB_PATH (absolute or relative to cwd)
 *   2. live data dir knowledge.db when live layout is active
 *   3. repo data/knowledge.db
 */
export function resolveKnowledgeDbPath(
  root = repoRootFromHere(),
  env: EnvLike = process.env,
  options?: { existsSync?: (p: string) => boolean },
): string {
  const envPath = env.KNOWLEDGE_DB_PATH?.trim()
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath)
  }
  const dataDir = resolveKnowledgeDataDir(env, options)
  if (dataDir) return liveKnowledgeDbPath(dataDir)
  return defaultKnowledgeDbPath(root)
}

export function resolveSchemaPath(
  root = repoRootFromHere(),
  env: EnvLike = process.env,
): string {
  const envPath = env.KNOWLEDGE_SCHEMA_PATH?.trim()
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath)
  }
  return defaultSchemaPath(root)
}

/**
 * Resolve blob store directory for SourceSnapshot bytes.
 * Env: KNOWLEDGE_BLOBS_DIR; else live data dir; else repo data/knowledge-blobs.
 */
export function resolveKnowledgeBlobsDir(
  root = repoRootFromHere(),
  env: EnvLike = process.env,
  options?: { existsSync?: (p: string) => boolean },
): string {
  const envPath = env.KNOWLEDGE_BLOBS_DIR?.trim()
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath)
  }
  const dataDir = resolveKnowledgeDataDir(env, options)
  if (dataDir) return liveKnowledgeBlobsDir(dataDir)
  return defaultBlobsDir(root)
}

/**
 * Resolve knowledge-releases export root (Caddy-static / operator tree).
 * Env: WAVEWORLD_KNOWLEDGE_RELEASES_ROOT; else live; else repo data/knowledge-releases.
 */
export function resolveKnowledgeReleasesDir(
  root = repoRootFromHere(),
  env: EnvLike = process.env,
  options?: { existsSync?: (p: string) => boolean },
): string {
  const envPath = env.WAVEWORLD_KNOWLEDGE_RELEASES_ROOT?.trim()
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath)
  }
  const dataDir = resolveKnowledgeDataDir(env, options)
  if (dataDir) return liveKnowledgeReleasesDir(dataDir)
  return defaultReleasesDir(root)
}

/** Ensure parent dir of a file path exists (for DB create / write). */
export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

/**
 * Resolve a blob object path under the knowledge blobs root (K17 traversal-safe).
 * Layout: `<blobsDir>/<sha256[0:2]>/<sha256>`.
 *
 * Rejects: empty/non-hex digests, path separators, `..`, absolute paths, and any
 * resolved path that escapes the blobs root.
 *
 * Returns absolute path when safe; throws Error with code `blob_path_unsafe`.
 */
export function resolveSafeKnowledgeBlobPath(
  sha256Hex: string,
  blobsDir?: string,
  options?: {
    root?: string
    env?: EnvLike
    existsSync?: (p: string) => boolean
  },
): string {
  const dig = (sha256Hex ?? '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(dig)) {
    const err = new Error(
      `blob_path_unsafe: digest must be 64 lowercase hex chars (got length=${dig.length})`,
    )
    ;(err as Error & { code?: string }).code = 'blob_path_unsafe'
    throw err
  }
  if (dig.includes('..') || dig.includes('/') || dig.includes('\\')) {
    const err = new Error('blob_path_unsafe: digest must not contain path segments')
    ;(err as Error & { code?: string }).code = 'blob_path_unsafe'
    throw err
  }

  const rootDir =
    blobsDir ??
    resolveKnowledgeBlobsDir(options?.root ?? repoRootFromHere(), options?.env, {
      existsSync: options?.existsSync,
    })
  const absRoot = path.resolve(rootDir)
  const candidate = path.resolve(absRoot, dig.slice(0, 2), dig)
  const rel = path.relative(absRoot, candidate)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const err = new Error('blob_path_unsafe: resolved path escapes blobs root')
    ;(err as Error & { code?: string }).code = 'blob_path_unsafe'
    throw err
  }
  return candidate
}

/**
 * Ensure live knowledge data directories exist (db parent, blobs, releases).
 * Idempotent; does not create the db file itself.
 */
export function ensureLiveKnowledgeDirs(
  dataDir: string = LIVE_KNOWLEDGE_DATA_DIR,
  mkdir: typeof fs.mkdirSync = fs.mkdirSync.bind(fs),
): {
  dataDir: string
  dbPath: string
  blobsDir: string
  releasesDir: string
} {
  const dbPath = liveKnowledgeDbPath(dataDir)
  const blobsDir = liveKnowledgeBlobsDir(dataDir)
  const releasesDir = liveKnowledgeReleasesDir(dataDir)
  mkdir(dataDir, { recursive: true })
  mkdir(path.dirname(dbPath), { recursive: true })
  mkdir(blobsDir, { recursive: true })
  mkdir(releasesDir, { recursive: true })
  return { dataDir, dbPath, blobsDir, releasesDir }
}
