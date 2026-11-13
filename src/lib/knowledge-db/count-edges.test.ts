import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  countEdgesByEfficiencyKindSync,
  countEdgesByStatusSync,
} from './count-edges.ts'
import {
  createKnowledgeEdgeSync,
  normalizeCreateEdgeInput,
} from './create-edge.ts'
import {
  createKnowledgeNodeSync,
  normalizeCreateNodeInput,
} from './create-node.ts'
import { migrateKnowledgeDb } from './migrate.ts'
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
    `k42-edges-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countEdgesByStatus (K42)', () => {
  it('counts active edges after create', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countEdgesByStatusSync({ root, dbPath }).total).toBe(0)

    createKnowledgeNodeSync(
      normalizeCreateNodeInput({ id: 'n:a', name: 'A' }),
      { root, dbPath },
    )
    createKnowledgeNodeSync(
      normalizeCreateNodeInput({ id: 'n:b', name: 'B' }),
      { root, dbPath },
    )
    createKnowledgeEdgeSync(
      normalizeCreateEdgeInput({
        id: 'e:k42',
        fromNodeId: 'n:a',
        toNodeId: 'n:b',
        name: 'edge',
        createClaim: false,
      }),
      { root, dbPath },
    )
    const c = countEdgesByStatusSync({ root, dbPath })
    expect(c.active).toBeGreaterThanOrEqual(1)
    expect(c.total).toBeGreaterThanOrEqual(1)
  })
})

describe('countEdgesByEfficiencyKind (K48)', () => {
  it('counts conversion and transport kinds', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countEdgesByEfficiencyKindSync({ root, dbPath }).total).toBe(0)

    createKnowledgeNodeSync(
      normalizeCreateNodeInput({ id: 'n:a', name: 'A' }),
      { root, dbPath },
    )
    createKnowledgeNodeSync(
      normalizeCreateNodeInput({ id: 'n:b', name: 'B' }),
      { root, dbPath },
    )
    createKnowledgeNodeSync(
      normalizeCreateNodeInput({ id: 'n:c', name: 'C' }),
      { root, dbPath },
    )
    createKnowledgeEdgeSync(
      normalizeCreateEdgeInput({
        id: 'e:conv',
        fromNodeId: 'n:a',
        toNodeId: 'n:b',
        name: 'conv',
        efficiencyKind: 'conversion',
        createClaim: false,
      }),
      { root, dbPath },
    )
    createKnowledgeEdgeSync(
      normalizeCreateEdgeInput({
        id: 'e:trans',
        fromNodeId: 'n:b',
        toNodeId: 'n:c',
        name: 'trans',
        efficiencyKind: 'transport',
        createClaim: false,
      }),
      { root, dbPath },
    )
    const c = countEdgesByEfficiencyKindSync({ root, dbPath })
    expect(c.conversion).toBe(1)
    expect(c.transport).toBe(1)
    expect(c.total).toBe(2)
  })
})
