/**
 * #48-O / #48-Q / C-conflict-seeds Offline multi-subject sample KnowledgeRelease
 * for the static browser catalog.
 *
 * - ≥6 claims on distinct real ConversionEdge subjectIds (efficiency + mechanism mix)
 * - ≥2 claims on real Controversies / energy-node subjectIds so Controversies UI panels
 *   (subjectId = controversy id | relatedNodeIds) can surface released claims
 * - ≥3 multi-member ConflictSets (controversy + related energy node + Matrix edge;
 *   parallel viewpoints; offline pipeline auto-emits errata ConflictSet — no silent merge)
 *
 * Built via offline pipeline: candidate fixture → checkClaim gate → emit conflicts
 * → publish → write. Deterministic ids/dates → fixed sha256. No network or wall clock.
 */

import { sha256Hex } from './hash'
import {
  runOfflinePublishAndWrite,
  runOfflinePublishPipeline,
  type OfflinePipelineFixture,
} from './offlinePipeline'
import {
  KNOWLEDGE_CONTRACT_VERSION,
  type Claim,
  type ClaimKind,
  type EvidenceBinding,
  type KnowledgeRelease,
  type SourceSnapshot,
} from './types'
import { verifyKnowledgeRelease } from './release'

/** Stable catalog id (safe for on-disk store path). */
export const SAMPLE_KNOWLEDGE_RELEASE_ID = 'kr-sample-48o'

export const SAMPLE_CAPTURED_AT = '2026-08-04T12:00:00.000Z'
export const SAMPLE_GATED_AT = '2026-08-04T15:00:00.000Z'
export const SAMPLE_RELEASED_AT = '2026-08-04T18:00:00.000Z'

/**
 * Real conversion edge ids from `src/data/ontology/edges.data.json`
 * so Matrix/Graph subject panels can surface claims.
 */
export const SAMPLE_EDGE_SUBJECT_IDS = [
  'em-radio-to-electric-rectenna',
  'em-visible-to-electric-photovoltaic',
  'thermal-to-electric-thermoelectric',
  'mechanical-to-electric-piezoelectric',
  'electric-to-visible-led',
  'chemical-to-electric-battery',
] as const

/**
 * Real Controversies page subjects (#48-Q):
 * - controversy `id` from `src/data/ontology/controversies.ts`
 * - related energy node id from controversy.relatedNodeIds / nodes ontology
 * Controversies UI: ReleasedClaimsPanel(subjectId=c.id) and each relatedNodeIds[].
 */
export const SAMPLE_CONTROVERSY_SUBJECT_IDS = [
  'information-energy',
  'thermal',
] as const

/**
 * Controversy subject that carries the sample multi-viewpoint ConflictSet seed.
 * Two `other` claims with different statements → errata ConflictSet on publish.
 */
export const SAMPLE_CONFLICT_SUBJECT_ID = 'information-energy' as const

/**
 * Stable claim ids that form the controversy errata ConflictSet (sorted join in id).
 * Offline pipeline `emitConflictSetsFromClaims` yields
 * `conflict:errata:claim-sample-48o-7+claim-sample-48o-9`.
 */
export const SAMPLE_CONFLICT_CLAIM_IDS = [
  'claim-sample-48o-7',
  'claim-sample-48o-9',
] as const

/** Expected ConflictSet id for the information-energy parallel viewpoints seed. */
export const SAMPLE_CONFLICT_SET_ID =
  `conflict:errata:${[...SAMPLE_CONFLICT_CLAIM_IDS].sort().join('+')}` as const

/**
 * Matrix edge subject that carries a second sample ConflictSet (C residual more-seeds).
 * Two efficiency claims with different η → errata ConflictSet (no silent merge).
 */
export const SAMPLE_EDGE_CONFLICT_SUBJECT_ID =
  'em-radio-to-electric-rectenna' as const

/** Stable claim ids for the rectenna efficiency conflict pair. */
export const SAMPLE_EDGE_CONFLICT_CLAIM_IDS = [
  'claim-sample-48o-1',
  'claim-sample-48o-10',
] as const

/** Expected ConflictSet id for the rectenna dual-η seed. */
export const SAMPLE_EDGE_CONFLICT_SET_ID =
  `conflict:errata:${[...SAMPLE_EDGE_CONFLICT_CLAIM_IDS].sort().join('+')}` as const

