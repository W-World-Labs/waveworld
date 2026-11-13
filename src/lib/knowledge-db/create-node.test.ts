import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createKnowledgeNodeSync,
  normalizeCreateNodeInput,
} from './create-node.ts'
import { migrateKnowledgeDb } from './migrate.ts'
import { listKnowledgeNodes } from './read.ts'
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
    `k24-node-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('createKnowledgeNode (K24)', () => {
  it('normalizes body and rejects bad fields', () => {
    expect(() => normalizeCreateNodeInput({})).toThrow(/id is required/)
    expect(() =>
      normalizeCreateNodeInput({ id: 'node:x', name: '' }),
    ).toThrow(/name is required/)
    expect(() =>
      normalizeCreateNodeInput({ id: '../evil', name: 'x' }),
    ).toThrow(/path/)
    const ok = normalizeCreateNodeInput({
      id: ' node:demo ',
      name: ' Demo ',
      parent: ' node:parent ',
    })
    expect(ok.id).toBe('node:demo')
    expect(ok.parentId).toBe('node:parent')
  })

  it('creates node (+ stub parent); list returns it; idempotent', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })

    const input = normalizeCreateNodeInput({
      id: 'node:k24-write-demo',
      name: 'K24 Write Demo',
      nameEn: 'K24 Write Demo',
      parentId: 'node:k24-parent',
      desc: 'demo energy form',
      symbol: 'K24',
    })

    const r1 = createKnowledgeNodeSync(input, { root, dbPath })
    expect(r1.created).toBe(true)
    expect(r1.parentCreated).toBe(true)
    expect(r1.node.id).toBe('node:k24-write-demo')
    expect(r1.node.parentId).toBe('node:k24-parent')
    expect(r1.node.name).toBe('K24 Write Demo')

    const listed = listKnowledgeNodes(
      { q: 'k24-write-demo', limit: 10 },
      { dbPath },
    )
    expect(listed.total).toBeGreaterThanOrEqual(1)
    expect(listed.items.some((n) => n.id === 'node:k24-write-demo')).toBe(true)

    const r2 = createKnowledgeNodeSync(input, { root, dbPath })
    expect(r2.created).toBe(false)
    expect(r2.parentCreated).toBe(false)
  })
})
