import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claimIdForConversionEfficiency,
  createKnowledgeEdgeSync,
  normalizeCreateEdgeInput,
} from './create-edge.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
import { listKnowledgeEdges } from './read.ts'
import { repoRootFromHere } from './paths.ts'

const root = repoRootFromHere()
const temps: string[] = []
afterEach(() => {
  for (const p of temps) {
    for (const s of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(p + s)
      } catch {
        /* */
      }
    }
  }
  temps.length = 0
})

function tempDb() {
  const p = path.join(
    os.tmpdir(),
    `k23-edge-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('createKnowledgeEdge (K23)', () => {
  it('normalizes body and rejects bad fields', () => {
    expect(() => normalizeCreateEdgeInput({})).toThrow(/id is required/)
    expect(() =>
      normalizeCreateEdgeInput({
        id: 'edge:x',
        fromNodeId: 'a',
        toNodeId: 'a',
        name: 'x',
      }),
    ).toThrow(/differ/)
    const ok = normalizeCreateEdgeInput({
      id: ' edge:demo ',
      from: ' node-a ',
      to: ' node-b ',
      name: ' Demo Edge ',
      efficiency: { eta: 0.5 },
    })
    expect(ok.id).toBe('edge:demo')
    expect(ok.fromNodeId).toBe('node-a')
    expect(ok.toNodeId).toBe('node-b')
    expect(ok.createClaim).toBe(true)
  })

  it('creates edge + efficiency claim; list returns it; idempotent', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })

    const input = normalizeCreateEdgeInput({
      id: 'edge:k23-write-demo',
      fromNodeId: 'node:k23-from',
      toNodeId: 'node:k23-to',
      name: 'K23 Write Demo Edge',
      nameEn: 'K23 Write Demo Edge',
      principle: 'demo conversion',
      efficiencyKind: 'conversion',
      efficiency: { eta: 0.42, unit: '1' },
      createClaim: true,
    })

    const r1 = createKnowledgeEdgeSync(input, { root, dbPath })
    expect(r1.created).toBe(true)
    expect(r1.claimCreated).toBe(true)
    expect(r1.claimId).toBe(
      claimIdForConversionEfficiency('edge:k23-write-demo'),
    )
    expect(r1.edge.id).toBe('edge:k23-write-demo')
    expect(r1.edge.fromNodeId).toBe('node:k23-from')
    expect(r1.nodesCreated.length).toBe(2)

    const listed = listKnowledgeEdges(
      { q: 'k23-write-demo', limit: 10 },
      { dbPath },
    )
    expect(listed.total).toBeGreaterThanOrEqual(1)
    expect(listed.items.some((e) => e.id === 'edge:k23-write-demo')).toBe(true)

    const db = openKnowledgeDb({ dbPath, root, readonly: true })
    try {
      const claim = db
        .prepare(`SELECT kind, state, subject_id FROM claims WHERE id = ?`)
        .get(r1.claimId!) as {
        kind: string
        state: string
        subject_id: string
      }
      expect(claim.kind).toBe('conversion.efficiency')
      expect(claim.state).toBe('candidate')
      expect(claim.subject_id).toBe('edge:k23-write-demo')
    } finally {
      db.close()
    }

    const r2 = createKnowledgeEdgeSync(input, { root, dbPath })
    expect(r2.created).toBe(false)
    expect(r2.claimCreated).toBe(false)
  })
})