/**
 * Controversies related energy-node subject that carries a third ConflictSet seed
 * (C residual more-seeds after subjectClaimsPanelModel). Two `other` claims with
 * different statements → errata ConflictSet so relatedNodeIds panels are not quiet.
 */
export const SAMPLE_NODE_CONFLICT_SUBJECT_ID = 'thermal' as const

/** Stable claim ids for the thermal node multi-explanation conflict pair. */
export const SAMPLE_NODE_CONFLICT_CLAIM_IDS = [
  'claim-sample-48o-8',
  'claim-sample-48o-11',
] as const

/** Expected ConflictSet id for the thermal node dual-view seed. */
export const SAMPLE_NODE_CONFLICT_SET_ID =
  `conflict:errata:${[...SAMPLE_NODE_CONFLICT_CLAIM_IDS].sort().join('+')}` as const

/**
 * UI surface that a sample multi-member ConflictSet seed targets.
 * C residual helper after thermal node ConflictSet — registry, not a fourth seed.
 */
export type SampleConflictSeedSurface =
  | 'controversy'
  | 'relatedNode'
  | 'matrixEdge'

/** Compact meta for one offline sample ConflictSet seed (no silent merge). */
export type SampleConflictSeed = {
  surface: SampleConflictSeedSurface
  subjectId: string
  claimIds: readonly string[]
  conflictSetId: string
}

/**
 * Stable registry of sample ConflictSet seeds (controversy + relatedNode thermal +
 * Matrix edge). Prefer this over hardcoding three SAMPLE_* triples at call sites.
 */
export const SAMPLE_CONFLICT_SEEDS: readonly SampleConflictSeed[] = [
  {
    surface: 'controversy',
    subjectId: SAMPLE_CONFLICT_SUBJECT_ID,
    claimIds: SAMPLE_CONFLICT_CLAIM_IDS,
    conflictSetId: SAMPLE_CONFLICT_SET_ID,
  },
  {
    surface: 'relatedNode',
    subjectId: SAMPLE_NODE_CONFLICT_SUBJECT_ID,
    claimIds: SAMPLE_NODE_CONFLICT_CLAIM_IDS,
    conflictSetId: SAMPLE_NODE_CONFLICT_SET_ID,
  },
  {
    surface: 'matrixEdge',
    subjectId: SAMPLE_EDGE_CONFLICT_SUBJECT_ID,
    claimIds: SAMPLE_EDGE_CONFLICT_CLAIM_IDS,
    conflictSetId: SAMPLE_EDGE_CONFLICT_SET_ID,
  },
] as const

/** Copy of SAMPLE_CONFLICT_SEEDS (claimIds cloned; stable surface order). */
export function listSampleConflictSeeds(): SampleConflictSeed[] {
  return SAMPLE_CONFLICT_SEEDS.map((s) => ({
    surface: s.surface,
    subjectId: s.subjectId,
    claimIds: [...s.claimIds],
    conflictSetId: s.conflictSetId,
  }))
}

/** All sample ConflictSet ids (locale-sorted). */
export function sampleConflictSetIds(): string[] {
  return SAMPLE_CONFLICT_SEEDS.map((s) => s.conflictSetId).sort((a, b) =>
    a.localeCompare(b),
  )
}

/** All sample contested subject ids (locale-sorted; distinct). */
export function sampleConflictSubjectIds(): string[] {
  return [
    ...new Set(SAMPLE_CONFLICT_SEEDS.map((s) => s.subjectId)),
  ].sort((a, b) => a.localeCompare(b))
}

/**
 * Look up one sample seed by Controversies/Matrix surface.
 * `undefined` when the surface has no sample seed (callers must not invent ids).
 */
export function sampleConflictSeedForSurface(
  surface: SampleConflictSeedSurface,
): SampleConflictSeed | undefined {
  const hit = SAMPLE_CONFLICT_SEEDS.find((s) => s.surface === surface)
  if (!hit) return undefined
  return {
    surface: hit.surface,
    subjectId: hit.subjectId,
    claimIds: [...hit.claimIds],
    conflictSetId: hit.conflictSetId,
  }
}

