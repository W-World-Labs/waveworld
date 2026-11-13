/**
 * Draft-only evaluator for preregistration-v2.draft.json.
 *
 * Does NOT register v2. Does NOT amend v1. Emits a machine-readable report
 * that human peer review can use before any formal freeze.
 *
 * Residual draft tooling (#53 / #47 auto):
 *   --write-summary       freeze peer-review snapshot (no register)
 *   --check-frozen        assert frozen 47c matches live evaluation (no write, no register)
 *   --write-peer-packet   freeze 47d human peer-review packet + markdown brief (no register)
 *   --check-peer-packet   assert frozen 47d matches digests / freezeRequirements / artifact files
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  diagnoseGoldenGpu,
  PRODUCTION_GPU_FIXTURE,
} from './diagnose-golden-gpu.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DRAFT_PATH = path.join(repoRoot, 'research/golden-case/preregistration-v2.draft.json')
const V1_PATH = path.join(repoRoot, 'research/golden-case/preregistration.json')
/** Frozen peer-review evidence path (draft-evaluation-only; not a registration). */
export const FROZEN_DRAFT_EVALUATION_SUMMARY_PATH = path.join(
  repoRoot,
  'research/golden-case/results/47c-draft-contract-evaluation.summary.json',
)
/** Frozen human peer-review packet path (draft-only; not a registration). */
export const PEER_REVIEW_PACKET_PATH = path.join(
  repoRoot,
  'research/golden-case/results/47d-peer-review-packet.summary.json',
)
/** Human-readable brief rendered from the packet (draft-only; not a registration). */
export const PEER_REVIEW_PACKET_MD_PATH = path.join(
  repoRoot,
  'research/golden-case/results/47d-peer-review-packet.md',
)

const FROZEN_SNAPSHOT_NOTE =
  'Frozen snapshot of a CI-safe draft evaluation for peer review. Re-run: npm run golden:draft:eval | golden:draft:write-summary | golden:draft:check. Does not register v2.'

const PEER_PACKET_NOTE =
  'Draft-only peer-review packet for independent numerical review of preregistration-v2.draft.json. Re-run: npm run golden:draft:peer-packet | golden:draft:check-peer-packet. Does not register v2. Does not close formal #47.'

/** Relative artifact paths inside the peer-review packet (repo-root relative). */
export type PeerReviewArtifactKey =
  | 'draftPath'
  | 'v1PreregistrationPath'
  | 'frozenEvaluationSummaryPath'
  | 'attributionReport'
  | 'rationaleDoc'
  | 'draftEvaluationMarkdown'

export type PeerReviewArtifacts = Record<PeerReviewArtifactKey, string>
export type PeerReviewArtifactFileDigests = Record<PeerReviewArtifactKey, string>

const PEER_ARTIFACT_KEYS: PeerReviewArtifactKey[] = [
  'draftPath',
  'v1PreregistrationPath',
  'frozenEvaluationSummaryPath',
  'attributionReport',
  'rationaleDoc',
  'draftEvaluationMarkdown',
]

function sha256FileLocal(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}

/** Resolve a packet-relative artifact path under research/golden-case when needed. */
export function resolvePeerReviewArtifactPath(relPath: string): string {
  if (path.isAbsolute(relPath)) return relPath
  if (relPath.startsWith('research/')) return path.join(repoRoot, relPath)
  // Attribution paths in the draft are results/... relative to golden-case/.
  return path.join(repoRoot, 'research/golden-case', relPath)
}

export function computePeerReviewArtifactFileDigests(
  artifacts: PeerReviewArtifacts,
): PeerReviewArtifactFileDigests {
  const out = {} as PeerReviewArtifactFileDigests
  for (const key of PEER_ARTIFACT_KEYS) {
    out[key] = sha256FileLocal(resolvePeerReviewArtifactPath(artifacts[key]))
  }
  return out
}
export interface DraftContractDoc {
  schema: string
  status: string
  caseId: string
  immutablePriorPreregistrationSha256: string
  freezeRequirements?: string[]
  attributionEvidence?: {
    workstream?: string
    report?: string
    rationaleDoc?: string
    summary?: string
    v1CpuGpuGateRemainsFailed?: boolean
    implementationDefectSuspected?: boolean
  }
  separationFromV1?: {
    v1CpuGpuAbsoluteTolerance?: number
    v1CpuGpuRelativeTolerance?: number
    whyV1Failed?: string
    v2DoesNotRescindV1?: boolean
  }
  contract: {
    backendImplementationEquivalence: {
      maximumAbsoluteStateError: number
      relativeErrorDenominatorFloor: number
      maximumFlooredRelativeStateError: number
    }
    scientificEquivalence: {
      maximumCalibrationRmseDelta: number
      requireSameModelFitThresholdDecision: boolean
      requireSameOverallHypothesisDecision: boolean
    }
    refinementCheck: {
      factors: number[]
      sameFinalIntegrationTime: boolean
      requireConclusionStable: boolean
    }
  }
  dimensions?: {
    time?: { integrationDt: number; stepsAtFactor1: number; finalTime?: number }
  }
  stepSizeAnalysis?: { refinementFactors?: number[] }
}

