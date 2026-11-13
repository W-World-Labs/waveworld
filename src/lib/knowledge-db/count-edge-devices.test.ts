import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countEdgeDevicesSync } from './count-edge-devices.ts'
import { migrateKnowledgeDb, openKnowledgeDb } from './migrate.ts'
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
    `k57-ed-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('countEdgeDevices (K57)', () => {
  it('counts devices after insert', () => {
    const dbPath = tempDb()
    migrateKnowledgeDb({ root, dbPath })
    expect(countEdgeDevicesSync({ root, dbPath }).total).toBe(0)

    const db = openKnowledgeDb({ dbPath, root })
    const now = '2026-01-01T00:00:00.000Z'
    db.prepare(
      `INSERT INTO energy_nodes (id, parent_id, name, name_en, symbol, icon, color,
         desc_zh, desc_en, quantities_json, consensus_json, refs_json, created_at, updated_at)
       VALUES ('n:a', null, 'A', null, null, null, null, '', null, '[]', '{}', null, ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO energy_nodes (id, parent_id, name, name_en, symbol, icon, color,
         desc_zh, desc_en, quantities_json, consensus_json, refs_json, created_at, updated_at)
       VALUES ('n:b', null, 'B', null, null, null, null, '', null, '[]', '{}', null, ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO conversion_edges (
         id, from_node_id, to_node_id, name, name_en, principle, principle_en,
         efficiency_kind, efficiency_json, formula_json, loss_mechanisms_json,
         maturity, apps_json, consensus_json, refs_json, status, created_at, updated_at
       ) VALUES ('e:1', 'n:a', 'n:b', 'edge', null, '', null, 'conversion',
         null, null, null, null, null, '{}', null, 'active', ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO edge_devices (id, edge_id, label, label_en, sort_order)
       VALUES ('d:1', 'e:1', 'dev1', null, 0)`,
    ).run()
    db.prepare(
      `INSERT INTO edge_devices (id, edge_id, label, label_en, sort_order)
       VALUES ('d:2', 'e:1', 'dev2', null, 1)`,
    ).run()
    db.close()

    const c = countEdgeDevicesSync({ root, dbPath })
    expect(c.total).toBe(2)
    expect(c.distinctEdges).toBe(1)
  })
})
