import { and, desc, eq, gt, inArray, or } from 'drizzle-orm';
import { getDb, getSqlite, withTransaction } from './db';
import { HttpError } from './http';
import { jobs } from './schema';
import { getComputeConfig, nativeComputeAllocation } from './w-compute-client';
import { isNativeLbmJob } from './compute-lbm';
import { decodeModelGeometry } from '../../../../lab/src/lib/models/geometry-contract';
import { isGpuLbmJob } from '../../../../../src/lib/sim/lbm-compute';
import type {
  AgentCapabilities,
  JobKind,
  JobProgress,
  JobRecord,
  JobResultV1,
  JobSpecV1,
  JobStatus,
  SolverBackendId,
} from '@/types/task';
import type { LbmThermalRegion } from '@w-sim/contracts';
import { MAC_3D_FEATURE, LBM_PRESSURE_FIELD_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_FIELD_HISTORY_FEATURE, LBM_GROUND_FEATURE, LBM_THERMAL_FEATURES, requiredLbmFeatures } from '@w-sim/contracts';
import { validateComputeMacResult } from './compute-mac';
import { validateThermalArtifacts } from './thermal-artifacts';
import { applySettlement, isTerminalStatus, BUILTIN_JOB_KINDS } from '@/types/task';
import { ResultValidationError, resultBackendAllowed, validateJobResult, validateLbmResult } from './validate-result';
import { fingerprintJobSpec, settlementKeyForResult } from './job-fingerprint';
import { listArtifacts, readArtifactBytes, sweepOrphanedArtifactFiles, sweepTerminalJobArtifacts, type StoredArtifact } from './artifacts';
import { createAuditManifestArtifact, recordAuditFailure } from './audit-manifest';
import { hostOutcome, storeAttemptOutcome } from './job-outcomes';
import { MODULE_JOB_KIND, isNativeModule, readModuleResult, readModuleJobInput } from '../../../../../src/lib/sim/module-compute';
import { decodeFlowSnapshot, decodeFlowSequence, assertFlowFrames, flowHasTemperature, isFlowSnapshotContentType, isFlowSequenceContentType, FLOW_SNAPSHOT_KIND, FLOW_SEQUENCE_KIND } from '../../../../lab/src/lib/cfd/flow-snapshot';
import { inflateSequenceArtifact } from './flow-inflate';
import { AIR_KINEMATIC_VISCOSITY, decimateFlags, prepareProductLbmLattice, prepareProductLbmUnits } from '@w-sim/solvers-lbm/d3q19';

/** Default lease TTL (seconds). Prefer TASK_LEASE_SECONDS; LEASE_SECONDS kept for compat. */
const DEFAULT_LEASE_SECONDS = 60;

/** Claim batch size — kind-filtered so agents are less likely to starve behind unrelated jobs. */
const CLAIM_CANDIDATE_LIMIT = 64;

/**
 * Lease TTL in seconds.
 * Env: TASK_LEASE_SECONDS (preferred) or LEASE_SECONDS; invalid/zero falls back to 60.
 */
export function getLeaseSeconds(): number {
  const raw = process.env.TASK_LEASE_SECONDS ?? process.env.LEASE_SECONDS;
  if (raw == null || raw === '') return DEFAULT_LEASE_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LEASE_SECONDS;
  return Math.floor(n);
}

function nowIso() {
  return new Date().toISOString();
}

function leaseExpiry(from = new Date()) {
  return new Date(from.getTime() + getLeaseSeconds() * 1000).toISOString();
}

/**
 * One grep-able JSON line per host-side job lifecycle transition — the
 * host-side counterpart of the agent's `[agent:telemetry]` line. Emitted
 * only after the state write lands, so a line always reflects committed
 * truth. Fields are job-row primitives only: never spec/result payloads,
 * env values, or secrets.
 */
function logJobEvent(
  event: string,
  job?: { id: string; kind: string } | null,
  extra?: Record<string, unknown>,
): void {
  console.log(`[host:job] ${JSON.stringify({
    event,
    ...(job ? { job_id: job.id, kind: job.kind } : {}),
    ...extra,
  })}`);
}

/** Bound stored/echoed error text in log lines — full text stays on the row. */
function shortErr(error: string): string {
  return error.length > 200 ? `${error.slice(0, 200)}…` : error;
}

/** Message written to jobs.error when a lease expires and the job is requeued. */
export const LEASE_EXPIRED_REQUEUE_ERROR = 'lease expired (requeued)';
export const LEASE_EXPIRED_MAX_ATTEMPTS_ERROR = 'lease expired (max attempts)';

/**
 * Normalize drizzle rows (camelCase) or raw better-sqlite3 rows (snake_case).
 * claimJob uses SELECT * inside a transaction and must handle both shapes.
 */