export interface PeerReviewChecklistItem {
  id: string
  required: true
  /** Always false in auto-generated packets; only a human may mark complete outside this tooling. */
  done: false
  prompt: string
}

/**
 * Machine-readable packet for independent numerical peer review.
 * Auto tooling never sets registered=true or formalReviewStillRequired=false.
 */
export interface PeerReviewPacket {
  schema: 'waveworld.golden-case-v2-peer-review-packet/v1'
  status: 'draft-peer-review-packet-only'
  registered: false
  formalReviewStillRequired: true
  v1GateRemainsFailed: true
  note: string
  caseId: string
  artifacts: PeerReviewArtifacts
  /**
   * SHA-256 of each artifact file on disk at freeze time.
   * Lets a human reviewer verify the packet points at unchanged files without registering v2.
   */
  artifactFileDigests: PeerReviewArtifactFileDigests
  digests: DraftEvaluationReport['digests']
  contractBounds: {
    maximumAbsoluteStateError: number
    relativeErrorDenominatorFloor: number
    maximumFlooredRelativeStateError: number
    maximumCalibrationRmseDelta: number
    refinementFactors: number[]
  }
  evaluationSummary: DraftEvaluationReport['summary']
  freezeRequirements: string[]
  separationFromV1: {
    v1CpuGpuAbsoluteTolerance: number | null
    v1CpuGpuRelativeTolerance: number | null
    whyV1Failed: string | null
    v2DoesNotRescindV1: boolean
  }
  reviewerChecklist: PeerReviewChecklistItem[]
}
export interface DraftCheck {
  id: string
  passed: boolean
  detail: string
  measured?: Record<string, number | boolean | string | null>
}

export interface DraftEvaluationReport {
  schema: 'waveworld.golden-case-v2-draft-evaluation/v1'
  status: 'draft-evaluation-only'
  registered: false
  /** Stable operator note; also used on frozen peer-review snapshots. */
  note: string
  draftPath: string
  digests: {
    v1PreregistrationSha256: string
    draftPreregistrationSha256: string
    draftPinsV1: boolean
  }
  draft: {
    status: string
    caseId: string
    schema: string
  }
  checks: DraftCheck[]
  summary: {
    allPassed: boolean
    failedIds: string[]
    scientificConclusionStable: boolean
    implementationDefectSuspected: boolean
    v1GateRemainsFailed: true
  }
  measurements: {
    conditions: Array<{
      fixtureKey: string
      refinements: Array<{
        factor: number
        dt: number
        steps: number
        cpu32VsCpu64MaxAbs: number
        cpu32Rmse: number
        cpu64Rmse: number
        cpu32RmseDelta: number
        modelFitFailsBoth: boolean
      }>
      maxAbsNonDecreasingWithFactor: boolean
    }>
    productionGpuVsCpu32: {
      air: { maxAbsoluteError: number; withinImplAbsBound: boolean; withinImplRelBound: boolean }
      n2: { maxAbsoluteError: number; withinImplAbsBound: boolean; withinImplRelBound: boolean }
    }
  }
  provenance: {
    sourceCommit: string
    executedAt: string
    note: string
  }
  /** Top-level mirror of summary for frozen peer-review JSON consumers. */
  v1GateRemainsFailed: true
  /** Explicit: auto draft tools never close formal #47 peer review. */
  formalReviewStillRequired: true
}

/**
 * Stable peer-review artifact shape (no executedAt / sourceCommit volatility).
 * Written by --write-summary; consumed by independent reviewers.
 */
export interface FrozenDraftEvaluationSummary {
  schema: 'waveworld.golden-case-v2-draft-evaluation/v1'
  status: 'draft-evaluation-only'
  registered: false
  note: string
  digests: DraftEvaluationReport['digests']
  draft: DraftEvaluationReport['draft']
  checks: DraftCheck[]
  summary: DraftEvaluationReport['summary']
  measurements: DraftEvaluationReport['measurements']
  v1GateRemainsFailed: true
  formalReviewStillRequired: true
}

/** Strip live-only provenance into the frozen peer-review snapshot schema. */
export function toFrozenDraftEvaluationSummary(
  report: DraftEvaluationReport,
): FrozenDraftEvaluationSummary {
  return {
    schema: report.schema,
    status: report.status,
    registered: false,
    note: FROZEN_SNAPSHOT_NOTE,
    digests: report.digests,
    draft: report.draft,
    checks: report.checks,
    summary: report.summary,
    measurements: report.measurements,
    v1GateRemainsFailed: true,
    formalReviewStillRequired: true,
  }
}