/**
 * All sample subject ids (edges + controversy/node).
 * Note: information-energy, thermal, and rectenna each have ≥2 claims (conflict seeds).
 * First element remains an edge id for SAMPLE_SUBJECT_ID call-site compat.
 */
export const SAMPLE_SUBJECT_IDS = [
  ...SAMPLE_EDGE_SUBJECT_IDS,
  ...SAMPLE_CONTROVERSY_SUBJECT_IDS,
] as const

/** @deprecated Prefer SAMPLE_SUBJECT_IDS[0]; kept for call-site compat. */
export const SAMPLE_SUBJECT_ID = SAMPLE_SUBJECT_IDS[0]

type SampleClaimSpec = {
  subjectId: (typeof SAMPLE_SUBJECT_IDS)[number]
  kind: ClaimKind
  title: string
  quote: string
  note: string
  bodyLine: string
  /**
   * Optional fixed claim id (conflict seeds need stable ids for ConflictSet digests).
   * Default: `claim-sample-48o-${n}` from loop index.
   */
  claimId?: string
  /** Efficiency claims only. */
  eta?: number
  /** Mechanism claims only. */
  mechanism?: string
  /** Controversy / multi-explanation claims (`other` kind). */
  topic?: string
}

const SAMPLE_CLAIM_SPECS: readonly SampleClaimSpec[] = [
  {
    subjectId: 'em-radio-to-electric-rectenna',
    kind: 'conversion.efficiency',
    claimId: 'claim-sample-48o-1',
    eta: 0.55,
    title: 'WaveWorld sample: rectenna RF→DC (#48-O)',
    quote: 'rectenna RF-to-DC conversion eta=0.55',
    note: 'Offline sample claim — rectenna (#48-O) viewpoint A (ConflictSet seed)',
    bodyLine:
      'WaveWorld sample #48-O: rectenna RF-to-DC conversion eta=0.55 (offline fixture).',
  },
  {
    subjectId: 'em-visible-to-electric-photovoltaic',
    kind: 'conversion.efficiency',
    eta: 0.22,
    title: 'WaveWorld sample: visible PV (#48-O)',
    quote: 'photovoltaic conversion eta=0.22',
    note: 'Offline sample claim — PV (#48-O)',
    bodyLine:
      'WaveWorld sample #48-O: visible-light photovoltaic conversion eta=0.22 (offline fixture).',
  },
  {
    subjectId: 'thermal-to-electric-thermoelectric',
    kind: 'conversion.efficiency',
    eta: 0.08,
    title: 'WaveWorld sample: thermoelectric (#48-O)',
    quote: 'thermoelectric conversion eta=0.08',
    note: 'Offline sample claim — thermoelectric (#48-O)',
    bodyLine:
      'WaveWorld sample #48-O: thermoelectric conversion eta=0.08 (offline fixture).',
  },
  {
    subjectId: 'mechanical-to-electric-piezoelectric',
    kind: 'conversion.efficiency',
    eta: 0.15,
    title: 'WaveWorld sample: piezoelectric (#48-O)',
    quote: 'piezoelectric conversion eta=0.15',
    note: 'Offline sample claim — piezoelectric (#48-O)',
    bodyLine:
      'WaveWorld sample #48-O: piezoelectric mechanical-to-electric conversion eta=0.15 (offline fixture).',
  },
  {
    subjectId: 'electric-to-visible-led',
    kind: 'conversion.efficiency',
    eta: 0.4,
    title: 'WaveWorld sample: LED (#48-O)',
    quote: 'LED wall-plug efficiency eta=0.40',
    note: 'Offline sample claim — LED (#48-O)',
    bodyLine:
      'WaveWorld sample #48-O: electric-to-visible LED conversion eta=0.40 (offline fixture).',
  },
  {
    subjectId: 'chemical-to-electric-battery',
    kind: 'conversion.mechanism',
    mechanism: 'electrochemical intercalation',
    title: 'WaveWorld sample: battery mechanism (#48-O)',
    quote: 'electrochemical intercalation discharge',
    note: 'Offline sample claim — battery mechanism (#48-O)',
    bodyLine:
      'WaveWorld sample #48-O: chemical-to-electric battery via electrochemical intercalation (offline fixture).',
  },
  // --- #48-Q Controversies UI subjects (controversy id + related energy node) ---
  {
    subjectId: 'information-energy',
    kind: 'other',
    claimId: 'claim-sample-48o-7',
    topic: 'Landauer principle / information is physical',
    title: 'WaveWorld sample: information↔energy controversy (#48-Q)',
    quote: 'erasing 1 bit costs at least kT ln2; information is physical (Landauer/Bennett)',
    note: 'Offline sample claim — controversy information-energy (#48-Q) viewpoint A',
    bodyLine:
      'WaveWorld sample #48-Q: controversy information-energy — Landauer ≥kT ln2 per bit erased; multi-explanation open (offline fixture).',
  },
  {
    subjectId: 'thermal',
    kind: 'other',
    claimId: 'claim-sample-48o-8',
    topic: 'thermal energy vs heat as energy in transfer',
    title: 'WaveWorld sample: thermal node (related to information-energy) (#48-Q)',
    quote: 'heat is energy in transfer, not a stored form; thermal energy is internal energy bookkeeping',
    note: 'Offline sample claim — energy node thermal (#48-Q) viewpoint A (node ConflictSet seed)',
    bodyLine:
      'WaveWorld sample #48-Q: energy node thermal (relatedNodeIds of information-energy) — heat vs internal energy convention (offline fixture).',
  },
  // --- C conflict seed: opposing viewpoint on same controversy subject+kind ---
  {
    subjectId: 'information-energy',
    kind: 'other',
    claimId: 'claim-sample-48o-9',
    topic: 'information is abstract / not a physical energy form',
    title: 'WaveWorld sample: information↔energy counter-view (#48-Q C-seed)',
    quote: 'information is abstract syntax; Landauer bound is thermodynamic bookkeeping, not "information energy"',
    note: 'Offline sample claim — controversy information-energy (#48-Q) viewpoint B (ConflictSet seed)',
    bodyLine:
      'WaveWorld sample #48-Q C-seed: controversy information-energy — opposing view: information is abstract; no distinct information-energy form (offline fixture).',
  },
  // --- C residual more-seeds: dual η on Matrix edge (errata ConflictSet) ---
  {
    subjectId: 'em-radio-to-electric-rectenna',
    kind: 'conversion.efficiency',
    claimId: 'claim-sample-48o-10',
    eta: 0.72,
    title: 'WaveWorld sample: rectenna RF→DC alternate lab (#48-O C-seed)',
    quote: 'rectenna RF-to-DC conversion eta=0.72 under different load/match conditions',
    note: 'Offline sample claim — rectenna (#48-O) viewpoint B (edge ConflictSet seed)',
    bodyLine:
      'WaveWorld sample #48-O C-seed: rectenna RF-to-DC conversion eta=0.72 (alternate lab; offline fixture).',
  },
  // --- C residual more-seeds: dual view on Controversies related node thermal ---
  {
    subjectId: 'thermal',
    kind: 'other',
    claimId: 'claim-sample-48o-11',
    topic: 'thermal energy as a stored macroscopic state variable',
    title: 'WaveWorld sample: thermal node alternate bookkeeping (#48-Q C-seed)',
    quote: 'thermal energy is often treated as a stored U(T) state; heat vs work split is path-dependent accounting',
    note: 'Offline sample claim — energy node thermal (#48-Q) viewpoint B (node ConflictSet seed)',
    bodyLine:
      'WaveWorld sample #48-Q C-seed: energy node thermal — opposing view: thermal energy as stored macroscopic U(T); heat/work path split (offline fixture).',
  },
] as const

