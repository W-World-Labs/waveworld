/**
 * K64: offline close-checklist floors for inventory totals (no CF DNS / prod route).
 * Fail closed if core tables are empty on the live Knowledge DB path.
 * K65: pure paste helpers for floor-check evidence (Gitea / checklist).
 * K66: expanded floors for materialProperties / evidence / edge devices+products / categories.
 */
export type InventoryFloorViolation = {
  field: string
  actual: number
  min: number
}

export type InventoryFloorCheckResult =
  | { ok: true }
  | { ok: false; violations: InventoryFloorViolation[] }

/** Minimum non-zero floors for seeded production/dev knowledge DB. */
export const KNOWLEDGE_INVENTORY_FLOORS = {
  nodes: 50,
  edges: 100,
  materials: 5,
  materialProperties: 5,
  materialCategories: 1,
  edgeDevices: 1,
  edgeProducts: 1,
  evidenceBindings: 1,
  claims: 50,
  snapshots: 1,
  releases: 1,
  /** K67: ingest pipeline must have at least one cursor after seed/bootstrap. */
  ingestCursors: 1,
} as const

export type InventoryFloorField = keyof typeof KNOWLEDGE_INVENTORY_FLOORS

/** Accept flat summary/totals maps (`{ nodes: n, edges: n, ... }`). */
export function checkInventoryFloors(
  summary: Record<string, number>,
  floors: Partial<Record<InventoryFloorField, number>> = KNOWLEDGE_INVENTORY_FLOORS,
): InventoryFloorCheckResult {
  const violations: InventoryFloorViolation[] = []
  for (const [field, min] of Object.entries(floors) as Array<
    [InventoryFloorField, number]
  >) {
    const actual = Number(summary[field] ?? 0)
    if (!(actual >= min)) {
      violations.push({ field, actual, min })
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}

/**
 * One-line floor-check report for ops paste.
 * ok → `inventory floors: ok`
 * fail → `inventory floors: FAIL nodes actual=0 < min=1; edges actual=0 < min=1`
 */
export function formatInventoryFloorReport(
  result: InventoryFloorCheckResult,
): string {
  if (result.ok) return 'inventory floors: ok'
  const detail = result.violations
    .map((v) => `${v.field} actual=${v.actual} < min=${v.min}`)
    .join('; ')
  return `inventory floors: FAIL ${detail}`
}

/**
 * Markdown table of floor violations (empty string when ok).
 */
export function formatInventoryFloorMarkdown(
  result: InventoryFloorCheckResult,
): string {
  if (result.ok) {
    return [
      '| field | actual | min | status |',
      '| --- | ---: | ---: | --- |',
      '| (all floors) | — | — | ok |',
    ].join('\n')
  }
  const lines = [
    '| field | actual | min | status |',
    '| --- | ---: | ---: | --- |',
    ...result.violations.map(
      (v) => `| ${v.field} | ${v.actual} | ${v.min} | FAIL |`,
    ),
  ]
  return lines.join('\n')
}
