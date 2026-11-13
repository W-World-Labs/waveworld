/**
 * Shared job assembly: optional knowledge resolve before createJob (#69 / #89).
 * w-sim never opens knowledge.db — this is the product cross-layer point.
 * Host :3001 is the canonical jobs API; tuanliu leftover routes reuse this helper.
 */
import type { JobSpecV1 } from '@w-sim/contracts'
import { resolveJobSpecFromKnowledge } from './resolve-job.ts'

export type KnowledgeSubmitRef = {
  kind?: string
  releaseId?: string
  packClaimId?: string
  packSubjectId?: string
  materialClaimIds?: string[]
}

export type AssembledJobSpec = {
  spec: JobSpecV1
  provenance: {
    knowledgeDbReleaseId: string
    claimIds: string[]
    packClaimId: string
    paramOverrideKeys: string[]
  }
}

export function stampKnowledgeProvenance(
  spec: JobSpecV1,
  provenance: AssembledJobSpec['provenance'],
): JobSpecV1 {
  const experiment = {
    ...(spec.experiment && typeof spec.experiment === 'object' ? spec.experiment : {}),
    knowledgeDbReleaseId: provenance.knowledgeDbReleaseId,
    claimIds: provenance.claimIds,
    packClaimId: provenance.packClaimId,
    paramOverrideKeys: provenance.paramOverrideKeys,
  }
  return {
    ...spec,
    experiment: experiment as JobSpecV1['experiment'],
  }
}

/**
 * When `knowledge` is present, resolve a released param pack into the spec.
 * Caller-supplied spec.parameters override pack defaults.
 */
export function assembleJobSpecFromKnowledge(input: {
  spec: JobSpecV1
  knowledge: KnowledgeSubmitRef
}): AssembledJobSpec {
  const kind = (input.knowledge.kind || input.spec.kind || '').trim()
  const result = resolveJobSpecFromKnowledge({
    kind,
    releaseId: input.knowledge.releaseId,
    packClaimId: input.knowledge.packClaimId,
    packSubjectId: input.knowledge.packSubjectId,
    materialClaimIds: input.knowledge.materialClaimIds,
    overrides: {
      parameters: input.spec.parameters as Record<string, unknown> | undefined,
      run: input.spec.run,
      name: input.spec.name,
      model: input.spec.model as Record<string, unknown> | undefined,
      outputs: input.spec.outputs as Record<string, unknown> | undefined,
      requirements: input.spec.requirements as Record<string, unknown> | undefined,
      experiment: input.spec.experiment as Record<string, unknown> | undefined,
      workspaceId: input.spec.workspaceId,
    },
  })
  if (!result.ok) {
    const err = new Error(result.message) as Error & { status: number; code: string }
    err.status = 400
    err.code = result.code
    throw err
  }
  const provenance = {
    knowledgeDbReleaseId: result.provenance.knowledgeDbReleaseId,
    claimIds: result.provenance.claimIds,
    packClaimId: result.provenance.packClaimId,
    paramOverrideKeys: result.provenance.paramOverrideKeys,
  }
  const merged = {
    ...result.jobSpec,
    ...input.spec,
    kind: result.jobSpec.kind,
    parameters: result.jobSpec.parameters,
    run: result.jobSpec.run,
  } as JobSpecV1
  return { spec: stampKnowledgeProvenance(merged, provenance), provenance }
}
