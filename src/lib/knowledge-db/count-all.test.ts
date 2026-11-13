import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  countKnowledgeInventorySync,
  dumpKnowledgeInventoryEvidenceSync,
  summarizeKnowledgeInventory,
} from './count-all.ts'
import { migrateKnowledgeDb } from './migrate.ts'

let fixtureDir = ''
let fixtureDbPath = ''

beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waveworld-knowledge-inventory-'))
  fixtureDbPath = path.join(fixtureDir, 'knowledge.db')
  migrateKnowledgeDb({ dbPath: fixtureDbPath })
})

afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true })
})

describe('countKnowledgeInventory (K61)', () => {
  it('returns inventory shape from a migrated clean-checkout fixture', () => {
    const inv = countKnowledgeInventorySync({ dbPath: fixtureDbPath })
    expect(inv.nodes.total).toBeGreaterThanOrEqual(0)
    expect(inv.edges.total).toBeGreaterThanOrEqual(0)
    expect(inv.claims.total).toBeGreaterThanOrEqual(0)
    expect(inv.materials.total).toBeGreaterThanOrEqual(0)
    expect(inv.releases.total).toBeGreaterThanOrEqual(0)
    expect(inv.ingestCursors.total).toBeGreaterThanOrEqual(0)
    // nested keys present
    expect(inv.nodes).toHaveProperty('roots')
    expect(inv.claims).toHaveProperty('candidate')
    expect(inv.evidenceBindings).toHaveProperty('supports')
  })
})

describe('dumpKnowledgeInventoryEvidence (K63)', () => {
  it('returns evidence envelope with path, migrations, summary', () => {
    const ev = dumpKnowledgeInventoryEvidenceSync({ dbPath: fixtureDbPath })
    expect(ev.source).toBe('db')
    expect(ev.exists).toBe(true)
    expect(typeof ev.dbPath).toBe('string')
    expect(ev.dbPath.length).toBeGreaterThan(0)
    expect(ev.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(Array.isArray(ev.migrations)).toBe(true)
    expect(ev.migrations.length).toBeGreaterThanOrEqual(1)
    expect(ev.tableCount).toBeGreaterThanOrEqual(10)
    expect(ev.tables).toContain('energy_nodes')
    expect(ev.tables).toContain('conversion_edges')
    expect(ev.tables).toContain('claims')
    expect(ev.counts.nodes.total).toBe(ev.summary.nodes)
    expect(ev.counts.edges.total).toBe(ev.summary.edges)
    expect(ev.counts.claims.total).toBe(ev.summary.claims)
    expect(ev.counts.claims.released).toBe(ev.summary.claimsReleased)
    expect(ev.counts.materials.total).toBe(ev.summary.materials)
    expect(ev.counts.ingestCursors.total).toBe(ev.summary.ingestCursors)
    expect(ev.summaryLine).toContain(`nodes=${ev.summary.nodes}`)
    expect(ev.summaryLine).toContain(`edges=${ev.summary.edges}`)
    expect(ev.summaryLine).toContain(`claims=${ev.summary.claims}`)
  })

  it('summarizeKnowledgeInventory mirrors nested totals', () => {
    const counts = countKnowledgeInventorySync({ dbPath: fixtureDbPath })
    const summary = summarizeKnowledgeInventory(counts)
    expect(summary.nodes).toBe(counts.nodes.total)
    expect(summary.conflictsOpen).toBe(counts.conflicts.open)
    expect(summary.releasesWithExport).toBe(counts.releases.withExport)
  })
})
