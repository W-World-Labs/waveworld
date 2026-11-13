/**
 * WaveWorld Host task protocol.
 *
 * **Authority:** `@w-sim/contracts` (W-Sim engine plane).
 * Browser labs and backend agents both import settlement types from W-Sim.
 * This module re-exports the contract and keeps Host-only persistence types
 * (JobRecord, AgentPublic catalog views) that are product-specific.
 */

export {
  JOB_SPEC_SCHEMA_VERSION,
  type BuiltinJobKind,
  type JobKind,
  BUILTIN_JOB_KINDS,
  CORE_FLUID_JOB_KINDS,
  /** Agent-facing default kind list (fluid + path). Prefer CORE_FLUID_JOB_KINDS. */
  JOB_KINDS,
  type JobStatus,
  type SolverBackendId,
  type PathEvidenceKind,
  type PathEvidenceSource,
  type JobModelRef,
  type JobParameters,
  type JobRunConfig,
  type JobOutputs,
  type JobRequirements,
  type JobSpecV1,
  type JobProgress,
  type JobResultArtifact,
  type JobResultBackend,
  type JobResultV1,
  isJobSpecV1,
  isTerminalStatus,
  defaultJobSpec,
  acceptJobSpec,
  applySettlement,
  canTransitionJobStatus,
  matchCapability,
  FLUID_KIND_SHELL,
  STRUCTURAL_KIND_SHELL,
  THERMAL_KIND_SHELL,
  type HostCapability,
  type KindShell,
} from '@w-sim/contracts'

export {
  type PathExperimentAnalysisV1,
  type PathExperimentSpecV1,
  type PathExperimentResultV1,
  type PathModelCapability,
} from '@w-sim/contracts'

import type {
  JobKind,
  JobStatus,
  JobSpecV1,
  JobResultV1,
  JobProgress,
  SolverBackendId,
  PathModelCapability,
  JobFeatureRequirement,
} from '@w-sim/contracts'

/** User-facing, aggregated view of one model version across registered Agents. */
export interface PathModelCatalogEntry extends PathModelCapability {
  available: boolean
  /** True when Agents advertise different implementations for the same id/version. */
  implementationConflict?: boolean
  /** Backends currently reachable on online Agents (a subset of backends). */
  availableBackends: SolverBackendId[]
  availableAgentCount: number
  registeredAgentCount: number
  lastSeenAt: string | null
}

export interface AgentCapabilities {
  backends: SolverBackendId[]
  /** Features actually supported by the installed solver. */
  features?: JobFeatureRequirement[]
  maxGrid?: 'fast' | 'standard' | 'fine'
  thermal?: boolean
  /** The installed LBM solver supports the constant-pressure fan component. */
  fan?: boolean
  kinds?: JobKind[]
  pathModels?: PathModelCapability[]
  /** Deployment identity shared by all work executed by this Agent process. */
  agentBuildId?: string
  /** SHA-256 of the dependency lockfile used for this Agent build. */
  dependencyLockSha256?: string
}

export interface AgentPublic {
  id: string
  name: string
  capabilities: AgentCapabilities
  lastSeenAt: string | null
  createdAt: string
}

/** Host SQLite / API job row (product persistence — not part of W-Sim wire protocol). */
export interface JobRecord {
  /** Compute settlement and instance shutdown have separate durable states. */
  compute?: { provider: 'w-compute'; instanceId: string | null; phase: string; error: string | null }

  id: string
  name: string | null
  status: JobStatus
  priority: number
  kind: JobKind
  spec: JobSpecV1
  result: JobResultV1 | null
  error: string | null
  createdBy: string | null
  agentId: string | null
  /** Linked user project when submitted with projectId (nullable for legacy jobs). */
  projectId?: string | null
  leaseExpiresAt: string | null
  attempt: number
  maxAttempts: number
  progress: JobProgress | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
  /** Canonical SHA-256 of job spec (for load-prior / skip recompute). */
  specFingerprint?: string | null
}
