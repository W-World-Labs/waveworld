/**
 * K2: edge efficiency → claims/releases + v_released_claims + deterministic sha256.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConversionEdge, EnergyNode } from '../../data/ontology/types.ts'
import { verifyKnowledgeRelease } from '../knowledge/release.ts'
import {
  SEED_EFFICIENCY_RELEASE_ID,
  SEED_RELEASED_AT,
  buildEdgeEfficiencyClaimBundle,
  claimIdForEdgeEfficiency,
  efficiencyStatementFromQuantity,
  promoteEdgeEfficiencyBundle,
  readClaimSeedCounts,
  seedEfficiencyClaimsFromEdgesSync,
} from './seed-claims-from-edges.ts'
import {
  seedKnowledgeDbFromStaticSync,
} from './seed-from-static.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere } from './paths.ts'

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
    `waveworld-knowledge-claims-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

const tinyNodes: EnergyNode[] = [
  {
    id: 'electric',
    name: '电能',
    desc: 'e',
    quantities: [],
    consensus: { status: 'established' },
  },
  {
    id: 'thermal',
    name: '热能',
    desc: 't',
    quantities: [],
    consensus: { status: 'established' },
  },
]

const tinyEdges: ConversionEdge[] = [
  {
    id: 'thermal-to-electric',
    from: 'thermal',
    to: 'electric',
    name: '热电',
    principle: 'p',
    efficiency: { symbol: 'η', unit: '1', min: 0.1, max: 0.4 },
    lossMechanisms: [],
    consensus: { status: 'established' },
    refs: [
      'https://example.org/thermoelectric',
      'https://example.org/seebeck',
    ],
  },
  {
    id: 'electric-to-thermal-heatpump',
    from: 'electric',
    to: 'thermal',
    name: '热泵',
    principle: 'p',
    kind: 'transport',
    efficiency: { symbol: 'COP', unit: '1', min: 2, max: 5 },
    lossMechanisms: [],
    consensus: { status: 'established' },
    refs: ['https://example.org/heatpump'],
  },
]

const emptyMaterials = { categories: [] as Array<{ key: string; label: string; materials: [] }> }

describe('efficiencyStatementFromQuantity', () => {
  it('maps eta range and COP transport', () => {
    const eta = efficiencyStatementFromQuantity({
      symbol: 'η',
      unit: '1',
      min: 0.1,
      max: 0.3,
    })
    expect(eta.metric).toBe('eta')
    expect(eta.value).toBeCloseTo(0.2, 6)
    expect(eta.etaMin).toBe(0.1)
    expect(eta.etaMax).toBe(0.3)

    const cop = efficiencyStatementFromQuantity(
      { symbol: 'COP', unit: '1', min: 2, max: 4 },
      'transport',
    )
    expect(cop.metric).toBe('cop')
    expect(cop.value).toBeCloseTo(3, 6)
  })
})

describe('seed efficiency claims (fixture)', () => {
  it('candidate→released path, v_released_claims, deterministic sha256', async () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    seedKnowledgeDbFromStaticSync({
      dbPath,
      root,
      skipMigrate: true,
      nodes: tinyNodes,
      edges: tinyEdges,
      materialsFile: emptyMaterials,
    })

    const r1 = await seedEfficiencyClaimsFromEdgesSync({
      dbPath,
      root,
      skipMigrate: true,
      edges: tinyEdges,
    })
    expect(r1.releaseId).toBe(SEED_EFFICIENCY_RELEASE_ID)
    expect(r1.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(r1.edgeClaimCount).toBe(2)
    expect(r1.counts.claims_released).toBe(2)
    expect(r1.counts.knowledge_releases).toBe(1)

    const r2 = await seedEfficiencyClaimsFromEdgesSync({
      dbPath,
      root,
      skipMigrate: true,
      edges: tinyEdges,
    })
    expect(r2.sha256).toBe(r1.sha256)
    expect(r2.counts).toEqual(r1.counts)

    // Pure bundle → same digest without DB (fixed input)
    const bundle = await buildEdgeEfficiencyClaimBundle(tinyEdges)
    const promoted = await promoteEdgeEfficiencyBundle(bundle)
    expect(promoted.release.sha256).toBe(r1.sha256)
    expect(promoted.release.releasedAt).toBe(SEED_RELEASED_AT)
    expect(await verifyKnowledgeRelease(promoted.release)).toBeNull()

    const db = openKnowledgeDb({ dbPath, root, readonly: true })
    try {
      const claimId = claimIdForEdgeEfficiency('thermal-to-electric')
      const claim = db
        .prepare(
          `SELECT id, kind, subject_id, state FROM claims WHERE subject_id = ? AND kind = ?`,
        )
        .get('thermal-to-electric', 'conversion.efficiency') as {
        id: string
        kind: string
        subject_id: string
        state: string
      }
      expect(claim.id).toBe(claimId)
      expect(claim.state).toBe('released')

      const view = db
        .prepare(
          `SELECT id, subject_id, state FROM v_released_claims WHERE subject_id = ?`,
        )
        .get('thermal-to-electric') as {
        id: string
        subject_id: string
        state: string
      }
      expect(view.id).toBe(claimId)
      expect(view.state).toBe('released')

      const rel = db
        .prepare(
          `SELECT id, sha256, released_at FROM knowledge_releases WHERE id = ?`,
        )
        .get(SEED_EFFICIENCY_RELEASE_ID) as {
        id: string
        sha256: string
        released_at: string
      }
      expect(rel.sha256).toBe(r1.sha256)
      expect(rel.released_at).toBe(SEED_RELEASED_AT)

      const binds = db
        .prepare(
          `SELECT COUNT(*) AS c FROM evidence_bindings WHERE claim_id = ?`,
        )
        .get(claimId) as { c: number }
      expect(binds.c).toBe(2)

      const counts = readClaimSeedCounts(db)
      expect(counts.claims_released).toBe(2)
      expect(counts.release_claims).toBe(2)
    } finally {
      db.close()
    }
  })

  it('order of edges does not change release sha256', async () => {
    const a = await promoteEdgeEfficiencyBundle(
      await buildEdgeEfficiencyClaimBundle(tinyEdges),
    )
    const b = await promoteEdgeEfficiencyBundle(
      await buildEdgeEfficiencyClaimBundle([...tinyEdges].reverse()),
    )
    expect(a.release.sha256).toBe(b.release.sha256)
  })
})
