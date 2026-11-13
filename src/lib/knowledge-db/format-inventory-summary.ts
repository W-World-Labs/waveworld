/**
 * K63: compact offline dump formats for knowledge inventory totals.
 * Pure helpers (no DB I/O) so unit tests stay offline.
 */
import type {
  KnowledgeInventoryCounts,
  KnowledgeInventorySummary,
} from './count-all.ts'
import { summarizeKnowledgeInventory } from './count-all.ts'

/** Ordered keys ops care about first; remaining keys follow alphabetically. */
const PREFERRED_TOTAL_KEYS = [
  'nodes',
  'edges',
  'materials',
  'claims',
  'releases',
  'conflicts',
] as const

export type InventoryTotals = Record<string, number>

/** Normalize nested counts or flat summary into `{ key: number }` totals. */
export function extractInventoryTotals(
  inv: KnowledgeInventoryCounts | KnowledgeInventorySummary | InventoryTotals,
): InventoryTotals {
  // Flat summary / totals map (all values are numbers)
  const entries = Object.entries(inv)
  if (
    entries.length > 0 &&
    entries.every(([, v]) => typeof v === 'number')
  ) {
    return { ...(inv as InventoryTotals) }
  }

  // Nested KnowledgeInventoryCounts → use summarize then expand
  const summary = summarizeKnowledgeInventory(inv as KnowledgeInventoryCounts)
  return { ...summary }
}

function orderedTotalKeys(totals: InventoryTotals): string[] {
  const preferred = PREFERRED_TOTAL_KEYS.filter((k) => k in totals)
  const rest = Object.keys(totals)
    .filter(
      (k) => !preferred.includes(k as (typeof PREFERRED_TOTAL_KEYS)[number]),
    )
    .sort()
  return [...preferred, ...rest]
}

/**
 * One-line compact summary, e.g.
 * `nodes=55 edges=588 materials=21 claims=588 releases=1 conflicts=2 ...`
 */
export function formatInventorySummary(
  inv: KnowledgeInventoryCounts | KnowledgeInventorySummary | InventoryTotals,
): string {
  const totals = extractInventoryTotals(inv)
  return orderedTotalKeys(totals)
    .map((k) => `${k}=${totals[k]}`)
    .join(' ')
}

/**
 * Small markdown table of top-level totals.
 */
export function formatInventoryMarkdown(
  inv: KnowledgeInventoryCounts | KnowledgeInventorySummary | InventoryTotals,
): string {
  const totals = extractInventoryTotals(inv)
  const keys = orderedTotalKeys(totals)
  const lines = [
    '| bucket | total |',
    '| --- | ---: |',
    ...keys.map((k) => `| ${k} | ${totals[k]} |`),
  ]
  return lines.join('\n')
}
