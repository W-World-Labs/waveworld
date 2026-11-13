/**
 * K1 seed-from-static: idempotent upsert + count alignment with static inventory.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConversionEdge, EnergyNode } from '../../data/ontology/types.ts'
import {
  MATERIAL_ID_BY_NAME,
  countStaticMaterialProperties,
  orderNodesParentsFirst,
  readSeedCounts,
  resolveMaterialId,
  seedKnowledgeDbFromStaticData,
  seedKnowledgeDbFromStaticSync,
} from './seed-from-static.ts'
import { seedKnowledgeDbFromRepo, staticInventory } from './seed-from-static.repo.ts'
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
    `waveworld-knowledge-seed-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
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
  {
    id: 'el-current',
    parent: 'electric',
    name: '电流',
    desc: 'c',
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
    device: ['热电偶', 'TEG'],
    products: [{ vendor: 'V', model: 'M1', spec: 's' }],
  },
]

const tinyMaterials = {
  categories: [
    {
      key: 'noble-gas',
      label: '贵气体',
      materials: [
        {
          name: '氩',
          formula: 'Ar',
          sigma_nm: 0.3405,
          epsilon_kJmol: 0.9961,
          epsilon_over_kB_K: 119.8,
          charge_e: 0,
          mass_amu: 39.948,
          forcefield: 'LJ',
          source: 'test',
          fidelity: 'quantitative' as const,
        },
      ],
    },
  ],
}

describe('orderNodesParentsFirst', () => {
  it('places parents before children', () => {
    const shuffled = [tinyNodes[2]!, tinyNodes[0]!, tinyNodes[1]!]
    const ordered = orderNodesParentsFirst(shuffled)
    expect(ordered.map((n) => n.id)).toEqual([
      'electric',
      'el-current',
      'thermal',
    ])
  })
})

describe('material id map', () => {
  it('covers all 21 static material names', () => {
    const inv = staticInventory()
    expect(inv.materials).toBe(21)
    expect(Object.keys(MATERIAL_ID_BY_NAME)).toHaveLength(21)
    expect(resolveMaterialId('氩')).toBe('mat:ar-lj')
    expect(resolveMaterialId('TIP3P 氧位点')).toBe('mat:tip3p-o')
  })
})

describe('seed-from-static (fixture)', () => {
  it('upserts nodes/edges/materials and is idempotent', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })

    const r1 = seedKnowledgeDbFromStaticSync({
      dbPath,
      root,
      skipMigrate: true,
      nodes: tinyNodes,
      edges: tinyEdges,
      materialsFile: tinyMaterials,
    })
    expect(r1.counts.energy_nodes).toBe(3)
    expect(r1.counts.conversion_edges).toBe(1)
    expect(r1.counts.edge_devices).toBe(2)
    expect(r1.counts.edge_products).toBe(1)
    expect(r1.counts.materials).toBe(1)
    expect(r1.counts.material_properties).toBe(
      countStaticMaterialProperties(tinyMaterials),
    )
    expect(r1.counts.material_properties).toBe(5)

    const r2 = seedKnowledgeDbFromStaticSync({
      dbPath,
      root,
      skipMigrate: true,
      nodes: tinyNodes,
      edges: tinyEdges,
      materialsFile: tinyMaterials,
    })
    expect(r2.counts).toEqual(r1.counts)

    const db = openKnowledgeDb({ dbPath, root, readonly: true })
    try {
      const edge = db
        .prepare(
          `SELECT from_node_id, to_node_id, efficiency_kind FROM conversion_edges WHERE id = ?`,
        )
        .get('thermal-to-electric') as {
        from_node_id: string
        to_node_id: string
        efficiency_kind: string
      }
      expect(edge.from_node_id).toBe('thermal')
      expect(edge.to_node_id).toBe('electric')

      const mat = db
        .prepare(`SELECT id, name FROM materials WHERE id = ?`)
        .get('mat:ar-lj') as { id: string; name: string }
      expect(mat.name).toBe('氩')

      const props = db
        .prepare(
          `SELECT key, value_num FROM material_properties WHERE material_id = ? ORDER BY sort_order`,
        )
        .all('mat:ar-lj') as Array<{ key: string; value_num: number }>
      expect(props.map((p) => p.key)).toContain('sigma_nm')
      expect(props.find((p) => p.key === 'sigma_nm')!.value_num).toBeCloseTo(
        0.3405,
        6,
      )
    } finally {
      db.close()
    }
  })

  it('rejects edges whose nodes are missing (FK)', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const db = openKnowledgeDb({ dbPath, root })
    try {
      expect(() =>
        seedKnowledgeDbFromStaticData(db, {
          nodes: [],
          edges: tinyEdges,
          materialsFile: { categories: [] },
        }),
      ).toThrow()
    } finally {
      db.close()
    }
  })
})

describe('seed-from-static (full static inventory)', () => {
  it('aligns row counts with NODES/EDGES/materials and re-seed is stable', () => {
    const dbPath = tempDb()
    const inv = staticInventory()
    expect(inv.nodes).toBeGreaterThan(20)
    expect(inv.edges).toBeGreaterThanOrEqual(500)
    expect(inv.materials).toBe(21)
    expect(inv.material_properties).toBe(21 * 5)

    const r1 = seedKnowledgeDbFromRepo({ dbPath, root })
    expect(r1.counts.energy_nodes).toBe(inv.nodes)
    expect(r1.counts.conversion_edges).toBe(inv.edges)
    expect(r1.counts.materials).toBe(21)
    expect(r1.counts.material_properties).toBe(inv.material_properties)
    expect(r1.counts.material_categories).toBe(inv.categories)

    const r2 = seedKnowledgeDbFromRepo({ dbPath, root })
    expect(r2.counts).toEqual(r1.counts)

    const db = openKnowledgeDb({ dbPath, root, readonly: true })
    try {
      const sample = db
        .prepare(
          `SELECT id FROM conversion_edges WHERE id = ?`,
        )
        .get('em-radio-to-electric-rectenna') as { id: string } | undefined
      expect(sample?.id).toBe('em-radio-to-electric-rectenna')

      const orphan = db
        .prepare(
          `SELECT COUNT(*) AS c FROM conversion_edges e
           LEFT JOIN energy_nodes f ON f.id = e.from_node_id
           LEFT JOIN energy_nodes t ON t.id = e.to_node_id
           WHERE f.id IS NULL OR t.id IS NULL`,
        )
        .get() as { c: number }
      expect(orphan.c).toBe(0)

      expect(readSeedCounts(db).materials).toBe(21)
    } finally {
      db.close()
    }
  }, 60_000)
})
