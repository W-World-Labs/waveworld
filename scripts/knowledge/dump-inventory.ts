/**
 * K62–K66: offline inventory dump for EPIC #52 close checklist (no public route required).
 * Emits evidence envelope by default; compact summary/md formats for ops paste.
 * K64/K66: --check exits non-zero if totals fall below KNOWLEDGE_INVENTORY_FLOORS
 * (K66 expands floors to materialProperties/categories, edgeDevices/Products, evidenceBindings).
 *
 * Usage:
 *   npx tsx scripts/knowledge/dump-inventory.ts              # pretty JSON (default)
 *   npx tsx scripts/knowledge/dump-inventory.ts --format=summary
 *   npx tsx scripts/knowledge/dump-inventory.ts -s
 *   npx tsx scripts/knowledge/dump-inventory.ts --format=md
 *   npx tsx scripts/knowledge/dump-inventory.ts --check
 *   npx tsx scripts/knowledge/db-cli.ts inventory
 */
import { dumpKnowledgeInventoryEvidenceSync } from '../../src/lib/knowledge-db/count-all.ts'
import {
  checkInventoryFloors,
  formatInventoryFloorReport,
} from '../../src/lib/knowledge-db/check-inventory-floors.ts'
import {
  extractInventoryTotals,
  formatInventoryMarkdown,
  formatInventorySummary,
} from '../../src/lib/knowledge-db/format-inventory-summary.ts'

type DumpFormat = 'json' | 'summary' | 'md'

function parseFormat(argv: string[]): DumpFormat {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-s' || a === '--summary') return 'summary'
    if (a === '--md' || a === '--markdown') return 'md'
    if (a === '--format' || a === '-f') {
      const v = (argv[i + 1] ?? '').toLowerCase()
      if (v === 'summary' || v === 's') return 'summary'
      if (v === 'md' || v === 'markdown') return 'md'
      if (v === 'json') return 'json'
      throw new Error(`unknown --format value: ${argv[i + 1]}`)
    }
    if (a.startsWith('--format=')) {
      const v = a.slice('--format='.length).toLowerCase()
      if (v === 'summary' || v === 's') return 'summary'
      if (v === 'md' || v === 'markdown') return 'md'
      if (v === 'json') return 'json'
      throw new Error(`unknown --format value: ${v}`)
    }
  }
  return 'json'
}

function wantsCheck(argv: string[]): boolean {
  return argv.includes('--check') || argv.includes('-c')
}

const argv = process.argv.slice(2)
const format = parseFormat(argv)
const doCheck = wantsCheck(argv)
const evidence = dumpKnowledgeInventoryEvidenceSync()
const totals = extractInventoryTotals(evidence.summary)

if (doCheck) {
  const result = checkInventoryFloors(totals)
  if (!result.ok) {
    // K65: human one-liner before JSON (Gitea paste)
    console.error(formatInventoryFloorReport(result))
    console.error(
      JSON.stringify(
        { ok: false, source: 'dump-inventory --check', violations: result.violations, totals },
        null,
        2,
      ),
    )
    process.exit(1)
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        source: 'dump-inventory --check',
        floors: 'KNOWLEDGE_INVENTORY_FLOORS',
        report: formatInventoryFloorReport(result),
        totals,
      },
      null,
      2,
    ),
  )
  if (format === 'json' && !argv.some((a) => a.includes('format') || a === '-s' || a === '--md')) {
    // --check alone: stop after ok JSON
    process.exit(0)
  }
}

if (format === 'summary') {
  console.log(formatInventorySummary(evidence.summary))
} else if (format === 'md') {
  console.log(formatInventoryMarkdown(evidence.summary))
} else if (!doCheck) {
  // Backward-compatible pretty JSON of full evidence (includes nested counts + summary)
  console.log(JSON.stringify(evidence, null, 2))
}
