/**
 * Knowledge DB CLI (SQLite) — EPIC #52 K0–K7
 *
 *   npm run knowledge:db:migrate
 *   npm run knowledge:db:status
 *   npx tsx scripts/knowledge/db-cli.ts path
 *   npx tsx scripts/knowledge/db-cli.ts seed
 *   npx tsx scripts/knowledge/db-cli.ts inventory   # K63/K65 close-checklist evidence dump
 *   npx tsx scripts/knowledge/db-cli.ts inventory --format=summary
 *   npx tsx scripts/knowledge/db-cli.ts inventory --check
 *   npx tsx scripts/knowledge/db-cli.ts cursors
 *   npx tsx scripts/knowledge/db-cli.ts publish-release --from <release.json> [--export-root dir]
 *   npx tsx scripts/knowledge/db-cli.ts resolve-job --kind <jobKind> [--release <id>] [--pack <claimId>]
 *
 * Env: KNOWLEDGE_DB_PATH, KNOWLEDGE_SCHEMA_PATH
 * seed = K1 skeleton + K2 efficiency claims + K7 sim.param_pack release
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  checkInventoryFloors,
  dumpKnowledgeInventoryEvidenceSync,
  extractInventoryTotals,
  formatInventoryFloorReport,
  formatInventoryMarkdown,
  formatInventorySummary,
  knowledgeDbStatus,
  loadIngestCursorsFromPath,
  migrateKnowledgeDb,
  publishKnowledgeReleaseToDb,
  resolveJobSpecFromKnowledge,
  resolveKnowledgeDbPath,
  resolveSchemaPath,
  repoRootFromHere,
  saveIngestCursorsToPath,
} from '../../src/lib/knowledge-db/index.ts'
import {
  seedKnowledgeDbFromRepoFull,
  staticInventory,
} from '../../src/lib/knowledge-db/seed-from-static.repo.ts'
import { parseCursorStore } from '../../src/lib/knowledge/ingest/scheduledIngest.ts'
import type { KnowledgeRelease } from '../../src/lib/knowledge/types.ts'
import { verifyKnowledgeRelease } from '../../src/lib/knowledge/release.ts'

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

type InventoryDumpFormat = 'json' | 'summary' | 'md'

/** K65: same format flags as dump-inventory.ts (parity). */
function parseInventoryFormat(argv: string[]): InventoryDumpFormat {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-s' || a === '--summary') return 'summary'
    if (a === '--md' || a === '--markdown') return 'md'
    if (a === '--format' || a === '-f') {
      const v = (argv[i + 1] ?? '').toLowerCase()
      if (v === 'summary' || v === 's') return 'summary'
      if (v === 'md' || v === 'markdown') return 'md'
      if (v === 'json') return 'json'
      throw new Error(`unknown --format value: ${argv[i + 1]}`)
    }
    if (a.startsWith('--format=')) {
      const v = a.slice('--format='.length).toLowerCase()
      if (v === 'summary' || v === 's') return 'summary'
      if (v === 'md' || v === 'markdown') return 'md'
      if (v === 'json') return 'json'
      throw new Error(`unknown --format value: ${v}`)
    }
  }
  return 'json'
}

