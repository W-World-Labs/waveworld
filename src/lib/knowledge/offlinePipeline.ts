/**
 * #48-N/#48-O Offline publish pipeline: fixture snapshots/claims → unified
 * checkClaim gate → ConflictSet emit (C residual seeds) → publishKnowledgeRelease
 * → optional writeKnowledgeRelease + index.
 *
 * Gate path (C3): `applyCheckClaims` (envelope + statement schema + SI/η for
 * efficiency kinds). Deterministic when callers pass fixed ISO timestamps
 * (no wall clock / HTTP). Sample catalog (#48-O/#48-Q + conflict seeds):
 * ≥6 edge claims + ≥2 controversy/node subjects + multi-member ConflictSets.
 */

import {
  emitConflictSetsFromClaims,
} from './conflictVisibility'
import {
  applyCheckClaims,
} from './gates/checkClaim'
import type { GateApplyResult } from './gates/efficiency'
import {
  PublishError,
  publishKnowledgeRelease,
  type PublishResult,
} from './publish/releasePublisher'
import {
  writeKnowledgeRelease,
  writeReleaseIndex,
} from './store/releaseStore'
import type {
  Claim,
  ConflictSet,
  EvidenceBinding,
  KnowledgeRelease,
  SourceSnapshot,
} from './types'

/** Working-set fixture (typically candidate claims + bindings + snapshots). */
export type OfflinePipelineFixture = {
  claims: Claim[]
  evidenceBindings: EvidenceBinding[]
  sourceSnapshots: SourceSnapshot[]
  /**
   * Optional pre-built ConflictSets (merged with auto-emit from gated claims).
   * Members must survive gate+publish or publisher trimGraph drops the set.
   */
  conflictSets?: ConflictSet[]
}

export type OfflinePipelineInput = {
  releaseId: string
  releasedAt: string
  fixture: OfflinePipelineFixture
  /**
   * Fixed ISO time applied as Claim.updatedAt by the unified checkClaim gate.
   * Required for digest-stable offline runs (do not use Date.now()).
   */
  gateAt: string
  /** When true (default), re-verify release digest after publish. */
  verify?: boolean
  /**
   * When true (default), scan gated claims for errata/duplicate and emit
   * ConflictSets before publish (sample controversy seeds + continuous path).
   */
  emitConflicts?: boolean
}

export type OfflinePipelineResult = {
  release: KnowledgeRelease
  gateResults: GateApplyResult[]
  publish: PublishResult
  /** Claim ids that failed checkClaim (quarantine / excluded from publish). */
  gatedOutClaimIds: string[]
  /** ConflictSets passed to publish (fixture ∪ auto-emit; pre-trim). */
  conflictSets: ConflictSet[]
}

export class OfflinePipelineError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'OfflinePipelineError'
    this.code = code
  }
}

/**
 * Run unified checkClaim gate → select/promote → publishKnowledgeRelease (in memory only).
 * Never touches the network or filesystem.
 */
export async function runOfflinePublishPipeline(
  input: OfflinePipelineInput,
): Promise<OfflinePipelineResult> {
  if (!input.gateAt || typeof input.gateAt !== 'string') {
    throw new OfflinePipelineError('missing_gate_at', 'gateAt ISO timestamp is required for deterministic offline runs')
  }
  if (!input.releaseId?.trim()) {
    throw new OfflinePipelineError('missing_release_id', 'releaseId is required')
  }
  if (!input.releasedAt?.trim()) {
    throw new OfflinePipelineError('missing_released_at', 'releasedAt is required')
  }
  if (!input.fixture?.claims?.length) {
    throw new OfflinePipelineError('empty_fixture', 'fixture.claims must be non-empty')
  }

  // C3: unified WLang Phase 1 checker (not efficiency-only).
  const gateResults = applyCheckClaims(input.fixture.claims, input.gateAt)
  const gatedClaims = gateResults.map((r) => r.claim)
  const gatedOutClaimIds = gateResults
    .filter((r) => r.transitionedTo === 'quarantine' || r.transitionedTo === 'candidate')
    .map((r) => r.claim.id)

  // C residual: ConflictSet seeds — auto-emit errata/duplicate from gated
  // working set (no silent merge) and merge with any fixture-provided sets.
  const conflictSets = mergeConflictSetsForPublish(
    gatedClaims,
    input.fixture.conflictSets,
    input.emitConflicts !== false,
  )

  let publish: PublishResult
  try {
    publish = await publishKnowledgeRelease({
      id: input.releaseId,
      releasedAt: input.releasedAt,
      claims: gatedClaims,
      evidenceBindings: input.fixture.evidenceBindings,
      sourceSnapshots: input.fixture.sourceSnapshots,
      conflictSets,
      verify: input.verify !== false,
    })
  } catch (e) {
    if (e instanceof PublishError) {
      throw new OfflinePipelineError(e.code, e.message)
    }
    throw e
  }

  return {
    release: publish.release,
    gateResults,
    publish,
    gatedOutClaimIds,
    conflictSets,
  }
}

/**
 * Merge fixture ConflictSets with integrity emit (stable id de-dupe).
 * Stamps `state: released` so open controversies ride with the release bag.
 */
export function mergeConflictSetsForPublish(
  gatedClaims: readonly Claim[],
  fixtureSets: readonly ConflictSet[] | undefined,
  emit: boolean,
): ConflictSet[] {
  const byId = new Map<string, ConflictSet>()
  if (emit) {
    const { conflictSets: emitted } = emitConflictSetsFromClaims(gatedClaims, {
      state: 'released',
    })
    for (const cs of emitted) {
      byId.set(cs.id, { ...cs, claimIds: [...cs.claimIds], state: 'released' })
    }
  }
  for (const cs of fixtureSets ?? []) {
    if (!cs?.id || !Array.isArray(cs.claimIds) || cs.claimIds.length < 2) continue
    byId.set(cs.id, {
      ...cs,
      claimIds: [...cs.claimIds],
      state: cs.state === 'released' ? 'released' : cs.state,
    })
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Full offline path: gate → publish → writeKnowledgeRelease → rewrite index.json.
 * Uses fixed `indexGeneratedAt` so trees are digest-stable across runs.
 */
export async function runOfflinePublishAndWrite(
  root: string,
  input: OfflinePipelineInput,
  opts?: { indexGeneratedAt?: string },
): Promise<
  OfflinePipelineResult & {
    dir: string
    file: string
    indexPath: string
  }
> {
  const result = await runOfflinePublishPipeline(input)
  const { dir, file } = await writeKnowledgeRelease(root, result.release)
  // writeKnowledgeRelease already rewrites index with wall-clock generatedAt;
  // overwrite with fixed timestamp for deterministic offline trees.
  const indexPath = await writeReleaseIndex(root, {
    generatedAt: opts?.indexGeneratedAt ?? input.releasedAt,
  })
  return { ...result, dir, file, indexPath }
}
