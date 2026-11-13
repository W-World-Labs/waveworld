import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  OfflinePipelineError,
  runOfflinePublishAndWrite,
  runOfflinePublishPipeline,
} from './offlinePipeline'
import { loadKnowledgeRelease, listKnowledgeReleaseIds } from './store/releaseStore'
import { verifyKnowledgeRelease } from './release'
import { sha256Hex } from './hash'
import type { Claim, EvidenceBinding, SourceSnapshot } from './types'
import { KNOWLEDGE_CONTRACT_VERSION } from './types'

const GATE_AT = '2026-08-04T15:00:00.000Z'
const RELEASED_AT = '2026-08-04T18:00:00.000Z'

async function snap(id: string, body: string): Promise<SourceSnapshot> {
  const bytes = new TextEncoder().encode(body)
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id,
    locator: `https://example.test/${id}`,
    locatorKind: 'url',
    capturedAt: '2026-08-04T12:00:00.000Z',
    contentSha256: await sha256Hex(bytes),
    captureStatus: 'bytes-captured',
    contentType: 'text/plain',
    byteLength: bytes.byteLength,
    provider: 'manual',
  }
}

function effClaim(
  id: string,
  subjectId: string,
  value: number,
  confidence = 0.8,
): Claim {
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id,
    kind: 'conversion.efficiency',
    subjectId,
    statement: { metric: 'eta', value, unit: '1' },
    state: 'candidate',
    confidence,
    createdAt: '2026-08-04T12:00:00.000Z',
  }
}

function binding(id: string, claimId: string, sourceSnapshotId: string): EvidenceBinding {
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id,
    claimId,
    sourceSnapshotId,
    support: 'supports',
    locator: { path: 'text', quote: 'eta' },
  }
}

