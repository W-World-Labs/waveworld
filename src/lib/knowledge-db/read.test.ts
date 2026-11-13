/**
 * K3: public read API (released-only claims) + pagination.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConversionEdge, EnergyNode } from '../../data/ontology/types.ts'
import {
  countNonReleasedInPublicView,
  getKnowledgeConflictSet,
  getKnowledgeEdge,
  getKnowledgeMaterial,
  getKnowledgeNode,
  getKnowledgeRelease,
  getLatestKnowledgeRelease,
  listKnowledgeConflictSets,
  listKnowledgeEdges,
  listKnowledgeMaterials,
  listKnowledgeNodes,
  listKnowledgeReleases,
  listReleasedClaimsForSubject,
  listSourceSnapshotsByContentSha,
  getSourceSnapshot,
} from './read.ts'
import { seedEfficiencyClaimsFromEdgesSync } from './seed-claims-from-edges.ts'
import { seedKnowledgeDbFromStaticSync } from './seed-from-static.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere } from './paths.ts'
import {
  DEFAULT_KNOWLEDGE_SOURCE,
  KNOWLEDGE_SEED_EDGES_DATA_PATH,
  KNOWLEDGE_SEED_ONLY_STATIC_PATHS,
  resolveKnowledgeSource,
} from './source.ts'

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
    `waveworld-knowledge-read-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
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
    device: ['热电偶', 'TEG'],
    products: [
      { vendor: 'Acme', model: 'TEG-100', vendorEn: 'Acme', spec: '100W' },
    ],
    efficiency: { symbol: 'η', unit: '1', min: 0.1, max: 0.4 },
    lossMechanisms: [],
    consensus: { status: 'established' },
    refs: ['https://example.org/thermoelectric'],
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

async function seedTiny(dbPath: string) {
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
}

describe('resolveKnowledgeSource', () => {
  it('defaults to db (K4); accepts static aliases and db aliases', () => {
    expect(resolveKnowledgeSource({})).toBe('db')
    expect(resolveKnowledgeSource({ KNOWLEDGE_SOURCE: '' })).toBe('db')
    expect(resolveKnowledgeSource({ KNOWLEDGE_SOURCE: 'db' })).toBe('db')
    expect(resolveKnowledgeSource({ KNOWLEDGE_SOURCE: 'DATABASE' })).toBe('db')
    expect(resolveKnowledgeSource({ KNOWLEDGE_SOURCE: 'sqlite' })).toBe('db')
    expect(resolveKnowledgeSource({ KNOWLEDGE_SOURCE: 'static' })).toBe(
      'static',
    )
    expect(resolveKnowledgeSource({ KNOWLEDGE_SOURCE: 'json' })).toBe('static')
    expect(resolveKnowledgeSource({ KNOWLEDGE_SOURCE: 'nope' })).toBe('db')
  })

  it('K9: edges.data.json is seed-only; default prod authority is knowledge.db', () => {
    expect(DEFAULT_KNOWLEDGE_SOURCE).toBe('db')
    expect(KNOWLEDGE_SEED_EDGES_DATA_PATH).toBe(
      'src/data/ontology/edges.data.json',
    )
    expect(KNOWLEDGE_SEED_ONLY_STATIC_PATHS).toContain(
      KNOWLEDGE_SEED_EDGES_DATA_PATH,
    )
    // Explicit static remains available for seed/emergency, never the default.
    expect(resolveKnowledgeSource({ KNOWLEDGE_SOURCE: 'static' })).toBe(
      'static',
    )
    expect(resolveKnowledgeSource({})).not.toBe('static')
    // Seed inventory file exists in-repo but is not the runtime source.
    const edgesAbs = path.join(root, KNOWLEDGE_SEED_EDGES_DATA_PATH)
    expect(fs.existsSync(edgesAbs)).toBe(true)
  })
})

describe('knowledge-db public read API', () => {
  it('lists nodes/edges/materials with pagination', async () => {
    const dbPath = tempDb()
    await seedTiny(dbPath)
    const opts = { dbPath, root }

    const nodes = listKnowledgeNodes({ limit: 1, offset: 0 }, opts)
    expect(nodes.total).toBe(2)
    expect(nodes.items).toHaveLength(1)
    expect(nodes.items[0]!.id).toBe('electric')

    // K36: parentId filter (tiny seed nodes are roots → parent null)
    const roots = listKnowledgeNodes({ parentId: '__root__' }, opts)
    expect(roots.total).toBe(2)
    expect(roots.items.every((n) => n.parentId == null)).toBe(true)
    const childOfMissing = listKnowledgeNodes({ parentId: 'no-such-parent' }, opts)
    expect(childOfMissing.total).toBe(0)

    const edges = listKnowledgeEdges({ limit: 10 }, opts)
    expect(edges.total).toBe(2)
    expect(edges.items.map((e) => e.id).sort()).toEqual([
      'electric-to-thermal-heatpump',
      'thermal-to-electric',
    ])
    // K37: efficiencyKind filter (seed: TEG conversion, heatpump transport)
    const conv = listKnowledgeEdges({ efficiencyKind: 'conversion', limit: 10 }, opts)
    expect(conv.total).toBe(1)
    expect(conv.items.every((e) => e.efficiencyKind === 'conversion')).toBe(true)
    const transport = listKnowledgeEdges({ efficiencyKind: 'transport', limit: 10 }, opts)
    expect(transport.total).toBe(1)
    expect(transport.items[0]!.id).toBe('electric-to-thermal-heatpump')
    const teg = edges.items.find((e) => e.id === 'thermal-to-electric')!
    expect(teg.devices).toEqual(['热电偶', 'TEG'])
    expect(teg.products).toEqual([
      {
        vendor: 'Acme',
        vendorEn: 'Acme',
        model: 'TEG-100',
        modelEn: null,
        spec: '100W',
        specEn: null,
      },
    ])
    const hp = edges.items.find(
      (e) => e.id === 'electric-to-thermal-heatpump',
    )!
    expect(hp.devices).toEqual([])
    expect(hp.products).toEqual([])

    const mats = listKnowledgeMaterials({}, opts)
    expect(mats.total).toBe(1)
    expect(mats.items[0]!.id).toBe('mat:ar-lj')

    // K35: kind filter
    const byKind = listKnowledgeMaterials({ kind: mats.items[0]!.kind }, opts)
    expect(byKind.total).toBeGreaterThanOrEqual(1)
    expect(byKind.items.every((m) => m.kind === mats.items[0]!.kind)).toBe(true)
    const miss = listKnowledgeMaterials({ kind: 'no-such-kind-xyz' }, opts)
    expect(miss.total).toBe(0)
    expect(miss.items).toHaveLength(0)
  })

  it('edge detail embeds released efficiency claims only', async () => {
    const dbPath = tempDb()
    await seedTiny(dbPath)
    const opts = { dbPath, root }

    const edge = getKnowledgeEdge('thermal-to-electric', opts)
    expect(edge).not.toBeNull()
    expect(edge!.devices).toEqual(['热电偶', 'TEG'])
    expect(edge!.products[0]?.model).toBe('TEG-100')
    expect(edge!.releasedClaims).toBeDefined()
    expect(edge!.releasedClaims!.length).toBe(1)
    const claim = edge!.releasedClaims![0]!
    expect(claim.state).toBe('released')
    expect(claim.kind).toBe('conversion.efficiency')
    expect(claim.subjectId).toBe('thermal-to-electric')
    expect(claim.statement).toMatchObject({ metric: 'eta' })

    // Inject a candidate claim that must never appear on public edge detail
    const db = openKnowledgeDb({ dbPath, root })
    try {
      db.prepare(
        `INSERT INTO claims (
          id, contract_version, kind, subject_id, statement_json, state,
          confidence, created_at, updated_at
        ) VALUES (
          'claim:cand:secret', 1, 'conversion.efficiency', 'thermal-to-electric',
          '{"metric":"eta","value":0.99,"unit":"1"}', 'candidate', 0.1,
          '2026-08-06T00:00:00.000Z', null
        )`,
      ).run()
    } finally {
      db.close()
    }

    const again = getKnowledgeEdge('thermal-to-electric', {
      dbPath,
      root,
    })
    expect(again!.releasedClaims!.every((c) => c.state === 'released')).toBe(
      true,
    )
    expect(
      again!.releasedClaims!.some((c) => c.id === 'claim:cand:secret'),
    ).toBe(false)

    const bySubject = listReleasedClaimsForSubject('thermal-to-electric', {
      dbPath,
      root,
    })
    expect(bySubject.every((c) => c.state === 'released')).toBe(true)
    expect(bySubject.some((c) => c.id === 'claim:cand:secret')).toBe(false)
    expect(countNonReleasedInPublicView({ dbPath, root })).toBe(0)
  })

  it('list edges can embed released claims; releases are released-only', async () => {
    const dbPath = tempDb()
    await seedTiny(dbPath)
    const opts = { dbPath, root }

    const page = listKnowledgeEdges(
      { embedReleasedClaims: true, limit: 50 },
      opts,
    )
    expect(page.items.every((e) => Array.isArray(e.releasedClaims))).toBe(true)
    const withClaims = page.items.filter(
      (e) => (e.releasedClaims?.length ?? 0) > 0,
    )
    expect(withClaims.length).toBe(2)

    const releases = listKnowledgeReleases({}, opts)
    expect(releases.total).toBe(1)
    expect(releases.items[0]!.state).toBe('released')
    expect(releases.items[0]!.claimCount).toBe(2)

    const latest = getLatestKnowledgeRelease(opts)
    expect(latest?.id).toBe(releases.items[0]!.id)
    expect(latest?.claimIds?.length).toBe(2)

    const detail = getKnowledgeRelease(latest!.id, {
      ...opts,
      includeClaims: true,
    })
    expect(detail?.claims?.every((c) => c.state === 'released')).toBe(true)
    expect(detail?.claims?.length).toBe(2)

    expect(getKnowledgeNode('electric', opts)?.name).toBe('电能')
    expect(getKnowledgeMaterial('mat:ar-lj', opts)?.properties?.length).toBe(5)
  })

  it('empty migrate DB returns empty pages', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const opts = { dbPath, root }
    expect(listKnowledgeNodes({}, opts).total).toBe(0)
    expect(listKnowledgeEdges({}, opts).total).toBe(0)
    expect(listKnowledgeReleases({}, opts).total).toBe(0)
    expect(getLatestKnowledgeRelease(opts)).toBeNull()
  })
})

describe('listKnowledgeConflictSets (K17)', () => {
  it('lists empty when no conflicts; filters by state/subject after insert', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    seedKnowledgeDbFromStaticSync({
      root,
      dbPath,
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
              },
            ],
          },
        ],
      },
    })
    const empty = listKnowledgeConflictSets({}, { dbPath })
    expect(empty.total).toBe(0)
    expect(empty.items).toEqual([])

    const db = openKnowledgeDb({ root, dbPath })
    db.prepare(
      `INSERT INTO conflict_sets (id, contract_version, subject_id, reason, state, created_at)
       VALUES (?, 1, ?, ?, 'open', ?)`,
    ).run('c-open-1', 'edge:a-b', 'two claims disagree', new Date().toISOString())
    db.prepare(
      `INSERT INTO conflict_sets (id, contract_version, subject_id, reason, state, created_at, updated_at)
       VALUES (?, 1, ?, ?, 'resolved', ?, ?)`,
    ).run(
      'c-res-1',
      'edge:a-b',
      'resolved via release',
      new Date().toISOString(),
      new Date().toISOString(),
    )
    // member needs a real claim id — insert minimal claim if seed created any
    const claim = db.prepare(`SELECT id FROM claims LIMIT 1`).get() as { id: string } | undefined
    if (claim) {
      db.prepare(
        `INSERT INTO conflict_members (conflict_id, claim_id) VALUES (?, ?)`,
      ).run('c-open-1', claim.id)
    }
    db.close()

    const all = listKnowledgeConflictSets({}, { dbPath })
    expect(all.total).toBe(2)
    expect(all.state).toBe('all')
    const openOnly = listKnowledgeConflictSets({ state: 'open' }, { dbPath })
    expect(openOnly.total).toBe(1)
    expect(openOnly.state).toBe('open')
    expect(openOnly.items[0]?.id).toBe('c-open-1')
    if (claim) {
      expect(openOnly.items[0]?.claimIds).toContain(claim.id)
    }
    const bySubject = listKnowledgeConflictSets(
      { subjectId: 'edge:a-b' },
      { dbPath },
    )
    expect(bySubject.total).toBe(2)
    const one = getKnowledgeConflictSet('c-res-1', { dbPath })
    expect(one?.state).toBe('resolved')
    expect(getKnowledgeConflictSet('missing', { dbPath })).toBeNull()
  })
})

describe('listKnowledgeConflictSets state filter (K31)', () => {
  it('filters open|resolved|all and echoes applied state', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    const db = openKnowledgeDb({ root, dbPath })
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO conflict_sets (id, contract_version, subject_id, reason, state, created_at)
       VALUES (?, 1, ?, ?, 'open', ?)`,
    ).run('k31-open', 'edge:k31', 'open demo', now)
    db.prepare(
      `INSERT INTO conflict_sets (id, contract_version, subject_id, reason, state, created_at, updated_at, resolution_note)
       VALUES (?, 1, ?, ?, 'resolved', ?, ?, ?)`,
    ).run(
      'k31-res',
      'edge:k31',
      'resolved demo',
      now,
      now,
      'closed in K31 test',
    )
    db.close()

    const open = listKnowledgeConflictSets({ state: 'open' }, { dbPath })
    expect(open.state).toBe('open')
    expect(open.total).toBe(1)
    expect(open.items.map((x) => x.id)).toEqual(['k31-open'])

    const resolved = listKnowledgeConflictSets({ state: 'resolved' }, { dbPath })
    expect(resolved.state).toBe('resolved')
    expect(resolved.total).toBe(1)
    expect(resolved.items[0]?.id).toBe('k31-res')
    expect(resolved.items[0]?.resolutionNote).toBe('closed in K31 test')

    const all = listKnowledgeConflictSets({ state: 'all' }, { dbPath })
    expect(all.state).toBe('all')
    expect(all.total).toBe(2)
    expect(all.items.map((x) => x.id).sort()).toEqual(['k31-open', 'k31-res'].sort())

    const def = listKnowledgeConflictSets({}, { dbPath })
    expect(def.state).toBe('all')
    expect(def.total).toBe(2)

    const invalid = listKnowledgeConflictSets(
      { state: 'nope' as 'open' },
      { dbPath },
    )
    expect(invalid.state).toBe('all')
    expect(invalid.total).toBe(2)
  })
})

describe('C2/K19 durable reverse index by content_sha256', () => {
  it('lists source_snapshots by content sha (idx_snap_sha)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdb-rev-'))
    temps.push(dir)
    const dbPath = path.join(dir, 'knowledge.db')
    migrateKnowledgeDb({ dbPath })
    const db = openKnowledgeDb({ dbPath })
    const sha =
      'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
    const sha2 =
      '112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00'
    db.prepare(
      `INSERT INTO source_snapshots (
         id, contract_version, locator, locator_kind, captured_at,
         content_sha256, capture_status, content_type, byte_length,
         license, title, provider, blob_relpath
       ) VALUES (?, 1, ?, 'url', ?, ?, 'bytes-captured', 'text/plain', 12,
         null, 't1', 'test', 'ab/cd.bin')`,
    ).run('snap-a', 'https://example.com/a', '2026-01-01T00:00:00.000Z', sha)
    db.prepare(
      `INSERT INTO source_snapshots (
         id, contract_version, locator, locator_kind, captured_at,
         content_sha256, capture_status, content_type, byte_length,
         license, title, provider, blob_relpath
       ) VALUES (?, 1, ?, 'url', ?, ?, 'locator-only', null, null,
         null, 't2', 'test', null)`,
    ).run('snap-b', 'https://example.com/b', '2026-01-02T00:00:00.000Z', sha)
    db.prepare(
      `INSERT INTO source_snapshots (
         id, contract_version, locator, locator_kind, captured_at,
         content_sha256, capture_status, content_type, byte_length,
         license, title, provider, blob_relpath
       ) VALUES (?, 1, ?, 'doi', ?, ?, 'locator-only', null, null,
         null, 'other', 'test', null)`,
    ).run('snap-c', '10.1000/xyz', '2026-01-03T00:00:00.000Z', sha2)
    db.close()

    const hits = listSourceSnapshotsByContentSha(sha, { dbPath })
    expect(hits).toHaveLength(2)
    expect(hits.map((h) => h.id).sort()).toEqual(['snap-a', 'snap-b'])
    expect(hits.every((h) => h.contentSha256 === sha)).toBe(true)
    expect(hits.find((h) => h.id === 'snap-a')?.captureStatus).toBe(
      'bytes-captured',
    )
    expect(hits.find((h) => h.id === 'snap-a')?.blobRelpath).toBe('ab/cd.bin')

    expect(listSourceSnapshotsByContentSha(sha2, { dbPath })).toHaveLength(1)
    expect(listSourceSnapshotsByContentSha('not-a-sha', { dbPath })).toEqual([])
    expect(listSourceSnapshotsByContentSha('0'.repeat(64), { dbPath })).toEqual(
      [],
    )
    expect(getSourceSnapshot('snap-a', { dbPath })?.locator).toBe(
      'https://example.com/a',
    )
    expect(getSourceSnapshot('missing', { dbPath })).toBeNull()
  })
})
