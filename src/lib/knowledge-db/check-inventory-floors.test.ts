import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_INVENTORY_FLOORS,
  checkInventoryFloors,
  formatInventoryFloorMarkdown,
  formatInventoryFloorReport,
} from './check-inventory-floors.ts'

describe('K64 checkInventoryFloors', () => {
  it('passes when all floors met', () => {
    const r = checkInventoryFloors({
      nodes: 55,
      edges: 588,
      materials: 21,
      materialProperties: 105,
      materialCategories: 4,
      edgeDevices: 10,
      edgeProducts: 1290,
      evidenceBindings: 1141,
      claims: 588,
      snapshots: 800,
      releases: 1,
      ingestCursors: 2,
    })
    expect(r.ok).toBe(true)
  })

  it('fails closed on empty core tables', () => {
    const r = checkInventoryFloors({
      nodes: 0,
      edges: 0,
      materials: 0,
      materialProperties: 0,
      materialCategories: 0,
      edgeDevices: 0,
      edgeProducts: 0,
      evidenceBindings: 0,
      claims: 0,
      snapshots: 0,
      releases: 0,
      ingestCursors: 0,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.violations.length).toBe(Object.keys(KNOWLEDGE_INVENTORY_FLOORS).length)
      expect(r.violations.map((v) => v.field)).toContain('nodes')
      expect(r.violations.map((v) => v.field)).toContain('materialProperties')
    }
  })

  it('K66 expanded floors catch missing materialProperties', () => {
    const r = checkInventoryFloors({
      nodes: 55,
      edges: 588,
      materials: 21,
      materialProperties: 0,
      materialCategories: 4,
      edgeDevices: 10,
      edgeProducts: 10,
      evidenceBindings: 10,
      claims: 588,
      snapshots: 800,
      releases: 1,
      ingestCursors: 2,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.violations).toEqual([
        { field: 'materialProperties', actual: 0, min: 5 },
      ])
    }
  })

  it('K67 floors require ingestCursors', () => {
    const r = checkInventoryFloors({
      nodes: 55,
      edges: 588,
      materials: 21,
      materialProperties: 105,
      materialCategories: 4,
      edgeDevices: 10,
      edgeProducts: 10,
      evidenceBindings: 10,
      claims: 588,
      snapshots: 800,
      releases: 1,
      ingestCursors: 0,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.violations).toEqual([{ field: 'ingestCursors', actual: 0, min: 1 }])
    }
  })

  it('allows custom floors', () => {
    const r = checkInventoryFloors({ nodes: 10, edges: 1 }, { nodes: 50 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.violations).toEqual([{ field: 'nodes', actual: 10, min: 50 }])
    }
  })
})

describe('K65 formatInventoryFloorReport', () => {
  it('formats ok one-liner', () => {
    expect(formatInventoryFloorReport({ ok: true })).toBe('inventory floors: ok')
  })

  it('formats FAIL with actual/min pairs', () => {
    const r = checkInventoryFloors(
      { nodes: 0, edges: 2 },
      { nodes: 1, edges: 5 },
    )
    expect(r.ok).toBe(false)
    const line = formatInventoryFloorReport(r)
    expect(line.startsWith('inventory floors: FAIL ')).toBe(true)
    expect(line).toContain('nodes actual=0 < min=1')
    expect(line).toContain('edges actual=2 < min=5')
  })

  it('formats markdown table for ok and fail', () => {
    const okMd = formatInventoryFloorMarkdown({ ok: true })
    expect(okMd).toContain('| field | actual | min | status |')
    expect(okMd).toContain('| ok |')

    const fail = checkInventoryFloors({ nodes: 0 }, { nodes: 1 })
    const failMd = formatInventoryFloorMarkdown(fail)
    expect(failMd).toContain('| nodes | 0 | 1 | FAIL |')
  })
})
