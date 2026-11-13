import { createHash, randomBytes } from 'crypto';
import { ensureTaskEnv } from './ensure-task-env';
import { sameSecret } from './safe-error-message';
import type { HostUser } from './user-auth';
import type { JobRecord } from '@/types/task';

type JobAccess = 'read' | 'edit';

async function sqlite() {
  ensureTaskEnv();
  const { getSqlite } = await import('@/lib/tasks/db');
  const db = getSqlite();
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_shares (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      title TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_share_items (
      share_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (share_id, job_id)
    );
    CREATE INDEX IF NOT EXISTS job_share_items_job ON job_share_items (job_id);
  `);
  return db;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Plausible share token: `shr_` + non-trivial base64url body.
 * Residual after 6d2ecaa: only `shr_`-prefixed tokens.
 * Residual after f8da984 / c72cf29: min length (bare `shr_` / too-short rejected).
 * Residual after c72cf29 (wave29): base64url charset only + max length so spaces,
 * punctuation, and absurd payloads never reach the DB grant/hash path.
 * createJobShare issues shr_ + 32-byte base64url (~43 body chars).
 */
const SHARE_TOKEN_RE = /^shr_[A-Za-z0-9_-]{8,80}$/;

export function isPlausibleShareToken(token: string): boolean {
  return SHARE_TOKEN_RE.test(token);
}

/**
 * Plausible share *id* (path param for revoke). createJobShare issues
 * crypto.randomUUID() — standard 8-4-4-4-12 hex form.
 * Residual after wave32: reject numeric strings / garbage before DB so clients
 * get 400 "invalid share id" instead of a dishonest 404 "share not found".
 * Do not claim Lab fully usable while #49 open.
 *
 * Same form is used for job ids (createJob → crypto.randomUUID) and project
 * ids (createProject → crypto.randomUUID). Residual after wave33:
 * isPlausibleJobId + normalizeShareJobIds on shares POST so non-array /
 * non-string / garbage jobIds → 400 (not char-spread Set or dishonest 404).
 * Residual after wave38: normalizeShareId / normalizeProjectId (trim+UUID parity
 * normalizeJobId) so shares DELETE and projects/[id] (+ jobs attach) gate
 * garbage path/body ids → 400 (not dishonest 404).
 * Residual after wave39: projects/[id]/members|models (+ modelId) reuse the same
 * gate; normalizeModelId (addProjectModel → randomUUID) for model DELETE.
 * Residual after wave40: artifacts/[id] + evidence/[id] + comparisons/[id] path
 * gates (saveArtifact / createEvidence / createPathComparison → randomUUID);
 * artifacts POST body.jobId normalizeJobId (garbage → 400 not dishonest 404).
 * Residual after wave41: comparisons POST normalizeShareJobIds; artifacts
 * POST/GET projectId + GET jobId; evidence import projectId — garbage → 400.
 */
const SHARE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Distinct job ids accepted by one share, publication, or comparison. */
export const MAX_SHARE_JOB_IDS = 64;

/**
 * Shared UUID path/body normalizer (job / share / project / model / artifact /
 * evidence / comparison create* → randomUUID).
 * Residual after wave37/38/39/40: one trim+UUID gate; specialized exports keep
 * call-site honesty.
 */
function normalizeUuidPathParam(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const t = id.trim();
  if (!t || t.length > 36) return null;
  if (!SHARE_ID_RE.test(t)) return null;
  return t;
}

/**
 * Normalize share *id* path param (createJobShare → crypto.randomUUID).
 * Residual after wave38: trim+UUID (parity normalizeJobId); shares DELETE uses
 * this so padded/garbage path ids → 400 invalid share id (not dishonest 404).
 */
export function normalizeShareId(id: unknown): string | null {
  return normalizeUuidPathParam(id);
}

export function isPlausibleShareId(id: string): boolean {
  return normalizeShareId(id) != null;
}

/**
 * Normalize project *id* path param (createProject → crypto.randomUUID).
 * Residual after wave38: projects/[id] GET/PATCH/DELETE + projects/[id]/jobs
 * gate garbage path ids → 400 invalid project id (not dishonest 404 not-found/forbidden).
 * Residual after wave39: projects/[id]/members (+ [userId]) and projects/[id]/models
 * (+ [modelId]) also gate project path ids → 400 (not dishonest 404 not-found).
 * Residual after wave41: artifacts POST body/header + GET ?projectId= and
 * evidence/import body.projectId also gate → 400 (not dishonest 403 forbidden).
 * Do not claim Lab fully usable while #49 open.
 */
export function normalizeProjectId(id: unknown): string | null {
  return normalizeUuidPathParam(id);
}

export function isPlausibleProjectId(id: string): boolean {
  return normalizeProjectId(id) != null;
}

/**
 * Normalize project *model* id path param (addProjectModel → crypto.randomUUID).
 * Residual after wave39: projects/[id]/models/[modelId] DELETE gates garbage model
 * ids → 400 invalid model id (not dishonest 404 not-found). Parity normalizeJobId /
 * normalizeProjectId. Do not claim Lab fully usable while #49 open.
 */
export function normalizeModelId(id: unknown): string | null {
  return normalizeUuidPathParam(id);
}

export function isPlausibleModelId(id: string): boolean {
  return normalizeModelId(id) != null;
}

/**
 * Normalize artifact *id* path param (saveArtifact → crypto.randomUUID).
 * Residual after wave40: artifacts/[id] GET gates garbage path ids → 400
 * invalid artifact id (not dishonest 404 "Artifact not found" for path
 * traversal / non-UUID). Parity normalizeJobId / normalizeProjectId.
 * Do not claim Lab fully usable while #49 open.
 */
export function normalizeArtifactId(id: unknown): string | null {
  return normalizeUuidPathParam(id);
}

export function isPlausibleArtifactId(id: string): boolean {
  return normalizeArtifactId(id) != null;
}

/**
 * Normalize evidence *id* path param (createEvidence → crypto.randomUUID).
 * Residual after wave40: evidence/[id] GET gates garbage path ids → 400
 * invalid evidence id (not dishonest 404 "evidence not found").
 * Do not claim Lab fully usable while #49 open.
 */
export function normalizeEvidenceId(id: unknown): string | null {
  return normalizeUuidPathParam(id);
}

export function isPlausibleEvidenceId(id: string): boolean {
  return normalizeEvidenceId(id) != null;
}

/**
 * Normalize path-comparison *id* path param (createPathComparison → randomUUID).
 * Residual after wave40: comparisons/[id] GET gates garbage path ids → 400
 * invalid comparison id (not dishonest 404 "comparison not found").
 * Do not claim Lab fully usable while #49 open.
 */
export function normalizeComparisonId(id: unknown): string | null {
  return normalizeUuidPathParam(id);
}

export function isPlausibleComparisonId(id: string): boolean {
  return normalizeComparisonId(id) != null;
}

/**
 * Plausible job *id* for share grants and job path params. createJob issues
 * crypto.randomUUID().
 * Residual after wave33: refuse numeric/empty/non-UUID before getJob so clients
 * get 400 "invalid job id" instead of a dishonest 404 "one or more jobs not found".
 * Residual after wave36: jobs/[id] GET + result + cancel also gate path ids with
 * this helper (parity shares DELETE isPlausibleShareId / publications publicId)
 * so garbage paths → 400, not dishonest 404 "Job not found".
 * Residual after wave37: normalizeJobId returns trimmed UUID or null so path
 * routes never call getJob/claim with padded/garbage ids (isPlausible + trim
 * honesty); audit + agent claim/complete/fail/heartbeat/progress also gate;
 * shareAllowsJob refuses non-UUID jobId before DB join.
 * Residual after wave38: projects/[id]/jobs POST body.jobId also uses this
 * (attachJobToProject never sees garbage → dishonest 404 "job not found").
 * Residual after wave40: artifacts POST body/header jobId also uses this
 * (getJob never sees garbage → dishonest 404 "job not found").
 * Residual after wave41: artifacts GET ?jobId= also uses this (list filter).
 * Do not claim Lab fully usable while #49 open.
 */
export function normalizeJobId(id: unknown): string | null {
  return normalizeUuidPathParam(id);
}

export function isPlausibleJobId(id: string): boolean {
  return normalizeJobId(id) != null;
}

/**
 * Normalize client `jobIds` from a JSON body before getJob.
 * Residual after wave33 (shares POST):
 * - null/undefined → [] (shares route maps empty to "jobIds required")
 * - non-array (string/object/number) → 400 "jobIds must be an array"
 *   (prior path spread string chars via Set — dishonest id list)
 * - non-string / empty / non-UUID entries → 400 "invalid job id"
 *   (not dishonest 404 not-found)
 * - trim + dedupe; preserve first-seen order
 * - more than MAX_SHARE_JOB_IDS distinct ids → 400 "too many job ids"
 *   before any getJob (a 256KB body could otherwise fan out thousands of lookups)
 * Residual after wave34: publications POST also uses this helper so garbage
 * jobIds are 400 (not dishonest 404 "not found or not publishable").
 * Residual after wave41: comparisons POST also uses this helper so garbage
 * jobIds are 400 (not dishonest 404 "path job … not found" from createPathComparison).
 * Prefer this before getJob / createJobShare / createPublication / createPathComparison.
 * Never invent ids.
 */
export function normalizeShareJobIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw Object.assign(new Error('jobIds must be an array'), { status: 400 });
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw Object.assign(new Error('invalid job id'), { status: 400 });
    }
    const t = item.trim();
    if (!t || !isPlausibleJobId(t)) {
      throw Object.assign(new Error('invalid job id'), { status: 400 });
    }
    if (!seen.has(t)) {
      if (out.length >= MAX_SHARE_JOB_IDS) {
        throw Object.assign(new Error('too many job ids'), { status: 400 });
      }
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Plausible publication *publicId* (path param for detail/download/reviews).
 * createPublication issues `pub_` + 18-byte base64url (matches tuanliu gate
 * `/^pub_[A-Za-z0-9_-]{10,80}$/` — Host must not invent a looser contract).
 * Residual after wave35: reject numeric / bare uuid / path-traversal garbage
 * before getPublication so clients get 400 "invalid publication id" instead
 * of a dishonest 404 "publication not found".
 * Do not claim Lab fully usable while #49 open.
 */
const PUBLICATION_PUBLIC_ID_RE = /^pub_[A-Za-z0-9_-]{10,80}$/;

export function isPlausiblePublicId(id: string): boolean {
  if (typeof id !== 'string') return false;
  const t = id.trim();
  if (!t || t.length > 84) return false; // pub_ (4) + 80 body
  return PUBLICATION_PUBLIC_ID_RE.test(t);
}

/**
 * Normalize publication `?version=` query before getPublication.
 * Residual after wave35: missing/empty → 1 (createPublication starts at v1);
 * non-finite / non-integer / <1 (incl. "abc", 0, -1, 1.5) → 400
 * "invalid publication version" (not dishonest 404 "publication not found").
 * Never invent NaN versions.
 */
export function normalizePublicationVersion(raw: unknown): number {
  if (raw == null || raw === '') return 1;
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return 1;
    n = Number(t);
  } else {
    throw Object.assign(new Error('invalid publication version'), { status: 400 });
  }
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 1) {
    throw Object.assign(new Error('invalid publication version'), { status: 400 });
  }
  return n;
}

/**
 * Extract share token from header or ?share=. Residual after 6d2ecaa: only
 * `shr_`-prefixed tokens are accepted (reject empty / bare secrets / typos so
 * accidental query params never grant access). Residual after f8da984: min length.
 * Residual after c72cf29: charset/max; header wins when both sources are plausible.
 */
/** Query `?share=` is a leak vector; production requires the header (#63). */
export function shareQueryAllowed(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.SHARE_ALLOW_QUERY === '1' || env.SHARE_ALLOW_QUERY === 'true') return true;
  return env.NODE_ENV !== 'production';
}

export function shareTokenFromRequest(
  req: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const header = req.headers.get('x-waveworld-share')?.trim();
  if (header && isPlausibleShareToken(header)) return header;
  if (!shareQueryAllowed(env)) return null;
  const token = new URL(req.url).searchParams.get('share')?.trim();
  return token && isPlausibleShareToken(token) ? token : null;
}

export async function shareAllowsJob(token: string | null, jobId: string): Promise<boolean> {
  // Residual after c72cf29: refuse non-plausible tokens before DB hash lookup
  // (parity shareTokenFromRequest; direct callers cannot skip format gates).
  if (!token || !isPlausibleShareToken(token)) return false;
  // Residual after wave37: refuse non-UUID jobId before DB join (parity token gate;
  // garbage job ids never become "not shared" via missing-row semantics alone).
  const normalizedJobId = normalizeJobId(jobId);
  if (!normalizedJobId) return false;
  const db = await sqlite();
  const row = db.prepare(
    `SELECT 1 FROM job_shares s
     JOIN job_share_items i ON i.share_id = s.id
     WHERE s.token_hash = ? AND i.job_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`
  ).get(tokenHash(token), normalizedJobId, new Date().toISOString());
  return !!row;
}

export type AgentPrincipal = { id: string };

/**
 * Agent authorization for job read/edit (cancel/audit).
 * Only the leasing agent (`job.agentId`) may access. Foreign registered
 * agents are not superusers (#60). Claim remains a separate route and
 * stays workspace-scoped via AGENT_WORKSPACE in claimJob.
 */
export function agentMayAccessJob(
  agent: AgentPrincipal | null | undefined,
  job: JobRecord,
  _access: JobAccess,
): boolean {
  if (!agent?.id) return false;
  return !!job.agentId && job.agentId === agent.id;
}

/**
 * Agent may download an artifact only when it is attached to a job the
 * agent currently holds (or held — agentId still set after complete).
 */
export function agentMayAccessArtifact(
  agent: AgentPrincipal | null | undefined,
  meta: { jobId?: string | null },
  job: JobRecord | null | undefined,
): boolean {
  if (!agent?.id || !meta.jobId || !job) return false;
  if (job.id !== meta.jobId) return false;
  return agentMayAccessJob(agent, job, 'read');
}

/** User/project authorization. Share tokens are intentionally read-only. */
export async function userMayAccessJob(user: HostUser | null, job: JobRecord, access: JobAccess): Promise<boolean> {
  if (!user) return false;
  if (job.createdBy === user.id) return true;
  if (!job.projectId) return false;
  const { canAccessProject } = await import('./project-service');
  const role = await canAccessProject(job.projectId, user.id, user.workspaceId);
  if (!role) return false;
  return access === 'read' || role === 'owner' || role === 'editor';
}

export async function requestMayAccessJob(req: Request, job: JobRecord, access: JobAccess): Promise<boolean> {
  const { authenticateAgent } = await import('@/lib/tasks/auth-agent');
  const agent = authenticateAgent(req.headers.get('authorization'));
  if (agent) return agentMayAccessJob(agent, job, access);
  // Residual after aabd0bf: timing-safe TASK_API_KEY (parity metrics/jobs-stats; never plain ===).
  const apiKey = process.env.TASK_API_KEY?.trim();
  if (apiKey && sameSecret(req.headers.get('x-api-key'), apiKey)) return true;
  const { resolveUser } = await import('./user-auth');
  if (await userMayAccessJob(await resolveUser(req), job, access)) return true;
  if (access === 'read' && await shareAllowsJob(shareTokenFromRequest(req), job.id)) return true;
  // Explicitly retain local developer ergonomics, never production openness.
  // Residual after 6d2ecaa: JOB_REQUIRE_AUTH=1 forces auth even outside production
  // (prod-like local gates; empty operator key never grants via sameSecret).
  return process.env.NODE_ENV !== 'production' && process.env.JOB_REQUIRE_AUTH !== '1';
}

/**
 * Share TTL bounds (seconds). Residual after wave30 / A-host-residual-small-wave30:
 * exported so clients and tests share the same honesty contract — silent NaN
 * expiresAt or unbounded TTL are not acceptable.
 * Residual after wave31: job-count + title bounds exported; JSON body TTL
 * normalized (numeric string "600" must not silently fall to DEFAULT).
 * Do not claim Lab fully usable while #49 open.
 */
export const SHARE_TTL_MIN_SECONDS = 300; // 5 minutes
export const SHARE_TTL_MAX_SECONDS = 365 * 24 * 3600; // 1 year
export const SHARE_TTL_DEFAULT_SECONDS = 30 * 24 * 3600; // 30 days
/** Max jobs per share grant (createJobShare fails closed above this). */
export const SHARE_JOBS_MAX = 20;
/** Max stored share title length (trim + slice; never unbounded DB text). */
export const SHARE_TITLE_MAX_CHARS = 200;

/**
 * Normalize client `expiresInSeconds` from a JSON body before clamp.
 * Residual after wave31: JSON often delivers numbers as strings ("600").
 * Prior path only accepted typeof number, so string "600" was non-finite and
 * silently became DEFAULT — dishonest applied TTL. Finite number / numeric
 * string → number for clamp; null/empty/non-numeric/object/array/boolean →
 * undefined (DEFAULT via clamp). Never invent NaN expiresAt.
 */
export function normalizeShareExpiresInSeconds(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Clamp share title for storage. Residual after wave31: trim + max length;
 * empty → null (never store whitespace-only titles).
 */
export function clampShareTitle(title?: string | null): string | null {
  if (title == null) return null;
  const t = String(title).trim();
  if (!t) return null;
  return t.length > SHARE_TITLE_MAX_CHARS ? t.slice(0, SHARE_TITLE_MAX_CHARS) : t;
}

/**
 * Clamp requested share TTL into [MIN, MAX].
 * Missing / non-finite / non-integer-after-floor → DEFAULT (never invent NaN
 * expiresAt). Below MIN → MIN; above MAX → MAX. Residual after wave30.
 * Prefer normalizeShareExpiresInSeconds(body.expiresInSeconds) first (wave31).
 */
export function clampShareTtlSeconds(expiresInSeconds?: number): number {
  if (expiresInSeconds == null || !Number.isFinite(expiresInSeconds)) {
    return SHARE_TTL_DEFAULT_SECONDS;
  }
  const n = Math.floor(expiresInSeconds);
  if (!Number.isFinite(n)) return SHARE_TTL_DEFAULT_SECONDS;
  return Math.min(SHARE_TTL_MAX_SECONDS, Math.max(SHARE_TTL_MIN_SECONDS, n));
}

export async function createJobShare(input: {
  user: HostUser;
  jobs: JobRecord[];
  title?: string;
  /** Already-normalized number preferred; raw body should pass normalizeShareExpiresInSeconds first. */
  expiresInSeconds?: number;
}): Promise<{
  id: string;
  token: string;
  jobIds: string[];
  expiresAt: string;
  /** Applied TTL after clamp (honesty: client sees what was stored). */
  expiresInSeconds: number;
  /** Applied title after clamp (null when empty / omitted). */
  title: string | null;
}> {
  if (!input.jobs.length || input.jobs.length > SHARE_JOBS_MAX) {
    throw Object.assign(new Error(`jobIds must contain 1–${SHARE_JOBS_MAX} jobs`), { status: 400 });
  }
  for (const job of input.jobs) {
    if (!await userMayAccessJob(input.user, job, 'edit')) throw Object.assign(new Error(`forbidden: cannot share job ${job.id}`), { status: 403 });
  }
  const ttl = clampShareTtlSeconds(input.expiresInSeconds);
  const title = clampShareTitle(input.title);
  const id = crypto.randomUUID();
  const token = `shr_${randomBytes(32).toString('base64url')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  const db = await sqlite();
  const insertShare = db.prepare(`INSERT INTO job_shares (id, token_hash, created_by, title, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`);
  const insertItem = db.prepare(`INSERT INTO job_share_items (share_id, job_id, position) VALUES (?, ?, ?)`);
  db.transaction(() => {
    insertShare.run(id, tokenHash(token), input.user.id, title, expiresAt, now.toISOString());
    input.jobs.forEach((job, position) => insertItem.run(id, job.id, position));
  })();
  return { id, token, jobIds: input.jobs.map((job) => job.id), expiresAt, expiresInSeconds: ttl, title };
}

export async function revokeJobShare(id: string, userId: string): Promise<boolean> {
  // Residual after wave32: refuse non-UUID ids before DB (parity isPlausibleShareToken).
  // Residual after wave38: normalizeShareId (trim+UUID); callers needing 400 vs 404
  // should gate with normalizeShareId / isPlausibleShareId first.
  const shareId = normalizeShareId(id);
  if (!shareId) return false;
  const db = await sqlite();
  const result = db.prepare(`UPDATE job_shares SET revoked_at = ? WHERE id = ? AND created_by = ? AND revoked_at IS NULL`).run(new Date().toISOString(), shareId, userId);
  return result.changes === 1;
}
