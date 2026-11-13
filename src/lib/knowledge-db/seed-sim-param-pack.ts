/**
 * K7: seed a released sim.param_pack (+ sim.material) into knowledge.db
 * so resolveJobSpecFromKnowledge works after seed-from-static / db-cli seed.
 *
 * Deterministic ids + fixed epoch → stable knowledge_releases.sha256.
 *
 * @see docs/knowledge-db.md §6 K7
 * @see EPIC #52
 */
import { buildKnowledgeRelease } from '../knowledge/release.ts'
import {
  KNOWLEDGE_CONTRACT_VERSION,
  type Claim,
  type EvidenceBinding,
  type KnowledgeRelease,
  type SourceSnapshot,
} from '../knowledge/types.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { persistKnowledgeReleaseToDb } from './publish-release.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

/** Stable seed release id (digest-stable when pack contents fixed). */
export const SEED_SIM_PARAM_PACK_RELEASE_ID =
  'kr-static-seed-sim-param-pack-v1'

/**
 * After efficiency seed epoch so ORDER BY released_at DESC picks this
 * release for default resolve-job (no releaseId).
 */
export const SEED_SIM_PARAM_PACK_RELEASED_AT = '2026-08-06T01:00:00.000Z'
export const SEED_SIM_PARAM_PACK_EPOCH = '2026-08-06T01:00:00.000Z'

export const SEED_LBM_PARAM_PACK_CLAIM_ID =
  'claim:sim.param_pack:lbm-d3q19:default'
export const SEED_LBM_PARAM_PACK_SUBJECT_ID = 'pack:lbm-d3q19:default'
export const SEED_LBM_JOB_KIND = 'lbm-d3q19'

export const SEED_AIR_MATERIAL_CLAIM_ID = 'claim:sim.material:air-std'
export const SEED_AIR_MATERIAL_SUBJECT_ID = 'mat:air-std'

export const SEED_SIM_PARAM_PACK_SNAPSHOT_ID = 'snap:seed-sim-param-pack-v1'
export const SEED_SIM_PARAM_PACK_BIND_PACK_ID = 'bind:seed-sim-param-pack-lbm'
export const SEED_SIM_PARAM_PACK_BIND_MAT_ID = 'bind:seed-sim-material-air'

/** Default LBM teaching parameters (authoritative seed, not npm fixtures). */
export const SEED_LBM_PARAM_PACK_PARAMETERS: Readonly<
  Record<string, unknown>
> = {
  inletVelocity: 0.05,
  fluidDensity: 1.0,
  fluidViscosity: 0.001,
  gridPreset: 'standard',
}

export const SEED_LBM_PARAM_PACK_UNITS: Readonly<Record<string, string>> = {
  inletVelocity: 'lu/ts',
  fluidDensity: 'lu',
  fluidViscosity: 'lu^2/ts',
}

export type SeedSimParamPackResult = {
  dbPath: string
  releaseId: string
  sha256: string
  packClaimId: string
  materialClaimId: string
  jobKind: string
  claimCount: number
}

/**
 * Build deterministic released KnowledgeRelease with one sim.param_pack
 * (lbm-d3q19) and one linked sim.material (air-std).
 */
export async function buildSeedSimParamPackRelease(options?: {
  releaseId?: string
  releasedAt?: string
  createdAt?: string
}): Promise<{
  release: KnowledgeRelease
  pack: Claim
  material: Claim
  snap: SourceSnapshot
}> {
  const createdAt = options?.createdAt ?? SEED_SIM_PARAM_PACK_EPOCH
  const releasedAt = options?.releasedAt ?? SEED_SIM_PARAM_PACK_RELEASED_AT
  const releaseId = options?.releaseId ?? SEED_SIM_PARAM_PACK_RELEASE_ID

  const snap: SourceSnapshot = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: SEED_SIM_PARAM_PACK_SNAPSHOT_ID,
    locator: 'waveworld://seed/sim-param-pack/lbm-d3q19-default',
    locatorKind: 'url',
    capturedAt: createdAt,
    contentSha256: 'e'.repeat(64),
    captureStatus: 'locator-only',
    provider: 'static-seed',
    title: 'Seed LBM-D3Q19 default param pack (K7)',
  }

  const pack: Claim = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: SEED_LBM_PARAM_PACK_CLAIM_ID,
    kind: 'sim.param_pack',
    subjectId: SEED_LBM_PARAM_PACK_SUBJECT_ID,
    statement: {
      kind: SEED_LBM_JOB_KIND,
      parameters: { ...SEED_LBM_PARAM_PACK_PARAMETERS },
      units: { ...SEED_LBM_PARAM_PACK_UNITS },
      conditions: { Re_approx: 100, source: 'static-seed-k7' },
    },
    state: 'released',
    confidence: 1,
    createdAt,
    updatedAt: releasedAt,
  }

  const material: Claim = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: SEED_AIR_MATERIAL_CLAIM_ID,
    kind: 'sim.material',
    subjectId: SEED_AIR_MATERIAL_SUBJECT_ID,
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
    createdAt,
    updatedAt: releasedAt,
  }

  const packBind: EvidenceBinding = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: SEED_SIM_PARAM_PACK_BIND_PACK_ID,
    claimId: pack.id,
    sourceSnapshotId: snap.id,
    support: 'supports',
    locator: { path: '$.title' },
    note: 'K7 static seed sim.param_pack',
  }
  const matBind: EvidenceBinding = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: SEED_SIM_PARAM_PACK_BIND_MAT_ID,
    claimId: material.id,
    sourceSnapshotId: snap.id,
    support: 'supports',
    locator: { path: '$.title' },
    note: 'K7 static seed sim.material',
  }

  const release = await buildKnowledgeRelease({
    id: releaseId,
    releasedAt,
    claims: [pack, material],
    evidenceBindings: [packBind, matBind],
    sourceSnapshots: [snap],
    conflictSets: [],
  })

  return { release, pack, material, snap }
}

/**
 * Persist seed sim.param_pack release into an open DB (idempotent upsert).
 */
export function persistSeedSimParamPackToDb(
  db: Parameters<typeof persistKnowledgeReleaseToDb>[0],
  release: KnowledgeRelease,
): ReturnType<typeof persistKnowledgeReleaseToDb> {
  return persistKnowledgeReleaseToDb(db, {
    release,
    meta: {
      source: 'seed-sim-param-pack',
      jobKind: SEED_LBM_JOB_KIND,
      packClaimId: SEED_LBM_PARAM_PACK_CLAIM_ID,
      materialClaimId: SEED_AIR_MATERIAL_CLAIM_ID,
    },
    createdAt: SEED_SIM_PARAM_PACK_EPOCH,
  })
}

/**
 * Open/migrate DB and publish seed sim.param_pack + sim.material release.
 */
export async function seedSimParamPackReleaseSync(options?: {
  dbPath?: string
  root?: string
  skipMigrate?: boolean
}): Promise<SeedSimParamPackResult> {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)

  if (!options?.skipMigrate) {
    migrateKnowledgeDb({ dbPath, root })
  }

  const { release, pack, material } = await buildSeedSimParamPackRelease()
  const db = openKnowledgeDb({ dbPath, root })
  try {
    const persisted = persistSeedSimParamPackToDb(db, release)
    return {
      dbPath,
      releaseId: release.id,
      sha256: release.sha256,
      packClaimId: pack.id,
      materialClaimId: material.id,
      jobKind: SEED_LBM_JOB_KIND,
      claimCount: persisted.claimCount,
    }
  } finally {
    db.close()
  }
}