function normalizeJobRow(row: Record<string, unknown>): typeof jobs.$inferSelect {
  const g = (camel: string, snake: string) =>
    (row[camel] !== undefined ? row[camel] : row[snake]) as never;
  return {
    id: row.id as string,
    name: (row.name as string | null) ?? null,
    status: row.status as string,
    priority: Number(row.priority ?? 0),
    kind: row.kind as string,
    spec: row.spec as string,
    result: (row.result as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    createdBy: g('createdBy', 'created_by') ?? null,
    agentId: g('agentId', 'agent_id') ?? null,
    projectId: g('projectId', 'project_id') ?? null,
    leaseExpiresAt: g('leaseExpiresAt', 'lease_expires_at') ?? null,
    attempt: Number(g('attempt', 'attempt') ?? 0),
    maxAttempts: Number(g('maxAttempts', 'max_attempts') ?? 3),
    progress: (row.progress as string | null) ?? null,
    createdAt: g('createdAt', 'created_at') as string,
    updatedAt: g('updatedAt', 'updated_at') as string,
    startedAt: g('startedAt', 'started_at') ?? null,
    finishedAt: g('finishedAt', 'finished_at') ?? null,
    specFingerprint: g('specFingerprint', 'spec_fingerprint') ?? null,
  };
}

type ComputeRunRow = { instance_id: string | null; phase: string; error: string | null };

function rowToJob(
  row: typeof jobs.$inferSelect | Record<string, unknown>,
  computeRows?: Map<string, ComputeRunRow>,
): JobRecord {
  const n = normalizeJobRow(row as Record<string, unknown>);
  // Batch callers (listJobs) pass a preloaded map — one IN() query for the
  // page instead of a per-row lookup (N+1 on every list call).
  const compute = computeRows
    ? computeRows.get(n.id)
    : getSqlite().prepare('SELECT instance_id, phase, error FROM compute_runs WHERE job_id = ?')
        .get(n.id) as ComputeRunRow | undefined;
  return {
    ...(compute ? { compute: { provider: 'w-compute' as const, instanceId: compute.instance_id, phase: compute.phase, error: compute.error } } : {}),
    id: n.id,
    name: n.name,
    status: n.status as JobStatus,
    priority: n.priority,
    kind: n.kind as JobKind,
    spec: JSON.parse(n.spec) as JobSpecV1,
    result: n.result ? (JSON.parse(n.result) as JobResultV1) : null,
    error: n.error,
    createdBy: n.createdBy,
    agentId: n.agentId,
    projectId: n.projectId ?? null,
    leaseExpiresAt: n.leaseExpiresAt,
    attempt: n.attempt,
    maxAttempts: n.maxAttempts,
    progress: n.progress ? (JSON.parse(n.progress) as JobProgress) : null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    startedAt: n.startedAt,
    finishedAt: n.finishedAt,
    specFingerprint: n.specFingerprint ?? null,
  };
}

/** Ensure jobs.spec_fingerprint column exists (idempotent for long-lived process). */
function ensureJobFingerprintColumn(): void {
  const sqlite = getSqlite();
  try {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN spec_fingerprint TEXT`);
  } catch {
    /* exists */
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

/**
 * Lazy reclaim of expired leases.
 * - Increments attempt and sets last_error when requeued.
 * - Marks failed when attempt+1 would exceed max_attempts.
 */
export function requeueExpiredLeases(): number {
  const now = nowIso();
  const settled = withTransaction((tx) => {
    const expired = tx.prepare(`
      SELECT id, kind, agent_id, attempt, max_attempts
      FROM jobs
      WHERE status IN ('leased', 'running')
        AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
        AND NOT EXISTS (SELECT 1 FROM compute_runs WHERE compute_runs.job_id = jobs.id)
    `).all(now) as Array<{ id: string; kind: string; agent_id: string | null; attempt: number; max_attempts: number }>;
    const requeued: Array<{ id: string; kind: string }> = [];
    const terminallyFailed: Array<{ id: string; kind: string }> = [];
    for (const job of expired) {
      const failed = job.attempt + 1 >= job.max_attempts;
      const update = failed
        ? tx.prepare(`UPDATE jobs SET status='failed', error=?, finished_at=?, updated_at=?, lease_expires_at=NULL, agent_id=NULL
          WHERE id=? AND status IN ('leased','running') AND agent_id IS ? AND attempt=? AND lease_expires_at < ?`)
            .run(LEASE_EXPIRED_MAX_ATTEMPTS_ERROR, now, now, job.id, job.agent_id, job.attempt, now)
        : tx.prepare(`UPDATE jobs SET status='queued', agent_id=NULL, lease_expires_at=NULL, progress=NULL, error=?, updated_at=?, attempt=attempt+1
          WHERE id=? AND status IN ('leased','running') AND agent_id IS ? AND attempt=? AND lease_expires_at < ?`)
            .run(LEASE_EXPIRED_REQUEUE_ERROR, now, job.id, job.agent_id, job.attempt, now);
      if (!update.changes) continue;
      if (failed) terminallyFailed.push({ id: job.id, kind: job.kind });
      else requeued.push({ id: job.id, kind: job.kind });
      if (job.agent_id) {
        const outcome = failed
          ? hostOutcome(job.id, 'failed', null, LEASE_EXPIRED_MAX_ATTEMPTS_ERROR)
          : hostOutcome(job.id, 'queued', null, null);
        storeAttemptOutcome(tx, {
          jobId: job.id, attempt: job.attempt, agentId: job.agent_id,
          outcome, createdAt: now,
        });
      }
    }
    return { requeued, terminallyFailed };
  });
  const { requeued, terminallyFailed } = settled;

  for (const job of requeued) logJobEvent('job.lease_expired', job, { outcome: 'requeued' });
  for (const job of terminallyFailed) logJobEvent('job.lease_expired', job, { outcome: 'failed' });

  // Same lazy cadence: reclaim disk held by terminal-job artifacts past
  // retention, plus row-less orphan files (crash between write and insert,
  // or DB restored from an older backup). The file walk is interval-throttled.
  try {
    const sweepNow = Date.parse(now);
    const gc = sweepTerminalJobArtifacts(sweepNow);
    const fileGc = sweepOrphanedArtifactFiles(sweepNow);
    if (gc.deletedRows > 0 || gc.fileErrors > 0 || (fileGc !== null && (fileGc.deleted > 0 || fileGc.fileErrors > 0))) {
      logJobEvent('artifact_gc', null, {
        candidates: gc.candidates,
        deleted: gc.deletedRows,
        bytes_freed: gc.bytesFreed,
        file_errors: gc.fileErrors,
        ...(fileGc !== null
          ? { orphan_files_deleted: fileGc.deleted, orphan_bytes_freed: fileGc.bytesFreed, orphan_scan_errors: fileGc.fileErrors }
          : {}),
      });
    }
  } catch {
    // GC is best-effort; a sweep failure must not break claim/stats callers.
  }
  return requeued.length;
}

/** New LBM requests use the current force and boundary conventions; saved jobs stay untouched. */
function normalizeNewJobSpec(spec: JobSpecV1): JobSpecV1 {
  if (spec.kind === 'mac-3d') return { ...spec, requirements: { ...spec.requirements,
    features: [...new Set([...(spec.requirements?.features ?? []), MAC_3D_FEATURE])].sort() } };
  if (spec.kind !== 'lbm-d3q19') return spec;
  return { ...spec, requirements: { ...spec.requirements,
    features: [...new Set([...(spec.requirements?.features ?? []), ...(spec.outputs.fields?.includes('pressure') ? [LBM_PRESSURE_FIELD_FEATURE] : []), LBM_GAUGE_FORCE_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE])].sort() } };
}

export function createJob(input: {
  spec: JobSpecV1;
  priority?: number;
  createdBy?: string | null;
  maxAttempts?: number;
  /** Internal browser submission: no managed instance is allocated. */
  browserAgentId?: string;
}): JobRecord {
  input = { ...input, spec: normalizeNewJobSpec(input.spec) };
  ensureJobFingerprintColumn();
  const id = crypto.randomUUID();
  const t = nowIso();
  const model = input.spec.model;
  const name =
    input.spec.name ??
    `${input.spec.kind}:${model?.presetId ?? model?.source ?? 'unnamed'}`;
  const fp = fingerprintJobSpec(input.spec);
  // Reserve native-capable jobs in the same transaction as creation. External
  // pull Agents must never race the managed instance worker for these jobs.
  const module = (input.spec.parameters as Record<string, unknown>)?.module;
  // Managed compute serves only the cpu executor: a job whose requirements
  // exclude 'cpu' (e.g. cuda-only) can never be claimed by the managed agent —
  // reserving it would poison the reconcile loop (unclaimable forever).
  const requiredBackends = input.spec.requirements?.backends;
  const cpuEligible = !Array.isArray(requiredBackends) || requiredBackends.length === 0 || requiredBackends.includes('cpu');
  const nativeSupported = cpuEligible && ((input.spec.kind === 'waveworld-module' && isNativeModule(module)) || isNativeLbmJob(input.spec) || input.spec.kind === 'mac-3d');
  // W_COMPUTE_ENABLED=1 但其余 W_COMPUTE_* 配置缺失时 getComputeConfig 抛出——
  // 配置错误不应把每个 native-capable job create 打成 500：跳过预留（外部
  // agent 仍可领取），告警留痕。
  let config: ReturnType<typeof getComputeConfig> = null;
  if (!input.browserAgentId && process.env.W_COMPUTE_ENABLED === '1' && nativeSupported) {
    try {
      config = getComputeConfig();
    } catch (err) {
      console.warn('[tasks] managed compute disabled: invalid W_COMPUTE_* config —', err instanceof Error ? err.message : err);
    }
  }
  withTransaction(sqlite => {
    // Raw insert so fingerprint column works even if drizzle schema cache lags.
    sqlite.prepare(
        `INSERT INTO jobs
         (id, name, status, priority, kind, spec, result, error, created_by, agent_id,
          project_id, lease_expires_at, attempt, max_attempts, progress, created_at,
          updated_at, started_at, finished_at, spec_fingerprint)
         VALUES (?, ?, 'queued', ?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, 0, ?, NULL, ?, ?, NULL, NULL, ?)`
      )
      .run(
        id,
        name,
        // 准入侧无界字段在此收敛：priority 截断到 ±1000，maxAttempts 1–25。
        typeof input.priority === 'number' && Number.isFinite(input.priority) ? Math.max(-1000, Math.min(1000, Math.trunc(input.priority))) : 0,
        input.spec.kind,
        JSON.stringify(input.spec),
        input.createdBy ?? null,
        typeof input.maxAttempts === 'number' && Number.isInteger(input.maxAttempts) ? Math.max(1, Math.min(25, input.maxAttempts)) : 3,
        t,
        t,
        fp
      );
    if (config) sqlite.prepare(`INSERT INTO compute_runs
      (job_id, cluster_id, allocation, max_wall_time_ms, deadline_ms, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, config.clusterId, JSON.stringify(nativeComputeAllocation(id, config)), config.maxWallTimeMs,
        Date.now() + config.maxWallTimeMs + 120000, t);
    if (input.browserAgentId) {
      const claimed = claimJob({ jobId: id, agentId: input.browserAgentId, internal: true,
        workspaceId: input.spec.workspaceId ?? 'default',
        capabilities: { kinds: ['waveworld-module', 'lbm-d3q19', 'mac-3d'], backends: ['cpu', 'webgpu-browser'], thermal: true, fan: true, features: [MAC_3D_FEATURE, LBM_PRESSURE_FIELD_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_FIELD_HISTORY_FEATURE, LBM_GROUND_FEATURE, ...LBM_THERMAL_FEATURES] } });
      if (!claimed) throw new HttpError(409, 'Browser could not claim this job');
    }
  });
  const job = getJob(id)!;
  logJobEvent('job.submitted', job, {
    managed: config != null,
    browser: input.browserAgentId != null,
    max_attempts: job.maxAttempts,
  });
  return job;
}

