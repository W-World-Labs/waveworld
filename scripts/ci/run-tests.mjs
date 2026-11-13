#!/usr/bin/env node
/**
 * Keep the SQLite latency gate out of Vitest's large parallel worker pool.
 * The gate still runs once, with its original 200 samples and <50ms budget,
 * after ordinary unit workers have exited. Explicit Vitest filters preserve
 * the historical `npm test -- <args>` behavior for focused development runs.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const perfTest = 'src/lib/knowledge-db/edge-detail-p95-smoke.test.ts'
const vitestBin = fileURLToPath(
  new URL('../../node_modules/vitest/vitest.mjs', import.meta.url),
)

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function runVitest(args) {
  run(process.execPath, [vitestBin, ...args])
}

const forwarded = process.argv.slice(2)
if (forwarded.length > 0) {
  runVitest(['run', ...forwarded])
  process.exit(0) // A focused run must not also launch the complete golden suite.
} else {
  runVitest(['run', '--exclude', perfTest])
  runVitest([
    'run',
    perfTest,
    '--pool=forks',
    '--maxWorkers=1',
    '--minWorkers=1',
    '--no-file-parallelism',
  ])
}

const npmCli = process.env.npm_execpath
if (npmCli) run(process.execPath, [npmCli, 'run', 'test:golden'])
else run('npm', ['run', 'test:golden'])
