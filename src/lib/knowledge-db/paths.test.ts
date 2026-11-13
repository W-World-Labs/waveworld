/**
 * K15: live /var/lib/waveworld/knowledge.* path resolution is first-class.
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LIVE_KNOWLEDGE_DATA_DIR,
  defaultBlobsDir,
  defaultKnowledgeDbPath,
  defaultReleasesDir,
  ensureLiveKnowledgeDirs,
  liveKnowledgeBlobsDir,
  liveKnowledgeDbPath,
  liveKnowledgeReleasesDir,
  repoRootFromHere,
  resolveKnowledgeBlobsDir,
  resolveKnowledgeDataDir,
  resolveKnowledgeDbPath,
  resolveKnowledgeReleasesDir,
  resolveSafeKnowledgeBlobPath,
  resolveSchemaPath,
} from './paths.ts'

const root = repoRootFromHere()

describe('knowledge-db paths (K15 live layout)', () => {
  it('defaults stay under repo data/ when no live env or live db', () => {
    const env = {}
    const existsSync = () => false
    expect(resolveKnowledgeDataDir(env, { existsSync })).toBeNull()
    expect(resolveKnowledgeDbPath(root, env, { existsSync })).toBe(
      defaultKnowledgeDbPath(root),
    )
    expect(resolveKnowledgeBlobsDir(root, env, { existsSync })).toBe(
      defaultBlobsDir(root),
    )
    expect(resolveKnowledgeReleasesDir(root, env, { existsSync })).toBe(
      defaultReleasesDir(root),
    )
  })

  it('KNOWLEDGE_DB_PATH wins over live layout', () => {
    const env = {
      KNOWLEDGE_DB_PATH: '/tmp/custom-knowledge.db',
      WAVEWORLD_USE_LIVE_KNOWLEDGE_DATA: '1',
    }
    expect(resolveKnowledgeDbPath(root, env)).toBe('/tmp/custom-knowledge.db')
  })

  it('WAVEWORLD_USE_LIVE_KNOWLEDGE_DATA enables /var/lib/waveworld layout', () => {
    const env = { WAVEWORLD_USE_LIVE_KNOWLEDGE_DATA: '1' }
    const existsSync = () => false
    expect(resolveKnowledgeDataDir(env, { existsSync })).toBe(LIVE_KNOWLEDGE_DATA_DIR)
    expect(resolveKnowledgeDbPath(root, env, { existsSync })).toBe(
      liveKnowledgeDbPath(),
    )
    expect(resolveKnowledgeBlobsDir(root, env, { existsSync })).toBe(
      liveKnowledgeBlobsDir(),
    )
    expect(resolveKnowledgeReleasesDir(root, env, { existsSync })).toBe(
      liveKnowledgeReleasesDir(),
    )
  })

  it('existing live knowledge.db auto-selects live data dir without force flag', () => {
    const env = {}
    const liveDb = liveKnowledgeDbPath()
    const existsSync = (p: string) => p === liveDb
    expect(resolveKnowledgeDataDir(env, { existsSync })).toBe(LIVE_KNOWLEDGE_DATA_DIR)
    expect(resolveKnowledgeDbPath(root, env, { existsSync })).toBe(liveDb)
  })

  it('WAVEWORLD_KNOWLEDGE_DATA_DIR overrides default live root', () => {
    const env = { WAVEWORLD_KNOWLEDGE_DATA_DIR: '/srv/ww-knowledge' }
    expect(resolveKnowledgeDataDir(env)).toBe('/srv/ww-knowledge')
    expect(resolveKnowledgeDbPath(root, env)).toBe(
      path.join('/srv/ww-knowledge', 'knowledge.db'),
    )
    expect(resolveKnowledgeBlobsDir(root, env)).toBe(
      path.join('/srv/ww-knowledge', 'knowledge-blobs'),
    )
  })

  it('KNOWLEDGE_BLOBS_DIR and WAVEWORLD_KNOWLEDGE_RELEASES_ROOT win when set', () => {
    const env = {
      WAVEWORLD_USE_LIVE_KNOWLEDGE_DATA: '1',
      KNOWLEDGE_BLOBS_DIR: '/tmp/blobs',
      WAVEWORLD_KNOWLEDGE_RELEASES_ROOT: '/tmp/releases',
    }
    expect(resolveKnowledgeBlobsDir(root, env)).toBe('/tmp/blobs')
    expect(resolveKnowledgeReleasesDir(root, env)).toBe('/tmp/releases')
  })

  it('relative KNOWLEDGE_DB_PATH resolves against cwd', () => {
    const env = { KNOWLEDGE_DB_PATH: 'rel-k.db' }
    expect(resolveKnowledgeDbPath(root, env)).toBe(
      path.resolve(process.cwd(), 'rel-k.db'),
    )
  })

  it('resolveSchemaPath honors KNOWLEDGE_SCHEMA_PATH', () => {
    expect(resolveSchemaPath(root, {})).toMatch(/knowledge-schema\.sql$/)
    expect(resolveSchemaPath(root, { KNOWLEDGE_SCHEMA_PATH: '/tmp/s.sql' })).toBe(
      '/tmp/s.sql',
    )
  })

  it('ensureLiveKnowledgeDirs creates data/blobs/releases under a temp root', () => {
    const created: string[] = []
    const dataDir = '/tmp/ww-k15-test-data'
    const result = ensureLiveKnowledgeDirs(dataDir, ((p: string) => {
      created.push(p)
      return p
    }) as typeof import('node:fs').mkdirSync)
    expect(result.dataDir).toBe(dataDir)
    expect(result.dbPath).toBe(path.join(dataDir, 'knowledge.db'))
    expect(result.blobsDir).toBe(path.join(dataDir, 'knowledge-blobs'))
    expect(result.releasesDir).toBe(path.join(dataDir, 'knowledge-releases'))
    expect(created).toContain(dataDir)
    expect(created).toContain(result.blobsDir)
    expect(created).toContain(result.releasesDir)
  })

  it('live path constants are stable contract', () => {
    expect(LIVE_KNOWLEDGE_DATA_DIR).toBe('/var/lib/waveworld')
    expect(liveKnowledgeDbPath()).toBe('/var/lib/waveworld/knowledge.db')
    expect(liveKnowledgeBlobsDir()).toBe('/var/lib/waveworld/knowledge-blobs')
    expect(liveKnowledgeReleasesDir()).toBe('/var/lib/waveworld/knowledge-releases')
  })
})

describe('resolveSafeKnowledgeBlobPath (K17)', () => {
  it('builds sha prefix layout under blobs root', () => {
    const dig = 'a'.repeat(64)
    const p = resolveSafeKnowledgeBlobPath(dig, '/tmp/kb')
    expect(p).toBe(path.join('/tmp/kb', 'aa', dig))
  })

  it('rejects non-hex, short digests, and traversal attempts', () => {
    expect(() => resolveSafeKnowledgeBlobPath('not-hex')).toThrow(/blob_path_unsafe/)
    expect(() => resolveSafeKnowledgeBlobPath('ab')).toThrow(/blob_path_unsafe/)
    expect(() => resolveSafeKnowledgeBlobPath('../' + 'a'.repeat(61))).toThrow(
      /blob_path_unsafe/,
    )
    expect(() => resolveSafeKnowledgeBlobPath('a'.repeat(63) + '/')).toThrow(
      /blob_path_unsafe/,
    )
  })
})