/** Compare frozen peer-review snapshot to a live report (ignores provenance volatility). */
export function frozenSummaryMatchesLive(
  frozen: FrozenDraftEvaluationSummary,
  live: DraftEvaluationReport,
): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = []
  if (frozen.schema !== live.schema) mismatches.push('schema')
  if (frozen.status !== live.status) mismatches.push('status')
  if (frozen.registered !== false || live.registered !== false) mismatches.push('registered')
  if (frozen.formalReviewStillRequired !== true) mismatches.push('formalReviewStillRequired')
  if (frozen.v1GateRemainsFailed !== true || live.v1GateRemainsFailed !== true) {
    mismatches.push('v1GateRemainsFailed')
  }
  if (JSON.stringify(frozen.digests) !== JSON.stringify(live.digests)) mismatches.push('digests')
  if (JSON.stringify(frozen.draft) !== JSON.stringify(live.draft)) mismatches.push('draft')
  if (JSON.stringify(frozen.checks) !== JSON.stringify(live.checks)) mismatches.push('checks')
  if (JSON.stringify(frozen.summary) !== JSON.stringify(live.summary)) mismatches.push('summary')
  if (JSON.stringify(frozen.measurements) !== JSON.stringify(live.measurements)) {
    mismatches.push('measurements')
  }
  return { ok: mismatches.length === 0, mismatches }
}

