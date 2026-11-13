import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

/** Single monorepo default when TASK_DB_PATH is unset (#73). */
export function resolveDefaultTaskDbPath(
  cwd: string = process.cwd(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (env.TASK_DB_PATH) return env.TASK_DB_PATH;
  const norm = cwd.replace(/\\/g, '/');
  if (norm.endsWith('/apps/host') || norm.endsWith('/apps/lab')) {
    return path.resolve(cwd, '../../data/tasks.db');
  }
  return path.join(cwd, 'data', 'tasks.db');
}

const DEFAULT_DB = resolveDefaultTaskDbPath();

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function ensureSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      last_seen_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      name TEXT,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,
      spec TEXT NOT NULL,
      result TEXT,
      error TEXT,
      created_by TEXT,
      agent_id TEXT,
      project_id TEXT,
      lease_expires_at TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      progress TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS job_attempt_outcomes (
      job_id TEXT NOT NULL REFERENCES jobs(id),
      attempt INTEGER NOT NULL CHECK (attempt >= 0),
      agent_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (job_id, attempt)
    );
    CREATE INDEX IF NOT EXISTS job_attempt_outcomes_agent
      ON job_attempt_outcomes (job_id, attempt, agent_id);
    CREATE TRIGGER IF NOT EXISTS job_attempt_outcomes_immutable_update
      BEFORE UPDATE ON job_attempt_outcomes
      BEGIN SELECT RAISE(ABORT, 'job attempt outcomes are immutable'); END;
    CREATE INDEX IF NOT EXISTS jobs_status_priority_created
      ON jobs (status, priority DESC, created_at);
    CREATE INDEX IF NOT EXISTS jobs_lease ON jobs (lease_expires_at);
    CREATE INDEX IF NOT EXISTS jobs_model_artifact ON jobs (
      CAST(json_extract(CASE WHEN json_valid(spec) THEN spec ELSE '{}' END, '$.model.artifactId') AS TEXT)
    );
    CREATE TABLE IF NOT EXISTS compute_runs (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id),
      cluster_id TEXT NOT NULL,
      allocation TEXT NOT NULL,
      input_json TEXT,
      max_wall_time_ms INTEGER NOT NULL,
      instance_id TEXT,
      phase TEXT NOT NULL DEFAULT 'queued',
      create_attempts INTEGER NOT NULL DEFAULT 0,
      failures INTEGER NOT NULL DEFAULT 0,
      deadline_ms INTEGER NOT NULL,
      lock_owner TEXT,
      lock_until_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      project_id TEXT,
      owner_user_id TEXT,
      kind TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      content_type TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      sha256 TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      content_type TEXT NOT NULL,
      metadata TEXT NOT NULL,
      owner_user_id TEXT,
      project_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS evidence_sha256 ON evidence (sha256);
    CREATE TABLE IF NOT EXISTS job_audits (
      job_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      artifact_id TEXT,
      manifest_sha256 TEXT,
      error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS publications (
      public_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0,
      project_id TEXT,
      owner_user_id TEXT NOT NULL,
      bundle_artifact_id TEXT NOT NULL,
      bundle_sha256 TEXT NOT NULL,
      manifest_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (public_id, version)
    );
    CREATE INDEX IF NOT EXISTS publications_owner_created ON publications(owner_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS publications_project_created ON publications(project_id, created_at DESC);
    CREATE TRIGGER IF NOT EXISTS publications_immutable_update BEFORE UPDATE ON publications
      BEGIN SELECT RAISE(ABORT, 'publication records are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS publications_immutable_delete BEFORE DELETE ON publications
      BEGIN SELECT RAISE(ABORT, 'publication records are immutable'); END;
    CREATE TABLE IF NOT EXISTS path_comparisons (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      created_by TEXT NOT NULL,
      job_ids TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (created_by, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS path_comparisons_creator_created
      ON path_comparisons (created_by, created_at);
  `);
  // Best-effort migrations for DBs created before project/owner columns.
  try {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN project_id TEXT`);
  } catch {
    /* column exists */
  }
  try {
    sqlite.exec(`CREATE INDEX IF NOT EXISTS jobs_project ON jobs (project_id)`);
  } catch {
    /* ok */
  }
  try {
    sqlite.exec(`ALTER TABLE artifacts ADD COLUMN project_id TEXT`);
  } catch {
    /* column exists */
  }
  try {
    sqlite.exec(`ALTER TABLE artifacts ADD COLUMN owner_user_id TEXT`);
  } catch {
    /* column exists */
  }
  try {
    sqlite.exec(`ALTER TABLE artifacts ADD COLUMN sha256 TEXT`);
  } catch {
    /* column exists */
  }
  try {
    sqlite.exec(`CREATE INDEX IF NOT EXISTS artifacts_project ON artifacts (project_id)`);
  } catch {
    /* ok */
  }
  try {
    sqlite.exec(`CREATE INDEX IF NOT EXISTS artifacts_owner ON artifacts (owner_user_id)`);
  } catch {
    /* ok */
  }
  try {
    // Terminal-job GC + stats join probe artifacts by owning job; the sweep's
    // cutoff/ordering needs created_at. Without these each lazy sweep is a
    // full artifacts scan on every claim/stats call.
    sqlite.exec(`CREATE INDEX IF NOT EXISTS artifacts_job ON artifacts (job_id)`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS artifacts_created ON artifacts (created_at)`);
  } catch {
    /* ok */
  }
  try {
    sqlite.exec(`ALTER TABLE evidence ADD COLUMN project_id TEXT`);
  } catch {
    /* column exists */
  }
  try {
    sqlite.exec(`CREATE INDEX IF NOT EXISTS evidence_project ON evidence (project_id, created_at)`);
  } catch {
    /* ok */
  }
  const computeColumns = sqlite.pragma('table_info(compute_runs)') as { name: string }[];
  if (!computeColumns.some(column => column.name === 'input_json')) sqlite.exec('ALTER TABLE compute_runs ADD COLUMN input_json TEXT');
  for (const name of ['create_attempts', 'failures']) {
    if (!computeColumns.some(column => column.name === name)) sqlite.exec(`ALTER TABLE compute_runs ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);
  }
  // Spec fingerprint for prior-compute reuse (compute cloud load-by-equivalent-spec).
  try {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN spec_fingerprint TEXT`);
  } catch {
    /* column exists */
  }
  try {
    sqlite.exec(
      `CREATE INDEX IF NOT EXISTS jobs_spec_fingerprint_status
       ON jobs (spec_fingerprint, status)`
    );
  } catch {
    /* ok */
  }
}

export function getDbPath(): string {
  return process.env.TASK_DB_PATH ?? DEFAULT_DB;
}

export function getDb() {
  if (_db) return _db;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  ensureSchema(sqlite);
  _sqlite = sqlite;
  _db = drizzle(sqlite, { schema });
  return _db;
}

/** 事务包装（原子 claim） */
export function withTransaction<T>(fn: (sqlite: Database.Database) => T): T {
  getDb();
  if (!_sqlite) throw new Error('DB not initialized');
  const tx = _sqlite.transaction(fn);
  return tx(_sqlite);
}

export function getSqlite(): Database.Database {
  getDb();
  if (!_sqlite) throw new Error('DB not initialized');
  return _sqlite;
}