function statementForSpec(spec: SampleClaimSpec): Record<string, unknown> {
  if (spec.kind === 'conversion.efficiency') {
    const eta = spec.eta ?? 0
    return {
      metric: 'eta',
      value: eta,
      unit: '1',
      etaMin: eta,
      etaMax: eta,
      note: spec.note,
    }
  }
  if (spec.kind === 'conversion.mechanism') {
    return {
      source: 'offline.sample',
      mechanism: spec.mechanism ?? 'unknown',
      note: spec.note,
    }
  }
  // Controversy / node / other multi-explanation claims
  return {
    source: 'offline.sample',
    topic: spec.topic ?? 'multi-explanation',
    note: spec.note,
  }
}

/**
 * Build candidate fixture (snapshots + claims + bindings).
 * Claims start as `candidate` so the offline pipeline exercises the gate.
 * Efficiency kinds run SI gates; mechanism/other kinds auto-validate (non-efficiency skip).
 */
export async function buildSampleOfflineFixture(): Promise<OfflinePipelineFixture> {
  const sourceSnapshots: SourceSnapshot[] = []
  const claims: Claim[] = []
  const evidenceBindings: EvidenceBinding[] = []

  for (let i = 0; i < SAMPLE_CLAIM_SPECS.length; i++) {
    const spec = SAMPLE_CLAIM_SPECS[i]!
    const n = i + 1
    const bodyBytes = new TextEncoder().encode(spec.bodyLine)
    const claimId = spec.claimId ?? `claim-sample-48o-${n}`
    // Stable snap/bind ids track claim suffix when claimId is fixed.
    const idSuffix = claimId.replace(/^claim-sample-48o-/, '') || String(n)
    const snapId = `snap-sample-48o-${idSuffix}`
    const bindId = `bind-sample-48o-${idSuffix}`

    sourceSnapshots.push({
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: snapId,
      // Distinct locators even when subjectId repeats (conflict seed pair).
      locator: `https://example.org/waveworld/sample-${spec.subjectId}-48o-${idSuffix}`,
      locatorKind: 'url',
      capturedAt: SAMPLE_CAPTURED_AT,
      contentSha256: await sha256Hex(bodyBytes),
      captureStatus: 'bytes-captured',
      contentType: 'text/plain',
      byteLength: bodyBytes.byteLength,
      provider: 'manual',
      title: spec.title,
    })

    claims.push({
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: claimId,
      kind: spec.kind,
      subjectId: spec.subjectId,
      statement: statementForSpec(spec),
      state: 'candidate',
      confidence: 0.75,
      createdAt: SAMPLE_CAPTURED_AT,
    })

    evidenceBindings.push({
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: bindId,
      claimId,
      sourceSnapshotId: snapId,
      support: 'supports',
      locator: { path: 'text', quote: spec.quote },
      note:
        claimId === 'claim-sample-48o-10'
          ? 'Offline sample binding (#48-O C edge conflict seed)'
          : claimId === 'claim-sample-48o-9'
            ? 'Offline sample binding (#48-Q C conflict seed)'
            : claimId === 'claim-sample-48o-11'
              ? 'Offline sample binding (#48-Q C node conflict seed)'
              : i < SAMPLE_EDGE_SUBJECT_IDS.length
                ? 'Offline sample binding (#48-O)'
                : 'Offline sample binding (#48-Q)',
    })
  }

  return { claims, evidenceBindings, sourceSnapshots }
}

