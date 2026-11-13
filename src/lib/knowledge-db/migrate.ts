/**
 * Apply Knowledge DB schema migrations (SQLite).
 * Migration id recorded in schema_migrations after successful apply.
 */
import fs from 'node:fs'
import type { SqliteDatabase } from './load-sqlite.ts'
import {
  ensureParentDir,
  resolveKnowledgeDbPath,
  resolveSchemaPath,
  repoRootFromHere,
} from './paths.ts'
import { loadBetterSqlite3 } from './load-sqlite.ts'

/** Baseline DDL shipped in docs/sql/knowledge-schema.sql */
export const KNOWLEDGE_SCHEMA_MIGRATION_ID = '2026-08-06-knowledge-schema-v1'

export type MigrateResult = {
  dbPath: string
  schemaPath: string
  applied: string[]
  already: string[]
  tables: string[]
}

export function listAppliedMigrations(db: SqliteDatabase): string[] {
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`,
    )
    .get() as { name?: string } | undefined
  if (!row?.name) return []
  const rows = db
    .prepare(`SELECT id FROM schema_migrations ORDER BY applied_at, id`)
    .all() as Array<{ id: string }>
  return rows.map((r) => r.id)
}

export function listTables(db: SqliteDatabase): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Open knowledge DB (creates file + parent dir). Does not migrate.
 */
export function openKnowledgeDb(options?: {
  dbPath?: string
  root?: string
  readonly?: boolean
}): SqliteDatabase {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  if (!options?.readonly) ensureParentDir(dbPath)
  const Database = loadBetterSqlite3(root)
  const db = new Database(dbPath, {
    readonly: options?.readonly ?? false,
    fileMustExist: options?.readonly ?? false,
  })
  if (!options?.readonly) {
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')
  } else {
    try {
      db.pragma('foreign_keys = ON')
    } catch {
      /* readonly ok */
    }
  }
  return db
}

/**
 * Apply baseline schema if not yet recorded.
 * Safe to call repeatedly (idempotent CREATE IF NOT EXISTS + migration row).
 */
export function migrateKnowledgeDb(options?: {
  dbPath?: string
  schemaPath?: string
  root?: string
}): MigrateResult {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const schemaPath = options?.schemaPath ?? resolveSchemaPath(root)

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Knowledge schema SQL not found: ${schemaPath}`)
  }
  const sql = fs.readFileSync(schemaPath, 'utf8')

  const db = openKnowledgeDb({ dbPath, root })
  try {
    const appliedBefore = listAppliedMigrations(db)
    const already: string[] = []
    const applied: string[] = []

    if (appliedBefore.includes(KNOWLEDGE_SCHEMA_MIGRATION_ID)) {
      already.push(KNOWLEDGE_SCHEMA_MIGRATION_ID)
    } else {
      const run = db.transaction(() => {
        db.exec(sql)
        // Schema file creates schema_migrations; ensure row
        db.prepare(
          `INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)`,
        ).run(KNOWLEDGE_SCHEMA_MIGRATION_ID, nowIso())
      })
      run()
      applied.push(KNOWLEDGE_SCHEMA_MIGRATION_ID)
    }

    // Re-apply DDL is already IF NOT EXISTS; if someone deleted migration row
    // but left tables, INSERT OR IGNORE after exec still works on second path.
    // If tables missing but row present, force exec once:
    const tables = listTables(db)
    if (
      already.length &&
      !tables.includes('energy_nodes') &&
      !tables.includes('claims')
    ) {
      db.exec(sql)
      already.length = 0
      applied.push(`${KNOWLEDGE_SCHEMA_MIGRATION_ID}:repaired`)
    }

    return {
      dbPath,
      schemaPath,
      applied,
      already: already.length ? already : listAppliedMigrations(db).filter(
        (id) => !applied.includes(id),
      ),
      tables: listTables(db),
    }
  } finally {
    db.close()
  }
}

export function knowledgeDbStatus(options?: {
  dbPath?: string
  root?: string
}): {
  dbPath: string
  exists: boolean
  migrations: string[]
  tables: string[]
  counts?: Record<string, number>
} {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const exists = fs.existsSync(dbPath)
  if (!exists) {
    return { dbPath, exists: false, migrations: [], tables: [] }
  }
  const db = openKnowledgeDb({ dbPath, root, readonly: true })
  try {
    const migrations = listAppliedMigrations(db)
    const tables = listTables(db)
    const counts: Record<string, number> = {}
    for (const t of [
      'energy_nodes',
      'conversion_edges',
      'materials',
      'material_properties',
      'claims',
      'source_snapshots',
      'knowledge_releases',
      'ingest_cursors',
    ]) {
      if (tables.includes(t)) {
        const row = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as {
          c: number
        }
        counts[t] = row.c
      }
    }
    return { dbPath, exists: true, migrations, tables, counts }
  } finally {
    db.close()
  }
}
