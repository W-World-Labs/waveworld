/**
 * K6: resolve released sim.param_pack / sim.material from knowledge.db
 * into a JobSpec-shaped payload with provenance.
 *
 * w-sim never opens knowledge.db — this is the WaveWorld assembly point.
 *
 * @see docs/knowledge-db.md §5.3
 * @see docs/platform-layers.md §2.3 resolveJob
 * @see EPIC #52 K6
 */
import { acceptJobSpec, defaultJobSpec, type JobSpecV1 } from '@w-sim/contracts'
import { MODULE_JOB_KIND, registeredModuleJobKindValidator } from '../sim/module-compute.ts'
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'
import {
  claimRowToReleasedDto,
  type ReadDbOptions,
  type ReleasedClaimDto,
} from './read.ts'

export type ResolveJobRefs = {
  /** Explicit sim.param_pack claim id (preferred when known). */
  packClaimId?: string
  /** Lookup pack by claims.subject_id when packClaimId omitted. */
  packSubjectId?: string
  /** Optional sim.material claim ids to attach. */
  materialClaimIds?: string[]
}

export type ResolveJobOverrides = {
  parameters?: Record<string, unknown>
  run?: {
    maxSteps?: number
    forceSampleEvery?: number
    warmupSteps?: number
    stopWhen?: { maxCdVariance?: number; window?: number }
  }
  name?: string
  model?: Record<string, unknown>
  outputs?: Record<string, unknown>
  requirements?: Record<string, unknown>
  experiment?: Record<string, unknown>
  workspaceId?: string
}

export type ResolveJobInput = {
  /** Job / sim kind (must match pack statement.kind when pack is found by kind scan). */
  kind: string
  /** Pin a knowledge release; default = latest released by released_at. */
  releaseId?: string
  /** Direct pack / material refs (also accepted nested under `refs`). */
  packClaimId?: string
  packSubjectId?: string
  materialClaimIds?: string[]
  refs?: ResolveJobRefs
  overrides?: ResolveJobOverrides
  /**
   * When true (default), run @w-sim/contracts acceptJobSpec on the assembled envelope.
   * Set false for dry structural assembly without kind registry checks.
   */
  validate?: boolean
}

/** Provenance attached to JobResult / job meta (K6 contract). */
export type ResolveJobProvenance = {
  knowledgeDbReleaseId: string
  claimIds: string[]
  packClaimId: string
  materialClaimIds: string[]
  /** Keys present in overrides.parameters (caller-applied, not knowledge defaults). */
  paramOverrideKeys: string[]
}

/**
 * JobSpec-shaped payload. Compatible with @w-sim JobSpecV1 envelope fields.
 * Parameters remain an open bag at assembly time; acceptJobSpec enforces kind rules.
 */
export type ResolvedJobSpec = {
  schemaVersion: 1
  kind: string
  name?: string
  parameters: Record<string, unknown>
  run: {
    maxSteps: number
    forceSampleEvery?: number
    warmupSteps?: number
    stopWhen?: { maxCdVariance?: number; window?: number }
  }
  outputs: Record<string, unknown>
  model?: Record<string, unknown>
  requirements?: Record<string, unknown>
  experiment?: Record<string, unknown>
  workspaceId?: string
}

export type ResolveJobOk = {
  ok: true
  jobSpec: ResolvedJobSpec
  provenance: ResolveJobProvenance
  pack: ReleasedClaimDto
  materials: ReleasedClaimDto[]
}

export type ResolveJobErrorCode =
  | 'missing_kind'
  | 'missing_release'
  | 'missing_pack'
  | 'pack_kind_mismatch'
  | 'invalid_pack'
  | 'missing_material'
  | 'accept_failed'

export type ResolveJobErr = {
  ok: false
  code: ResolveJobErrorCode
  message: string
}

export type ResolveJobResult = ResolveJobOk | ResolveJobErr

type ClaimRow = {
  id: string
  contract_version: number
  kind: string
  subject_id: string
  statement_json: string
  state: string
  confidence: number | null
  created_at: string
  updated_at: string | null
}