export function writeFrozenDraftEvaluationSummary(
  report: DraftEvaluationReport,
  outPath: string = FROZEN_DRAFT_EVALUATION_SUMMARY_PATH,
): FrozenDraftEvaluationSummary {
  const frozen = toFrozenDraftEvaluationSummary(report)
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(frozen, null, 2)}\n`, 'utf8')
  return frozen
}

function sha256File(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}

function loadDraft(): DraftContractDoc {
  return JSON.parse(readFileSync(DRAFT_PATH, 'utf8')) as DraftContractDoc
}

function fixtureWithinImplBound(
  maxAbs: number,
  draft: DraftContractDoc,
): { withinAbs: boolean; withinRel: boolean } {
  const absBound = draft.contract.backendImplementationEquivalence.maximumAbsoluteStateError
  const relBound = draft.contract.backendImplementationEquivalence.maximumFlooredRelativeStateError
  const floor = draft.contract.backendImplementationEquivalence.relativeErrorDenominatorFloor
  // Fixture only stores max abs / raw max rel; floored relative upper-bound uses unit scale floor.
  const flooredRel = maxAbs / Math.max(1.0, floor)
  return {
    withinAbs: maxAbs <= absBound,
    withinRel: flooredRel <= relBound,
  }
}

/** Evaluate the unregistered v2 draft contract against CPU-only diagnosis + production GPU fixture. */
export async function evaluatePreregistrationV2Draft(): Promise<DraftEvaluationReport> {
  const draft = loadDraft()
  const v1Sha = sha256File(V1_PATH)
  const draftSha = sha256File(DRAFT_PATH)
  const factors = draft.contract.refinementCheck.factors
  const diagnosis = await diagnoseGoldenGpu({ cpuOnly: true, refinementFactors: factors })

  const checks: DraftCheck[] = []

  checks.push({
    id: 'draft-status-unregistered',
    passed: draft.status === 'draft-not-registered',
    detail: `draft.status=${draft.status}`,
  })

  checks.push({
    id: 'draft-pins-v1-digest',
    passed: draft.immutablePriorPreregistrationSha256 === v1Sha,
    detail: `draft.immutablePrior=${draft.immutablePriorPreregistrationSha256}; file=${v1Sha}`,
  })

  checks.push({
    id: 'v1-gate-remains-failed',
    passed: diagnosis.immutablePriorDecision === 'fail' && diagnosis.attribution.v1GateRemainsFailed === true,
    detail: `immutablePriorDecision=${diagnosis.immutablePriorDecision}`,
  })

  const rmseDeltaLimit = draft.contract.scientificEquivalence.maximumCalibrationRmseDelta
  const rmseLimit = Number(
    JSON.parse(readFileSync(V1_PATH, 'utf8')).thresholds.normalizedRmseMax,
  )

  let maxObservedRmseDelta = 0
  let allModelFitFail = true
  const conditionMeasurements: DraftEvaluationReport['measurements']['conditions'] = []

  for (const condition of diagnosis.conditions) {
    const refinements = condition.refinements.map((r) => {
      const delta = Math.abs(r.scientificMetrics.cpu32RmseDelta ?? 0)
      maxObservedRmseDelta = Math.max(maxObservedRmseDelta, delta)
      const modelFitFailsBoth =
        r.scientificMetrics.cpu64Rmse > rmseLimit && r.scientificMetrics.cpu32Rmse > rmseLimit
      if (!modelFitFailsBoth) allModelFitFail = false
      return {
        factor: r.factor,
        dt: r.dt,
        steps: r.steps,
        cpu32VsCpu64MaxAbs: r.cpu32VsCpu64.maxAbsoluteError,
        cpu32Rmse: r.scientificMetrics.cpu32Rmse,
        cpu64Rmse: r.scientificMetrics.cpu64Rmse,
        cpu32RmseDelta: r.scientificMetrics.cpu32RmseDelta ?? 0,
        modelFitFailsBoth,
      }
    })

    // Draft accumulation model: max |CPU32−CPU64| is expected to non-decrease as factor rises.
    let maxAbsNonDecreasingWithFactor = true
    for (let i = 1; i < refinements.length; i++) {
      if (refinements[i].cpu32VsCpu64MaxAbs + 1e-18 < refinements[i - 1].cpu32VsCpu64MaxAbs) {
        maxAbsNonDecreasingWithFactor = false
      }
    }

    conditionMeasurements.push({
      fixtureKey: condition.fixtureKey,
      refinements,
      maxAbsNonDecreasingWithFactor,
    })
  }

  checks.push({
    id: 'scientific-rmse-delta-within-draft-bound',
    passed: maxObservedRmseDelta <= rmseDeltaLimit,
    detail: `max|ΔRMSE(f32,f64)|=${maxObservedRmseDelta} ≤ ${rmseDeltaLimit}`,
    measured: { maxObservedRmseDelta, rmseDeltaLimit },
  })

  checks.push({
    id: 'scientific-model-fit-decision-stable',
    passed:
      allModelFitFail &&
      diagnosis.scientificConclusionStable &&
      draft.contract.scientificEquivalence.requireSameModelFitThresholdDecision,
    detail: `allModelFitFail=${allModelFitFail}; diagnosis.scientificConclusionStable=${diagnosis.scientificConclusionStable}`,
  })

  checks.push({
    id: 'refinement-factors-match-draft',
    passed:
      JSON.stringify(factors) === JSON.stringify(draft.stepSizeAnalysis?.refinementFactors ?? factors) &&
      factors.length >= 2,
    detail: `factors=${JSON.stringify(factors)}`,
  })

  const absGrowthOk = conditionMeasurements.every((c) => c.maxAbsNonDecreasingWithFactor)
  checks.push({
    id: 'refinement-abs-drift-non-decreasing',
    passed: absGrowthOk,
    detail: absGrowthOk
      ? 'CPU32–CPU64 max abs non-decreases with refinement factor on both conditions'
      : 'unexpected abs drift decrease on a condition',
  })

  checks.push({
    id: 'refinement-conclusion-stable',
    passed: draft.contract.refinementCheck.requireConclusionStable && diagnosis.scientificConclusionStable,
    detail: `scientificConclusionStable=${diagnosis.scientificConclusionStable}`,
  })

  const airImpl = fixtureWithinImplBound(PRODUCTION_GPU_FIXTURE.gpuVsCpu32.air.maxAbsoluteError, draft)
  const n2Impl = fixtureWithinImplBound(PRODUCTION_GPU_FIXTURE.gpuVsCpu32.n2.maxAbsoluteError, draft)

  checks.push({
    id: 'implementation-gpu-cpu32-fixture-within-abs-bound',
    passed: airImpl.withinAbs && n2Impl.withinAbs,
    detail: `air abs=${PRODUCTION_GPU_FIXTURE.gpuVsCpu32.air.maxAbsoluteError}; n2 abs=${PRODUCTION_GPU_FIXTURE.gpuVsCpu32.n2.maxAbsoluteError}; bound=${draft.contract.backendImplementationEquivalence.maximumAbsoluteStateError}`,
    measured: {
      airMaxAbs: PRODUCTION_GPU_FIXTURE.gpuVsCpu32.air.maxAbsoluteError,
      n2MaxAbs: PRODUCTION_GPU_FIXTURE.gpuVsCpu32.n2.maxAbsoluteError,
      absBound: draft.contract.backendImplementationEquivalence.maximumAbsoluteStateError,
    },
  })

  checks.push({
    id: 'implementation-gpu-cpu32-fixture-within-floored-rel-bound',
    passed: airImpl.withinRel && n2Impl.withinRel,
    detail: `floored relative uses unit-scale denominator; bound=${draft.contract.backendImplementationEquivalence.maximumFlooredRelativeStateError}`,
  })

  checks.push({
    id: 'no-implementation-defect-suspected',
    passed: diagnosis.attribution.implementationDefectSuspected === false,
    detail: `implementationDefectSuspected=${diagnosis.attribution.implementationDefectSuspected}`,
  })

  const failedIds = checks.filter((c) => !c.passed).map((c) => c.id)
  const report: DraftEvaluationReport = {
    schema: 'waveworld.golden-case-v2-draft-evaluation/v1',
    status: 'draft-evaluation-only',
    registered: false,
    note: FROZEN_SNAPSHOT_NOTE,
    draftPath: 'research/golden-case/preregistration-v2.draft.json',
    digests: {
      v1PreregistrationSha256: v1Sha,
      draftPreregistrationSha256: draftSha,
      draftPinsV1: draft.immutablePriorPreregistrationSha256 === v1Sha,
    },
    draft: {
      status: draft.status,
      caseId: draft.caseId,
      schema: draft.schema,
    },
    checks,
    summary: {
      allPassed: failedIds.length === 0,
      failedIds,
      scientificConclusionStable: diagnosis.scientificConclusionStable,
      implementationDefectSuspected: diagnosis.attribution.implementationDefectSuspected,
      v1GateRemainsFailed: true,
    },
    measurements: {
      conditions: conditionMeasurements,
      productionGpuVsCpu32: {
        air: {
          maxAbsoluteError: PRODUCTION_GPU_FIXTURE.gpuVsCpu32.air.maxAbsoluteError,
          withinImplAbsBound: airImpl.withinAbs,
          withinImplRelBound: airImpl.withinRel,
        },
        n2: {
          maxAbsoluteError: PRODUCTION_GPU_FIXTURE.gpuVsCpu32.n2.maxAbsoluteError,
          withinImplAbsBound: n2Impl.withinAbs,
          withinImplRelBound: n2Impl.withinRel,
        },
      },
    },
    provenance: {
      sourceCommit: diagnosis.provenance.sourceCommit as string,
      executedAt: new Date().toISOString(),
      note: 'Draft evaluation only. Not a formal registration. Peer review still required for #47 v2 freeze.',
    },
    v1GateRemainsFailed: true,
    formalReviewStillRequired: true,
  }

  return report
}

/**
 * Load the frozen peer-review snapshot from disk (draft-evaluation-only).
 * Does not register v2.
 */
export function loadFrozenDraftEvaluationSummary(
  pathToSummary: string = FROZEN_DRAFT_EVALUATION_SUMMARY_PATH,
): FrozenDraftEvaluationSummary {
  return JSON.parse(readFileSync(pathToSummary, 'utf8')) as FrozenDraftEvaluationSummary
}

/**
 * CI/ops helper: re-run live draft evaluation and assert the frozen 47c
 * snapshot matches. Never writes; never registers v2.
 */
export async function checkFrozenDraftEvaluationSummary(): Promise<{
  ok: boolean
  mismatches: string[]
  liveAllPassed: boolean
  formalReviewStillRequired: true
  registered: false
}> {
  const live = await evaluatePreregistrationV2Draft()
  const frozen = loadFrozenDraftEvaluationSummary()
  const match = frozenSummaryMatchesLive(frozen, live)
  return {
    ok: match.ok && live.summary.allPassed,
    mismatches: match.ok
      ? live.summary.allPassed
        ? []
        : [`live-checks-failed:${live.summary.failedIds.join(',')}`]
      : match.mismatches,
    liveAllPassed: live.summary.allPassed,
    formalReviewStillRequired: true,
    registered: false,
  }
}

function defaultReviewerChecklist(freezeRequirements: string[]): PeerReviewChecklistItem[] {
  const fromFreeze = freezeRequirements.map((prompt, index) => ({
    id: `freeze-requirement-${index + 1}`,
    required: true as const,
    done: false as const,
    prompt,
  }))
  return [
    ...fromFreeze,
    {
      id: 'confirm-ci-draft-eval-green',
      required: true,
      done: false,
      prompt:
        'Confirm npm run golden:draft:check and npm run test:golden are green on the reviewed commit (draft tools only).',
    },
    {
      id: 'do-not-auto-register',
      required: true,
      done: false,
      prompt:
        'Do not flip draft.status away from draft-not-registered or claim formal v2 registration without human attestation + manifest digests + timestamp.',
    },
  ]
}

/**
 * Build a stable peer-review packet from frozen 47c + draft freezeRequirements.
 * Never registers v2; checklist items always done=false.
 */
export function buildPeerReviewPacket(
  frozen: FrozenDraftEvaluationSummary = loadFrozenDraftEvaluationSummary(),
  draft: DraftContractDoc = loadDraft(),
): PeerReviewPacket {
  const freezeRequirements = Array.isArray(draft.freezeRequirements)
    ? draft.freezeRequirements
    : []
  const attribution = draft.attributionEvidence ?? {}
  const separation = draft.separationFromV1 ?? {}
  const artifacts: PeerReviewArtifacts = {
    draftPath: 'research/golden-case/preregistration-v2.draft.json',
    v1PreregistrationPath: 'research/golden-case/preregistration.json',
    frozenEvaluationSummaryPath:
      'research/golden-case/results/47c-draft-contract-evaluation.summary.json',
    attributionReport:
      attribution.report ?? 'results/47a-precision-attribution-first-cut.md',
    rationaleDoc: attribution.rationaleDoc ?? 'results/47b-numerical-rationale.md',
    draftEvaluationMarkdown: 'results/47c-draft-contract-evaluation.md',
  }
  return {
    schema: 'waveworld.golden-case-v2-peer-review-packet/v1',
    status: 'draft-peer-review-packet-only',
    registered: false,
    formalReviewStillRequired: true,
    v1GateRemainsFailed: true,
    note: PEER_PACKET_NOTE,
    caseId: draft.caseId,
    artifacts,
    artifactFileDigests: computePeerReviewArtifactFileDigests(artifacts),
    digests: frozen.digests,
    contractBounds: {
      maximumAbsoluteStateError:
        draft.contract.backendImplementationEquivalence.maximumAbsoluteStateError,
      relativeErrorDenominatorFloor:
        draft.contract.backendImplementationEquivalence.relativeErrorDenominatorFloor,
      maximumFlooredRelativeStateError:
        draft.contract.backendImplementationEquivalence.maximumFlooredRelativeStateError,
      maximumCalibrationRmseDelta:
        draft.contract.scientificEquivalence.maximumCalibrationRmseDelta,
      refinementFactors: draft.contract.refinementCheck.factors,
    },
    evaluationSummary: frozen.summary,
    freezeRequirements,
    separationFromV1: {
      v1CpuGpuAbsoluteTolerance: separation.v1CpuGpuAbsoluteTolerance ?? null,
      v1CpuGpuRelativeTolerance: separation.v1CpuGpuRelativeTolerance ?? null,
      whyV1Failed: separation.whyV1Failed ?? null,
      v2DoesNotRescindV1: separation.v2DoesNotRescindV1 === true,
    },
    reviewerChecklist: defaultReviewerChecklist(freezeRequirements),
  }
}

/**
 * Human-readable brief rendered from a peer-review packet.
 * Auto tooling never marks checklist items done.
 */
export function renderPeerReviewPacketMarkdown(packet: PeerReviewPacket): string {
  const checklist = packet.reviewerChecklist
    .map(
      (item, index) =>
        `${index + 1}. [ ] \`${item.id}\` — ${item.prompt}${item.required ? ' **(required)**' : ''}`,
    )
    .join('\n')
  const digests = [
    `- v1 preregistration: \`${packet.digests.v1PreregistrationSha256}\``,
    `- draft preregistration: \`${packet.digests.draftPreregistrationSha256}\``,
    `- draft pins v1: \`${packet.digests.draftPinsV1}\``,
  ].join('\n')
  const fileDigests = PEER_ARTIFACT_KEYS.map(
    (key) => `- \`${packet.artifacts[key]}\` → \`${packet.artifactFileDigests[key]}\``,
  ).join('\n')
  const bounds = [
    `- max abs state error: \`${packet.contractBounds.maximumAbsoluteStateError}\``,
    `- rel denominator floor: \`${packet.contractBounds.relativeErrorDenominatorFloor}\``,
    `- max floored rel state error: \`${packet.contractBounds.maximumFlooredRelativeStateError}\``,
    `- max calibration RMSE delta: \`${packet.contractBounds.maximumCalibrationRmseDelta}\``,
    `- refinement factors: \`${packet.contractBounds.refinementFactors.join(', ')}\``,
  ].join('\n')
  const freeze = packet.freezeRequirements.map((req, i) => `${i + 1}. ${req}`).join('\n')
  return `# #47 residual — peer-review packet (auto draft tools only)

Status: **draft peer-review packaging only**. Does **not** register v2. Does **not**
close formal peer review on #47 / #53 residual. Checklist items below are always
unchecked when this file is produced by auto tooling.

## Purpose

Give an independent numerical reviewer a single machine-readable packet plus this
brief that collect:

1. Frozen v1 + draft digests (from 47c).
2. On-disk artifact file digests (verify files were not swapped after freeze).
3. Draft contract bounds (ULP abs / floored rel / RMSE delta / refinement factors).
4. \`freezeRequirements\` from \`preregistration-v2.draft.json\`.
5. Separation-from-v1 statements (v1 failure preserved).
6. An undone reviewer checklist (human must attest outside this tooling).

## Machine-readable packet

\`results/47d-peer-review-packet.summary.json\`

Flags: \`registered=${packet.registered}\` · \`formalReviewStillRequired=${packet.formalReviewStillRequired}\` · \`v1GateRemainsFailed=${packet.v1GateRemainsFailed}\` · caseId=\`${packet.caseId}\`

## Commands

\`\`\`bash
npm run golden:draft:peer-packet
npm run golden:draft:check-peer-packet
npm run test:golden
\`\`\`

\`--write-peer-packet\` rewrites the JSON packet **and** this markdown brief.
\`--check-peer-packet\` rebuilds the packet from live digests + draft freezeRequirements,
requires 47c frozen sync first, verifies on-disk artifact file digests, and exits
non-zero on drift — without writing or registering v2.

## Digests (from frozen 47c)

${digests}

## Artifact file digests (SHA-256)

${fileDigests}

## Contract bounds

${bounds}

## Evaluation summary (frozen 47c)

- allPassed: \`${packet.evaluationSummary.allPassed}\`
- scientificConclusionStable: \`${packet.evaluationSummary.scientificConclusionStable}\`
- implementationDefectSuspected: \`${packet.evaluationSummary.implementationDefectSuspected}\`
- v1GateRemainsFailed: \`${packet.evaluationSummary.v1GateRemainsFailed}\`
- failedIds: \`${packet.evaluationSummary.failedIds.join(', ') || '(none)'}\`

## freezeRequirements (from draft)

${freeze}

## Separation from v1

- v1 CPU/GPU abs tol: \`${packet.separationFromV1.v1CpuGpuAbsoluteTolerance}\`
- v1 CPU/GPU rel tol: \`${packet.separationFromV1.v1CpuGpuRelativeTolerance}\`
- v2DoesNotRescindV1: \`${packet.separationFromV1.v2DoesNotRescindV1}\`
- whyV1Failed: ${packet.separationFromV1.whyV1Failed ?? '(none)'}

## Reviewer checklist (auto: all undone)

${checklist}

## Explicit non-goals

- Not a formal registration or manifest freeze.
- Not a human attestation record (checklist stays undone in CI).
- Not a close of #47 formal peer review (**Blocked** residual remains human).

## Note

${packet.note}
`.replace(/\n*$/, '\n')
}

