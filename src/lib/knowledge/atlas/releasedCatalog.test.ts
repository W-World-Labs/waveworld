import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assertReleasedClaim,
  claimsByKind,
  exportLatestReleasedConflictVisibility,
  exportReleasedConflictVisibility,
  listReleasedIds,
  loadLatestReleased,
  loadReleased,
  releaseMeta,
  resolveKnowledgeReleasesRoot,
  summarizeReleasedCatalog,
  DEFAULT_KNOWLEDGE_RELEASES_REL,
  KNOWLEDGE_RELEASES_DIR_ENV,
} from './releasedCatalog'
import { emitConflictSetsFromClaims } from '../conflictVisibility'
import { writeKnowledgeRelease } from '../store/releaseStore'
import { publishKnowledgeRelease } from '../publish/releasePublisher'
import type { Claim, EvidenceBinding, SourceSnapshot } from '../types'
import { KNOWLEDGE_CONTRACT_VERSION } from '../types'
import { sha256Hex } from '../hash'
import { ReleaseStoreError } from '../store/releaseStore'

async function putRelease(root: string, id: string) {
  const locator = `https://example.test/${id}`
  const snap: SourceSnapshot = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: `src-${id}`,
    locator,
    locatorKind: 'url',
    capturedAt: '2026-08-04T00:00:00.000Z',
    contentSha256: await sha256Hex(locator),
    captureStatus: 'bytes-captured',
    provider: 'test',
  }
  const claim: Claim = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: `cl-${id}`,
    kind: 'conversion.mechanism',
    subjectId: 'sub',
    statement: { mechanism: id },
    state: 'validated',
    confidence: 0.9,
    createdAt: '2026-08-04T00:00:00.000Z',
  }
  const binding: EvidenceBinding = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: `eb-${id}`,
    claimId: claim.id,
    sourceSnapshotId: snap.id,
    support: 'supports',
  }
  const { release } = await publishKnowledgeRelease({
    id,
    releasedAt: '2026-08-04T12:00:00.000Z',
    claims: [claim],
    evidenceBindings: [binding],
    sourceSnapshots: [snap],
  })
  await writeKnowledgeRelease(root, release)
  return release
}

describe('Atlas released catalog (#48-G)', () => {
  it('resolveKnowledgeReleasesRoot prefers explicit root then env', () => {
    const cwd = '/tmp/ww-root'
    expect(resolveKnowledgeReleasesRoot({ cwd, root: 'rel/path' })).toBe(
      path.resolve(cwd, 'rel/path'),
    )
    const prev = process.env[KNOWLEDGE_RELEASES_DIR_ENV]
    process.env[KNOWLEDGE_RELEASES_DIR_ENV] = '/abs/kr'
    try {
      expect(resolveKnowledgeReleasesRoot({ cwd })).toBe('/abs/kr')
    } finally {
      if (prev === undefined) delete process.env[KNOWLEDGE_RELEASES_DIR_ENV]
      else process.env[KNOWLEDGE_RELEASES_DIR_ENV] = prev
    }
    delete process.env[KNOWLEDGE_RELEASES_DIR_ENV]
    expect(resolveKnowledgeReleasesRoot({ cwd })).toBe(
      path.resolve(cwd, DEFAULT_KNOWLEDGE_RELEASES_REL),
    )
  })

  it('list / load / latest / summarize', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ww-atlas-'))
    await putRelease(root, 'kr-a')
    await putRelease(root, 'kr-b')

    const ids = await listReleasedIds({ root })
    expect(ids).toEqual(['kr-a', 'kr-b'])

    const one = await loadReleased('kr-a', { root })
    expect(one.id).toBe('kr-a')
    expect(one.claims[0]!.state).toBe('released')

    const latest = await loadLatestReleased({ root })
    expect(latest?.id).toBe('kr-b')

    const sum = await summarizeReleasedCatalog({ root })
    expect(sum.root).toBe(path.resolve(root))
    expect(sum.ids).toEqual(['kr-a', 'kr-b'])
    expect(sum.latest?.id).toBe('kr-b')
    expect(sum.latest?.claimCount).toBe(1)
    expect(sum.latest?.sha256).toMatch(/^[a-f0-9]{64}$/)

    const mechs = claimsByKind(one, 'conversion.mechanism')
    expect(mechs).toHaveLength(1)
    expect(releaseMeta(one).bindingCount).toBe(1)
    expect(releaseMeta(one).conflictCount).toBe(0)
  })

  it('empty store returns null latest', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ww-atlas-empty-'))
    expect(await loadLatestReleased({ root })).toBeNull()
    const sum = await summarizeReleasedCatalog({ root })
    expect(sum.ids).toEqual([])
    expect(sum.latest).toBeNull()
    expect(await exportLatestReleasedConflictVisibility({ root })).toBeNull()
  })

  it('assertReleasedClaim rejects non-released', () => {
    const bad: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'x',
      kind: 'other',
      subjectId: 's',
      statement: {},
      state: 'candidate',
      createdAt: '2026-08-04T00:00:00.000Z',
    }
    expect(() => assertReleasedClaim(bad)).toThrow(ReleaseStoreError)
  })

  it('exportReleasedConflictVisibility loads disk release → ConflictSet export (C4 CLI path)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ww-atlas-c4-'))
    const a: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'c4-a',
      kind: 'conversion.efficiency',
      subjectId: 'edge-x',
      statement: { metric: 'eta', value: 0.1, unit: '1' },
      state: 'validated',
      confidence: 0.8,
      createdAt: '2026-08-06T03:00:00.000Z',
    }
    const b: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'c4-b',
      kind: 'conversion.efficiency',
      subjectId: 'edge-x',
      statement: { metric: 'eta', value: 0.9, unit: '1' },
      state: 'validated',
      confidence: 0.8,
      createdAt: '2026-08-06T03:00:00.000Z',
    }
    const { conflictSets } = emitConflictSetsFromClaims([a, b], { state: 'validated' })
    const { release } = await publishKnowledgeRelease({
      id: 'kr-c4-cli',
      releasedAt: '2026-08-06T05:00:00.000Z',
      claims: [a, b],
      evidenceBindings: [],
      sourceSnapshots: [],
      conflictSets,
    })
    await writeKnowledgeRelease(root, release)

    const exp = await exportReleasedConflictVisibility('kr-c4-cli', { root })
    expect(exp.releaseId).toBe('kr-c4-cli')
    expect(exp.sha256).toBe(release.sha256)
    expect(exp.conflictCount).toBe(1)
    expect(exp.conflicts[0]!.claimIds).toEqual(['c4-a', 'c4-b'])
    expect(exp.conflicts[0]!.kind).toBe('errata')
    expect(exp.conflicts[0]!.subjectIds).toEqual(['edge-x'])

    expect(releaseMeta(release).conflictCount).toBe(1)

    const latest = await exportLatestReleasedConflictVisibility({ root })
    expect(latest?.releaseId).toBe('kr-c4-cli')
    expect(latest?.conflicts[0]!.claimIds).toEqual(['c4-a', 'c4-b'])
  })
})