type ReleaseHead = {
  id: string
  released_at: string
  state: string
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

function coerceParameters(
  raw: unknown,
): Record<string, unknown> {
  if (!isPlainObject(raw)) return {}
  return { ...raw }
}

function pickRelease(
  db: SqliteDatabase,
  releaseId: string | undefined,
): ReleaseHead | null {
  if (releaseId) {
    const row = db
      .prepare(
        `SELECT id, released_at, state FROM knowledge_releases
         WHERE id = ? AND state = 'released'`,
      )
      .get(releaseId) as ReleaseHead | undefined
    return row ?? null
  }
  const row = db
    .prepare(
      `SELECT id, released_at, state FROM knowledge_releases
       WHERE state = 'released'
       ORDER BY released_at DESC, id DESC
       LIMIT 1`,
    )
    .get() as ReleaseHead | undefined
  return row ?? null
}

function loadReleasedClaimInRelease(
  db: SqliteDatabase,
  releaseId: string,
  claimId: string,
): ReleasedClaimDto | null {
  const row = db
    .prepare(
      `SELECT c.* FROM claims c
       INNER JOIN release_claims rc ON rc.claim_id = c.id
       WHERE rc.release_id = ?
         AND c.id = ?
         AND c.state = 'released'`,
    )
    .get(releaseId, claimId) as ClaimRow | undefined
  return row ? claimRowToReleasedDto(row) : null
}

function findParamPack(
  db: SqliteDatabase,
  releaseId: string,
  opts: {
    packClaimId?: string
    packSubjectId?: string
    kind: string
  },
): ReleasedClaimDto | null {
  if (opts.packClaimId) {
    const byId = loadReleasedClaimInRelease(db, releaseId, opts.packClaimId)
    if (!byId) return null
    if (byId.kind !== 'sim.param_pack') return null
    return byId
  }

  if (opts.packSubjectId) {
    const row = db
      .prepare(
        `SELECT c.* FROM claims c
         INNER JOIN release_claims rc ON rc.claim_id = c.id
         WHERE rc.release_id = ?
           AND c.subject_id = ?
           AND c.kind = 'sim.param_pack'
           AND c.state = 'released'
         ORDER BY c.id
         LIMIT 1`,
      )
      .get(releaseId, opts.packSubjectId) as ClaimRow | undefined
    return row ? claimRowToReleasedDto(row) : null
  }

  // Default: first released sim.param_pack in release whose statement.kind matches job kind.
  const rows = db
    .prepare(
      `SELECT c.* FROM claims c
       INNER JOIN release_claims rc ON rc.claim_id = c.id
       WHERE rc.release_id = ?
         AND c.kind = 'sim.param_pack'
         AND c.state = 'released'
       ORDER BY c.id`,
    )
    .all(releaseId) as ClaimRow[]

  for (const row of rows) {
    const dto = claimRowToReleasedDto(row)
    const stKind = dto.statement.kind
    if (typeof stKind === 'string' && stKind === opts.kind) {
      return dto
    }
  }

  // Fallback: single pack only when statement.kind is empty or matches.
  if (rows.length === 1) {
    const dto = claimRowToReleasedDto(rows[0]!)
    const stKind = dto.statement.kind
    if (
      typeof stKind !== 'string'
      || stKind.length === 0
      || stKind === opts.kind
    ) {
      return dto
    }
  }
  return null
}

function loadMaterials(
  db: SqliteDatabase,
  releaseId: string,
  materialClaimIds: string[],
): { ok: true; materials: ReleasedClaimDto[] } | { ok: false; missing: string } {
  const materials: ReleasedClaimDto[] = []
  for (const id of materialClaimIds) {
    const dto = loadReleasedClaimInRelease(db, releaseId, id)
    if (!dto || dto.kind !== 'sim.material') {
      return { ok: false, missing: id }
    }
    materials.push(dto)
  }
  return { ok: true, materials }
}

function materialPropertiesBag(
  materials: ReleasedClaimDto[],
): Record<string, unknown> | undefined {
  if (materials.length === 0) return undefined
  const bag: Record<string, unknown> = {}
  for (const m of materials) {
    const materialId =
      typeof m.statement.materialId === 'string'
        ? m.statement.materialId
        : m.subjectId
    bag[materialId] = {
      claimId: m.id,
      properties: m.statement.properties ?? null,
      propertyRefs: m.statement.propertyRefs ?? null,
      conditions: m.statement.conditions ?? null,
    }
  }
  return bag
}

function assembleJobSpec(
  kind: string,
  parameters: Record<string, unknown>,
  overrides: ResolveJobOverrides | undefined,
): ResolvedJobSpec {
  // Seed envelope from w-sim defaults for known kinds (run/outputs/model shells).
  const base = defaultJobSpec({
    kind: kind as never,
    name: overrides?.name,
    workspaceId: overrides?.workspaceId,
    parameters: parameters as never,
    run: overrides?.run as never,
    outputs: overrides?.outputs as never,
    model: overrides?.model as never,
    requirements: overrides?.requirements as never,
    experiment: overrides?.experiment as never,
  }) as ResolvedJobSpec

  // defaultJobSpec already merged parameters for fluid kinds with DEFAULT_FLUID_*;
  // re-assert knowledge parameters as the knowledge defaults, then caller overrides.
  const mergedParams: Record<string, unknown> = {
    ...(isPlainObject(base.parameters) ? base.parameters : {}),
    ...parameters,
    ...(overrides?.parameters ?? {}),
  }

  const spec: ResolvedJobSpec = {
    schemaVersion: 1,
    kind,
    parameters: mergedParams,
    run: {
      maxSteps:
        overrides?.run?.maxSteps
        ?? (typeof base.run?.maxSteps === 'number' ? base.run.maxSteps : 2000),
      forceSampleEvery:
        overrides?.run?.forceSampleEvery ?? base.run?.forceSampleEvery,
      warmupSteps: overrides?.run?.warmupSteps ?? base.run?.warmupSteps,
      stopWhen: overrides?.run?.stopWhen ?? base.run?.stopWhen,
    },
    outputs: {
      ...(isPlainObject(base.outputs) ? base.outputs : { forces: true, history: true }),
      ...(overrides?.outputs ?? {}),
    },
  }
  if (overrides?.name ?? base.name) {
    spec.name = (overrides?.name ?? base.name) as string
  }
  if (overrides?.model ?? base.model) {
    spec.model = {
      ...(isPlainObject(base.model) ? base.model : {}),
      ...(overrides?.model ?? {}),
    }
  }
  if (overrides?.requirements ?? base.requirements) {
    spec.requirements = {
      ...(isPlainObject(base.requirements) ? base.requirements : {}),
      ...(overrides?.requirements ?? {}),
    }
  }
  if (overrides?.experiment ?? base.experiment) {
    spec.experiment = (overrides?.experiment ?? base.experiment) as Record<
      string,
      unknown
    >
  }
  if (overrides?.workspaceId ?? base.workspaceId) {
    spec.workspaceId = (overrides?.workspaceId ?? base.workspaceId) as string
  }
  return spec
}

/**
 * Core resolver: open DB → release → param_pack (+ materials) → JobSpec + provenance.
 */
export function resolveJobSpecFromKnowledge(
  input: ResolveJobInput,
  options?: ReadDbOptions,
): ResolveJobResult {
  const kind = typeof input.kind === 'string' ? input.kind.trim() : ''
  if (!kind) {
    return { ok: false, code: 'missing_kind', message: 'kind is required' }
  }

  const packClaimId = input.packClaimId ?? input.refs?.packClaimId
  const packSubjectId = input.packSubjectId ?? input.refs?.packSubjectId
  const materialClaimIds = [
    ...(input.materialClaimIds ?? []),
    ...(input.refs?.materialClaimIds ?? []),
  ].filter((id, i, arr) => id && arr.indexOf(id) === i)

  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const readonly = options?.readonly !== false
  const db = openKnowledgeDb({ dbPath, root, readonly })

  try {
    const release = pickRelease(db, input.releaseId)
    if (!release) {
      return {
        ok: false,
        code: 'missing_release',
        message: input.releaseId
          ? `knowledge release not found or not released: ${input.releaseId}`
          : 'no released knowledge_releases rows',
      }
    }

    const pack = findParamPack(db, release.id, {
      packClaimId,
      packSubjectId,
      kind,
    })
    if (!pack) {
      return {
        ok: false,
        code: 'missing_pack',
        message: packClaimId
          ? `sim.param_pack claim not in release ${release.id}: ${packClaimId}`
          : packSubjectId
            ? `sim.param_pack subject not in release ${release.id}: ${packSubjectId}`
            : `no released sim.param_pack for kind=${kind} in release ${release.id}`,
      }
    }

    if (pack.kind !== 'sim.param_pack') {
      return {
        ok: false,
        code: 'invalid_pack',
        message: `claim ${pack.id} is not sim.param_pack`,
      }
    }

    const stKind = pack.statement.kind
    if (typeof stKind === 'string' && stKind.length > 0 && stKind !== kind) {
      return {
        ok: false,
        code: 'pack_kind_mismatch',
        message: `param_pack statement.kind=${stKind} does not match requested kind=${kind}`,
      }
    }

    if (!isPlainObject(pack.statement.parameters)) {
      return {
        ok: false,
        code: 'invalid_pack',
        message: `sim.param_pack ${pack.id}: parameters object required`,
      }
    }

    const mats = loadMaterials(db, release.id, materialClaimIds)
    if (!mats.ok) {
      return {
        ok: false,
        code: 'missing_material',
        message: `sim.material claim not in release ${release.id}: ${mats.missing}`,
      }
    }

    const packParams = coerceParameters(pack.statement.parameters)
    const materialsBag = materialPropertiesBag(mats.materials)
    const parameters: Record<string, unknown> = {
      ...packParams,
    }
    if (materialsBag) {
      parameters.materials = materialsBag
    }
    // Optional pack-level units / conditions for runners that want them.
    if (isPlainObject(pack.statement.units)) {
      parameters._units = pack.statement.units
    }
    if (isPlainObject(pack.statement.conditions)) {
      parameters._conditions = pack.statement.conditions
    }

    const jobSpec = assembleJobSpec(kind, parameters, input.overrides)

    if (input.validate !== false) {
      const accepted = acceptJobSpec(jobSpec, jobSpec.kind === MODULE_JOB_KIND
        ? { registeredKindValidator: registeredModuleJobKindValidator(jobSpec as JobSpecV1) }
        : undefined)
      if (!accepted.ok) {
        return {
          ok: false,
          code: 'accept_failed',
          message: `acceptJobSpec: ${accepted.code}: ${accepted.message}`,
        }
      }
    }

    const claimIds = [pack.id, ...mats.materials.map((m) => m.id)]
    const paramOverrideKeys = Object.keys(input.overrides?.parameters ?? {})

    return {
      ok: true,
      jobSpec,
      provenance: {
        knowledgeDbReleaseId: release.id,
        claimIds,
        packClaimId: pack.id,
        materialClaimIds: mats.materials.map((m) => m.id),
        paramOverrideKeys,
      },
      pack,
      materials: mats.materials,
    }
  } finally {
    db.close()
  }
}

/**
 * Convenience for Host API: throw-style not used; returns result + HTTP mapping helpers.
 */
export function resolveJobErrorStatus(code: ResolveJobErrorCode): number {
  switch (code) {
    case 'missing_kind':
    case 'invalid_pack':
    case 'pack_kind_mismatch':
    case 'accept_failed':
      return 400
    case 'missing_release':
    case 'missing_pack':
    case 'missing_material':
      return 404
    default:
      return 400
  }
}
