import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countNodesByParentSync } from './count-nodes.ts'
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
    `k43-nodes-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countNodesByParent (K43)', () => {
  it('counts roots and children after create', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countNodesByParentSync({ root, dbPath })).toEqual({
      roots: 0,
      children: 0,
      total: 0,
    })

    createKnowledgeNodeSync(
      normalizeCreateNodeInput({ id: 'n:root', name: 'Root' }),
      { root, dbPath },
    )
    createKnowledgeNodeSync(
      normalizeCreateNodeInput({
        id: 'n:child',
        name: 'Child',
        parentId: 'n:root',
        ensureParent: false,
      }),
      { root, dbPath },
    )
    const c = countNodesByParentSync({ root, dbPath })
    expect(c.roots).toBe(1)
    expect(c.children).toBe(1)
    expect(c.total).toBe(2)
  })
})
