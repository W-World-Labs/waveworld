#!/usr/bin/env node
/**
 * Post-build bundle budget gate (#4).
 * Scans dist/assets/*.js and fails if any *own* ontology edges-data chunk
 * exceeds EDGE_BUDGET_KB, or if total JS exceeds TOTAL_BUDGET_KB (optional soft).
 *
 * Usage:
 *   node scripts/check-bundle-budget.mjs [--dir dist] [--edge-kb 900]
 */
import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  // edges.data.json alone is ~1.2MB source; after minify ~660–1000 kB.
  // Gate starts at 1100 kB to catch regressions back to a monolithic mega-chunk.
  const out = { dir: 'dist', edgeKb: 1100, totalKb: 7500 }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') out.dir = argv[++i]
    else if (a === '--edge-kb') out.edgeKb = Number(argv[++i])
    else if (a === '--total-kb') out.totalKb = Number(argv[++i])
  }
  return out
}

/**
 * Pure helper — unit-tested: classify a file basename as edges-data chunk.
 * Vite emits names like edges-data-XXXX.js when manualChunks returns 'edges-data'.
 */
export function isEdgesDataChunk(basename) {
  return /^edges-data[-.].+\.js$/.test(basename) || basename.startsWith('edges-data')
}

export function summarizeAssets(files, edgeBudgetBytes) {
  const rows = files.map((f) => ({
    name: path.basename(f.path),
    bytes: f.bytes,
    isEdgesData: isEdgesDataChunk(path.basename(f.path)),
  }))
  const edges = rows.filter((r) => r.isEdgesData)
  const maxEdges = edges.reduce((m, r) => Math.max(m, r.bytes), 0)
  const total = rows.reduce((s, r) => s + r.bytes, 0)
  const violations = edges
    .filter((r) => r.bytes > edgeBudgetBytes)
    .map((r) => `${r.name}: ${(r.bytes / 1024).toFixed(1)} kB > budget ${(edgeBudgetBytes / 1024).toFixed(0)} kB`)
  return { rows, edges, maxEdges, total, violations, ok: violations.length === 0 }
}

function main() {
  const { dir, edgeKb, totalKb } = parseArgs(process.argv)
  const assetsDir = path.join(dir, 'assets')
  if (!fs.existsSync(assetsDir)) {
    console.error(`missing ${assetsDir} — run vite build first`)
    process.exit(2)
  }
  const files = fs
    .readdirSync(assetsDir)
    .filter((n) => n.endsWith('.js'))
    .map((n) => {
      const p = path.join(assetsDir, n)
      return { path: p, bytes: fs.statSync(p).size }
    })
  const edgeBudgetBytes = edgeKb * 1024
  const summary = summarizeAssets(files, edgeBudgetBytes)
  console.log(
    JSON.stringify(
      {
        edgeBudgetKb: edgeKb,
        edgesChunks: summary.edges.map((e) => ({
          name: e.name,
          kb: +(e.bytes / 1024).toFixed(1),
        })),
        maxEdgesKb: +(summary.maxEdges / 1024).toFixed(1),
        totalJsKb: +(summary.total / 1024).toFixed(1),
        ok: summary.ok,
        violations: summary.violations,
      },
      null,
      2,
    ),
  )
  if (!summary.ok) {
    console.error('bundle budget FAILED:', summary.violations.join('; '))
    process.exit(1)
  }
  if (totalKb > 0 && summary.total > totalKb * 1024) {
    console.error(
      `total JS ${(summary.total / 1024).toFixed(1)} kB exceeds --total-kb ${totalKb}`,
    )
    process.exit(1)
  }
  console.error('bundle budget OK')
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)

if (isMain) main()
