import { describe, expect, it } from 'vitest'
import type {
  KnowledgeInventoryCounts,
  KnowledgeInventorySummary,
} from './count-all.ts'
import {
  extractInventoryTotals,
  formatInventoryMarkdown,
  formatInventorySummary,
} from './format-inventory-summary.ts'

function fixtureCounts(
  overrides: Partial<
    Record<keyof KnowledgeInventoryCounts, { total: number } & Record<string, number>>
  > = {},
): KnowledgeInventoryCounts {
  const base = {
    nodes: { roots: 0, children: 0, total: 0 },
    edges: { active: 0, inactive: 0, total: 0, other: 0 },
    edgeDevices: { total: 0, distinctEdges: 0 },
    edgeProducts: { total: 0, distinctEdges: 0 },
    materials: {
      forcefield_lj: 0,
      fluid_continuum: 0,
      device_product: 0,
      other: 0,
      total: 0,
      unknown: 0,
    },
    materialCategories: { total: 0, withMaterials: 0, empty: 0 },
    materialProperties: {
      total: 0,
      withNumeric: 0,
      textOnly: 0,
      distinctKeys: 0,
    },
    claims: {
      candidate: 0,
      quarantine: 0,
      validated: 0,
      released: 0,
      total: 0,
      other: 0,
    },
    evidenceBindings: {
      supports: 0,
      refutes: 0,
      context: 0,
      total: 0,
      other: 0,
    },
    conflicts: { open: 0, resolved: 0, total: 0, other: 0 },
    conflictMembers: {
      total: 0,
      conflictsWithMembers: 0,
      distinctClaims: 0,
    },
    snapshots: {
      url: 0,
      doi: 0,
      citation: 0,
      other: 0,
      total: 0,
      unknown: 0,
    },
    releases: { total: 0, withExport: 0, withoutExport: 0 },
    releaseClaims: { total: 0, distinctReleases: 0, distinctClaims: 0 },
    releaseSnapshots: { total: 0, distinctReleases: 0, distinctSnapshots: 0 },
    releaseBindings: { total: 0, distinctReleases: 0, distinctBindings: 0 },
    releaseConflicts: { total: 0, distinctReleases: 0, distinctConflicts: 0 },
    ingestCursors: { total: 0, withCursor: 0, withoutCursor: 0 },
  } as KnowledgeInventoryCounts

  for (const [k, v] of Object.entries(overrides)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(base as any)[k] = { ...(base as any)[k], ...v }
  }
  return base
}

function fixtureSummary(
  partial: Partial<KnowledgeInventorySummary> = {},
): KnowledgeInventorySummary {
  return {
    nodes: 0,
    edges: 0,
    edgeDevices: 0,
    edgeProducts: 0,
    materials: 0,
    materialCategories: 0,
    materialProperties: 0,
    claims: 0,
    claimsReleased: 0,
    evidenceBindings: 0,
    conflicts: 0,
    conflictsOpen: 0,
    conflictMembers: 0,
    snapshots: 0,
    releases: 0,
    releasesWithExport: 0,
    releaseClaims: 0,
    releaseSnapshots: 0,
    releaseBindings: 0,
    releaseConflicts: 0,
    ingestCursors: 0,
    ...partial,
  }
}

describe('formatInventorySummary (K63)', () => {
  it('extracts totals from nested inventory counts', () => {
    const inv = fixtureCounts({
      nodes: { total: 55 },
      edges: { total: 588 },
      materials: { total: 21 },
      claims: { total: 588, released: 588 },
      releases: { total: 1 },
      conflicts: { total: 2, open: 2 },
    })
    const totals = extractInventoryTotals(inv)
    expect(totals.nodes).toBe(55)
    expect(totals.edges).toBe(588)
    expect(totals.materials).toBe(21)
    expect(totals.claims).toBe(588)
    expect(totals.claimsReleased).toBe(588)
    expect(totals.releases).toBe(1)
    expect(totals.conflicts).toBe(2)
    expect(totals.conflictsOpen).toBe(2)
  })

  it('accepts flat KnowledgeInventorySummary', () => {
    const summary = fixtureSummary({
      nodes: 55,
      edges: 588,
      materials: 21,
      claims: 588,
      releases: 1,
      conflicts: 2,
    })
    const totals = extractInventoryTotals(summary)
    expect(totals.nodes).toBe(55)
    expect(totals.edges).toBe(588)
  })

  it('formats one-line summary with preferred keys first', () => {
    const summary = fixtureSummary({
      nodes: 55,
      edges: 588,
      materials: 21,
      claims: 588,
      releases: 1,
      conflicts: 2,
      snapshots: 800,
    })
    const line = formatInventorySummary(summary)
    expect(
      line.startsWith(
        'nodes=55 edges=588 materials=21 claims=588 releases=1 conflicts=2',
      ),
    ).toBe(true)
    expect(line).toContain('snapshots=800')
    expect(line).toContain('ingestCursors=0')
  })

  it('formats markdown table of top-level totals', () => {
    const summary = fixtureSummary({
      nodes: 55,
      edges: 588,
      materials: 21,
      claims: 588,
      releases: 1,
      conflicts: 2,
    })
    const md = formatInventoryMarkdown(summary)
    expect(md).toContain('| bucket | total |')
    expect(md).toContain('| --- | ---: |')
    expect(md).toContain('| nodes | 55 |')
    expect(md).toContain('| edges | 588 |')
    expect(md).toContain('| materials | 21 |')
    expect(md).toContain('| claims | 588 |')
    expect(md).toContain('| releases | 1 |')
    expect(md).toContain('| conflicts | 2 |')
    const nodesIdx = md.indexOf('| nodes |')
    const edgeDevicesIdx = md.indexOf('| edgeDevices |')
    expect(nodesIdx).toBeGreaterThan(-1)
    expect(edgeDevicesIdx).toBeGreaterThan(nodesIdx)
  })
})
