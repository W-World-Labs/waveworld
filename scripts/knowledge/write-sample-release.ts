/**
 * #48-O / #48-Q Write multi-subject offline sample KnowledgeRelease into the static catalog.
 *
 * Thin wrapper around the offline pipeline (same as offline-pipeline.ts).
 * Default root: public/knowledge-releases (Vite serves /knowledge-releases/…).
 * Override: KNOWLEDGE_RELEASES_DIR=/path npx tsx scripts/knowledge/write-sample-release.ts
 *
 * Offline + deterministic (fixed ids/dates → fixed sha256).
 * ≥6 edge subjects + ≥2 controversy/node subjects for Controversies UI.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSampleKnowledgeRelease } from '../../src/lib/knowledge/sampleRelease.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(here, '../../public/knowledge-releases')

async function main() {
  const root = process.env.KNOWLEDGE_RELEASES_DIR?.trim() || defaultRoot
  const { release, file, indexPath } = await writeSampleKnowledgeRelease(root)
  console.log(
    JSON.stringify(
      {
        id: release.id,
        releasedAt: release.releasedAt,
        sha256: release.sha256,
        claimCount: release.claims.length,
        subjectIds: [...new Set(release.claims.map((c) => c.subjectId))],
        root,
        file,
        indexPath,
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
