/**
 * Knowledge DB migrate smoke (temp file).
 * Requires apps/host better-sqlite3 install.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_SCHEMA_MIGRATION_ID,
  knowledgeDbStatus,
  migrateKnowledgeDb,
  openKnowledgeDb,
} from './index.ts'
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
    `waveworld-knowledge-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('knowledge-db migrate', () => {
  it('applies schema once and is idempotent', () => {
    const dbPath = tempDb()
    const r1 = migrateKnowledgeDb({ dbPath, root })
    expect(r1.applied).toContain(KNOWLEDGE_SCHEMA_MIGRATION_ID)
    expect(r1.tables).toContain('energy_nodes')
    expect(r1.tables).toContain('conversion_edges')
    expect(r1.tables).toContain('materials')
    expect(r1.tables).toContain('claims')
    expect(r1.tables).toContain('knowledge_releases')
    expect(r1.tables).toContain('schema_migrations')

    const r2 = migrateKnowledgeDb({ dbPath, root })
    expect(r2.applied).toEqual([])
    expect(r2.already).toContain(KNOWLEDGE_SCHEMA_MIGRATION_ID)
    expect(r2.tables.length).toBe(r1.tables.length)

    const status = knowledgeDbStatus({ dbPath, root })
    expect(status.exists).toBe(true)
    expect(status.migrations).toContain(KNOWLEDGE_SCHEMA_MIGRATION_ID)
    expect(status.counts?.energy_nodes).toBe(0)
    expect(status.counts?.conversion_edges).toBe(0)
  })

  it('enforces foreign keys on conversion_edges', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ dbPath, root })
    const db = openKnowledgeDb({ dbPath, root })
    try {
      const now = new Date().toISOString()
      expect(() => {
        db.prepare(
          `INSERT INTO conversion_edges (
            id, from_node_id, to_node_id, name, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run('e1', 'missing-a', 'missing-b', 'x', now, now)
      }).toThrow()

      db.prepare(
        `INSERT INTO energy_nodes (id, name, desc_zh, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('electric', '电能', 'desc', now, now)
      db.prepare(
        `INSERT INTO energy_nodes (id, name, desc_zh, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('thermal', '热能', 'desc', now, now)
      db.prepare(
        `INSERT INTO conversion_edges (
          id, from_node_id, to_node_id, name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('thermal-to-electric', 'thermal', 'electric', '热电', now, now)

      const n = db
        .prepare(`SELECT COUNT(*) AS c FROM conversion_edges`)
        .get() as { c: number }
      expect(n.c).toBe(1)
    } finally {
      db.close()
    }
  })
})
