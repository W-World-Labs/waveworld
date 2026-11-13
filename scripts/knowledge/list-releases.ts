/**
 * CLI: list / show on-disk KnowledgeRelease catalog (Atlas-read path).
 *
 *   npx tsx scripts/knowledge/list-releases.ts
 *   npx tsx scripts/knowledge/list-releases.ts --id kr-xxx
 *   KNOWLEDGE_RELEASES_DIR=/path npx tsx scripts/knowledge/list-releases.ts
 */
import {
  loadReleased,
  summarizeReleasedCatalog,
  claimsByKind,
} from '../../src/lib/knowledge/atlas/releasedCatalog.ts'

async function main() {
  const args = process.argv.slice(2)
  const idIdx = args.indexOf('--id')
  const id = idIdx >= 0 ? args[idIdx + 1] : undefined
  const kindIdx = args.indexOf('--kind')
  const kind = kindIdx >= 0 ? args[kindIdx + 1] : undefined

  if (id) {
    const release = await loadReleased(id)
    console.log(
      JSON.stringify(
        {
          id: release.id,
          releasedAt: release.releasedAt,
          sha256: release.sha256,
          claimCount: release.claims.length,
          claims: kind
            ? claimsByKind(release, kind).map((c) => ({
                id: c.id,
                kind: c.kind,
                statement: c.statement,
              }))
            : release.claims.map((c) => ({ id: c.id, kind: c.kind, state: c.state })),
        },
        null,
        2,
      ),
    )
    return
  }

  const sum = await summarizeReleasedCatalog()
  console.log(JSON.stringify(sum, null, 2))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
