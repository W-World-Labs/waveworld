/**
 * §7.4 (EPIC #52): 不把 tasks 用户数据写入 knowledge 备份对外分发包.
 *
 * The first-class knowledge backup pair (`knowledge.db` + `knowledge-blobs/`,
 * K8–K10 via scripts/deploy/backup-waveworld.mjs) is the artifact that may be
 * distributed as a whole-DB read-only replica (docs/knowledge-db.md §2:
 * "知识可整库发布/只读副本，不夹带用户任务隐私"). This pins the invariant:
 * a stamp produced from real tasks + knowledge sources must carry zero
 * tasks-domain tables or user-data bytes inside the knowledge pair; tasks
 * data stays confined to the separate top-level `tasks.db`/`artifacts/`.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadBetterSqlite3 } from './load-sqlite.ts'
import {
  listTables,
  migrateKnowledgeDb,
  openKnowledgeDb,
} from './migrate.ts'
import { repoRootFromHere, resolveSchemaPath } from './paths.ts'

const root = repoRootFromHere()
const temps: string[] = []

afterEach(() => {
  for (const dir of temps) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* */
    }
  }
  temps.length = 0
})

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdb-backup-isolation-'))
  temps.push(dir)
  return dir
}

/** tasks.db user-domain tables (apps/host/src/lib/tasks/db.ts, user-auth.ts, project-service.ts, job-sharing.ts). */
const TASKS_DOMAIN_TABLES = [
  'agents',
  'jobs',
  'compute_runs',
  'artifacts',
  'evidence',
  'evidence_sha',
  'job_audits',
  'job_shares',
  'job_share_items',
  'publications',
  'path_comparisons',
  'independent_reviews',
  'host_sessions',
  'projects',
  'project_members',
  'project_models',
  'users',
  'sessions',
  'api_keys',
] as const

const TASKS_SECRET_MARKERS = [
  'TASKS_USER_SECRET_7c1f',
  'tasks-secret@example.com',
  'TASKS_ARTIFACT_SECRET_9e02',
] as const

/** Knowledge schema table allow-list, parsed from the authoritative DDL. */
function knowledgeSchemaTables(): Set<string> {
  const sql = fs.readFileSync(resolveSchemaPath(root), 'utf8')
  const names = new Set<string>()
  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)) {
    names.add(m[1]!)
  }
  return names
}

