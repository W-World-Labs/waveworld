import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { getDb, getSqlite } from './db';
import { artifacts } from './schema';
import { HttpError } from './http';
import { MODEL_GEOMETRY_ARTIFACT_KIND, isModelGeometryContentType } from '../../../../lab/src/lib/models/geometry-contract';
import type { JobSpecV1 } from '../../types/task';

const ROOT = () => {
  if (process.env.ARTIFACT_ROOT) return path.resolve(process.env.ARTIFACT_ROOT);
  // Prefer waveworld repo data/ when host runs from apps/host
  const cwd = process.cwd().replace(/\\/g, '/');
  if (cwd.endsWith('/apps/host')) {
    return path.resolve(process.cwd(), '../../data/artifacts');
  }
  return path.join(process.cwd(), 'data', 'artifacts');
};

/**
 * Max upload size. Prefer ARTIFACT_MAX_BYTES; MAX_ARTIFACT_BYTES kept for compat.
 * Default 32 MiB.
 */
export function getArtifactMaxBytes(): number {
  const raw =
    process.env.ARTIFACT_MAX_BYTES ?? process.env.MAX_ARTIFACT_BYTES ?? String(32 * 1024 * 1024);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 32 * 1024 * 1024;
  return Math.floor(n);
}

/** True when list/download may proceed without agent/user auth (local dev). */
export function allowOpenArtifactAccess(): boolean {
  if (process.env.ARTIFACT_REQUIRE_AUTH === '1' || process.env.ARTIFACT_REQUIRE_AUTH === 'true') {
    return false;
  }
  if (process.env.NODE_ENV === 'production') return false;
  return true;
}

export interface StoredArtifact {
  id: string;
  jobId: string | null;
  projectId: string | null;
  ownerUserId: string | null;
  kind: string;
  storageKey: string;
  contentType: string;
  bytes: number;
  /** SHA-256 of immutable stored bytes; null only for artifacts created before migration. */
  sha256: string | null;
  createdAt: string;
}

/** Ensure project_id / owner_user_id columns exist (idempotent). */
export function ensureArtifactColumns(): void {
  const sqlite = getSqlite();
  try {
    sqlite.exec(`ALTER TABLE artifacts ADD COLUMN project_id TEXT`);
  } catch {
    /* exists */
  }
  try {
    sqlite.exec(`ALTER TABLE artifacts ADD COLUMN owner_user_id TEXT`);
  } catch {
    /* exists */
  }
  try {
    sqlite.exec(`ALTER TABLE artifacts ADD COLUMN sha256 TEXT`);
  } catch {
    /* exists */
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
}

/** Safe path segment: alnum, dash, underscore, dot; no traversal. */
export function safePathSegment(value: string | null | undefined, fallback: string): string {
  if (value == null || value === '') return fallback;
  const s = String(value);
  if (s.includes('..') || s.includes('/') || s.includes('\\') || s.includes('\0')) {
    return fallback;
  }
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(s)) return fallback;
  return s;
}