/**
 * Build a verified multi-subject KnowledgeRelease via the offline pipeline.
 * Pure / offline / deterministic for fixed contract version + hash impl.
 */
export async function buildSampleKnowledgeRelease(): Promise<KnowledgeRelease> {
  const fixture = await buildSampleOfflineFixture()
  const { release } = await runOfflinePublishPipeline({
    releaseId: SAMPLE_KNOWLEDGE_RELEASE_ID,
    releasedAt: SAMPLE_RELEASED_AT,
    fixture,
    gateAt: SAMPLE_GATED_AT,
  })
  return release
}

/**
 * Write sample into a store root (e.g. `public/knowledge-releases`) and
 * rewrite `index.json` with a fixed `generatedAt` for deterministic trees.
 */
export async function writeSampleKnowledgeRelease(root: string): Promise<{
  release: KnowledgeRelease
  dir: string
  file: string
  indexPath: string
}> {
  const fixture = await buildSampleOfflineFixture()
  const result = await runOfflinePublishAndWrite(
    root,
    {
      releaseId: SAMPLE_KNOWLEDGE_RELEASE_ID,
      releasedAt: SAMPLE_RELEASED_AT,
      fixture,
      gateAt: SAMPLE_GATED_AT,
    },
    { indexGeneratedAt: SAMPLE_RELEASED_AT },
  )

  const err = await verifyKnowledgeRelease(result.release)
  if (err) throw new Error(`sample release failed verify: ${err}`)

  return {
    release: result.release,
    dir: result.dir,
    file: result.file,
    indexPath: result.indexPath,
  }
}