describe('knowledge backup pair contains no tasks user data (§7.4)', () => {
  it('stamp knowledge.db + knowledge-blobs carry zero tasks-domain rows or bytes', () => {
    const dir = tempRoot()
    const Database = loadBetterSqlite3(root)

    // tasks.db: real tasks-domain tables filled with marker user data.
    const tasksDbPath = path.join(dir, 'tasks.db')
    const tasksDb = new Database(tasksDbPath)
    tasksDb.exec(`
      CREATE TABLE jobs (id TEXT PRIMARY KEY, title TEXT, owner_email TEXT);
      CREATE TABLE agents (id TEXT PRIMARY KEY, token TEXT);
      CREATE TABLE host_sessions (id TEXT PRIMARY KEY, user_email TEXT);
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO jobs VALUES ('job-1', '${TASKS_SECRET_MARKERS[0]}', '${TASKS_SECRET_MARKERS[1]}');
      INSERT INTO agents VALUES ('agent-1', '${TASKS_SECRET_MARKERS[0]}-token');
      INSERT INTO host_sessions VALUES ('sess-1', '${TASKS_SECRET_MARKERS[1]}');
      INSERT INTO projects VALUES ('proj-1', '${TASKS_SECRET_MARKERS[0]}-project');
    `)
    tasksDb.close()

    // knowledge.db: real migrated knowledge schema + a claim row.
    const knowledgeDbPath = path.join(dir, 'knowledge.db')
    migrateKnowledgeDb({ root, dbPath: knowledgeDbPath })
    const kdb = openKnowledgeDb({ root, dbPath: knowledgeDbPath })
    try {
      kdb
        .prepare(
          `INSERT INTO claims (
             id, contract_version, kind, subject_id, statement_json,
             state, confidence, created_at, updated_at
           ) VALUES ('claim-k', 1, 'efficiency', 'edge:e1',
                     '{"value":0.5,"unit":"fraction"}', 'released', 0.8,
                     '2026-01-02T00:00:00.000Z', NULL)`,
        )
        .run()
    } finally {
      kdb.close()
    }

    // knowledge-blobs: content-addressed evidence bytes only.
    const blobSha = 'a'.repeat(64)
    const blobsRoot = path.join(dir, 'knowledge-blobs')
    fs.mkdirSync(path.join(blobsRoot, 'aa'), { recursive: true })
    fs.writeFileSync(path.join(blobsRoot, 'aa', blobSha), 'evidence-bytes')

    // tasks artifacts root (stays OUTSIDE the knowledge pair).
    const artifactsRoot = path.join(dir, 'artifacts')
    fs.mkdirSync(path.join(artifactsRoot, 'job-1'), { recursive: true })
    fs.writeFileSync(
      path.join(artifactsRoot, 'job-1', 'result.bin'),
      TASKS_SECRET_MARKERS[2],
    )

    const stamp = path.join(dir, 'backup-stamp')
    const script = path.join(root, 'scripts/deploy/backup-waveworld.mjs')
    const run = spawnSync(
      process.execPath,
      [
        script,
        '--db',
        tasksDbPath,
        '--artifacts',
        artifactsRoot,
        '--out',
        stamp,
        '--knowledge-db',
        knowledgeDbPath,
        '--knowledge-blobs',
        blobsRoot,
      ],
      { cwd: root, encoding: 'utf8' },
    )
    expect(run.status, run.stderr).toBe(0)
    const manifest = JSON.parse(run.stdout) as {
      database: { path: string }
      knowledgeDatabase: { path: string }
      knowledgeBlobs: { inventory: string }
    }

    // Knowledge pair is first-class and separate from the tasks backup file.
    expect(manifest.knowledgeDatabase.path).toBe('knowledge.db')
    expect(manifest.database.path).toBe('tasks.db')

    // 1) knowledge.db inside the stamp has only knowledge-schema tables —
    //    no tasks-domain table can ride along in the distributable replica.
    const stampKdb = openKnowledgeDb({
      root,
      dbPath: path.join(stamp, 'knowledge.db'),
      readonly: true,
    })
    try {
      const tables = listTables(stampKdb)
      const allowed = knowledgeSchemaTables()
      expect(tables.length).toBeGreaterThan(0)
      for (const t of tables) {
        expect(allowed.has(t), `unexpected table in knowledge.db: ${t}`).toBe(
          true,
        )
        expect(
          (TASKS_DOMAIN_TABLES as readonly string[]).includes(t),
          `tasks-domain table leaked into knowledge.db: ${t}`,
        ).toBe(false)
      }
      // It is a real knowledge replica (claim present), not an empty shell.
      const claimCount = stampKdb
        .prepare(`SELECT COUNT(*) AS c FROM claims`)
        .get() as { c: number }
      expect(claimCount.c).toBe(1)

      // 2) No tasks user-data bytes anywhere in knowledge.db cells.
      const allRows: unknown[] = []
      for (const t of tables) {
        allRows.push(
          ...(stampKdb.prepare(`SELECT * FROM ${t}`).all() as unknown[]),
        )
      }
      const corpus = JSON.stringify(allRows)
      for (const marker of TASKS_SECRET_MARKERS) {
        expect(corpus.includes(marker), `marker leaked: ${marker}`).toBe(false)
      }
    } finally {
      stampKdb.close()
    }

    // 3) knowledge-blobs carries only hex-sha evidence files — no task
    //    artifact paths or bytes.
    const inventory = JSON.parse(
      fs.readFileSync(
        path.join(stamp, 'knowledge-blobs.inventory.json'),
        'utf8',
      ),
    ) as { files: Array<{ path: string }> }
    expect(inventory.files.length).toBe(1)
    for (const f of inventory.files) {
      expect(f.path).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}$/)
      const bytes = fs.readFileSync(
        path.join(stamp, 'knowledge-blobs', ...f.path.split('/')),
      )
      for (const marker of TASKS_SECRET_MARKERS) {
        expect(bytes.includes(marker), `blob leaked: ${f.path}`).toBe(false)
      }
    }
    expect(
      fs.existsSync(path.join(stamp, 'knowledge-blobs', 'job-1')),
    ).toBe(false)
  })
})