function assertUnderRoot(absPath: string): boolean {
  const root = path.resolve(/* turbopackIgnore: true */ ROOT());
  const resolved = path.resolve(/* turbopackIgnore: true */ absPath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

const ARTIFACT_STORE_ERROR = 'artifact storage unavailable';

/**
 * fs probe that never conflates a store fault with absence: ENOENT/ENOTDIR
 * means genuinely missing; EACCES/ELOOP/EIO and friends mean the store is
 * faulting and must surface an honest 5xx — a raw fs throw would also leak
 * absolute server paths through errorResponse's err.message echo.
 */
export function statArtifactFile(absPath: string): 'present' | 'missing' {
  try {
    fs.statSync(absPath);
    return 'present';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing';
    throw new HttpError(500, ARTIFACT_STORE_ERROR);
  }
}

function rowToStored(row: Record<string, unknown>): StoredArtifact {
  const g = (camel: string, snake: string) =>
    row[camel] !== undefined ? row[camel] : row[snake];
  return {
    id: String(row.id),
    jobId: (g('jobId', 'job_id') as string | null) ?? null,
    projectId: (g('projectId', 'project_id') as string | null) ?? null,
    ownerUserId: (g('ownerUserId', 'owner_user_id') as string | null) ?? null,
    kind: String(row.kind),
    storageKey: String(g('storageKey', 'storage_key')),
    contentType: String(g('contentType', 'content_type')),
    bytes: Number(g('bytes', 'bytes') ?? 0),
    sha256: (g('sha256', 'sha256') as string | null) ?? null,
    createdAt: String(g('createdAt', 'created_at')),
  };
}

export function saveArtifact(input: {
  jobId?: string | null;
  projectId?: string | null;
  ownerUserId?: string | null;
  kind: string;
  contentType: string;
  data: Buffer | Uint8Array;
}): StoredArtifact {
  ensureArtifactColumns();
  const max = getArtifactMaxBytes();
  if (input.data.byteLength > max) {
    throw new HttpError(
      413,
      `artifact too large: ${input.data.byteLength} > ${max} bytes (ARTIFACT_MAX_BYTES)`
    );
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const sha256 = createHash('sha256').update(input.data).digest('hex');
  // Prefer project scope for on-disk layout, else job, else orphan — all segments sanitized.
  const dirSeg = safePathSegment(
    input.projectId ?? input.jobId ?? null,
    input.projectId ? 'project' : input.jobId ? 'job' : 'orphan'
  );
  // If job/project id was unsafe, still isolate under a generic folder + id file.
  const parent =
    dirSeg === 'project' || dirSeg === 'job' || dirSeg === 'orphan'
      ? dirSeg
      : dirSeg;
  const fileName = `${safePathSegment(id, id)}.bin`;
  const storageKey = path.join(parent, fileName);
  const abs = path.join(ROOT(), storageKey);
  if (!assertUnderRoot(abs)) {
    throw new HttpError(400, 'invalid artifact storage path');
  }
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, input.data);
  } catch (err) {
    // Remove a partial write so a faulting store cannot strand bytes the row
    // sweep will never see; the generic message never leaks fs paths upstream.
    try {
      fs.rmSync(abs, { force: true });
    } catch {
      /* best effort */
    }
    throw new HttpError(500, ARTIFACT_STORE_ERROR);
  }

  const row: StoredArtifact = {
    id,
    jobId: input.jobId ?? null,
    projectId: input.projectId ?? null,
    ownerUserId: input.ownerUserId ?? null,
    kind: input.kind,
    storageKey,
    contentType: input.contentType,
    bytes: input.data.byteLength,
    sha256,
    createdAt,
  };

  // Raw insert so optional columns always work even if drizzle schema lags.
  const sqlite = getSqlite();
  sqlite
    .prepare(
      `INSERT INTO artifacts
       (id, job_id, project_id, owner_user_id, kind, storage_key, content_type, bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.jobId,
      row.projectId,
      row.ownerUserId,
      row.kind,
      row.storageKey,
      row.contentType,
      row.bytes,
      row.sha256,
      row.createdAt
    );
  return row;
}

export function getArtifact(id: string): { meta: StoredArtifact; absPath: string } | null {
  ensureArtifactColumns();
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
    return null;
  }
  const sqlite = getSqlite();
  const row = sqlite.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    // Fallback drizzle path (legacy)
    const drow = getDb().select().from(artifacts).where(eq(artifacts.id, id)).get();
    if (!drow) return null;
    const meta = rowToStored(drow as unknown as Record<string, unknown>);
    return resolveDisk(meta);
  }
  return resolveDisk(rowToStored(row));
}

function resolveDisk(meta: StoredArtifact): { meta: StoredArtifact; absPath: string } | null {
  // Reject stored keys that escape root (defense in depth against poisoned rows).
  const key = meta.storageKey;
  if (!key || key.includes('\0') || path.isAbsolute(key)) return null;
  const normalized = path.normalize(key);
  if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) return null;
  const abs = path.resolve(ROOT(), normalized);
  if (!assertUnderRoot(abs)) return null;
  return { meta: { ...meta, storageKey: normalized }, absPath: abs };
}

export function readArtifactBytes(id: string): { meta: StoredArtifact; data: Buffer } | null {
  const found = getArtifact(id);
  if (!found || statArtifactFile(found.absPath) === 'missing') return null;
  let data: Buffer;
  try {
    data = fs.readFileSync(found.absPath);
  } catch (err) {
    // Vanished between stat and read is still "missing"; a real store fault
    // (EACCES/EISDIR/EIO…) must not read back as a corrupt/not-found artifact.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw new HttpError(500, ARTIFACT_STORE_ERROR);
  }
  if (data.byteLength !== found.meta.bytes) return null;
  if (found.meta.sha256 && createHash('sha256').update(data).digest('hex') !== found.meta.sha256) return null;
  return { meta: found.meta, data };
}

export type ListArtifactsFilter = {
  jobId?: string;
  projectId?: string;
  ownerUserId?: string;
};

/**
 * List artifacts. Accepts legacy `listArtifacts(jobId)` or filter object.
 */
export function listArtifacts(
  jobIdOrFilter?: string | ListArtifactsFilter
): StoredArtifact[] {
  ensureArtifactColumns();
  const filter: ListArtifactsFilter =
    typeof jobIdOrFilter === 'string'
      ? { jobId: jobIdOrFilter }
      : jobIdOrFilter ?? {};

  const sqlite = getSqlite();
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.jobId) {
    clauses.push('job_id = ?');
    params.push(filter.jobId);
  }
  if (filter.projectId) {
    clauses.push('project_id = ?');
    params.push(filter.projectId);
  }
  if (filter.ownerUserId) {
    clauses.push('owner_user_id = ?');
    params.push(filter.ownerUserId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = sqlite
    .prepare(`SELECT * FROM artifacts ${where} ORDER BY created_at DESC LIMIT 500`)
    .all(...params) as Record<string, unknown>[];
  return rows.map(rowToStored);
}

/**
 * Whether a user may download / view an artifact.
 * - project-scoped: must be owner/member/workspace viewer of that project
 * - owner-scoped (no project): must match owner_user_id
 * - legacy (no project, no owner): any authenticated user
 */
export function userMayAccessArtifact(
  meta: StoredArtifact,
  user: { id: string },
  projectAccess: 'owner' | 'editor' | 'viewer' | null | undefined
): boolean {
  if (meta.projectId) {
    return projectAccess != null;
  }
  if (meta.ownerUserId) {
    return meta.ownerUserId === user.id;
  }
  // Unscoped / orphan artifacts are not world-readable (#67).
  return false;
}

/** A submitted model reference must belong to the submitting user/project. */
export function validateModelArtifactReference(
  spec: JobSpecV1,
  userId: string | null,
  context: { projectId?: string; canEditProject?: boolean } = {},
): void {
  if (spec.model?.source !== 'artifact') return;
  const found = spec.model.artifactId ? getArtifact(spec.model.artifactId) : null;
  if (!found) throw new HttpError(400, 'model artifact not found');
  const meta = found.meta;
  if (meta.projectId) {
    if (meta.projectId !== context.projectId || !context.canEditProject) throw new HttpError(403, 'model artifact requires access to its project');
  } else if (meta.ownerUserId) {
    if (meta.ownerUserId !== userId) throw new HttpError(403, 'model artifact belongs to another user');
  } else if (!allowOpenArtifactAccess()) {
    throw new HttpError(403, 'model artifact has no owner');
  }
  if ((spec.kind === 'lbm-d3q19' || spec.kind === 'mac-3d') && (meta.kind !== MODEL_GEOMETRY_ARTIFACT_KIND || !isModelGeometryContentType(meta.contentType))) {
    throw new HttpError(400, 'Fluid model must use the WaveWorld mesh artifact format');
  }
}

/**
 * Retention for artifacts bound to terminal (failed/cancelled) jobs, except
 * model inputs still referenced by a saved job or project model.
 * Env: ARTIFACT_RETENTION_SECONDS; 0 disables the sweep. Default 7 days.
 */
export function getArtifactRetentionSeconds(): number {
  const raw = process.env.ARTIFACT_RETENTION_SECONDS;
  if (raw == null || raw === '') return 7 * 24 * 3600;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 7 * 24 * 3600;
  return Math.floor(n);
}

/** Per-sweep delete bound. Env: ARTIFACT_GC_MAX_DELETE; default 256, capped 4096. */
export function getArtifactGcBatchSize(): number {
  const raw = process.env.ARTIFACT_GC_MAX_DELETE;
  if (raw == null || raw === '') return 256;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 256;
  return Math.min(Math.floor(n), 4096);
}

export interface ArtifactGcResult {
  candidates: number;
  deletedRows: number;
  bytesFreed: number;
  /** Unlink failures — row kept so a later sweep retries. */
  fileErrors: number;
}

/** Per-sweep directory-walk bound — internal constant, like CLAIM_CANDIDATE_LIMIT. */
const ORPHAN_FILE_SCAN_LIMIT = 8192;

/** Min interval between orphan-file sweeps. Env: ARTIFACT_GC_INTERVAL_SECONDS; default 3600 (hourly); 0 = every call. */
export function getArtifactGcIntervalSeconds(): number {
  const raw = process.env.ARTIFACT_GC_INTERVAL_SECONDS;
  if (raw == null || raw === '') return 3600;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 3600;
  return Math.floor(n);
}

let lastOrphanFileSweepAt = 0;

export interface ArtifactFileGcResult {
  scanned: number;
  deleted: number;
  bytesFreed: number;
  fileErrors: number;
}

/**
 * Disk-side counterpart of sweepTerminalJobArtifacts: files under
 * ARTIFACT_ROOT with no DB row and mtime older than the retention window.
 * saveArtifact writes the file before its row insert, so a crash — or a DB
 * restored from an older backup — leaves permanent orphans the row sweep
 * cannot see. The age cutoff makes the in-flight write→insert gap safe.
 * Throttled by ARTIFACT_GC_INTERVAL_SECONDS; returns null when not due.
 * Emptied directories are removed (root itself never is).
 *
 * Runs only when ARTIFACT_ROOT is explicitly configured: the file sweep
 * inverts authority (disk enumerated, DB is the oracle), so a DB/root
 * mismatch — e.g. a test TASK_DB_PATH beside the dev-default root — must
 * never turn into deletes.
 */
export function sweepOrphanedArtifactFiles(now = Date.now()): ArtifactFileGcResult | null {
  const retention = getArtifactRetentionSeconds();
  if (retention <= 0 || !process.env.ARTIFACT_ROOT) return null;
  const intervalMs = getArtifactGcIntervalSeconds() * 1000;
  if (intervalMs > 0 && now - lastOrphanFileSweepAt < intervalMs) return null;
  lastOrphanFileSweepAt = now;

  const result: ArtifactFileGcResult = { scanned: 0, deleted: 0, bytesFreed: 0, fileErrors: 0 };
  const root = path.resolve(/* turbopackIgnore: true */ ROOT());
  const sqlite = getSqlite();
  const cutoffMs = now - retention * 1000;
  const hasRow = sqlite.prepare(`SELECT 1 FROM artifacts WHERE storage_key = ? LIMIT 1`);
  const dirs: string[] = [root];
  while (dirs.length > 0 && result.scanned < ORPHAN_FILE_SCAN_LIMIT) {
    const dir = dirs.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (result.scanned >= ORPHAN_FILE_SCAN_LIMIT) break;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      result.scanned++;
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (st.mtimeMs > cutoffMs) continue;
      const rel = path.relative(root, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel) || hasRow.get(rel)) continue;
      try {
        fs.unlinkSync(abs);
        result.deleted++;
        result.bytesFreed += st.size;
      } catch {
        result.fileErrors++;
      }
    }
    // Remove directories emptied by this sweep (or earlier churn); rmdir
    // fails harmlessly on non-empty dirs. Root is never removed.
    if (dir !== root) {
      try {
        fs.rmdirSync(dir);
      } catch {
        /* non-empty */
      }
    }
  }
  return result;
}

/**
 * Bounded GC of artifacts whose owning job settled failed/cancelled past the
 * retention window. File is unlinked before the row delete so a crash can
 * never strand an unreferenced file; a missing file or poisoned storage key
 * still clears the (already unreachable) row. Called lazily from
 * requeueExpiredLeases — the same sweep cadence as lease reclaim.
 */
export function sweepTerminalJobArtifacts(now = Date.now()): ArtifactGcResult {
  const result: ArtifactGcResult = { candidates: 0, deletedRows: 0, bytesFreed: 0, fileErrors: 0 };
  const retention = getArtifactRetentionSeconds();
  if (retention <= 0) return result;
  ensureArtifactColumns();
  const sqlite = getSqlite();
  const cutoff = new Date(now - retention * 1000).toISOString();
  // Project tables are created lazily; job-only hosts still need working GC.
  const hasProjectModels = !!sqlite.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_models'`
  ).get();
  const rows = sqlite
    .prepare(
      `SELECT a.* FROM artifacts a JOIN jobs j ON j.id = a.job_id
       WHERE j.status IN ('failed', 'cancelled') AND a.created_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM jobs model_job
           WHERE CAST(json_extract(CASE WHEN json_valid(model_job.spec) THEN model_job.spec ELSE '{}' END, '$.model.artifactId') AS TEXT) = a.id
         )
         ${hasProjectModels ? 'AND NOT EXISTS (SELECT 1 FROM project_models model WHERE model.artifact_id = a.id)' : ''}
       ORDER BY a.created_at ASC LIMIT ?`
    )
    .all(cutoff, getArtifactGcBatchSize()) as Record<string, unknown>[];
  result.candidates = rows.length;
  const del = sqlite.prepare(`DELETE FROM artifacts WHERE id = ?`);
  for (const row of rows) {
    const meta = rowToStored(row);
    const found = resolveDisk(meta);
    if (found) {
      let present: boolean;
      try {
        present = statArtifactFile(found.absPath) === 'present';
      } catch {
        // A faulting store is not "file absent": keep the row so the next
        // sweep retries instead of stranding an unreferenced file.
        result.fileErrors++;
        continue;
      }
      if (present) {
        try {
          fs.unlinkSync(found.absPath);
        } catch {
          result.fileErrors++;
          continue;
        }
      }
    }
    del.run(meta.id);
    result.deletedRows++;
    result.bytesFreed += meta.bytes;
  }
  return result;
}
