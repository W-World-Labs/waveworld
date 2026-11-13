import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ReleaseStoreError,
  assertSafeReleaseId,
  listKnowledgeReleaseIds,
  loadKnowledgeRelease,
  writeKnowledgeRelease,
} from './releaseStore'
import { publishKnowledgeRelease } from '../publish/releasePublisher'
import type { Claim, EvidenceBinding, SourceSnapshot } from '../types'
import { KNOWLEDGE_CONTRACT_VERSION } from '../types'
import { sha256Hex } from '../hash'

async function fixtureRelease(id: string) {
  const locator = 'https://example.test/work/1'
  const snap: SourceSnapshot = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'src-1',
    locator,
    locatorKind: 'url',
    capturedAt: '2026-08-04T00:00:00.000Z',
    contentSha256: await sha256Hex(locator),
    captureStatus: 'bytes-captured',
    provider: 'test',
  }
  const claim: Claim = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'cl-1',
    kind: 'conversion.mechanism',
    subjectId: 'sub',
    statement: { mechanism: 'test' },
    state: 'validated',
    confidence: 0.9,
    createdAt: '2026-08-04T00:00:00.000Z',
  }
  const binding: EvidenceBinding = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'eb-1',
    claimId: 'cl-1',
    sourceSnapshotId: 'src-1',
    support: 'supports',
  }
  const { release } = await publishKnowledgeRelease({
    id,
    releasedAt: '2026-08-04T12:00:00.000Z',
    claims: [claim],
    evidenceBindings: [binding],
    sourceSnapshots: [snap],
  })
  return release
}

describe('release store (#48-F)', () => {
  it('assertSafeReleaseId rejects traversal', () => {
    expect(() => assertSafeReleaseId('../etc')).toThrow(ReleaseStoreError)
    expect(() => assertSafeReleaseId('a/b')).toThrow(ReleaseStoreError)
    expect(() => assertSafeReleaseId('')).toThrow(ReleaseStoreError)
    expect(() => assertSafeReleaseId('kr-2026-ok')).not.toThrow()
  })

  it('write + load roundtrip with verify', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ww-kr-'))
    const release = await fixtureRelease('kr-roundtrip-1')
    const { file } = await writeKnowledgeRelease(root, release)
    expect(file.endsWith(`${path.sep}release.json`)).toBe(true)

    const loaded = await loadKnowledgeRelease(root, 'kr-roundtrip-1')
    expect(loaded.sha256).toBe(release.sha256)
    expect(loaded.claims).toHaveLength(1)
    expect(loaded.claims[0]!.state).toBe('released')

    const ids = await listKnowledgeReleaseIds(root)
    expect(ids).toEqual(['kr-roundtrip-1'])

    const sidecar = await readFile(path.join(root, 'kr-roundtrip-1', 'sha256'), 'utf8')
    expect(sidecar.trim()).toBe(release.sha256)
  })

  it('negative: missing release', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ww-kr-'))
    await expect(loadKnowledgeRelease(root, 'nope')).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('negative: tampered digest fails verify', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ww-kr-'))
    const release = await fixtureRelease('kr-tamper')
    await writeKnowledgeRelease(root, release)
    const file = path.join(root, 'kr-tamper', 'release.json')
    const obj = JSON.parse(await readFile(file, 'utf8')) as { sha256: string }
    obj.sha256 = '0'.repeat(64)
    await writeFile(file, JSON.stringify(obj), 'utf8')
    await expect(loadKnowledgeRelease(root, 'kr-tamper')).rejects.toMatchObject({
      code: 'verify_failed',
    })
  })

  it('list ignores junk directories without release.json', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ww-kr-'))
    const release = await fixtureRelease('kr-only')
    await writeKnowledgeRelease(root, release)
    await writeFile(path.join(root, 'README'), 'nope', 'utf8')
    const ids = await listKnowledgeReleaseIds(root)
    expect(ids).toEqual(['kr-only'])
  })
})