/**
 * Find the most recent succeeded job with the same spec fingerprint.
 * Used for compute-cloud "load prior data" / skip recompute.
 */
export function findSucceededJobByFingerprint(fingerprint: string): JobRecord | null {
  ensureJobFingerprintColumn();
  requeueExpiredLeases();
  if (!fingerprint || fingerprint.length < 16) return null;
  const row = getSqlite()
    .prepare(
      `SELECT * FROM jobs
       WHERE status = 'succeeded'
         AND spec_fingerprint = ?
         AND result IS NOT NULL
       ORDER BY finished_at DESC, created_at DESC
       LIMIT 1`
    )
    .get(fingerprint) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

/**
 * Create a new queued job, or return an existing succeeded job with the same
 * fingerprint when reuseSucceeded is true.
 */
export function createOrReuseJob(input: {
  spec: JobSpecV1;
  priority?: number;
  createdBy?: string | null;
  maxAttempts?: number;
  /** When true, return prior succeeded job for equivalent spec instead of queueing. */
  reuseSucceeded?: boolean;
}): { job: JobRecord; reused: boolean } {
  input = { ...input, spec: normalizeNewJobSpec(input.spec) };
  ensureJobFingerprintColumn();
  if (input.reuseSucceeded) {
    const fp = fingerprintJobSpec(input.spec);
    const prior = findSucceededJobByFingerprint(fp);
    if (prior && prior.result) {
      logJobEvent('job.reused', prior, { fingerprint: fp });
      return { job: prior, reused: true };
    }
  }
  const job = createJob({
    spec: input.spec,
    priority: input.priority,
    createdBy: input.createdBy,
    maxAttempts: input.maxAttempts,
  });
  return { job, reused: false };
}

/**
 * Load a succeeded job's stored result by stable job id (no re-solve).
 * Returns null if missing or not succeeded.
 */
export function loadSucceededJobResult(jobId: string): {
  jobId: string;
  status: 'succeeded';
  specFingerprint: string | null;
  result: JobResultV1;
  artifactMetas: StoredArtifact[];
} | null {
  const job = getJob(jobId);
  if (!job || job.status !== 'succeeded' || !job.result) return null;
  const artifactMetas = listArtifacts({ jobId: job.id });
  return {
    jobId: job.id,
    status: 'succeeded',
    specFingerprint: job.specFingerprint ?? null,
    result: job.result,
    artifactMetas,
  };
}

/**
 * Load artifact bytes by stable artifact id (prior compute payload).
 * Returns null if missing on disk or not found.
 */
export function loadArtifactData(artifactId: string): {
  artifactId: string;
  contentType: string;
  bytes: number;
  data: Buffer;
  jobId: string | null;
} | null {
  const found = readArtifactBytes(artifactId);
  if (!found) return null;
  return {
    artifactId: found.meta.id,
    contentType: found.meta.contentType,
    bytes: found.meta.bytes,
    data: found.data,
    jobId: found.meta.jobId,
  };
}

export function getJob(id: string): JobRecord | null {
  requeueExpiredLeases();
  const row = getDb().select().from(jobs).where(eq(jobs.id, id)).get();
  if (row) return rowToJob(row);
  // Fallback raw select (fingerprint column + mixed row shapes)
  const raw = getSqlite().prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return raw ? rowToJob(raw) : null;
}

export function listJobs(opts?: {
  status?: JobStatus | JobStatus[];
  kind?: JobKind;
  limit?: number;
}): JobRecord[] {
  requeueExpiredLeases();
  const db = getDb();
  // Fail-closed page bound, parity listEvidence/listProjectsForUser: a negative
  // limit would slice(0, -1) into an all-but-last table dump and an oversized
  // one defeats the page contract.
  const requested = Number(opts?.limit ?? 50);
  const limit = Number.isFinite(requested)
    ? Math.min(200, Math.max(1, Math.floor(requested)))
    : 50;
  // 过滤与分页下推到 SQL：全表 select 再内存过滤会随 jobs 增长把每次
  // 列表调用变成 O(表大小) 的扫描（含 spec/result 大 JSON 列）。
  const conditions = [];
  if (opts?.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    conditions.push(inArray(jobs.status, statuses));
  }
  if (opts?.kind) {
    conditions.push(eq(jobs.kind, opts.kind));
  }
  const rows = db
    .select()
    .from(jobs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .all();
  // One compute_runs IN() lookup for the whole page (was N+1 per row).
  const ids = rows.map((r) => r.id);
  const computeRows = new Map<string, ComputeRunRow>();
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    for (const r of getSqlite()
      .prepare(`SELECT job_id, instance_id, phase, error FROM compute_runs WHERE job_id IN (${ph})`)
      .all(...ids) as Array<ComputeRunRow & { job_id: string }>) {
      computeRows.set(r.job_id, r);
    }
  }
  return rows.map((row) => rowToJob(row, computeRows));
}

export interface JobQueueStats {
  queued: number;
  leased: number;
  running: number;
  failed: number;
  succeeded: number;
  cancelled: number;
  total: number;
  leaseSeconds: number;
  oldestQueuedAgeSeconds: number;
  /** Expired active leases observed before this stats call's safe requeue sweep. */
  expiredLeases: number;
  byKind: Record<string, {
    queued: number;
    leased: number;
    running: number;
    failed: number;
    succeeded: number;
    total: number;
  }>;
  recent: {
    windowSeconds: number;
    failed: number;
    succeeded: number;
    averageDurationSeconds: number;
    maximumDurationSeconds: number;
  };
  /** Artifact volume after the lazy retention sweep. */
  artifacts: {
    total: number;
    bytes: number;
    /** Artifacts bound to failed/cancelled jobs, including retained model inputs. */
    terminalJobArtifacts: number;
  };
}

/** Metrics-friendly queue counters (after lazy requeue of expired leases). */
export function getJobStats(): JobQueueStats {
  const sqlite = getSqlite();
  const now = nowIso();
  const expiredRow = sqlite
    .prepare(`SELECT COUNT(*) AS c FROM jobs WHERE status IN ('leased', 'running') AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`)
    .get(now) as { c: number };
  const expiredLeases = Number(expiredRow?.c) || 0;
  requeueExpiredLeases();
  const rows = sqlite
    .prepare(`SELECT status, COUNT(*) AS c FROM jobs GROUP BY status`)
    .all() as Array<{ status: string; c: number }>;

  const counts: Record<string, number> = {
    queued: 0,
    leased: 0,
    running: 0,
    failed: 0,
    succeeded: 0,
    cancelled: 0,
  };
  let total = 0;
  for (const row of rows) {
    const n = Number(row.c) || 0;
    total += n;
    if (row.status in counts) counts[row.status] = n;
  }

  const oldest = sqlite.prepare(`SELECT MIN(created_at) AS createdAt FROM jobs WHERE status = 'queued'`).get() as { createdAt: string | null };
  const oldestMs = oldest?.createdAt ? Date.parse(oldest.createdAt) : Number.NaN;
  const oldestQueuedAgeSeconds = Number.isFinite(oldestMs) ? Math.max(0, Math.floor((Date.now() - oldestMs) / 1000)) : 0;

  const byKindRows = sqlite.prepare(`SELECT kind, status, COUNT(*) AS c FROM jobs GROUP BY kind, status`).all() as Array<{ kind: string; status: string; c: number }>;
  const byKind: JobQueueStats['byKind'] = {};
  for (const row of byKindRows) {
    // Job kind is a finite protocol enum; unknown legacy values collapse to "other".
    const kind = (BUILTIN_JOB_KINDS as string[]).includes(row.kind) ? row.kind : 'other';
    const group = byKind[kind] ?? { queued: 0, leased: 0, running: 0, failed: 0, succeeded: 0, total: 0 };
    const n = Number(row.c) || 0;
    if (row.status in group && row.status !== 'total') group[row.status as keyof Omit<typeof group, 'total'>] += n;
    group.total += n; byKind[kind] = group;
  }

  const windowSeconds = 3600;
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const recentRows = sqlite.prepare(`SELECT status, started_at AS startedAt, finished_at AS finishedAt FROM jobs WHERE status IN ('succeeded', 'failed') AND finished_at >= ?`).all(since) as Array<{ status: string; startedAt: string | null; finishedAt: string | null }>;
  let recentFailed = 0; let recentSucceeded = 0; const durations: number[] = [];
  for (const row of recentRows) {
    if (row.status === 'failed') recentFailed += 1; else if (row.status === 'succeeded') recentSucceeded += 1;
    const start = row.startedAt ? Date.parse(row.startedAt) : Number.NaN;
    const finish = row.finishedAt ? Date.parse(row.finishedAt) : Number.NaN;
    if (Number.isFinite(start) && Number.isFinite(finish) && finish >= start) durations.push((finish - start) / 1000);
  }

  // Artifact volume: unbounded growth is a disk-fill risk on the origin;
  // terminalJobArtifacts counts rows whose owning job settled failed/cancelled
  // (including model inputs retained because a saved job/project uses them).
  const artifactRow = sqlite
    .prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(bytes), 0) AS b FROM artifacts`)
    .get() as { c: number; b: number };
  const reclaimableRow = sqlite
    .prepare(`SELECT COUNT(*) AS c FROM artifacts WHERE job_id IS NOT NULL AND job_id IN (SELECT id FROM jobs WHERE status IN ('failed', 'cancelled'))`)
    .get() as { c: number };

  return {
    queued: counts.queued,
    leased: counts.leased,
    running: counts.running,
    failed: counts.failed,
    succeeded: counts.succeeded,
    cancelled: counts.cancelled,
    total,
    leaseSeconds: getLeaseSeconds(),
    oldestQueuedAgeSeconds,
    expiredLeases,
    byKind,
    recent: {
      windowSeconds,
      failed: recentFailed,
      succeeded: recentSucceeded,
      averageDurationSeconds: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
      maximumDurationSeconds: durations.length ? Math.max(...durations) : 0,
    },
    artifacts: {
      total: Number(artifactRow?.c) || 0,
      bytes: Number(artifactRow?.b) || 0,
      terminalJobArtifacts: Number(reclaimableRow?.c) || 0,
    },
  };
}

export function agentMatchesJob(caps: AgentCapabilities, spec: JobSpecV1): boolean {
  const kinds = caps.kinds ?? ['lbm-d3q19'];
  if (!kinds.includes(spec.kind)) return false;
  if (spec.kind === 'mac-3d' && (!caps.features?.includes(MAC_3D_FEATURE) || !caps.backends.includes('cpu') ||
      spec.requirements?.precision !== 'float64' || spec.requirements.backends?.length !== 1 || spec.requirements.backends[0] !== 'cpu')) return false;
  const features = [...(spec.requirements?.features ?? []), ...requiredLbmFeatures(spec)];
  if (features.some(feature => !Array.isArray(caps.features) || !caps.features.includes(feature))) return false;

  if (spec.kind === 'path-experiment') {
    const model = spec.experiment?.model;
    if (!model) return false;
    const capability = caps.pathModels?.find(
      (candidate) => candidate.id === model.id && candidate.version === model.version,
    );
    if (!capability || capability.backends.length === 0) return false;
    if (model.checksum && capability.implementationSha256 !== model.checksum) return false;
    if (!capability.backends.some((backend) => caps.backends.includes(backend) || compatibleBackend(backend, caps.backends))) {
      return false;
    }
  }

  const params = spec.parameters as Record<string, unknown>;
  if (spec.kind === 'lbm-d3q19' && params.thermalEnabled === true) {
    if (caps.thermal !== true) return false;
    if (!isGpuLbmJob(spec) && (!caps.backends.includes('cpu') || spec.requirements?.backends?.length !== 1 ||
        spec.requirements.backends[0] !== 'cpu' || spec.requirements.precision !== 'mixed')) return false;
  }
  if (params.thermalEnabled && caps.thermal === false) return false;
  if (spec.kind === 'lbm-d3q19' && params.fan !== undefined && caps.fan !== true) return false;

  const required = spec.requirements?.backends;
  if (required && required.length > 0) {
    const have = new Set(caps.backends);
    if (!required.some((b) => have.has(b) || compatibleBackend(b, caps.backends))) {
      return false;
    }
  }

  const grid = params.gridPreset as string | undefined;
  if (grid) {
    const maxGrid = caps.maxGrid ?? 'fine';
    const rank: Record<string, number> = { fast: 0, standard: 1, fine: 2 };
    if ((rank[grid] ?? 99) > (rank[maxGrid] ?? 2)) return false;
  }

  return true;
}

function compatibleBackend(required: SolverBackendId, have: SolverBackendId[]): boolean {
  // webgpu 统称匹配 dawn/browser
  if (required === 'webgpu') {
    return have.some((h) => h === 'webgpu' || h === 'webgpu-dawn' || h === 'webgpu-browser');
  }
  if (required === 'webgpu-dawn' || required === 'webgpu-browser') {
    return have.includes(required) || have.includes('webgpu');
  }
  // 'native-cuda' 与 'cuda' 是同一物理后端：agent 声明 'cuda'，
  // 模块 spec/结果使用 'native-cuda'——任一方向都应可领取。
  if (required === 'native-cuda' || required === 'cuda') {
    return have.includes('cuda') || have.includes('native-cuda');
  }
  return have.includes(required);
}

/**
 * Effective workspace filter for agents.
 * Env AGENT_WORKSPACE scopes claim to jobs whose spec.workspaceId matches
 * (global claim when unset). Explicit input.workspaceId overrides env.
 */
export function resolveAgentWorkspaceFilter(explicit?: string | null): string | null {
  if (explicit != null && explicit !== '') return explicit;
  const env = process.env.AGENT_WORKSPACE;
  if (env != null && env !== '') return env;
  return null;
}

function jobMatchesWorkspace(spec: JobSpecV1, workspaceFilter: string | null): boolean {
  if (!workspaceFilter) return true;
  return (spec.workspaceId ?? 'default') === workspaceFilter;
}

/**
 * Atomic claim: SQLite transaction SELECT + UPDATE.
 * Fair-ish: priority DESC, then oldest created_at first.
 * Optional kind whitelist (intersected with agent caps) and workspace filter.
 * Cancelled / non-queued jobs are never claimable (status gate).
 */
export function claimJob(input: {
  agentId: string;
  capabilities: AgentCapabilities;
  jobId?: string;
  /** Optional kind filter; intersected with agent capability kinds. */
  kinds?: JobKind[];
  /** Optional workspace; falls back to AGENT_WORKSPACE env when set. */
  workspaceId?: string | null;
  /** Internal managed-compute worker only; never accepted from the Agent HTTP body. */
  managedCompute?: boolean;
  /** Internal createJob browser-claim path: suppress job.claimed (job.submitted carries browser:true). */
  internal?: boolean;
}): JobRecord | null {
  requeueExpiredLeases();

  const workspaceFilter = resolveAgentWorkspaceFilter(input.workspaceId);
  const capKinds = input.capabilities.kinds ?? ['lbm-d3q19'];
  const kinds =
    input.kinds && input.kinds.length > 0
      ? input.kinds.filter((k) => capKinds.includes(k))
      : capKinds;

  if (kinds.length === 0) return null;

  return withTransaction((sqlite) => {
    let candidateId: string | null = input.jobId ?? null;

    if (candidateId) {
      const managed = sqlite.prepare('SELECT job_id FROM compute_runs WHERE job_id = ?').get(candidateId);
      if (!!managed !== !!input.managedCompute) return null;
      const row = sqlite
        .prepare(`SELECT id, status, kind, spec FROM jobs WHERE id = ?`)
        .get(candidateId) as
        | { id: string; status: string; kind: string; spec: string }
        | undefined;
      // Only queued is claimable — cancelled/leased/running/terminal excluded.
      if (!row || row.status !== 'queued') return null;
      if (!kinds.includes(row.kind as JobKind)) return null;
      const spec = JSON.parse(row.spec) as JobSpecV1;
      if (!agentMatchesJob(input.capabilities, spec)) return null;
      if (!jobMatchesWorkspace(spec, workspaceFilter)) return null;
    } else {
      const placeholders = kinds.map(() => '?').join(',');
      const rows = sqlite
        .prepare(
          `SELECT id, spec FROM jobs
           WHERE status = 'queued'
             AND NOT EXISTS (SELECT 1 FROM compute_runs WHERE compute_runs.job_id = jobs.id)
             AND kind IN (${placeholders})
           ORDER BY priority DESC, created_at ASC
           LIMIT ?`
        )
        .all(...kinds, CLAIM_CANDIDATE_LIMIT) as Array<{ id: string; spec: string }>;

      candidateId = null;
      for (const row of rows) {
        const spec = JSON.parse(row.spec) as JobSpecV1;
        if (!agentMatchesJob(input.capabilities, spec)) continue;
        if (!jobMatchesWorkspace(spec, workspaceFilter)) continue;
        candidateId = row.id;
        break;
      }
      if (!candidateId) return null;
    }

    const t = nowIso();
    const exp = leaseExpiry();
    const updated = sqlite
      .prepare(
        `UPDATE jobs
         SET status = 'leased',
             agent_id = ?,
             lease_expires_at = ?,
             updated_at = ?,
             started_at = COALESCE(started_at, ?)
         WHERE id = ? AND status = 'queued'`
      )
      .run(input.agentId, exp, t, t, candidateId);

    // Concurrent claim lost the race — not claimable anymore.
    if (updated.changes !== 1) return null;

    const row = sqlite.prepare(`SELECT * FROM jobs WHERE id = ?`).get(candidateId) as typeof jobs.$inferSelect;
    const claimed = rowToJob(row);
    if (!input.internal) {
      logJobEvent('job.claimed', claimed, {
        agent_id: input.agentId,
        lease_s: getLeaseSeconds(),
        managed: input.managedCompute === true,
      });
    }
    return claimed;
  });
}

export function heartbeatJob(input: {
  jobId: string;
  agentId: string;
  progress?: Partial<JobProgress>;
}): JobRecord {
  const job = getJob(input.jobId);
  if (!job) {
    throw new HttpError(404, 'Job not found');
  }
  if (job.status === 'cancelled') {
    throw new HttpError(409, 'Job was cancelled; cannot heartbeat');
  }
  if (job.status === 'succeeded' || job.status === 'failed') {
    throw new HttpError(409, `Job is ${job.status}; cannot heartbeat`);
  }
  if (job.agentId !== input.agentId) {
    throw new HttpError(409, 'Job is leased by another agent');
  }
  if (job.status !== 'leased' && job.status !== 'running') {
    throw new HttpError(409, `Cannot heartbeat job in status ${job.status}`);
  }

  const t = nowIso();
  const progress: JobProgress | null = input.progress
    ? {
        step: input.progress.step ?? job.progress?.step ?? 0,
        total: input.progress.total ?? job.progress?.total ?? job.spec.run.maxSteps,
        message: input.progress.message ?? job.progress?.message,
        cd: input.progress.cd ?? job.progress?.cd,
        cl: input.progress.cl ?? job.progress?.cl,
        updatedAt: t,
      }
    : job.progress;

  // Steady-state throttle: while the stored lease is still >50% fresh, a
  // heartbeat that changes nothing (status already running, identical
  // progress payload) would be a pure WAL write. Skipping it bounds the
  // write rate to ~1 per half-lease-window per job even if a buggy agent
  // loops beats — the response still carries the true stored deadline.
  // leased→running transitions and any progress change always write.
  const leaseFreshMs = job.leaseExpiresAt ? Date.parse(job.leaseExpiresAt) - Date.now() : 0;
  const progressUnchanged =
    job.progress != null && progress != null &&
    progress.step === job.progress.step &&
    progress.total === job.progress.total &&
    (progress.message ?? null) === (job.progress.message ?? null) &&
    (progress.cd ?? null) === (job.progress.cd ?? null) &&
    (progress.cl ?? null) === (job.progress.cl ?? null);
  if (
    job.status === 'running' &&
    leaseFreshMs > getLeaseSeconds() * 500 &&
    (input.progress == null || progressUnchanged)
  ) {
    return job;
  }

  const heartbeat = getDb()
    .update(jobs)
    .set({
      status: 'running',
      leaseExpiresAt: leaseExpiry(),
      progress: progress ? JSON.stringify(progress) : null,
      updatedAt: t,
    })
    // 原子守卫：check-then-write 之间的 cancel/fail 不得被心跳复活成 running。
    .where(and(eq(jobs.id, input.jobId), eq(jobs.agentId, input.agentId), inArray(jobs.status, ['leased', 'running'])))
    .run();
  if (!heartbeat.changes) throw new HttpError(409, 'Job is no longer leased to this agent');

  return getJob(input.jobId)!;
}

export function completeJob(input: {
  jobId: string;
  agentId: string;
  /** 0-based lease attempt; omitted only for explicitly documented legacy clients. */
  attempt?: number;
  result: JobResultV1;
}): JobRecord | null {
  const job = getJob(input.jobId);
  if (!job) return null;
  if (job.agentId !== input.agentId) return null;
  const attempt = input.attempt ?? job.attempt;
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt !== job.attempt) return null;
  // Cheap terminal/non-claimable guard before any validation work — a stale
  // complete on a dead job (e.g. failJob retains agentId) must not burn
  // frame/artifact decode. 'succeeded' falls through so its idempotent-retry
  // branch can compare settlement keys; the leased/running recheck after
  // validation plus the atomic write guard stay authoritative.
  if (job.status !== 'succeeded' && job.status !== 'leased' && job.status !== 'running') return null;

  // Validate before settlement / status transition (reject NaN/non-finite Cd/Cl)
  const result: JobResultV1 = {
    ...input.result,
    backend: {
      ...input.result.backend,
      id: input.result.backend?.id ?? 'unknown',
      agentId: input.agentId,
    },
  };
  // Artifact/frame validation can outlast the lease window for large
  // trajectories — renew inside the long loops so a legitimately heavy settle
  // is not requeued mid-check (livelock: each attempt burns a lease then the
  // guarded write fails). A heartbeat rejection also aborts validation early
  // instead of finishing work whose settlement can no longer land.
  let lastValidationRenew = Date.now();
  const renewLeaseDuringValidation = (): void => {
    const now = Date.now();
    if (now - lastValidationRenew < Math.max(5_000, getLeaseSeconds() * 500)) return;
    heartbeatJob({ jobId: input.jobId, agentId: input.agentId });
    lastValidationRenew = now;
  };
  try {
    validateJobResult(result);
    if (job.spec.kind === 'path-experiment') {
      // The generic result envelope also serves non-path jobs, where an
      // experiment is optional. Bind path settlements to their submitted model.
      const expected = job.spec.experiment;
      if (!expected || !result.experiment) {
        throw new ResultValidationError('result.experiment is required for a path-experiment job');
      }
      if (result.experiment.experimentId !== expected.experimentId) {
        throw new ResultValidationError('result.experiment.experimentId must match the submitted experiment');
      }
      if (result.experiment.modelVersion !== expected.model.version) {
        throw new ResultValidationError('result.experiment.modelVersion must match the submitted model version');
      }
    }
    // Backend-requirement honesty: the reported executor must satisfy
    // spec.requirements.backends (ANY-OF with alias families) for every kind —
    // previously only the thermal branch checked, with a narrower literal map
    // that also rejected legit 'native-cuda' results for 'cuda' requirements.
    const requiredBackends = job.spec.requirements?.backends;
    if (requiredBackends?.length && !resultBackendAllowed(result.backend?.id, requiredBackends)) {
      throw new ResultValidationError(
        `result.backend.id ${JSON.stringify(result.backend?.id)} does not satisfy spec.requirements.backends`
      );
    }
    // Already settled: applySettlement makes same-key retry idempotent and
    // rejects a different result fingerprint (double_settlement).
    if (job.status === 'succeeded') {
      const attemptKey = settlementKeyForResult(input.jobId, result);
      if (!job.result) {
        throw new HttpError(409, 'Job is succeeded but has no stored result');
      }
      const settledKey = settlementKeyForResult(input.jobId, job.result);
      const settle = applySettlement(
        {
          jobId: input.jobId,
          executionStatus: 'succeeded',
          settlement: 'settled',
          settlementKey: settledKey,
        },
        { key: attemptKey, executionStatus: 'succeeded' },
      );
      if (!settle.ok) {
        throw new HttpError(409, settle.message);
      }
      // Pure idempotent no-op: do not rewrite DB or re-run audit side effects.
      return job;
    }
    if (requiredLbmFeatures(job.spec).some(feature => result.derived?.[feature] !== 1)) {
      throw new ResultValidationError('LBM result requires an executor supporting the submitted ground/material/contact features, field history, pressure, mass balance and gauge-force / nonequilibrium-inlet / nonequilibrium-outlet conventions');
    }
    const fluid = job.spec.parameters as Record<string, unknown>;
    if (job.spec.kind === 'lbm-d3q19') {
      const ground = fluid.ground as { mode: 'stationary' | 'moving'; clearanceM: number } | undefined;
      if (ground ? result.derived?.groundMode !== ground.mode || result.derived?.groundClearanceM !== ground.clearanceM ||
          result.derived?.groundVelocityMps !== (ground.mode === 'moving' ? fluid.inletVelocity : 0) :
          ['groundMode', 'groundClearanceM', 'groundVelocityMps'].some(key => result.derived?.[key] !== undefined)) {
        throw new ResultValidationError('LBM result must report the submitted ground mode, clearance and physical wall speed');
      }
    }
    if (job.spec.kind === 'lbm-d3q19' && fluid.gridPreset != null) {
      if (job.spec.model?.referenceArea !== undefined && result.derived?.referenceArea !== job.spec.model.referenceArea) {
        throw new ResultValidationError('LBM result reference area must equal the submitted model referenceArea');
      }
      const mode = fluid.viscosityMode ?? 'physical';
      const requested = fluid.fluidViscosity == null ? AIR_KINEMATIC_VISCOSITY : Number(fluid.fluidViscosity) / Number(fluid.fluidDensity ?? 1.225);
      const actualRequested = result.derived?.requestedViscosityM2s;
      const simulated = result.derived?.simulatedViscosityM2s;
      const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(Number.MIN_VALUE, Math.max(Math.abs(a), Math.abs(b)) * 1e-9);
      if (typeof actualRequested !== 'number' || typeof simulated !== 'number' ||
          ![requested, actualRequested, simulated].every(value => Number.isFinite(value) && value > 0) ||
          result.derived?.viscosityMode !== mode || !close(requested, actualRequested) ||
          (mode === 'physical' && !close(requested, simulated)) || simulated < requested * (1 - 1e-9)) {
        throw new ResultValidationError('LBM result must preserve the requested viscosity mode and report requested/simulated viscosity');
      }
      if (Number(fluid.inletVelocity) > 0) {
        if (![result.summary.cd, result.summary.cl].every(value => typeof value === 'number' && Number.isFinite(value))) {
          throw new ResultValidationError('LBM force coefficients require finite values for a positive inlet reference velocity');
        }
      } else if (result.summary.cd !== undefined || result.summary.cl !== undefined || result.history?.cd !== undefined || result.history?.cl !== undefined) {
        throw new ResultValidationError('LBM force coefficients are unavailable at zero inlet reference velocity');
      }
    }
    if (job.spec.kind === 'lbm-d3q19' && fluid.thermalEnabled === true) {
      const ambient = Number(fluid.ambientTemp ?? 25);
      const mode = fluid.thermalMode ?? 'fixed-temperature';
      const scale = mode === 'solid-power' ? 1 : Number(fluid.heatSourceTemp ?? 60) - ambient;
      const gpu = isGpuLbmJob(job.spec);
      if (result.derived?.ambientC !== ambient || result.derived?.temperatureScaleC !== scale ||
          result.derived?.precision !== (gpu ? 'float32' : 'mixed') || result.summary.steps !== job.spec.run.maxSteps ||
          !(job.spec.requirements?.backends?.length && resultBackendAllowed(result.backend?.id, job.spec.requirements.backends)) ||
          !result.thermal || result.thermal.mode !== mode ||
          !Number.isFinite(result.derived?.thermalDiffusivityPhysical) || Number(result.derived?.thermalDiffusivityPhysical) <= 0) {
        throw new ResultValidationError('Thermal result requires the submitted mode, energy audit, temperature scale and physical diffusivity');
      }
      const power = Number(fluid.totalPowerW) + ((fluid.thermalRegions ?? []) as LbmThermalRegion[]).reduce((sum, region) => sum + region.totalPowerW, 0);
      const expectedSource = mode === 'solid-power' ? power * Number(fluid.dtSeconds ?? 0.0001) * result.summary.steps : 0;
      if (!Number.isFinite(expectedSource) || Math.abs(result.thermal.sourceEnergyJ - expectedSource) >
          Math.max(Number.MIN_VALUE, Math.abs(expectedSource) * (gpu ? 2e-6 : 1e-9))) {
        throw new ResultValidationError('Thermal source energy must match the submitted power and elapsed time');
      }
    }
    validateLbmResult(job.spec, result);
    if (job.spec.kind === 'lbm-d3q19' && result.lbmMassBalance) {
      let length = job.spec.model?.referenceLength;
      if (length === undefined && job.spec.model?.source === 'artifact') {
        const source = readArtifactBytes(job.spec.model.artifactId!);
        if (!source || (source.meta.ownerUserId !== job.createdBy && (!source.meta.projectId || source.meta.projectId !== job.projectId))) {
          throw new ResultValidationError('LBM mass units require model geometry owned by this job');
        }
        try {
          const geometry = decodeModelGeometry(source.data.buffer.slice(source.data.byteOffset, source.data.byteOffset + source.data.byteLength) as ArrayBuffer, source.meta.contentType);
          let minX = Infinity, maxX = -Infinity;
          for (let i = 0; i < geometry.vertices.length; i += 3) {
            minX = Math.min(minX, geometry.vertices[i]); maxX = Math.max(maxX, geometry.vertices[i]);
          }
          length = maxX - minX;
        } catch (error) { throw new ResultValidationError(error instanceof Error ? error.message : 'Invalid LBM mass-unit geometry'); }
      }
      if (length === undefined) throw new ResultValidationError('LBM mass units require model.referenceLength or owned model geometry');
      try {
        const { units } = prepareProductLbmUnits(job.spec, length);
        for (const key of ['dx', 'dt'] as const) {
          const actual = result.derived?.[key], expected = units[key];
          if (typeof actual !== 'number' || !Number.isFinite(actual) || actual <= 0 ||
              Math.abs(actual - expected) > Math.max(Number.MIN_VALUE, Math.abs(expected) * 1e-9)) {
            throw new Error('LBM mass report physical dx/dt must match the submitted grid and time step');
          }
        }
        if (job.spec.outputs.fields?.includes('pressure')) {
          const expected = Number(fluid.fluidDensity ?? 1.225) * (units.dx / units.dt) ** 2;
          const actual = result.derived?.pressureScalePa;
          if (!Number.isFinite(expected) || expected <= 0 || typeof actual !== 'number' || !Number.isFinite(actual) || actual <= 0 ||
              Math.abs(actual - expected) > Math.max(Number.MIN_VALUE, Math.abs(expected) * 1e-9)) {
            throw new Error('LBM pressureScalePa must match the submitted density and prepared dx/dt');
          }
        }
        // Kilogram totals are executor measurements. Unit binding and report
        // arithmetic do not independently verify populations or conservation.
      } catch (error) { throw new ResultValidationError(error instanceof Error ? error.message : 'Invalid LBM mass units'); }
    }
    const thermalParameters = (job.spec.parameters ?? {}) as Record<string, unknown>
    const spatialIgbt = job.spec.kind === 'electro-thermal-igbt' && thermalParameters.mode === 'spatial-chip'
    if (job.spec.kind === 'thermal-3d-transient' || job.spec.kind === 'thermal-3d-steady' || spatialIgbt) {
      try {
        validateThermalArtifacts({ job, agentId: input.agentId, result, lookup: id => {
          renewLeaseDuringValidation();
          return readArtifactBytes(id);
        } });
      } catch (error) {
        throw new ResultValidationError(error instanceof Error ? error.message : 'Invalid thermal field artifacts');
      }
    }
    if (job.spec.kind === 'mac-3d') validateComputeMacResult(job, result);
    if (job.spec.kind === 'lbm-d3q19' && job.spec.outputs.fields?.length) {
      const refs = result.artifacts?.filter(artifact => artifact.kind === FLOW_SNAPSHOT_KIND || artifact.kind === FLOW_SEQUENCE_KIND) ?? [];
      if (!refs.length || refs.length > 4096 || refs.reduce((sum, ref) => sum + (ref.bytes ?? Infinity), 0) > 256 * 1024 * 1024) {
        throw new ResultValidationError('LBM fields require a bounded saved display artifact sequence');
      }
      const frames = [];
      for (const ref of refs) {
        renewLeaseDuringValidation();
        const stored = readArtifactBytes(ref.artifactId);
        const seq = ref.kind === FLOW_SEQUENCE_KIND;
        if (!stored || stored.meta.jobId !== job.id || stored.meta.kind !== ref.kind ||
            stored.meta.ownerUserId !== job.createdBy || stored.meta.projectId !== job.projectId ||
            (seq ? !isFlowSequenceContentType(stored.meta.contentType) : !isFlowSnapshotContentType(stored.meta.contentType)) ||
            ref.contentType !== stored.meta.contentType || ref.bytes !== stored.meta.bytes) {
          throw new ResultValidationError('LBM fields require saved display artifacts belonging to this job');
        }
        const data = stored.data;
        try {
          if (seq) {
            const raw = inflateSequenceArtifact(data);
            frames.push(...decodeFlowSequence(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer));
            continue;
          }
          const frame = decodeFlowSnapshot(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, stored.meta.contentType);
          if (ref.step === undefined ? (job.spec.outputs.fieldFrames ?? 1) > 1 : ref.step !== frame.step) throw new Error('LBM artifact step does not match its saved frame');
          frames.push(frame);
        } catch (error) { throw new ResultValidationError(error instanceof Error ? error.message : 'Invalid LBM frame'); }
      }
      for (const frame of frames) {
        if (flowHasTemperature(frame) !== (fluid.thermalEnabled === true)) throw new ResultValidationError('LBM frame temperature mode does not match the job');
      }
      try { assertFlowFrames(frames, job.spec, result.summary.steps, result.derived); }
      catch (error) { throw new ResultValidationError(error instanceof Error ? error.message : 'Invalid LBM sequence'); }
      // Trajectories must also match the submitted model, not merely each other.
      // Final-only legacy jobs keep their existing model preparation behavior.
      if ((job.spec.outputs.fieldFrames ?? 1) > 1 && job.spec.model?.source === 'artifact') {
        const model = readArtifactBytes(job.spec.model.artifactId!);
        if (!model) throw new ResultValidationError('LBM source model is missing');
        try {
          const geometry = decodeModelGeometry(model.data.buffer.slice(model.data.byteOffset, model.data.byteOffset + model.data.byteLength) as ArrayBuffer, model.meta.contentType);
          const prepared = prepareProductLbmLattice(job.spec, geometry), first = frames[0];
          const coarse = decimateFlags(prepared.nx, prepared.ny, prepared.nz, prepared.flags, job.spec.outputs.fieldStride ?? 1);
          if (['dx', 'dt'].some(key => {
            const actual = result.derived?.[key], expected = prepared.units[key as 'dx' | 'dt'];
            return typeof actual !== 'number' || !Number.isFinite(actual) || actual <= 0 ||
              Math.abs(actual - expected) > Math.max(Number.MIN_VALUE, Math.abs(expected) * 1e-9);
          })) throw new Error('LBM recorded physical dx/dt must match the submitted grid and time step');
          if (first.nx !== coarse.nx || first.ny !== coarse.ny || first.nz !== coarse.nz ||
              first.uLattice !== Math.fround(prepared.units.uLattice) || first.flags.length !== coarse.flags.length ||
              first.flags.some((flag, index) => flag !== coarse.flags[index])) throw new Error('LBM frames do not match the submitted model, grid and units');
        } catch (error) { throw new ResultValidationError(error instanceof Error ? error.message : 'Invalid LBM sequence model'); }
      }
    }
    if (job.spec.kind === MODULE_JOB_KIND) {
      try {
        readModuleResult(result, readModuleJobInput(job.spec));
      } catch (error) {
        throw new ResultValidationError(error instanceof Error ? error.message : String(error));
      }
      // 模块结果引用的 artifact 必须属于本 job——与 LBM 帧同一归属标准，
      // 否则结算结果可携带他任务/他用户的 artifact 引用。
      const refs = result.artifacts ?? [];
      if (refs.length > 4096) {
        throw new ResultValidationError('module result artifacts exceed the 4096 bound');
      }
      for (const ref of refs) {
        renewLeaseDuringValidation();
        const stored = readArtifactBytes(ref.artifactId);
        if (!stored || stored.meta.jobId !== job.id ||
            (stored.meta.ownerUserId ?? null) !== (job.createdBy ?? null)) {
          throw new ResultValidationError('module result artifacts must belong to this job');
        }
      }
    }
  } catch (e) {
    if (e instanceof ResultValidationError) {
      throw new HttpError(400, e.message);
    }
    throw e;
  }

  const attemptKey = settlementKeyForResult(input.jobId, result);

  if (job.status !== 'leased' && job.status !== 'running') return null;

  // First settlement from unsettled — wire contracts applySettlement so Host
  // and @w-sim/runtime share the same key semantics.
  const first = applySettlement(
    {
      jobId: input.jobId,
      executionStatus: 'succeeded',
      settlement: 'unsettled',
    },
    { key: attemptKey, executionStatus: 'succeeded' },
  );
  if (!first.ok) {
    throw new HttpError(409, first.message);
  }

  const t = nowIso();

  const completed = withTransaction((sqlite) => {
    const update = getDb()
      .update(jobs)
      .set({
        status: 'succeeded',
        result: JSON.stringify(result),
        error: null,
        leaseExpiresAt: null,
        progress: JSON.stringify({
          step: result.summary.steps,
          total: result.summary.steps,
          message: 'done',
          cd: result.summary.cd,
          cl: result.summary.cl,
          updatedAt: t,
        }),
        updatedAt: t,
        finishedAt: t,
      })
      // Attempt is part of lease ownership: stale requests from an earlier
      // lease cannot settle a later lease held by the same Agent.
      .where(and(eq(jobs.id, input.jobId), eq(jobs.agentId, input.agentId), eq(jobs.attempt, attempt),
        or(eq(jobs.status, 'leased'), eq(jobs.status, 'running')), gt(jobs.leaseExpiresAt, t)))
      .run();
    if (!update.changes) {
      const settled = getJob(input.jobId);
      return settled?.status === 'succeeded' && settled.result && settlementKeyForResult(input.jobId, settled.result) === attemptKey ? settled : null;
    }
    const after = getJob(input.jobId);
    if (after) {
      storeAttemptOutcome(sqlite, {
        jobId: input.jobId, attempt, agentId: input.agentId,
        outcome: hostOutcome(input.jobId, 'succeeded', after.result, null), createdAt: t,
      });
    }
    return after;
  });
  if (completed) {
    logJobEvent('job.succeeded', completed, {
      agent_id: input.agentId,
      backend: result.backend?.id ?? null,
      steps: result.summary?.steps ?? null,
      latency_ms: completed.startedAt
        ? Date.parse(completed.finishedAt ?? t) - Date.parse(completed.startedAt)
        : null,
    });
  }
  // Result durability is the primary transaction. Audit materialization is a
  // compensatable secondary step: failure is recorded but never falsifies a
  // successfully persisted compute result.
  if (completed?.kind === 'path-experiment') {
    try {
      createAuditManifestArtifact(completed);
    } catch (error) {
      try { recordAuditFailure(completed.id, error); } catch { /* keep succeeded authoritative */ }
    }
  }
  return completed;
}

export function failJob(input: {
  jobId: string;
  agentId: string;
  /** 0-based lease attempt; omitted only for explicitly documented legacy clients. */
  attempt?: number;
  error: string;
  retryable?: boolean;
}): JobRecord | null {
  const job = getJob(input.jobId);
  if (!job) return null;
  if (job.agentId !== input.agentId) return null;
  if (isTerminalStatus(job.status)) return null;
  const attempt = input.attempt ?? job.attempt;
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt !== job.attempt) return null;

  const t = nowIso();
  const canRetry = input.retryable !== false && job.attempt + 1 < job.maxAttempts;

  // 原子守卫：WHERE 复核 agent_id + 非终态——check-then-write 之间若租约
  // 易主或 job 已终态，陈旧的 fail 不得覆盖新状态。
  const guard = and(eq(jobs.id, input.jobId), eq(jobs.agentId, input.agentId), eq(jobs.attempt, attempt),
    inArray(jobs.status, ['leased', 'running', 'queued']));
  const after = withTransaction((sqlite) => {
    if (canRetry) {
      getDb().update(jobs).set({
        status: 'queued', agentId: null, leaseExpiresAt: null,
        error: input.error, attempt: job.attempt + 1, progress: null, updatedAt: t,
      }).where(guard).run();
    } else {
      getDb().update(jobs).set({
        status: 'failed', error: input.error, leaseExpiresAt: null,
        updatedAt: t, finishedAt: t,
      }).where(guard).run();
    }
    const current = getJob(input.jobId);
    if ((canRetry && current?.status === 'queued' && current.agentId === null && current.attempt === job.attempt + 1) ||
        (!canRetry && current?.status === 'failed' && current.error === input.error)) {
      storeAttemptOutcome(sqlite, {
        jobId: input.jobId, attempt, agentId: input.agentId,
        outcome: canRetry ? hostOutcome(input.jobId, 'queued', null, null) : hostOutcome(input.jobId, 'failed', null, input.error),
        createdAt: t,
      });
    }
    return current;
  });
  if (after?.status === 'queued' && after.agentId === null && after.attempt === job.attempt + 1) {
    logJobEvent('job.retried', after, { attempt: after.attempt, error: shortErr(input.error) });
  } else if (after?.status === 'failed' && after.error === input.error) {
    logJobEvent('job.failed', after, { attempt: after.attempt, error: shortErr(input.error) });
  }
  return after;
}

/**
 * Cancel a non-terminal job. Cancelled jobs are not claimable (status gate)
 * and heartbeat/complete/fail reject them.
 */
export function cancelJob(id: string): JobRecord | null {
  const t = nowIso();
  const after = withTransaction((sqlite) => {
    const job = getJob(id);
    if (!job || isTerminalStatus(job.status)) return job;
    const update = getDb().update(jobs).set({
      status: 'cancelled', leaseExpiresAt: null, agentId: null, updatedAt: t, finishedAt: t,
    }).where(and(eq(jobs.id, id), eq(jobs.attempt, job.attempt), inArray(jobs.status, ['queued', 'leased', 'running']))).run();
    const current = getJob(id);
    if (update.changes && current?.status === 'cancelled' && job.agentId) {
      storeAttemptOutcome(sqlite, {
        jobId: id, attempt: job.attempt, agentId: job.agentId,
        outcome: hostOutcome(id, 'cancelled', null, null), createdAt: t,
      });
    }
    return current;
  });
  if (after?.status === 'cancelled' && after.finishedAt === t) {
    logJobEvent('job.cancelled', after);
  }
  return after;
}