export function writePeerReviewPacketMarkdown(
  packet: PeerReviewPacket = buildPeerReviewPacket(),
  outPath: string = PEER_REVIEW_PACKET_MD_PATH,
): string {
  const md = renderPeerReviewPacketMarkdown(packet)
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, md, 'utf8')
  return md
}
export function writePeerReviewPacket(
  packet: PeerReviewPacket = buildPeerReviewPacket(),
  outPath: string = PEER_REVIEW_PACKET_PATH,
): PeerReviewPacket {
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8')
  writePeerReviewPacketMarkdown(packet)
  return packet
}

export function loadPeerReviewPacket(
  pathToPacket: string = PEER_REVIEW_PACKET_PATH,
): PeerReviewPacket {
  return JSON.parse(readFileSync(pathToPacket, 'utf8')) as PeerReviewPacket
}

/** Verify packet.artifactFileDigests match current on-disk files. */
export function peerReviewArtifactFileDigestsMatchDisk(
  packet: PeerReviewPacket,
): { ok: boolean; mismatches: string[] } {
  const live = computePeerReviewArtifactFileDigests(packet.artifacts)
  const mismatches: string[] = []
  for (const key of PEER_ARTIFACT_KEYS) {
    if (packet.artifactFileDigests?.[key] !== live[key]) {
      mismatches.push(`artifactFileDigests.${key}`)
    }
  }
  // Cross-check content digests for v1 + draft when paths are the preregistrations.
  if (
    packet.artifactFileDigests?.v1PreregistrationPath &&
    packet.digests.v1PreregistrationSha256 !== packet.artifactFileDigests.v1PreregistrationPath
  ) {
    mismatches.push('digests.v1-vs-artifactFileDigests')
  }
  if (
    packet.artifactFileDigests?.draftPath &&
    packet.digests.draftPreregistrationSha256 !== packet.artifactFileDigests.draftPath
  ) {
    mismatches.push('digests.draft-vs-artifactFileDigests')
  }
  return { ok: mismatches.length === 0, mismatches }
}

