/**
 * #48-O / #48-Q Offline knowledge pipeline CLI.
 *
 * snapshots/claims (in-code fixture) → efficiency gate → publishKnowledgeRelease
 * → writeKnowledgeRelease → regenerate index.json.
 *
 * Deterministic, no live HTTP. Default root: public/knowledge-releases.
 * Sample: ≥6 edge subjects + ≥2 controversy/node subjects for Controversies UI.
 *
 *   npx tsx scripts/knowledge/offline-pipeline.ts
 *   KNOWLEDGE_RELEASES_DIR=/path npx tsx scripts/knowledge/offline-pipeline.ts
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSampleKnowledgeRelease } from '../../src/lib/knowledge/sampleRelease.ts'
import {
  SAMPLE_CONTROVERSY_SUBJECT_IDS,
  SAMPLE_EDGE_SUBJECT_IDS,
  SAMPLE_SUBJECT_IDS,
} from '../../src/lib/knowledge/sampleRelease.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(here, '../../public/knowledge-releases')

async function main() {
  const root = process.env.KNOWLEDGE_RELEASES_DIR?.trim() || defaultRoot
  const { release, file, indexPath } = await writeSampleKnowledgeRelease(root)
  const subjectIds = [...new Set(release.claims.map((c) => c.subjectId))]
  console.log(
    JSON.stringify(
      {
        pipeline: 'offline-gate-publish-write',
        id: release.id,
        releasedAt: release.releasedAt,
        sha256: release.sha256,
        claimCount: release.claims.length,
        subjectIds,
        expectedSubjects: [...SAMPLE_SUBJECT_IDS],
        edgeSubjects: [...SAMPLE_EDGE_SUBJECT_IDS],
        controversySubjects: [...SAMPLE_CONTROVERSY_SUBJECT_IDS],
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
