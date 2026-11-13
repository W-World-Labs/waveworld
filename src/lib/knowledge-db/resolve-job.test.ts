/**
 * K6: resolveJobSpecFromKnowledge — happy path + missing pack.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acceptJobSpec } from '@w-sim/contracts'
import { buildKnowledgeRelease } from '../knowledge/release.ts'
import {
  KNOWLEDGE_CONTRACT_VERSION,
  type Claim,
  type EvidenceBinding,
  type SourceSnapshot,
} from '../knowledge/types.ts'
import { migrateKnowledgeDb } from './migrate.ts'
import { persistKnowledgeReleaseToDb } from './publish-release.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere } from './paths.ts'
import {
  resolveJobErrorStatus,
  resolveJobSpecFromKnowledge,
} from './resolve-job.ts'

const root = repoRootFromHere()
const temps: string[] = []

afterEach(() => {
  for (const p of temps) {
    try {
      fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(p + suffix)
      } catch {
        /* ignore */
      }
    }
  }
  temps.length = 0
})

function tempDb(): string {
  const p = path.join(
    os.tmpdir(),
    `waveworld-knowledge-resolve-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

const EPOCH = '2026-08-06T06:00:00.000Z'

async function seedPackRelease(opts?: {
  includeMaterial?: boolean
  packKind?: string
  parameters?: Record<string, unknown>
  releaseId?: string
}) {
  const packKind = opts?.packKind ?? 'lbm-d3q19'
  const snap: SourceSnapshot = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'snap-k6-pack',
    locator: 'https://example.org/k6-lbm-defaults',
    locatorKind: 'url',
    capturedAt: EPOCH,
    contentSha256: 'c'.repeat(64),
    captureStatus: 'locator-only',
    provider: 'fixture',
    title: 'K6 LBM defaults',
  }

  const pack: Claim = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'claim-k6-param-pack-lbm',
    kind: 'sim.param_pack',
    subjectId: `pack:${packKind}:default`,
    statement: {
      kind: packKind,
      parameters: opts?.parameters ?? {
        inletVelocity: 0.05,
        fluidDensity: 1.0,
        fluidViscosity: 0.001,
        gridPreset: 'standard',
      },
      units: {
        inletVelocity: 'lu/ts',
        fluidDensity: 'lu',
        fluidViscosity: 'lu^2/ts',
      },
      conditions: { Re_approx: 100 },
    },
    state: 'released',
    confidence: 1,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  }

  const bind: EvidenceBinding = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: 'bind-k6-pack',
    claimId: pack.id,
    sourceSnapshotId: snap.id,
    support: 'supports',
    locator: { path: '$.title' },
  }

  const claims: Claim[] = [pack]
  const bindings: EvidenceBinding[] = [bind]
  let material: Claim | undefined

  if (opts?.includeMaterial) {
    material = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'claim-k6-material-air',
      kind: 'sim.material',
      subjectId: 'mat:air-std',
      statement: {
        materialId: 'air-std',
        properties: [
          { key: 'fluidDensity', value: 1.225, unit: 'kg/m^3' },
          { key: 'fluidViscosity', value: 1.81e-5, unit: 'Pa·s' },
        ],
        conditions: { T_K: 288.15 },
      },
      state: 'released',
      confidence: 1,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    }
    claims.push(material)
    bindings.push({
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'bind-k6-mat',
      claimId: material.id,
      sourceSnapshotId: snap.id,
      support: 'supports',
      locator: { path: '$.title' },
    })
  }

  const release = await buildKnowledgeRelease({
    id: opts?.releaseId ?? 'kr-k6-param-pack-fixture',
    releasedAt: EPOCH,
    claims,
    evidenceBindings: bindings,
    sourceSnapshots: [snap],
    conflictSets: [],
  })

  return { release, pack, material, snap }
}

describe('resolveJobSpecFromKnowledge (K6)', () => {
  it('happy path: released sim.param_pack → JobSpec + provenance', async () => {
    const { release, pack } = await seedPackRelease({ includeMaterial: true })
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const db = openKnowledgeDb({ dbPath, root })
    try {
      persistKnowledgeReleaseToDb(db, { release })
    } finally {
      db.close()
    }

    const result = resolveJobSpecFromKnowledge(
      {
        kind: 'lbm-d3q19',
        releaseId: release.id,
        materialClaimIds: ['claim-k6-material-air'],
        overrides: {
          parameters: { inletVelocity: 0.08 },
          name: 'k6-resolved-lbm',
        },
      },
      { dbPath, root },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.jobSpec.schemaVersion).toBe(1)
    expect(result.jobSpec.kind).toBe('lbm-d3q19')
    expect(result.jobSpec.name).toBe('k6-resolved-lbm')
    expect(result.jobSpec.parameters.inletVelocity).toBe(0.08) // override wins
    expect(result.jobSpec.parameters.fluidDensity).toBe(1.0) // pack default
    expect(result.jobSpec.parameters.gridPreset).toBe('standard')
    expect(result.jobSpec.run.maxSteps).toBeGreaterThanOrEqual(1)
    expect(result.jobSpec.outputs).toBeTruthy()

    expect(result.provenance.knowledgeDbReleaseId).toBe(release.id)
    expect(result.provenance.packClaimId).toBe(pack.id)
    expect(result.provenance.claimIds).toEqual([
      pack.id,
      'claim-k6-material-air',
    ])
    expect(result.provenance.materialClaimIds).toEqual([
      'claim-k6-material-air',
    ])
    expect(result.provenance.paramOverrideKeys).toEqual(['inletVelocity'])

    // Nested materials bag from sim.material claim
    const materials = result.jobSpec.parameters.materials as Record<
      string,
      unknown
    >
    expect(materials['air-std']).toBeTruthy()

    const accepted = acceptJobSpec(result.jobSpec)
    expect(accepted.ok).toBe(true)
  })

  it('resolves by packClaimId and latest release when releaseId omitted', async () => {
    const { release, pack } = await seedPackRelease()
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const db = openKnowledgeDb({ dbPath, root })
    try {
      persistKnowledgeReleaseToDb(db, { release })
    } finally {
      db.close()
    }

    const result = resolveJobSpecFromKnowledge(
      {
        kind: 'lbm-d3q19',
        refs: { packClaimId: pack.id },
      },
      { dbPath, root },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.provenance.knowledgeDbReleaseId).toBe(release.id)
    expect(result.provenance.packClaimId).toBe(pack.id)
    expect(result.jobSpec.parameters.inletVelocity).toBe(0.05)
  })

  it('missing pack → ok:false code missing_pack', async () => {
    // Release with only a non-pack claim
    const snap: SourceSnapshot = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'snap-k6-nopack',
      locator: 'https://example.org/k6-nopack',
      locatorKind: 'url',
      capturedAt: EPOCH,
      contentSha256: 'd'.repeat(64),
      captureStatus: 'locator-only',
      provider: 'fixture',
    }
    const other: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'claim-k6-other',
      kind: 'other',
      subjectId: 'x',
      statement: { note: 'no pack' },
      state: 'released',
      createdAt: EPOCH,
    }
    const release = await buildKnowledgeRelease({
      id: 'kr-k6-no-pack',
      releasedAt: EPOCH,
      claims: [other],
      evidenceBindings: [],
      sourceSnapshots: [snap],
      conflictSets: [],
    })

    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const db = openKnowledgeDb({ dbPath, root })
    try {
      persistKnowledgeReleaseToDb(db, { release })
    } finally {
      db.close()
    }

    const result = resolveJobSpecFromKnowledge(
      { kind: 'lbm-d3q19', releaseId: release.id },
      { dbPath, root },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('missing_pack')
    expect(result.message).toMatch(/param_pack/)
    expect(resolveJobErrorStatus(result.code)).toBe(404)
  })

  it('missing release → missing_release', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const result = resolveJobSpecFromKnowledge(
      { kind: 'lbm-d3q19' },
      { dbPath, root },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('missing_release')
    expect(resolveJobErrorStatus(result.code)).toBe(404)
  })

  it('pack kind mismatch → pack_kind_mismatch', async () => {
    const { release, pack } = await seedPackRelease({
      packKind: 'thermal-3d-steady',
      parameters: { ambientTemp: 300, powerW: 10 },
    })
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const db = openKnowledgeDb({ dbPath, root })
    try {
      persistKnowledgeReleaseToDb(db, { release })
    } finally {
      db.close()
    }

    const result = resolveJobSpecFromKnowledge(
      {
        kind: 'lbm-d3q19',
        packClaimId: pack.id,
        releaseId: release.id,
      },
      { dbPath, root },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('pack_kind_mismatch')
    expect(resolveJobErrorStatus(result.code)).toBe(400)
  })

  it('explicit missing packClaimId → missing_pack', async () => {
    const { release } = await seedPackRelease()
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const db = openKnowledgeDb({ dbPath, root })
    try {
      persistKnowledgeReleaseToDb(db, { release })
    } finally {
      db.close()
    }

    const result = resolveJobSpecFromKnowledge(
      {
        kind: 'lbm-d3q19',
        releaseId: release.id,
        packClaimId: 'claim-does-not-exist',
      },
      { dbPath, root },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('missing_pack')
  })
})
