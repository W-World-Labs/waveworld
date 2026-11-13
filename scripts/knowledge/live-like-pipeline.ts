/**
 * #48-R Offline live-like knowledge pipeline CLI.
 *
 * fixture OpenAlex/Crossref works → SourceSnapshot → extract claims
 * → efficiency gate → publishKnowledgeRelease → writeKnowledgeRelease.
 *
 * Deterministic clocks, no live HTTP. Default root: data/knowledge-releases-demo.
 * Production enable remains operator-owned.
 *
 *   npx tsx scripts/knowledge/live-like-pipeline.ts
 *   KNOWLEDGE_RELEASES_DIR=/path npx tsx scripts/knowledge/live-like-pipeline.ts
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LIVE_LIKE_CAPTURED_AT,
  LIVE_LIKE_GATED_AT,
  LIVE_LIKE_RELEASE_ID,
  LIVE_LIKE_RELEASED_AT,
  buildDefaultLiveLikeFixture,
  runOfflineLiveLikeAndWrite,
} from '../../src/lib/knowledge/liveLikePipeline.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(here, '../../data/knowledge-releases-demo')

async function main() {
  const root = process.env.KNOWLEDGE_RELEASES_DIR?.trim() || defaultRoot
  const result = await runOfflineLiveLikeAndWrite(
    root,
    {
      releaseId: LIVE_LIKE_RELEASE_ID,
      releasedAt: LIVE_LIKE_RELEASED_AT,
      capturedAt: LIVE_LIKE_CAPTURED_AT,
      gateAt: LIVE_LIKE_GATED_AT,
      fixture: buildDefaultLiveLikeFixture(),
    },
    { indexGeneratedAt: LIVE_LIKE_RELEASED_AT },
  )

  console.log(
    JSON.stringify(
      {
        pipeline: 'offline-live-like',
        issueSlice: '#48-R',
        id: result.release.id,
        releasedAt: result.release.releasedAt,
        sha256: result.release.sha256,
        claimCount: result.release.claims.length,
        claimSource: result.claimSource,
        extractedClaimCount: result.extractedClaimCount,
        fallbackClaimCount: result.fallbackClaimCount,
        gatedOutClaimIds: result.gatedOutClaimIds,
        openAlexSnapshots: result.openAlexSnapshots.length,
        crossrefSnapshots: result.crossrefSnapshots.length,
        mergedSnapshots: result.mergedSnapshots.length,
        duplicatesDropped: result.merge.duplicatesDropped,
        root,
        file: result.file,
        indexPath: result.indexPath,
        clocks: {
          capturedAt: LIVE_LIKE_CAPTURED_AT,
          gateAt: LIVE_LIKE_GATED_AT,
          releasedAt: LIVE_LIKE_RELEASED_AT,
        },
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
