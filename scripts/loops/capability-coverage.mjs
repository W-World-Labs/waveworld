#!/usr/bin/env node
/**
 * Static source inventory (machine JSON + human summary); no completion score.
 *
 * Layers:
 *   source    — Atlas teaching sim source files (src/lib/sim)
 *   solver_packages — solvers-* source and test file presence
 *   kind_registry — built contract kinds with declared package owners (kind-matrix)
 *   kit       — lab-kit descriptor presence
 *   knowledge — source counts; local DB counts only with --knowledge-inventory
 *   principle_bridge — declared principle and equivalence-reference tables
 *
 * Usage:
 *   node scripts/loops/capability-coverage.mjs
 *   node scripts/loops/capability-coverage.mjs --json
 *   node scripts/loops/capability-coverage.mjs --write runtime/capability-coverage.json
 *   CAPABILITY_COVERAGE_STRICT=1  # exit 1 if kind-matrix not ok
 *
 * Schema v2 removes v1 heuristic percentages. Counts do not prove execution,
 * numerical validation, engineering readiness, or production health.
 * This is an optional cross-repository research inventory; it is not part of
 * WaveWorld's standalone install, build, or deployment dependency chain.
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WW_ROOT = path.resolve(__dirname, '../..')
const WSIM_ROOT =
  process.env.WSIM_ROOT || path.resolve(WW_ROOT, '../20-15-w-sim')

const args = process.argv.slice(2)
const wantJson = args.includes('--json')
const writeIdx = args.indexOf('--write')
const writePath =
  writeIdx >= 0
    ? path.resolve(WW_ROOT, args[writeIdx + 1] || 'runtime/capability-coverage.json')
    : path.resolve(WW_ROOT, 'runtime/capability-coverage.json')
const alwaysWrite = !args.includes('--no-write')
const strict =
  process.env.CAPABILITY_COVERAGE_STRICT === '1' ||
  process.env.CAPABILITY_COVERAGE_STRICT === 'true' ||
  args.includes('--strict')

function countSimLeaves() {
  const simDir = path.join(WW_ROOT, 'src/lib/sim')
  if (!existsSync(simDir)) return { files: 0 }
  const files = readdirSync(simDir).filter(
    (n) => n.endsWith('.ts') && !n.endsWith('.test.ts') && !n.endsWith('.d.ts'),
  )
  return { files: files.length }
}

function listSolverPackages() {
  const packagesDir = path.join(WSIM_ROOT, 'packages')
  if (!existsSync(packagesDir)) return []
  return readdirSync(packagesDir)
    .filter((n) => n.startsWith('solvers-') && n !== 'solvers-_template')
    .filter((n) => statSync(path.join(packagesDir, n)).isDirectory())
    .sort()
}

function solverPackageStats(name) {
  const root = path.join(WSIM_ROOT, 'packages', name)
  const srcDir = path.join(root, 'src')
  let testFiles = 0
  let srcFiles = 0
  function walk(d) {
    if (!existsSync(d)) return
    for (const n of readdirSync(d)) {
      const p = path.join(d, n)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (n.endsWith('.test.ts')) testFiles++
      else if (n.endsWith('.ts') && !n.endsWith('.d.ts')) srcFiles++
    }
  }
  walk(srcDir)
  return { name, testFiles, srcFiles, hasKit: existsSync(path.join(srcDir, 'kit.ts')) }
}

async function kindMatrix() {
  const script = path.join(WSIM_ROOT, 'scripts/check-kind-matrix.mjs')
  if (!existsSync(script)) {
    return { ok: false, error: 'check-kind-matrix.mjs missing', coveredLive: null, builtin: null }
  }
  try {
    const mod = await import(pathToFileURL(script).href)
    // A missing contracts build is unknown, never a smaller denominator
    // inferred from the very owner table that this check should validate.
    const jobSpec = path.join(WSIM_ROOT, 'packages/contracts/dist/job-spec.js')
    const contracts = await import(pathToFileURL(jobSpec).href)
    if (!Array.isArray(contracts.BUILTIN_JOB_KINDS) || !contracts.BUILTIN_JOB_KINDS.length) {
      throw new Error('BUILTIN_JOB_KINDS unavailable; build the W-Sim contracts package')
    }
    const builtinKinds = [...contracts.BUILTIN_JOB_KINDS]
    const result = mod.runKindMatrixCheck({ builtinKinds, strict: true })
    return {
      ok: result.ok,
      errors: result.errors || [],
      coveredLive: result.coveredLive || [],
      uncovered: result.uncovered || [],
      labKitPackages: result.labKitPackages || [],
      labKitMissing: result.labKitMissing || [],
      builtin: builtinKinds,
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e), coveredLive: null, builtin: null }
  }
}

function knowledgeSurface() {
  const dbDir = path.join(WW_ROOT, 'src/lib/knowledge-db')
  const hostKnowledge = path.join(WW_ROOT, 'apps/host/src/app/api/v1/knowledge')
  let dbModules = 0
  let hostRoutes = 0
  if (existsSync(dbDir)) {
    dbModules = readdirSync(dbDir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts')).length
  }
  function walk(d) {
    if (!existsSync(d)) return
    for (const n of readdirSync(d)) {
      const p = path.join(d, n)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (n === 'route.ts') hostRoutes++
    }
  }
  walk(hostKnowledge)
  return { dbModules, hostRoutes }
}

function tryKnowledgeInventory() {
  // Best-effort: npm run knowledge:inventory:summary may need DB
  const r = spawnSync(
    'npm',
    ['run', 'knowledge:inventory:summary', '--silent'],
    { cwd: WW_ROOT, encoding: 'utf8', timeout: 60000 },
  )
  if (r.status !== 0) {
    return { available: false, reason: (r.stderr || r.stdout || 'inventory unavailable').slice(0, 200) }
  }
  const out = (r.stdout || '').trim()
  // try parse JSON if entire stdout is JSON
  try {
    const j = JSON.parse(out)
    return { available: true, summary: j }
  } catch {
    return { available: true, raw: out.slice(0, 500) }
  }
}

/** Read declarations, without treating their status labels as test results. */
async function loadPrincipleBridge() {
  const entry = path.join(WSIM_ROOT, 'packages/contracts/dist/principle-bridge.js')
  try {
    const mod = await import(pathToFileURL(entry).href)
    if (!Array.isArray(mod.KIND_DERIVES_FROM) || !Array.isArray(mod.EQUIVALENCE_GOLDENS)) {
      throw new Error('Principle declaration tables unavailable')
    }
    return {
      available: true,
      source: 'packages/contracts/dist/principle-bridge.js',
      method_rows: mod.KIND_DERIVES_FROM.length,
      principle_links: mod.KIND_DERIVES_FROM.reduce((count, row) => count + row.principles.length, 0),
      equivalence_rows: mod.EQUIVALENCE_GOLDENS.length,
      declared_statuses: Object.fromEntries(['stub', 'smoke', 'engineering'].map(status =>
        [status, mod.EQUIVALENCE_GOLDENS.filter(row => row.status === status).length])),
      verification: 'not-run',
      note: 'These are declared references, not verified proof dependencies or evidence of automatic solver composition.',
    }
  } catch {
    return { available: false, verification: 'not-run', reason: 'Built principle declaration tables unavailable' }
  }
}