function wantsInventoryCheck(argv: string[]): boolean {
  return argv.includes('--check') || argv.includes('-c')
}

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0] ?? 'status'
  const root = repoRootFromHere()

  if (cmd === 'path') {
    console.log(
      JSON.stringify(
        {
          db: resolveKnowledgeDbPath(root),
          schema: resolveSchemaPath(root),
          env: {
            KNOWLEDGE_DB_PATH: process.env.KNOWLEDGE_DB_PATH ?? null,
            KNOWLEDGE_SCHEMA_PATH: process.env.KNOWLEDGE_SCHEMA_PATH ?? null,
          },
        },
        null,
        2,
      ),
    )
    return
  }

  if (cmd === 'migrate') {
    const result = migrateKnowledgeDb({ root })
    console.log(
      JSON.stringify(
        {
          ok: true,
          dbPath: result.dbPath,
          schemaPath: result.schemaPath,
          applied: result.applied,
          already: result.already,
          tableCount: result.tables.length,
          tables: result.tables,
        },
        null,
        2,
      ),
    )
    return
  }

  if (cmd === 'status') {
    const s = knowledgeDbStatus({ root })
    console.log(JSON.stringify({ ok: true, ...s }, null, 2))
    return
  }

  // K63/K65: inventory evidence; K65 parity with dump-inventory --format / --check
  if (cmd === 'inventory' || cmd === 'dump-inventory' || cmd === 'counts') {
    const rest = argv.slice(1)
    const dbPath = argValue(rest, '--db')
    const format = parseInventoryFormat(rest)
    const doCheck = wantsInventoryCheck(rest)
    const evidence = dumpKnowledgeInventoryEvidenceSync({ root, dbPath })
    const totals = extractInventoryTotals(evidence.summary)

    if (doCheck) {
      const result = checkInventoryFloors(totals)
      if (!result.ok) {
        console.error(formatInventoryFloorReport(result))
        console.error(
          JSON.stringify(
            {
              ok: false,
              source: 'db-cli inventory --check',
              violations: result.violations,
              totals,
            },
            null,
            2,
          ),
        )
        process.exit(1)
      }
      console.log(
        JSON.stringify(
          {
            ok: true,
            source: 'db-cli inventory --check',
            floors: 'KNOWLEDGE_INVENTORY_FLOORS',
            report: formatInventoryFloorReport(result),
            totals,
          },
          null,
          2,
        ),
      )
      // --check alone: stop after ok JSON (same as dump-inventory)
      if (
        format === 'json' &&
        !rest.some((a) => a.includes('format') || a === '-s' || a === '--md')
      ) {
        return
      }
    }

    if (format === 'summary') {
      console.log(formatInventorySummary(evidence.summary))
      return
    }
    if (format === 'md') {
      console.log(formatInventoryMarkdown(evidence.summary))
      return
    }
    if (!doCheck) {
      console.log(JSON.stringify(evidence, null, 2))
    }
    return
  }

  if (cmd === 'seed') {
    const inv = staticInventory()
    const { skeleton, claims, paramPack } = await seedKnowledgeDbFromRepoFull({
      root,
    })
    const aligned =
      skeleton.counts.energy_nodes === inv.nodes &&
      skeleton.counts.conversion_edges === inv.edges &&
      skeleton.counts.materials === inv.materials &&
      skeleton.counts.material_properties === inv.material_properties &&
      claims.counts.claims_released > 0 &&
      claims.sha256.length === 64 &&
      paramPack.sha256.length === 64 &&
      paramPack.claimCount >= 1
    console.log(
      JSON.stringify(
        {
          ok: aligned,
          dbPath: skeleton.dbPath,
          static: inv,
          counts: skeleton.counts,
          claims: {
            releaseId: claims.releaseId,
            sha256: claims.sha256,
            edgeClaimCount: claims.edgeClaimCount,
            counts: claims.counts,
          },
          paramPack: {
            releaseId: paramPack.releaseId,
            sha256: paramPack.sha256,
            packClaimId: paramPack.packClaimId,
            materialClaimId: paramPack.materialClaimId,
            jobKind: paramPack.jobKind,
            claimCount: paramPack.claimCount,
          },
          aligned,
        },
        null,
        2,
      ),
    )
    if (!aligned) process.exit(1)
    return
  }

  if (cmd === 'cursors') {
    const sub = argv[1]
    const dbPath = argValue(argv, '--db')
    if (sub === 'import-file') {
      const file = argValue(argv, '--from')
      if (!file) {
        console.error('Usage: db-cli.ts cursors import-file --from <cursors.json>')
        process.exit(2)
      }
      const raw = JSON.parse(await readFile(path.resolve(file), 'utf8')) as unknown
      const store = parseCursorStore(raw)
      const saved = saveIngestCursorsToPath(store, { dbPath, root })
      console.log(
        JSON.stringify(
          {
            ok: true,
            dbPath: saved.dbPath,
            written: saved.written,
            cursors: store.cursors,
          },
          null,
          2,
        ),
      )
      return
    }

    // default: list
    const loaded = loadIngestCursorsFromPath({ dbPath, root })
    console.log(
      JSON.stringify(
        {
          ok: true,
          dbPath: loaded.dbPath,
          store: loaded.store,
          count: loaded.store.cursors.length,
        },
        null,
        2,
      ),
    )
    return
  }

  if (cmd === 'publish-release') {
    const from = argValue(argv, '--from')
    if (!from) {
      console.error(
        'Usage: db-cli.ts publish-release --from <release.json> [--export-root dir] [--db path]',
      )
      process.exit(2)
    }
    const exportRoot = argValue(argv, '--export-root')
    const dbPath = argValue(argv, '--db')
    const raw = JSON.parse(await readFile(path.resolve(from), 'utf8')) as KnowledgeRelease
    const v = await verifyKnowledgeRelease(raw)
    if (v) {
      console.error(`verify failed: ${v}`)
      process.exit(1)
    }
    const result = await publishKnowledgeReleaseToDb(raw, {
      root,
      dbPath,
      exportRoot: exportRoot ? path.resolve(exportRoot) : undefined,
      meta: { via: 'db-cli publish-release', sourceFile: path.resolve(from) },
    })
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
    return
  }

  if (cmd === 'resolve-job') {
    const kind = argValue(argv, '--kind')
    if (!kind) {
      console.error(
        'Usage: db-cli.ts resolve-job --kind <jobKind> [--release <id>] [--pack <claimId>] [--subject <subjectId>] [--db path]',
      )
      process.exit(2)
    }
    const dbPath = argValue(argv, '--db')
    const releaseId = argValue(argv, '--release')
    const packClaimId = argValue(argv, '--pack')
    const packSubjectId = argValue(argv, '--subject')
    const result = resolveJobSpecFromKnowledge(
      {
        kind,
        releaseId,
        packClaimId,
        packSubjectId,
      },
      { dbPath, root },
    )
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exit(1)
    return
  }

  console.error(
    `Usage: db-cli.ts <migrate|status|path|seed|inventory|cursors|publish-release|resolve-job>`,
  )
  process.exit(2)
}

try {
  await main()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