describe('offline publish pipeline (#48-N)', () => {
  it('gates candidates then publishes multi-subject release', async () => {
    const s1 = await snap('snap-a', 'body-a')
    const s2 = await snap('snap-b', 'body-b')
    const s3 = await snap('snap-c', 'body-c')
    const claims = [
      effClaim('cl-a', 'em-radio-to-electric-rectenna', 0.5),
      effClaim('cl-b', 'em-visible-to-electric-photovoltaic', 0.2),
      effClaim('cl-c', 'thermal-to-electric-thermoelectric', 0.1),
    ]
    const bindings = [
      binding('eb-a', 'cl-a', 'snap-a'),
      binding('eb-b', 'cl-b', 'snap-b'),
      binding('eb-c', 'cl-c', 'snap-c'),
    ]

    const a = await runOfflinePublishPipeline({
      releaseId: 'kr-offline-test',
      releasedAt: RELEASED_AT,
      gateAt: GATE_AT,
      fixture: { claims, evidenceBindings: bindings, sourceSnapshots: [s1, s2, s3] },
    })
    const b = await runOfflinePublishPipeline({
      releaseId: 'kr-offline-test',
      releasedAt: RELEASED_AT,
      gateAt: GATE_AT,
      fixture: { claims, evidenceBindings: bindings, sourceSnapshots: [s1, s2, s3] },
    })

    expect(a.release.claims).toHaveLength(3)
    expect(a.release.claims.every((c) => c.state === 'released')).toBe(true)
    expect(new Set(a.release.claims.map((c) => c.subjectId)).size).toBe(3)
    expect(a.gatedOutClaimIds).toEqual([])
    expect(a.publish.promotedClaimIds.sort()).toEqual(['cl-a', 'cl-b', 'cl-c'])
    expect(a.conflictSets).toEqual([])
    expect(a.release.conflictSets).toEqual([])
    expect(await verifyKnowledgeRelease(a.release)).toBeNull()
    expect(a.release.sha256).toBe(b.release.sha256)
  })

  it('auto-emits errata ConflictSet when same subject+kind disagree (C conflict seeds)', async () => {
    const s1 = await snap('snap-view-a', 'view-a-body')
    const s2 = await snap('snap-view-b', 'view-b-body')
    const a: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'cl-view-a',
      kind: 'other',
      subjectId: 'information-energy',
      statement: {
        source: 'offline.test',
        topic: 'Landauer / information is physical',
        note: 'viewpoint A',
      },
      state: 'candidate',
      confidence: 0.8,
      createdAt: '2026-08-04T12:00:00.000Z',
    }
    const b: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'cl-view-b',
      kind: 'other',
      subjectId: 'information-energy',
      statement: {
        source: 'offline.test',
        topic: 'information is abstract syntax',
        note: 'viewpoint B',
      },
      state: 'candidate',
      confidence: 0.8,
      createdAt: '2026-08-04T12:00:00.000Z',
    }
    const r = await runOfflinePublishPipeline({
      releaseId: 'kr-conflict-seed',
      releasedAt: RELEASED_AT,
      gateAt: GATE_AT,
      fixture: {
        claims: [a, b],
        evidenceBindings: [
          binding('eb-a', 'cl-view-a', 'snap-view-a'),
          binding('eb-b', 'cl-view-b', 'snap-view-b'),
        ],
        sourceSnapshots: [s1, s2],
      },
    })

    expect(r.release.claims).toHaveLength(2)
    expect(r.release.claims.every((c) => c.state === 'released')).toBe(true)
    expect(r.release.conflictSets).toHaveLength(1)
    const cs = r.release.conflictSets[0]!
    expect(cs.id).toBe('conflict:errata:cl-view-a+cl-view-b')
    expect([...cs.claimIds].sort()).toEqual(['cl-view-a', 'cl-view-b'])
    expect(cs.state).toBe('released')
    // Both viewpoints remain — no silent merge winner
    expect(r.release.claims.map((c) => c.id).sort()).toEqual(['cl-view-a', 'cl-view-b'])
    expect(await verifyKnowledgeRelease(r.release)).toBeNull()
  })

  it('excludes quarantine efficiency claims from publish set', async () => {
    const s1 = await snap('snap-ok', 'ok')
    const s2 = await snap('snap-bad', 'bad')
    const claims = [
      effClaim('cl-ok', 'em-radio-to-electric-rectenna', 0.4),
      effClaim('cl-bad', 'em-visible-to-electric-photovoltaic', 1.5), // first-law fail
    ]
    const bindings = [
      binding('eb-ok', 'cl-ok', 'snap-ok'),
      binding('eb-bad', 'cl-bad', 'snap-bad'),
    ]

    const r = await runOfflinePublishPipeline({
      releaseId: 'kr-partial',
      releasedAt: RELEASED_AT,
      gateAt: GATE_AT,
      fixture: { claims, evidenceBindings: bindings, sourceSnapshots: [s1, s2] },
    })

    expect(r.gatedOutClaimIds).toContain('cl-bad')
    expect(r.release.claims.map((c) => c.id)).toEqual(['cl-ok'])
    expect(r.publish.excludedClaimIds).toContain('cl-bad')
  })

  it('checkClaim reject path: schema-bad mechanism is quarantined (not published)', async () => {
    const s1 = await snap('snap-ok', 'ok-body')
    const s2 = await snap('snap-bad-mech', 'bad-mech-body')
    const ok: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'cl-mech-ok',
      kind: 'conversion.mechanism',
      subjectId: 'em-radio-to-electric-rectenna',
      statement: { mechanism: 'rectenna RF harvest' },
      state: 'candidate',
      confidence: 0.8,
      createdAt: '2026-08-04T12:00:00.000Z',
    }
    // Empty statement fails validateStatementForKind — efficiency-only gate
    // would have silently promoted non-efficiency candidates.
    const bad: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'cl-mech-bad',
      kind: 'conversion.mechanism',
      subjectId: 'em-visible-to-electric-photovoltaic',
      statement: { note: 'missing mechanism/source' },
      state: 'candidate',
      confidence: 0.9,
      createdAt: '2026-08-04T12:00:00.000Z',
    }
    const bindings = [
      binding('eb-mech-ok', 'cl-mech-ok', 'snap-ok'),
      binding('eb-mech-bad', 'cl-mech-bad', 'snap-bad-mech'),
    ]

    const r = await runOfflinePublishPipeline({
      releaseId: 'kr-checkclaim-reject',
      releasedAt: RELEASED_AT,
      gateAt: GATE_AT,
      fixture: {
        claims: [ok, bad],
        evidenceBindings: bindings,
        sourceSnapshots: [s1, s2],
      },
    })

    expect(r.gatedOutClaimIds).toContain('cl-mech-bad')
    expect(r.release.claims.map((c) => c.id)).toEqual(['cl-mech-ok'])
    expect(r.publish.excludedClaimIds).toContain('cl-mech-bad')
    const badGate = r.gateResults.find((g) => g.claim.id === 'cl-mech-bad')
    expect(badGate?.transitionedTo).toBe('quarantine')
    expect(badGate?.verdict.ok).toBe(false)
    expect(
      badGate?.verdict.reasons.some((x) => x.startsWith('statement:')),
    ).toBe(true)
  })

  it('checkClaim reject path: empty efficiency statement quarantined before publish', async () => {
    const s1 = await snap('snap-empty-eff', 'empty-eff')
    const bad: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'cl-empty-eff',
      kind: 'conversion.efficiency',
      subjectId: 'em-radio-to-electric-rectenna',
      statement: {},
      state: 'candidate',
      confidence: 0.9,
      createdAt: '2026-08-04T12:00:00.000Z',
    }
    const good = effClaim('cl-good-eff', 'thermal-to-electric-thermoelectric', 0.12)
    const bindings = [
      binding('eb-empty', 'cl-empty-eff', 'snap-empty-eff'),
      binding('eb-good', 'cl-good-eff', 'snap-empty-eff'),
    ]

    const r = await runOfflinePublishPipeline({
      releaseId: 'kr-empty-eff',
      releasedAt: RELEASED_AT,
      gateAt: GATE_AT,
      fixture: {
        claims: [bad, good],
        evidenceBindings: bindings,
        sourceSnapshots: [s1],
      },
    })

    expect(r.gatedOutClaimIds).toContain('cl-empty-eff')
    expect(r.release.claims.map((c) => c.id)).toEqual(['cl-good-eff'])
    const emptyGate = r.gateResults.find((g) => g.claim.id === 'cl-empty-eff')
    expect(emptyGate?.transitionedTo).toBe('quarantine')
    expect(
      emptyGate?.verdict.reasons.some(
        (x) => x.includes('statement:') || x.includes('need value'),
      ),
    ).toBe(true)
  })

  it('requires gateAt for determinism', async () => {
    await expect(
      runOfflinePublishPipeline({
        releaseId: 'kr-x',
        releasedAt: RELEASED_AT,
        gateAt: '',
        fixture: {
          claims: [effClaim('c', 's', 0.1)],
          evidenceBindings: [],
          sourceSnapshots: [],
        },
      }),
    ).rejects.toBeInstanceOf(OfflinePipelineError)
  })

  it('runOfflinePublishAndWrite persists release + fixed index', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ww-offline-pipe-'))
    const s1 = await snap('snap-w', 'write-body')
    const claims = [effClaim('cl-w', 'em-radio-to-electric-rectenna', 0.33)]
    const bindings = [binding('eb-w', 'cl-w', 'snap-w')]

    const r = await runOfflinePublishAndWrite(
      root,
      {
        releaseId: 'kr-write-1',
        releasedAt: RELEASED_AT,
        gateAt: GATE_AT,
        fixture: { claims, evidenceBindings: bindings, sourceSnapshots: [s1] },
      },
      { indexGeneratedAt: RELEASED_AT },
    )

    expect(r.file.endsWith(`${path.sep}release.json`)).toBe(true)
    const loaded = await loadKnowledgeRelease(root, 'kr-write-1')
    expect(loaded.sha256).toBe(r.release.sha256)
    expect(await listKnowledgeReleaseIds(root)).toEqual(['kr-write-1'])

    const index = JSON.parse(await readFile(r.indexPath, 'utf8')) as {
      generatedAt: string
      ids: string[]
    }
    expect(index.generatedAt).toBe(RELEASED_AT)
    expect(index.ids).toEqual(['kr-write-1'])
  })
})