async function main() {
  const sim = countSimLeaves()
  const solverPkgs = listSolverPackages()
  const solverStats = solverPkgs.map(solverPackageStats)
  const km = await kindMatrix()
  const knowledge = knowledgeSurface()
  const inventory = args.includes('--knowledge-inventory') ? tryKnowledgeInventory()
    : { available: false, reason: 'Not requested; use --knowledge-inventory for local database counts' }
  const principleBridge = await loadPrincipleBridge()
  const report = {
    schemaVersion: 2,
    scope: 'source-inventory',
    generatedAt: new Date().toISOString(),
    roots: { waveworld: WW_ROOT, wsim: WSIM_ROOT },
    assessment: {
      product_completion: 'not-assessed',
      numerical_validation: 'not-run',
      production_health: 'not-checked',
      reason: 'No requirement-by-requirement completion denominator is defined here. File counts, registered kinds and declared tests cannot establish physics coverage or engineering accuracy.',
    },
    layers: {
      source: { label: 'Simulation TypeScript source files (not simulator count)', sim_leaf_ts_files: sim.files },
      solver_packages: {
        label: 'Solver package source inventory',
        package_count: solverPkgs.length,
        packages_with_test_files: solverStats.filter(row => row.testFiles > 0).length,
        per_package: solverStats,
        tests_executed: false,
      },
      kind_registry: {
        label: 'Static contract/package ownership check',
        kind_matrix_ok: km.ok,
        builtin_kinds: km.builtin,
        declared_kinds_with_packages: km.coveredLive,
        uncovered: km.uncovered ?? null,
        builtin_count: km.builtin?.length ?? null,
        declared_count: km.coveredLive?.length ?? null,
        errors: km.errors ?? (km.error ? [km.error] : []),
        note: 'Package metadata and files only; no solver execution or live service probe.',
      },
      kit: {
        label: 'Declared HqLabKit source descriptors',
        lab_kit_packages: km.labKitPackages ?? null,
        lab_kit_missing: km.labKitMissing ?? null,
        packages_with_kit_ts: solverStats.filter(row => row.hasKit).length,
      },
      knowledge: {
        label: 'Local knowledge source/database inventory',
        db_modules: knowledge.dbModules,
        host_routes: knowledge.hostRoutes,
        inventory,
      },
      principle_bridge: principleBridge,
    },
  }
  const human = [
    `# Capability inventory ${report.generatedAt}`,
    '',
    'This is a **source inventory**, not a product completion or physics coverage percentage.',
    'Numerical validation: **not run**. Production health: **not checked**. No solver is executed by this report.',
    '',
    '| Observed scope | Count / status | Evidence boundary |',
    '|----------------|---------------:|-------------------|',
    `| Simulation TypeScript files | ${sim.files} | Source files, not separate simulators |`,
    `| Solver packages with test files | ${report.layers.solver_packages.packages_with_test_files}/${solverPkgs.length} | Test presence; tests were not run |`,
    `| Declared kinds with package metadata | ${km.builtin ? `${km.coveredLive.length}/${km.builtin.length}` : 'unknown'} | Static ownership check: ${km.ok ? 'PASS' : 'FAIL'} |`,
    `| Packages with kit.ts | ${report.layers.kit.packages_with_kit_ts} | Descriptor presence only |`,
    `| Knowledge sources / routes | ${knowledge.dbModules} / ${knowledge.hostRoutes} | Local files, not production availability |`,
    `| Principle/equivalence declaration rows | ${principleBridge.available ? `${principleBridge.method_rows} / ${principleBridge.equivalence_rows}` : 'unknown'} | References, not verified proof dependencies or automatic composition |`,
    '',
    'Engineering readiness needs scoped requirements, supported inputs/units/boundaries, numerical and experimental evidence, and verified product execution. This report does not assess it.',
    'The --strict gate checks static kind registration only. Missing evidence is reported as unknown; it never becomes a smaller completion denominator.',
    ...(report.layers.kind_registry.errors.length ? ['', ...report.layers.kind_registry.errors.map(error => `Registry error: ${error}`)] : []),
  ].join('\n')

  if (alwaysWrite || writeIdx >= 0) {
    mkdirSync(path.dirname(writePath), { recursive: true })
    writeFileSync(writePath, JSON.stringify(report, null, 2) + '\n')
    const mdPath = /\.json$/i.test(writePath) ? writePath.replace(/\.json$/i, '.md') : writePath + '.md'
    writeFileSync(mdPath, human + '\n')
  }
  if (wantJson) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(human)
    if (alwaysWrite || writeIdx >= 0) console.log(`\nWrote ${writePath}`)
  }
  if (strict && !km.ok) process.exitCode = 1
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
