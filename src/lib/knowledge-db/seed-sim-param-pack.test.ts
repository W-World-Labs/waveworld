/**
 * K7: seed sim.param_pack release → resolveJobSpecFromKnowledge succeeds.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acceptJobSpec } from '@w-sim/contracts'
import { verifyKnowledgeRelease } from '../knowledge/release.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere } from './paths.ts'
import { resolveJobSpecFromKnowledge } from './resolve-job.ts'
import {
  SEED_AIR_MATERIAL_CLAIM_ID,
  SEED_LBM_JOB_KIND,
  SEED_LBM_PARAM_PACK_CLAIM_ID,
  SEED_SIM_PARAM_PACK_RELEASE_ID,
  buildSeedSimParamPackRelease,
  seedSimParamPackReleaseSync,
} from './seed-sim-param-pack.ts'

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
    `waveworld-knowledge-sim-pack-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('seed-sim-param-pack (K7)', () => {
  it('buildSeedSimParamPackRelease is deterministic + verifyable', async () => {
    const a = await buildSeedSimParamPackRelease()
    const b = await buildSeedSimParamPackRelease()
    expect(a.release.id).toBe(SEED_SIM_PARAM_PACK_RELEASE_ID)
    expect(a.release.sha256).toBe(b.release.sha256)
    expect(a.release.sha256).toHaveLength(64)
    expect(a.pack.id).toBe(SEED_LBM_PARAM_PACK_CLAIM_ID)
    expect(a.material.id).toBe(SEED_AIR_MATERIAL_CLAIM_ID)
    expect(await verifyKnowledgeRelease(a.release)).toBeNull()
  })

  it('seed publishes release; resolveJobSpecFromKnowledge succeeds', async () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const seeded = await seedSimParamPackReleaseSync({
      dbPath,
      root,
      skipMigrate: true,
    })

    expect(seeded.releaseId).toBe(SEED_SIM_PARAM_PACK_RELEASE_ID)
    expect(seeded.packClaimId).toBe(SEED_LBM_PARAM_PACK_CLAIM_ID)
    expect(seeded.sha256).toHaveLength(64)
    expect(seeded.claimCount).toBe(2)

    const db = openKnowledgeDb({ dbPath, root })
    try {
      const packs = db
        .prepare(
          `SELECT COUNT(*) AS c FROM claims
           WHERE kind = 'sim.param_pack' AND state = 'released'`,
        )
        .get() as { c: number }
      expect(packs.c).toBeGreaterThanOrEqual(1)
      const mats = db
        .prepare(
          `SELECT COUNT(*) AS c FROM claims
           WHERE kind = 'sim.material' AND state = 'released'`,
        )
        .get() as { c: number }
      expect(mats.c).toBeGreaterThanOrEqual(1)
      const rel = db
        .prepare(
          `SELECT sha256 FROM knowledge_releases WHERE id = ?`,
        )
        .get(SEED_SIM_PARAM_PACK_RELEASE_ID) as { sha256: string }
      expect(rel.sha256).toBe(seeded.sha256)
    } finally {
      db.close()
    }

    const result = resolveJobSpecFromKnowledge(
      {
        kind: SEED_LBM_JOB_KIND,
        // default latest release should be the param-pack seed
        materialClaimIds: [SEED_AIR_MATERIAL_CLAIM_ID],
      },
      { dbPath, root },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.provenance.knowledgeDbReleaseId).toBe(
      SEED_SIM_PARAM_PACK_RELEASE_ID,
    )
    expect(result.provenance.packClaimId).toBe(SEED_LBM_PARAM_PACK_CLAIM_ID)
    expect(result.jobSpec.kind).toBe(SEED_LBM_JOB_KIND)
    expect(result.jobSpec.parameters.inletVelocity).toBe(0.05)
    expect(result.jobSpec.parameters.gridPreset).toBe('standard')

    const accepted = acceptJobSpec(result.jobSpec)
    expect(accepted.ok).toBe(true)
  })

  it('re-seed is idempotent (stable sha256 + claim count)', async () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const first = await seedSimParamPackReleaseSync({
      dbPath,
      root,
      skipMigrate: true,
    })
    const second = await seedSimParamPackReleaseSync({
      dbPath,
      root,
      skipMigrate: true,
    })
    expect(second.sha256).toBe(first.sha256)
    expect(second.releaseId).toBe(first.releaseId)

    const db = openKnowledgeDb({ dbPath, root })
    try {
      const packs = db
        .prepare(
          `SELECT COUNT(*) AS c FROM claims WHERE id = ?`,
        )
        .get(SEED_LBM_PARAM_PACK_CLAIM_ID) as { c: number }
      expect(packs.c).toBe(1)
    } finally {
      db.close()
    }
  })

  it('resolve by explicit packClaimId + releaseId', async () => {
    const dbPath = tempDb()
    await seedSimParamPackReleaseSync({ dbPath, root })
    const result = resolveJobSpecFromKnowledge(
      {
        kind: SEED_LBM_JOB_KIND,
        releaseId: SEED_SIM_PARAM_PACK_RELEASE_ID,
        packClaimId: SEED_LBM_PARAM_PACK_CLAIM_ID,
      },
      { dbPath, root },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.provenance.packClaimId).toBe(SEED_LBM_PARAM_PACK_CLAIM_ID)
  })
})