/** Compare frozen 47d packet to a freshly built packet (stable fields only). */
export function peerReviewPacketMatchesLive(
  frozen: PeerReviewPacket,
  live: PeerReviewPacket,
): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = []
  if (frozen.schema !== live.schema) mismatches.push('schema')
  if (frozen.status !== live.status) mismatches.push('status')
  if (frozen.registered !== false || live.registered !== false) mismatches.push('registered')
  if (frozen.formalReviewStillRequired !== true || live.formalReviewStillRequired !== true) {
    mismatches.push('formalReviewStillRequired')
  }
  if (frozen.v1GateRemainsFailed !== true || live.v1GateRemainsFailed !== true) {
    mismatches.push('v1GateRemainsFailed')
  }
  if (JSON.stringify(frozen.digests) !== JSON.stringify(live.digests)) mismatches.push('digests')
  if (JSON.stringify(frozen.contractBounds) !== JSON.stringify(live.contractBounds)) {
    mismatches.push('contractBounds')
  }
  if (JSON.stringify(frozen.evaluationSummary) !== JSON.stringify(live.evaluationSummary)) {
    mismatches.push('evaluationSummary')
  }
  if (JSON.stringify(frozen.freezeRequirements) !== JSON.stringify(live.freezeRequirements)) {
    mismatches.push('freezeRequirements')
  }
  if (JSON.stringify(frozen.separationFromV1) !== JSON.stringify(live.separationFromV1)) {
    mismatches.push('separationFromV1')
  }
  if (JSON.stringify(frozen.artifacts) !== JSON.stringify(live.artifacts)) {
    mismatches.push('artifacts')
  }
  if (JSON.stringify(frozen.artifactFileDigests) !== JSON.stringify(live.artifactFileDigests)) {
    mismatches.push('artifactFileDigests')
  }
  if (JSON.stringify(frozen.reviewerChecklist) !== JSON.stringify(live.reviewerChecklist)) {
    mismatches.push('reviewerChecklist')
  }
  if (frozen.caseId !== live.caseId) mismatches.push('caseId')
  // Auto packet must never claim human checklist completion.
  if (!frozen.reviewerChecklist.every((item) => item.done === false)) {
    mismatches.push('checklist-must-remain-undone-in-auto-packet')
  }
  return { ok: mismatches.length === 0, mismatches }
}

