/**
 * #48-K / #52-K5 One-tick knowledge ingest (OpenAlex and/or Crossref).
 *
 *   npm run knowledge:ingest-once
 *   npm run knowledge:ingest-once -- --providers openalex --filter from_publication_date:2024-01-01
 *   npm run knowledge:ingest-once -- --dry-run --providers crossref
 *
 * Env:
 *   KNOWLEDGE_DB_PATH         knowledge.db path (cursor + snapshot authority)
 *   KNOWLEDGE_INGEST_CURSORS  optional JSON mirror path (not sole truth after K5)
 *   KNOWLEDGE_INGEST_MAILTO   polite pool email
 *   KNOWLEDGE_INGEST_FILTER   default filter for both providers
 *
 * Does NOT publish KnowledgeRelease — only SourceSnapshots + cursor advance.
 * K5: cursors + snapshots land in knowledge.db; optional --cursors JSON mirror.
 * Live HTTP unless --dry-run (then exits after printing resolved options).
 */

import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  loadCursorStore,
  saveCursorStore,
} from '../../src/lib/knowledge/store/cursorStoreIo.ts'
import {
  runScheduledIngestTick,
  type IngestProvider,
} from '../../src/lib/knowledge/ingest/scheduledIngest.ts'
import {
  emptyCursorStore,
  loadIngestCursorsFromPath,
  saveIngestCursorsToPath,
} from '../../src/lib/knowledge-db/ingest-cursors.ts'
import {
  migrateKnowledgeDb,
  openKnowledgeDb,
  resolveKnowledgeDbPath,
  repoRootFromHere,
} from '../../src/lib/knowledge-db/index.ts'
import { upsertSourceSnapshots } from '../../src/lib/knowledge-db/publish-release.ts'

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = hasFlag(args, '--dry-run')
  const skipDb = hasFlag(args, '--no-db')
  const providersRaw = argValue(args, '--providers') ?? 'openalex,crossref'
  const providers = providersRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is IngestProvider => s === 'openalex' || s === 'crossref')
  if (providers.length === 0) {
    console.error('No valid --providers (openalex,crossref)')
    process.exit(2)
  }

  const filter =
    argValue(args, '--filter') ?? process.env.KNOWLEDGE_INGEST_FILTER
  const mailto =
    argValue(args, '--mailto') ??
    process.env.KNOWLEDGE_INGEST_MAILTO ??
    'research@localhost'
  const outDir = argValue(args, '--out')
  const cursorPath = argValue(args, '--cursors')
  const root = repoRootFromHere()
  const dbPath =
    argValue(args, '--db') ?? resolveKnowledgeDbPath(root)

  // K5: DB is cursor authority unless --no-db (legacy file-only / offline ops).
  let cursorsFile: string | null = null
  let store = emptyCursorStore()
  let cursorSource: 'db' | 'file' | 'empty' = 'empty'

  if (!skipDb) {
    const fromDb = loadIngestCursorsFromPath({ dbPath, root })
    store = fromDb.store
    cursorSource = fromDb.store.cursors.length > 0 ? 'db' : 'empty'
  }

  // Bootstrap / mirror: file may seed empty DB or be written as ops mirror.
  const wantFile =
    Boolean(cursorPath) ||
    Boolean(process.env.KNOWLEDGE_INGEST_CURSORS) ||
    skipDb
  if (wantFile || store.cursors.length === 0) {
    const fileLoaded = await loadCursorStore(cursorPath)
    cursorsFile = fileLoaded.path
    if (store.cursors.length === 0 && fileLoaded.store.cursors.length > 0) {
      store = fileLoaded.store
      cursorSource = 'file'
    }
  }

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          providers,
          filter: filter ?? null,
          mailto,
          dbPath: skipDb ? null : dbPath,
          skipDb,
          cursorSource,
          cursorsFile,
          cursorStore: store,
        },
        null,
        2,
      ),
    )
    return
  }

  const result = await runScheduledIngestTick({
    providers,
    filter,
    mailto,
    cursorStore: store,
  })

  let dbCursorsWritten = 0
  let snapshotsWritten = 0
  if (!skipDb) {
    const saved = saveIngestCursorsToPath(result.cursorStore, { dbPath, root })
    dbCursorsWritten = saved.written
    migrateKnowledgeDb({ dbPath, root })
    const db = openKnowledgeDb({ dbPath, root })
    try {
      snapshotsWritten = upsertSourceSnapshots(db, result.snapshots)
    } finally {
      db.close()
    }
  }

  let fileSaved: string | null = null
  if (wantFile || cursorPath) {
    fileSaved = await saveCursorStore(result.cursorStore, cursorPath)
  }

  if (outDir) {
    await mkdir(outDir, { recursive: true })
    const stamp = result.capturedAt.replace(/[:.]/g, '-')
    const outFile = path.join(outDir, `snapshots-${stamp}.json`)
    await writeFile(
      outFile,
      JSON.stringify(
        {
          capturedAt: result.capturedAt,
          pages: result.pages,
          merge: {
            duplicatesDropped: result.merge.duplicatesDropped,
            byProvider: result.merge.byProvider,
          },
          snapshots: result.snapshots,
        },
        null,
        2,
      ),
      'utf8',
    )
    console.error(`wrote ${outFile}`)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        cursorAuthority: skipDb ? 'file' : 'knowledge.db',
        dbPath: skipDb ? null : dbPath,
        dbCursorsWritten,
        snapshotsWritten,
        cursorsFile: fileSaved,
        cursorSourceBefore: cursorSource,
        pages: result.pages.map((p) => ({
          provider: p.provider,
          snapshotCount: p.snapshotCount,
          nextCursor: p.nextCursor,
        })),
        mergedSnapshots: result.snapshots.length,
        duplicatesDropped: result.merge.duplicatesDropped,
        byProvider: result.merge.byProvider,
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
