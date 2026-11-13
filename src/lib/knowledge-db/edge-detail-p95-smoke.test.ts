/**
 * K13: automated edge-detail read p95 smoke (local SQLite &lt; 50ms budget).
 * Gate: knowledge-db (vitest src/lib/knowledge-db).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EDGE_DETAIL_P95_BUDGET_MS,
  formatEdgeDetailP95Report,
  measureEdgeDetailP95,
  percentileNearestRank,
} from './edge-detail-p95-smoke.ts'
import { seedKnowledgeDbFromRepoFull } from './seed-from-static.repo.ts'
import { repoRootFromHere } from './paths.ts'

const root = repoRootFromHere()
const temps: string[] = []

afterEach(() => {
  for (const p of temps) {
    try {
      fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(p + suffix)
      } catch {
        /* ignore */
      }
    }
  }
  temps.length = 0
})

function tempDb(): string {
  const p = path.join(
    os.tmpdir(),
    `waveworld-edge-p95-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  )
  temps.push(p)
  return p
}

describe('edge-detail-p95-smoke helpers', () => {
  it('percentileNearestRank uses ceil rank', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentileNearestRank(xs, 50)).toBe(5)
    expect(percentileNearestRank(xs, 95)).toBe(10)
    expect(percentileNearestRank(xs, 100)).toBe(10)
  })
})

describe('K13 edge-detail local SQLite p95 budget', () => {
  it(`getKnowledgeEdge embed path p95 < ${EDGE_DETAIL_P95_BUDGET_MS}ms (or reports measured)`, async () => {
    // Keep the corpus identical across developer hosts and CI runners. In
    // particular, never let a host-local /var/lib database change this gate.
    // Seeding is intentionally outside the timed samples.
    const dbPath = tempDb()
    await seedKnowledgeDbFromRepoFull({ dbPath, root })

    const report = measureEdgeDetailP95({
      dbPath,
      root,
      iterations: 200,
      warmup: 25,
      sampleEdgeCount: 40,
      embedReleasedClaims: true,
      budgetMs: EDGE_DETAIL_P95_BUDGET_MS,
    })

    // Always log measured numbers for operators / CI artifacts.
    // eslint-disable-next-line no-console
    console.log(formatEdgeDetailP95Report(report) + ' seed=repo-full')

    expect(
      report.pass,
      `edge-detail p95 budget missed: measured p50=${report.p50Ms.toFixed(3)}ms ` +
        `p95=${report.p95Ms.toFixed(3)}ms max=${report.maxMs.toFixed(3)}ms ` +
        `mean=${report.meanMs.toFixed(3)}ms (budget < ${report.budgetMs}ms, n=${report.iterations})`,
    ).toBe(true)
    expect(report.p95Ms).toBeLessThan(EDGE_DETAIL_P95_BUDGET_MS)
    expect(report.edgeIds.length).toBeGreaterThanOrEqual(1)
    expect(report.iterations).toBe(200)
  })
})