/**
 * CI helper: rebuild peer-review packet from frozen 47c + draft and assert 47d matches.
 * Also verifies artifact file digests against on-disk files and markdown brief sync.
 * Never writes; never registers v2.
 */
export async function checkPeerReviewPacket(): Promise<{
  ok: boolean
  mismatches: string[]
  formalReviewStillRequired: true
  registered: false
  checklistAllUndone: boolean
  artifactDigestsOk: boolean
  markdownBriefOk: boolean
}> {
  // Ensure 47c is live-synced first so digests/summary are trustworthy inputs.
  const frozen47c = await checkFrozenDraftEvaluationSummary()
  const livePacket = buildPeerReviewPacket()
  const frozenPacket = loadPeerReviewPacket()
  const match = peerReviewPacketMatchesLive(frozenPacket, livePacket)
  const disk = peerReviewArtifactFileDigestsMatchDisk(frozenPacket)
  const liveDisk = peerReviewArtifactFileDigestsMatchDisk(livePacket)
  let markdownBriefOk = false
  const mdMismatches: string[] = []
  try {
    const onDiskMd = readFileSync(PEER_REVIEW_PACKET_MD_PATH, 'utf8')
    const expectedMd = renderPeerReviewPacketMarkdown(livePacket)
    markdownBriefOk = onDiskMd === expectedMd
    if (!markdownBriefOk) mdMismatches.push('markdown-brief-out-of-sync')
  } catch {
    mdMismatches.push('markdown-brief-missing')
  }  const mismatches = [
    ...(frozen47c.ok ? [] : frozen47c.mismatches.map((m) => `47c:${m}`)),
    ...match.mismatches,
    ...disk.mismatches.map((m) => `disk:${m}`),
    ...liveDisk.mismatches.map((m) => `live-disk:${m}`),
    ...mdMismatches,
  ]
  return {
    ok: frozen47c.ok && match.ok && disk.ok && liveDisk.ok && markdownBriefOk,
    mismatches,
    formalReviewStillRequired: true,
    registered: false,
    checklistAllUndone: livePacket.reviewerChecklist.every((item) => item.done === false),
    artifactDigestsOk: disk.ok && liveDisk.ok,
    markdownBriefOk,
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const writeSummary = process.argv.includes('--write-summary')
  const checkFrozen = process.argv.includes('--check-frozen')
  const writePeerPacket = process.argv.includes('--write-peer-packet')
  const checkPeerPacketFlag = process.argv.includes('--check-peer-packet')
  const writeFlags = [writeSummary, writePeerPacket].filter(Boolean).length
  const checkFlags = [checkFrozen, checkPeerPacketFlag].filter(Boolean).length
  if (writeFlags + checkFlags > 1) {
    process.stderr.write(
      'evaluate-preregistration-v2-draft: use exactly one of --write-summary | --check-frozen | --write-peer-packet | --check-peer-packet\n',
    )
    process.exitCode = 2
  } else if (checkFrozen) {
    checkFrozenDraftEvaluationSummary()
      .then((result) => {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
        if (!result.ok) {
          process.stderr.write(
            `frozen 47c out of sync or live checks failed: ${result.mismatches.join(', ') || 'unknown'}. Re-run: npm run golden:draft:write-summary\n`,
          )
          process.exitCode = 1
        } else {
          process.stderr.write(
            'frozen 47c matches live draft evaluation (formalReviewStillRequired=true; registered=false)\n',
          )
        }
      })
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
        process.exitCode = 1
      })
  } else if (checkPeerPacketFlag) {
    checkPeerReviewPacket()
      .then((result) => {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
        if (!result.ok) {
          process.stderr.write(
            `frozen 47d peer-review packet out of sync: ${result.mismatches.join(', ') || 'unknown'}. Re-run: npm run golden:draft:peer-packet\n`,
          )
          process.exitCode = 1
        } else {
          process.stderr.write(
            'frozen 47d peer-review packet matches live digests + artifact files + markdown brief (formalReviewStillRequired=true; registered=false; checklist undone)\n',
          )
        }
      })
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
        process.exitCode = 1
      })
  } else if (writePeerPacket) {
    try {
      const packet = writePeerReviewPacket()
      process.stderr.write(
        `wrote peer-review packet → research/golden-case/results/47d-peer-review-packet.summary.json + .md (formalReviewStillRequired=${packet.formalReviewStillRequired}; registered=false; artifactFileDigests=${Object.keys(packet.artifactFileDigests).length})\n`,
      )
      process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`)
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
      process.exitCode = 1
    }
  } else {
    evaluatePreregistrationV2Draft()
      .then((value) => {
        if (writeSummary) {
          const frozen = writeFrozenDraftEvaluationSummary(value)
          process.stderr.write(
            `wrote frozen draft evaluation summary → research/golden-case/results/47c-draft-contract-evaluation.summary.json (formalReviewStillRequired=${frozen.formalReviewStillRequired})\n`,
          )
        }
        process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
        if (!value.summary.allPassed) process.exitCode = 1
      })
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
        process.exitCode = 1
      })
  }
}
