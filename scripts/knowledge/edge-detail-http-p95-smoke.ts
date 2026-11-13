#!/usr/bin/env tsx
/**
 * K14: live Host edge-detail HTTP p95 smoke CLI (EPIC #52).
 *
 * Usage:
 *   npx tsx scripts/knowledge/edge-detail-http-p95-smoke.ts --cachebuster <64-hex-build-id>
 *   WAVEWORLD_HOST_BASE=http://127.0.0.1:3001 npx tsx scripts/knowledge/edge-detail-http-p95-smoke.ts --cachebuster <64-hex-build-id>
 *
 * Exit 0 when p95 &lt; budget; exit 1 on budget miss or Host error.
 * Always prints p50/p95/max and pass/fail.
 */
import {
  EDGE_DETAIL_HTTP_P95_BUDGET_MS,
  formatEdgeDetailHttpP95Report,
  measureEdgeDetailHttpP95,
  resolveKnowledgeHttpP95Base,
} from '../../src/lib/knowledge-db/edge-detail-http-p95-smoke.ts'

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const value = args[i + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`K14 CLI: ${name} requires a value`)
  }
  return value
}

function positiveIntegerArg(
  args: string[],
  name: string,
  fallback: number,
): number {
  const raw = argValue(args, name)
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < 0 || (name === '--iterations' && value < 1)) {
    throw new Error(`K14 CLI: ${name} must be a valid non-negative integer`)
  }
  return value
}

function parseEmbed(args: string[]): boolean {
  const embedRaw = argValue(args, '--embed')
  if (args.includes('--no-embed') && embedRaw !== undefined) {
    throw new Error('K14 CLI: --embed and --no-embed cannot be combined')
  }
  if (embedRaw === undefined) return !args.includes('--no-embed')
  if (['1', 'true'].includes(embedRaw.toLowerCase())) return true
  if (['0', 'false'].includes(embedRaw.toLowerCase())) return false
  throw new Error('K14 CLI: --embed must be true/false')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const baseUrl = argValue(args, '--base') ?? resolveKnowledgeHttpP95Base()
  const iterations = positiveIntegerArg(args, '--iterations', 40)
  const warmup = positiveIntegerArg(args, '--warmup', 5)
  const sampleEdgeCount = positiveIntegerArg(args, '--sample-edges', 20)
  const budgetRaw = argValue(args, '--budget-ms')
  const budgetMs = budgetRaw
    ? Number(budgetRaw)
    : EDGE_DETAIL_HTTP_P95_BUDGET_MS
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error('K14 CLI: --budget-ms must be a positive number')
  }
  const embed = parseEmbed(args)
  const cachebuster = argValue(args, '--cachebuster')
  if (cachebuster === undefined) {
    throw new Error(
      'K14 CLI: --cachebuster is required and must be a 64-hex candidate',
    )
  }

  console.log(
    `K14 edge-detail HTTP p95 smoke base=${baseUrl} iterations=${iterations} budget=${budgetMs}ms embed=${embed} cachebuster=${cachebuster ?? 'none'}`,
  )

  const report = await measureEdgeDetailHttpP95({
    baseUrl,
    iterations,
    warmup,
    sampleEdgeCount,
    budgetMs,
    embedReleasedClaims: embed,
    cachebuster,
  })

  console.log(formatEdgeDetailHttpP95Report(report))
  console.log(
    JSON.stringify(
      {
        pass: report.pass,
        p50Ms: report.p50Ms,
        p95Ms: report.p95Ms,
        maxMs: report.maxMs,
        meanMs: report.meanMs,
        budgetMs: report.budgetMs,
        iterations: report.iterations,
        warmup: report.warmup,
        samplesMs: report.samplesMs,
        sampleCount: report.sampleCount,
        edgeCount: report.edgeCount,
        edgeIds: report.edgeIds,
        edgeIdSummary: report.edgeIdSummary,
        embed: report.embed,
        embedReleasedClaims: report.embedReleasedClaims,
        cachebuster: report.cachebuster,
        baseUrl: report.baseUrl,
        lastStatus: report.lastStatus,
      },
      null,
      2,
    ),
  )

  if (!report.pass) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(
    err instanceof Error ? err.stack || err.message : String(err),
  )
  process.exitCode = 1
})
