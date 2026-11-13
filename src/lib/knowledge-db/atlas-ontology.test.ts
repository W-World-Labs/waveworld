/**
 * K11: Atlas Matrix/Graph ontology load via createKnowledgeAdapter + static fallback.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConversionEdge, EnergyNode } from '../../data/ontology/types.ts'
import {
  knowledgeEdgeDtoToConversionEdge,
  knowledgeNodeDtoToEnergyNode,
  loadAtlasOntology,
  loadAtlasOntologyFromAdapter,
  loadAtlasOntologyStatic,
} from './atlas-ontology.ts'
import {
  createKnowledgeAdapter,
  resetKnowledgeAdapterCache,
} from './adapter.ts'
import { seedKnowledgeDbFromStaticSync } from './seed-from-static.ts'
import { repoRootFromHere } from './paths.ts'
import type { KnowledgeEdgeDto, KnowledgeNodeDto } from './read.ts'

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
    `waveworld-atlas-ontology-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

const tinyNodes: EnergyNode[] = [
  {
    id: 'electric',
    name: '电能',
    desc: 'e',
    quantities: [{ symbol: 'E', unit: 'J' }],
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
    device: ['热电偶'],
    products: [{ vendor: 'Acme', model: 'TEG-1', spec: '1W' }],
    efficiency: { symbol: 'η', unit: '1', min: 0.1, max: 0.4 },
    lossMechanisms: [{ name: 'loss', desc: 'd' }],
    consensus: { status: 'established' },
    refs: ['https://example.org/te'],
  },
]

describe('dto mappers', () => {
  it('maps node DTO to EnergyNode', () => {
    const dto: KnowledgeNodeDto = {
      id: 'chemical',
      parentId: null,
      name: '化学能',
      nameEn: 'Chemical',
      symbol: 'E_c',
      icon: '🔥',
      color: '#f00',
      desc: 'd',
      descEn: 'en',
      quantities: [{ symbol: 'ΔG', unit: 'J/mol' }],
      consensus: { status: 'established' },
      refs: ['https://ex.org'],
    }
    const n = knowledgeNodeDtoToEnergyNode(dto)
    expect(n.id).toBe('chemical')
    expect(n.parent).toBeUndefined()
    expect(n.quantities[0]?.symbol).toBe('ΔG')
    expect(n.consensus.status).toBe('established')
  })

  it('maps edge DTO and rejects missing efficiency', () => {
    const ok: KnowledgeEdgeDto = {
      id: 'e1',
      fromNodeId: 'a',
      toNodeId: 'b',
      name: 'n',
      nameEn: null,
      principle: 'p',
      principleEn: null,
      efficiencyKind: 'transport',
      efficiency: { symbol: 'COP', unit: '1', min: 2, max: 4 },
      formula: null,
      lossMechanisms: [],
      maturity: null,
      apps: null,
      consensus: { status: 'established' },
      refs: null,
      status: 'active',
      devices: ['热电偶', 'TEG'],
      products: [
        {
          vendor: 'V',
          vendorEn: 'Vendor',
          model: 'M1',
          modelEn: null,
          spec: 's',
          specEn: null,
        },
      ],
    }
    const e = knowledgeEdgeDtoToConversionEdge(ok)
    expect(e?.from).toBe('a')
    expect(e?.to).toBe('b')
    expect(e?.kind).toBe('transport')
    expect(e?.efficiency.max).toBe(4)
    expect(e?.device).toEqual(['热电偶', 'TEG'])
    expect(e?.products).toEqual([
      {
        vendor: 'V',
        vendorEn: 'Vendor',
        model: 'M1',
        spec: 's',
      },
    ])

    const bad: KnowledgeEdgeDto = { ...ok, efficiency: null }
    expect(knowledgeEdgeDtoToConversionEdge(bad)).toBeNull()
  })
})

describe('loadAtlasOntology', () => {
  it('loads via createKnowledgeAdapter source=static inject', async () => {
    const adapter = createKnowledgeAdapter({
      source: 'static',
      loadStaticNodes: () => tinyNodes,
      loadStaticEdges: () => tinyEdges,
      loadStaticMaterials: () => [],
    })
    const bundle = await loadAtlasOntologyFromAdapter(adapter)
    expect(bundle.source).toBe('static')
    expect(bundle.nodes).toHaveLength(2)
    expect(bundle.edges).toHaveLength(1)
    expect(bundle.edges[0]!.id).toBe('thermal-to-electric')
    expect(bundle.edges[0]!.device).toEqual(['热电偶'])
    expect(bundle.edges[0]!.products?.[0]?.model).toBe('TEG-1')
  })

  it('loads via createKnowledgeAdapter default db path', async () => {
    const dbPath = tempDb()
    seedKnowledgeDbFromStaticSync({
      dbPath,
      root,
      nodes: tinyNodes,
      edges: tinyEdges,
      materialsFile: { categories: [] },
    })
    const adapter = createKnowledgeAdapter({ source: 'db', dbPath, root })
    const bundle = await loadAtlasOntology({
      adapter,
      skipLocalAdapter: true,
      apiBase: '', // force no API
    })
    expect(bundle.source).toBe('db')
    expect(bundle.usedFallback).toBe(false)
    expect(bundle.nodes.map((n) => n.id).sort()).toEqual([
      'electric',
      'thermal',
    ])
    expect(bundle.edges).toHaveLength(1)
    expect(bundle.edges[0]!.efficiency.min).toBe(0.1)
    // K12: join tables populate device/product chips without static fallback
    expect(bundle.edges[0]!.device).toEqual(['热电偶'])
    expect(bundle.edges[0]!.products).toEqual([
      { vendor: 'Acme', model: 'TEG-1', spec: '1W' },
    ])
  })

  it('explicit static fallback when API fails', async () => {
    const fetchFail: typeof fetch = async () => {
      throw new Error('network down')
    }
    const bundle = await loadAtlasOntology({
      skipLocalAdapter: true,
      apiBase: '/api/v1/knowledge',
      fetchImpl: fetchFail,
    })
    expect(bundle.source).toBe('static')
    expect(bundle.usedFallback).toBe(true)
    expect(bundle.error).toMatch(/network down|HTTP|fetch/i)
    expect(bundle.nodes.length).toBeGreaterThan(10)
    expect(bundle.edges.length).toBeGreaterThan(50)
  })

  it('preferStatic forces packaged ontology', async () => {
    const bundle = await loadAtlasOntologyStatic()
    expect(bundle.source).toBe('static')
    expect(bundle.nodes.length).toBeGreaterThan(0)
    expect(bundle.edges.length).toBeGreaterThan(0)
  })
})
