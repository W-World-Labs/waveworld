/**
 * #48 C2b — Live network crawl of static ConversionEdge.refs → reduce locator-only debt.
 *
 * Uses real HTTP by default (injectable in library). Prints before/after counts and
 * sample reverse-index hits. Does **not** write Knowledge DB blobs (#52 owns durable store).
 *
 *   npx tsx scripts/knowledge/live-crawl-edge-refs.ts
 *   LIVE_CRAWL_LIMIT=20 npx tsx scripts/knowledge/live-crawl-edge-refs.ts
 *   LIVE_CRAWL_MAX_LOCATORS=5 npx tsx scripts/knowledge/live-crawl-edge-refs.ts
 *
 * Env:
 *   LIVE_CRAWL_LIMIT         max edges to include (default 40)
 *   LIVE_CRAWL_MAX_LOCATORS  cap unique URLs after edge filter (optional)
 *   LIVE_CRAWL_CONCURRENCY   parallel fetches (default 2)
 *   LIVE_CRAWL_TIMEOUT_MS    per-request timeout (default 15000)
 */
import { EDGES } from '../../src/data/ontology/edges.ts'
import {
  collectUniqueEdgeRefLocators,
  edgeRefsLiveNetworkCrawlBulk,
  edgesToBulkItems,
  lookupBlobByContentSha,
} from '../../src/lib/knowledge/edgeRefs.ts'

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

async function main() {
  const edgeLimit = envInt('LIVE_CRAWL_LIMIT', 40)
  const maxLocators = process.env.LIVE_CRAWL_MAX_LOCATORS
    ? envInt('LIVE_CRAWL_MAX_LOCATORS', 0)
    : 0
  const concurrency = envInt('LIVE_CRAWL_CONCURRENCY', 2)
  const timeoutMs = envInt('LIVE_CRAWL_TIMEOUT_MS', 15_000)

  let items = edgesToBulkItems(EDGES)
    .filter((e) => (e.refs?.length ?? 0) > 0)
    .slice(0, edgeLimit)

  if (maxLocators > 0) {
    const keep = new Set(collectUniqueEdgeRefLocators(items).slice(0, maxLocators))
    items = items
      .map((e) => ({
        id: e.id,
        refs: (e.refs ?? []).filter((u) => keep.has(u.trim())),
      }))
      .filter((e) => (e.refs?.length ?? 0) > 0)
  }

  const uniqueBefore = collectUniqueEdgeRefLocators(items)
  console.log(
    JSON.stringify(
      {
        phase: 'start',
        edgeCount: items.length,
        uniqueLocators: uniqueBefore.length,
        concurrency,
        timeoutMs,
      },
      null,
      2,
    ),
  )

  const live = await edgeRefsLiveNetworkCrawlBulk(items, {
    concurrency,
    timeoutMs,
    // real network
  })

  const sampleHits: Array<{
    contentSha256: string
    locator: string
    byteLength?: number
    edgeIds: string[]
  }> = []
  for (const [sha, entry] of live.blobStore.bySha) {
    if (entry.captureStatus !== 'bytes-captured' || !entry.bytes) continue
    sampleHits.push({
      contentSha256: sha,
      locator: entry.locator,
      byteLength: entry.byteLength,
      edgeIds: entry.edgeIds.slice(0, 4),
    })
    if (sampleHits.length >= 5) break
  }

  // Prove reverse lookup on first sample
  const verified =
    sampleHits[0] != null
      ? lookupBlobByContentSha(live.blobStore, sampleHits[0].contentSha256)
      : undefined

  console.log(
    JSON.stringify(
      {
        phase: 'done',
        before: live.before,
        after: live.after,
        reducedLocatorOnlySlots:
          live.before.totalLocatorOnly - live.after.totalLocatorOnly,
        crawl: {
          attempted: live.crawl.attempted,
          captured: live.crawl.captured,
          failed: live.crawl.failed,
          skipped: live.crawl.skipped,
          remainingLocatorOnlyCount: live.crawl.remainingLocatorOnly.length,
        },
        blobStore: {
          uniqueShaCount: live.blobStore.uniqueShaCount,
          uniqueLocatorCount: live.blobStore.uniqueLocatorCount,
        },
        sampleReverseIndex: sampleHits,
        reverseLookupOk: verified?.captureStatus === 'bytes-captured',
        note: 'In-memory reverse index only; Knowledge DB durable blobs are #52',
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
