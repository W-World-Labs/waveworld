/**
 * K3/K4: KNOWLEDGE_SOURCE=static|db adapter (default db).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConversionEdge, EnergyNode } from '../../data/ontology/types.ts'
import {
  createKnowledgeAdapter,
  resetKnowledgeAdapterCache,
} from './adapter.ts'
import { seedEfficiencyClaimsFromEdgesSync } from './seed-claims-from-edges.ts'
import { seedKnowledgeDbFromStaticSync } from './seed-from-static.ts'
import { repoRootFromHere } from './paths.ts'

const root = repoRootFromHere()
const temps: string[] = []

afterEach(() => {
  resetKnowledgeAdapterCache()
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
    `waveworld-knowledge-adapter-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
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
    refs: ['https://example.org/te'],
  },
]

describe('createKnowledgeAdapter', () => {
  it('static source serves injected ontology without DB claims', async () => {
    const adapter = createKnowledgeAdapter({
      source: 'static',
      loadStaticNodes: () => tinyNodes,
      loadStaticEdges: () => tinyEdges,
      loadStaticMaterials: () => [
        { id: 'mat:ar-lj', categoryId: 'lj', name: '氩' },
      ],
    })
    expect(adapter.source).toBe('static')
    const nodes = await adapter.listNodes({})
    expect(nodes.total).toBe(2)
    const edge = await adapter.getEdge('thermal-to-electric')
    expect(edge?.efficiency).toMatchObject({ min: 0.1, max: 0.4 })
    expect(edge?.releasedClaims).toEqual([])
    const mats = await adapter.listMaterials({})
    expect(mats.items[0]!.id).toBe('mat:ar-lj')
    const rel = await adapter.listReleases({})
    expect(rel.total).toBe(0)
  })

  it('db source embeds released efficiency claims on edge detail', async () => {
    const dbPath = tempDb()
    seedKnowledgeDbFromStaticSync({
      dbPath,
      root,
      nodes: tinyNodes,
      edges: tinyEdges,
      materialsFile: {
        categories: [
          {
            key: 'lj',
            label: 'LJ',
            materials: [
              {
                name: '氩',
                formula: 'Ar',
                sigma_nm: 0.34,
                epsilon_kJmol: 1,
                epsilon_over_kB_K: 120,
                charge_e: 0,
                mass_amu: 40,
              },
            ],
          },
        ],
      },
    })
    await seedEfficiencyClaimsFromEdgesSync({
      dbPath,
      root,
      skipMigrate: true,
      edges: tinyEdges,
    })

    const adapter = createKnowledgeAdapter({
      source: 'db',
      dbPath,
      root,
    })
    expect(adapter.source).toBe('db')
    const edge = await adapter.getEdge('thermal-to-electric')
    expect(edge?.releasedClaims?.length).toBe(1)
    expect(edge?.releasedClaims?.[0]?.state).toBe('released')
    const releases = await adapter.listReleases({})
    expect(releases.total).toBe(1)
  })

  it('env KNOWLEDGE_SOURCE selects mode', async () => {
    const a = createKnowledgeAdapter({
      env: { KNOWLEDGE_SOURCE: 'static' },
      loadStaticNodes: () => tinyNodes,
      loadStaticEdges: () => [],
      loadStaticMaterials: () => [],
    })
    expect(a.source).toBe('static')

    const dbPath = tempDb()
    seedKnowledgeDbFromStaticSync({
      dbPath,
      root,
      nodes: tinyNodes,
      edges: [],
      materialsFile: { categories: [] },
    })
    const b = createKnowledgeAdapter({
      env: { KNOWLEDGE_SOURCE: 'db' },
      dbPath,
      root,
    })
    expect(b.source).toBe('db')
    expect((await b.listNodes({})).total).toBe(2)
  })

  it('defaults to db when source/env unset (K4)', async () => {
    const dbPath = tempDb()
    seedKnowledgeDbFromStaticSync({
      dbPath,
      root,
      nodes: tinyNodes,
      edges: [],
      materialsFile: { categories: [] },
    })
    const adapter = createKnowledgeAdapter({
      env: {},
      dbPath,
      root,
    })
    expect(adapter.source).toBe('db')
    expect((await adapter.listNodes({})).total).toBe(2)
  })
})
