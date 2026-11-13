/**
 * #47-B / residual draft tools: v1 bytes immutable; v2 draft stays unregistered;
 * draft contract evaluator is CI-runnable without registering formal v2.
 * Frozen 47c summary stays in sync with live evaluation (still formalReviewStillRequired).
 * 47d peer-review packet packages freezeRequirements + artifact file digests for humans
 * without registering; markdown brief stays in sync with the packet.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  buildPeerReviewPacket,
  checkFrozenDraftEvaluationSummary,
  checkPeerReviewPacket,
  evaluatePreregistrationV2Draft,
  FROZEN_DRAFT_EVALUATION_SUMMARY_PATH,
  frozenSummaryMatchesLive,
  loadFrozenDraftEvaluationSummary,
  loadPeerReviewPacket,
  peerReviewArtifactFileDigestsMatchDisk,
  PEER_REVIEW_PACKET_MD_PATH,
  PEER_REVIEW_PACKET_PATH,
  peerReviewPacketMatchesLive,
  renderPeerReviewPacketMarkdown,
  toFrozenDraftEvaluationSummary,
  type FrozenDraftEvaluationSummary,
} from './evaluate-preregistration-v2-draft.ts'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const v1Path = path.join(root, 'research/golden-case/preregistration.json')
const v2Path = path.join(root, 'research/golden-case/preregistration-v2.draft.json')

const FROZEN_V1_SHA256 =
  '6c7a37fb359ced55721a6aac79aea7181b56733815f1e10bee9c99c66a3b7c81'

function sha256File(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}

describe('preregistration v2 draft (#47-B)', () => {
  it('does not modify frozen v1 preregistration bytes', () => {
    const actual = sha256File(v1Path)
    assert.equal(
      actual,
      FROZEN_V1_SHA256,
      'preregistration.json must remain bit-identical to the frozen v1 digest',
    )
  })

  it('v2 draft stays draft-not-registered and pins v1 digest', () => {
    const draft = JSON.parse(readFileSync(v2Path, 'utf8')) as {
      status: string
      immutablePriorPreregistrationSha256: string
      contract: {
        backendImplementationEquivalence: { maximumAbsoluteStateError: number }
        scientificEquivalence: { maximumCalibrationRmseDelta: number }
        refinementCheck: { factors: number[] }
      }
      dimensions?: { time?: { integrationDt: number; stepsAtFactor1: number } }
      stepSizeAnalysis?: { refinementFactors: number[] }
    }
    assert.equal(draft.status, 'draft-not-registered')
    assert.equal(draft.immutablePriorPreregistrationSha256, FROZEN_V1_SHA256)
    assert.ok(draft.dimensions?.time?.integrationDt === 0.01)
    assert.ok(draft.dimensions?.time?.stepsAtFactor1 === 922)
    assert.deepEqual(draft.contract.refinementCheck.factors, [1, 2, 4])
    assert.deepEqual(draft.stepSizeAnalysis?.refinementFactors, [1, 2, 4])
    // 4 * ulp(1.0f32)
    assert.ok(
      Math.abs(draft.contract.backendImplementationEquivalence.maximumAbsoluteStateError - 4.76837158203125e-7) <
        1e-20,
    )
    assert.equal(draft.contract.scientificEquivalence.maximumCalibrationRmseDelta, 0.00001)
  })

  it('draft contract evaluator passes without registering v2', async () => {
    const report = await evaluatePreregistrationV2Draft()
    assert.equal(report.schema, 'waveworld.golden-case-v2-draft-evaluation/v1')
    assert.equal(report.status, 'draft-evaluation-only')
    assert.equal(report.registered, false)
    assert.equal(report.formalReviewStillRequired, true)
    assert.equal(report.v1GateRemainsFailed, true)
    assert.equal(report.draft.status, 'draft-not-registered')
    assert.equal(report.digests.v1PreregistrationSha256, FROZEN_V1_SHA256)
    assert.equal(report.digests.draftPinsV1, true)
    assert.equal(report.summary.v1GateRemainsFailed, true)
    assert.equal(report.summary.implementationDefectSuspected, false)
    assert.equal(report.summary.scientificConclusionStable, true)
    assert.equal(
      report.summary.allPassed,
      true,
      `draft checks failed: ${report.summary.failedIds.join(', ')}`,
    )
    assert.ok(report.checks.every((c) => c.passed))

    // Refinement study: both conditions, factors 1/2/4, abs drift non-decreasing.
    assert.equal(report.measurements.conditions.length, 2)
    for (const condition of report.measurements.conditions) {
      assert.deepEqual(
        condition.refinements.map((r) => r.factor),
        [1, 2, 4],
      )
      assert.equal(condition.maxAbsNonDecreasingWithFactor, true)
      for (const r of condition.refinements) {
        assert.ok(r.cpu64Rmse > 0.5, `${condition.fixtureKey} f=${r.factor} cpu64Rmse`)
        assert.ok(r.cpu32Rmse > 0.5, `${condition.fixtureKey} f=${r.factor} cpu32Rmse`)
        assert.ok(Math.abs(r.cpu32RmseDelta) <= 1e-5)
        assert.equal(r.modelFitFailsBoth, true)
      }
    }

    // Production GPU–CPU32 fixture within 4 ULP implementation bound.
    assert.equal(report.measurements.productionGpuVsCpu32.air.withinImplAbsBound, true)
    assert.equal(report.measurements.productionGpuVsCpu32.n2.withinImplAbsBound, true)

    // Frozen transform never claims formal registration / peer-review close.
    const projected = toFrozenDraftEvaluationSummary(report)
    assert.equal(projected.registered, false)
    assert.equal(projected.formalReviewStillRequired, true)
    assert.equal(projected.v1GateRemainsFailed, true)
    assert.ok(!('provenance' in projected))
    assert.ok(!('draftPath' in projected))
  })

  it('frozen 47c summary stays in sync with live draft evaluation (peer-review gate)', async () => {
    const live = await evaluatePreregistrationV2Draft()
    const frozen = loadFrozenDraftEvaluationSummary()

    assert.equal(frozen.schema, 'waveworld.golden-case-v2-draft-evaluation/v1')
    assert.equal(frozen.status, 'draft-evaluation-only')
    assert.equal(frozen.registered, false)
    assert.equal(frozen.formalReviewStillRequired, true)
    assert.equal(frozen.v1GateRemainsFailed, true)
    assert.ok(
      typeof frozen.note === 'string' && frozen.note.includes('Does not register v2'),
      'frozen note must state non-registration',
    )

    const match = frozenSummaryMatchesLive(frozen, live)
    assert.equal(
      match.ok,
      true,
      `47c frozen summary out of sync with live evaluator: ${match.mismatches.join(', ')}. Re-run: npm run golden:draft:write-summary`,
    )
  })

  it('checkFrozenDraftEvaluationSummary is CI-safe and never claims formal registration', async () => {
    const result = await checkFrozenDraftEvaluationSummary()
    assert.equal(result.ok, true, `check-frozen failed: ${result.mismatches.join(', ')}`)
    assert.equal(result.liveAllPassed, true)
    assert.equal(result.formalReviewStillRequired, true)
    assert.equal(result.registered, false)
    assert.deepEqual(result.mismatches, [])
    // Frozen path exists and is still draft-only.
    const frozen = JSON.parse(
      readFileSync(FROZEN_DRAFT_EVALUATION_SUMMARY_PATH, 'utf8'),
    ) as FrozenDraftEvaluationSummary
    assert.equal(frozen.registered, false)
    assert.equal(frozen.formalReviewStillRequired, true)
  })

  it('47d peer-review packet is draft-only, checklist undone, and stays in sync', async () => {
    const live = buildPeerReviewPacket()
    assert.equal(live.schema, 'waveworld.golden-case-v2-peer-review-packet/v1')
    assert.equal(live.status, 'draft-peer-review-packet-only')
    assert.equal(live.registered, false)
    assert.equal(live.formalReviewStillRequired, true)
    assert.equal(live.v1GateRemainsFailed, true)
    assert.equal(live.digests.v1PreregistrationSha256, FROZEN_V1_SHA256)
    assert.equal(live.digests.draftPinsV1, true)
    assert.ok(live.freezeRequirements.length >= 5, 'draft freezeRequirements must be present')
    assert.ok(live.reviewerChecklist.length >= live.freezeRequirements.length)
    assert.ok(
      live.reviewerChecklist.every((item) => item.done === false && item.required === true),
      'auto peer-review packet must leave all checklist items undone',
    )
    assert.equal(live.separationFromV1.v2DoesNotRescindV1, true)
    assert.deepEqual(live.contractBounds.refinementFactors, [1, 2, 4])
    assert.ok(live.note.includes('Does not register v2'))

    // Artifact file digests pin on-disk bytes (and agree with content digests for v1/draft).
    assert.equal(live.artifactFileDigests.v1PreregistrationPath, FROZEN_V1_SHA256)
    assert.equal(
      live.artifactFileDigests.draftPath,
      live.digests.draftPreregistrationSha256,
    )
    assert.equal(live.artifactFileDigests.v1PreregistrationPath.length, 64)
    assert.equal(live.artifactFileDigests.frozenEvaluationSummaryPath.length, 64)
    const disk = peerReviewArtifactFileDigestsMatchDisk(live)
    assert.equal(disk.ok, true, `artifact digests drift: ${disk.mismatches.join(', ')}`)

    const frozen = loadPeerReviewPacket()
    const match = peerReviewPacketMatchesLive(frozen, live)
    assert.equal(
      match.ok,
      true,
      `47d peer-review packet out of sync: ${match.mismatches.join(', ')}. Re-run: npm run golden:draft:peer-packet`,
    )

    // Markdown brief is rendered from the packet and stays bit-stable with the freeze.
    const expectedMd = renderPeerReviewPacketMarkdown(live)
    assert.ok(expectedMd.includes('Does **not** register v2'))
    assert.ok(expectedMd.includes(FROZEN_V1_SHA256))
    assert.ok(expectedMd.includes('[ ] `freeze-requirement-1`'))
    assert.ok(expectedMd.includes(live.artifactFileDigests.draftPath))
    const onDiskMd = readFileSync(PEER_REVIEW_PACKET_MD_PATH, 'utf8')
    assert.equal(
      onDiskMd,
      expectedMd,
      '47d markdown brief out of sync with packet. Re-run: npm run golden:draft:peer-packet',
    )
    const check = await checkPeerReviewPacket()
    assert.equal(check.ok, true, `check-peer-packet failed: ${check.mismatches.join(', ')}`)
    assert.equal(check.formalReviewStillRequired, true)
    assert.equal(check.registered, false)
    assert.equal(check.checklistAllUndone, true)
    assert.equal(check.artifactDigestsOk, true)
    assert.equal(check.markdownBriefOk, true)
    assert.deepEqual(check.mismatches, [])

    const onDisk = JSON.parse(readFileSync(PEER_REVIEW_PACKET_PATH, 'utf8')) as {
      registered: boolean
      formalReviewStillRequired: boolean
      artifactFileDigests?: Record<string, string>
    }
    assert.equal(onDisk.registered, false)
    assert.equal(onDisk.formalReviewStillRequired, true)
    assert.ok(onDisk.artifactFileDigests?.draftPath)
  })
})