/**
 * Coarse in-process rate limiter (#62).
 * Keyed by bucket + client IP (x-forwarded-for / x-real-ip).
 */
type Bucket = { count: number; resetAt: number; logged?: boolean };

const buckets = new Map<string, Bucket>();
let lastTableFullLog = 0;

export const RATE_LIMIT_WINDOWS = {
  login: { limit: 20, windowMs: 60_000 },
  oidc: { limit: 30, windowMs: 60_000 },
  register: { limit: 10, windowMs: 60_000 },
  knowledgeWrite: { limit: 60, windowMs: 60_000 },
  jobSubmit: { limit: 30, windowMs: 60_000 },
  // One share create is a small set of lookups. 30/min sheds a loop
  // before each request can carry a 256KB id list.
  jobShare: { limit: 30, windowMs: 60_000 },
  // Publication and comparison creates each look up every job and then
  // write a derived record. 30/min is checked before the body is read.
  jobCompose: { limit: 30, windowMs: 60_000 },
  // Audit materializes a manifest artifact. 30/min sheds an anonymous
  // UUID scan before getJob, and still allows a few repairs.
  jobAudit: { limit: 30, windowMs: 60_000 },
  // Capability PUT rewrites the row that every later auth call parses.
  // An agent updates once at start; 30/min is before the 256KB body.
  agentCapability: { limit: 30, windowMs: 60_000 },
  // Each project create writes a project row and an owner membership.
  // 30/min is checked before the 256KB body.
  projectCreate: { limit: 30, windowMs: 60_000 },
  // Project-scoped row writes (update/delete, member upsert/remove, model
  // bind/unbind, job attach) are cheap but keyed by the authed user so a
  // stolen session cannot run an unbounded write loop. 60/min leaves bulk
  // UI edits usable.
  projectWrite: { limit: 60, windowMs: 60_000 },
  // A review create reads up to 1MB then writes a review row.
  publicationReview: { limit: 30, windowMs: 60_000 },
  // Golden-case advance verifies datasets, imports evidence, and writes
  // jobs + comparison + publication — shed a repeat loop before the work.
  goldenCaseAdvance: { limit: 30, windowMs: 60_000 },
  artifactUpload: { limit: 120, windowMs: 60_000 },
  // 正常 claim 轮询 2s ≈ 30/min；8× headroom。--poll 1ms 的失控 agent
  // 每次 claim 都要 SELECT+parse+UPDATE，必须把单 agent 频率钉死。
  jobClaim: { limit: 240, windowMs: 60_000 },
  // keepalive 正常 15s ≈ 4/min；CLI 下限 100ms。心跳已免写（no-op 节流），
  // 但每次调用仍是 auth+job 两次 SELECT + capabilities JSON.parse。
  jobHeartbeat: { limit: 480, windowMs: 60_000 },
  // One settle per finished job, plus retries. 120/min is 2/s — enough for
  // short jobs, and it sheds a tight fail/complete loop before the 64MB
  // complete body is read.
  jobSettle: { limit: 120, windowMs: 60_000 },
  // Cancel is a rare user action. 60/min still sheds an anonymous UUID
  // scan that would otherwise SELECT on every request.
  jobCancel: { limit: 60, windowMs: 60_000 },
  // Detail and result share this bucket. 120/min is 2/s for a polling
  // page; an anonymous UUID scan is shed before getJob.
  jobRead: { limit: 120, windowMs: 60_000 },
  // Artifact download stats the store before the auth check. 120/min
  // still loads a result panel; an anonymous id scan is shed first.
  artifactRead: { limit: 120, windowMs: 60_000 },
  // resolve-job reads up to 4MB then runs knowledge.db assembly +
  // acceptJobSpec validation. The K18 write key is optional (open when
  // unset), so an anonymous caller could otherwise loop the assembly.
  knowledgeResolveJob: { limit: 60, windowMs: 60_000 },
  // Public publication downloads re-read the bundle and re-verify its
  // digest on every request, unauthenticated. 60/min per IP keeps a
  // result page usable while shedding a repeat loop before the disk
  // read + sha + manifest verify.
  publicationDownload: { limit: 60, windowMs: 60_000 },
} as const;

/**
 * Bound on tracked keys. Without it a client rotating IPs (spoofed or NAT
 * churn) mints a bucket per request and the limiter itself becomes an
 * unbounded in-process memory leak. When full, expired entries are swept
 * first; a still-full table fails closed — during a real key-flood the
 * limiter's job is shedding load anyway.
 */
export const MAX_RATE_LIMIT_KEYS = 8192;

export type RateLimitBucket = keyof typeof RATE_LIMIT_WINDOWS;

export function clientRateKey(req: Request, bucket: string): string {
  // XFF 最左条目完全由客户端控制——轮换即可无限换桶，限流形同虚设。
  // 信任序：cf-connecting-ip（CF 边缘覆写，CF 路径下不可伪造）→
  // x-real-ip（边缘代理设置）→ XFF 最右条目（我方边缘实测的对端 IP，
  // TCP 层事实，客户端不可伪造；CF 流量下它是 CF 出口，故 cf- 优先）。
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  const real = req.headers.get('x-real-ip')?.trim();
  const lastHop = req.headers.get('x-forwarded-for')?.split(',').pop()?.trim();
  const ip = cf || real || lastHop || 'local';
  return `${bucket}:${ip}`;
}

export function rateLimitTake(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { ok: boolean; retryAfterSec: number } {
  const cur = buckets.get(key);
  if (!cur || now >= cur.resetAt) {
    if (!cur && buckets.size >= MAX_RATE_LIMIT_KEYS) {
      for (const [k, b] of buckets) { if (now >= b.resetAt) buckets.delete(k); }
      if (buckets.size >= MAX_RATE_LIMIT_KEYS) {
        // Global shed — log at most once a minute regardless of flood rate.
        if (now - lastTableFullLog >= 60_000) {
          lastTableFullLog = now;
          console.warn(`[host:rate-limit] ${JSON.stringify({ event: 'table_full', keys: buckets.size })}`);
        }
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil(windowMs / 1000)) };
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (cur.count >= limit) {
    // One line per key per window — enough for an operator to see WHO is
    // being shed without letting a flood client spam logs per rejection.
    // `logged` resets each window because a fresh bucket object is created.
    if (!cur.logged) {
      cur.logged = true;
      console.warn(`[host:rate-limit] ${JSON.stringify({ key, limit, windowMs })}`);
    }
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }
  cur.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

export function consumeRateLimit(
  req: Request,
  bucket: RateLimitBucket,
  now = Date.now(),
): { ok: boolean; retryAfterSec: number } {
  const cfg = RATE_LIMIT_WINDOWS[bucket];
  return rateLimitTake(clientRateKey(req, bucket), cfg.limit, cfg.windowMs, now);
}

/**
 * Artifact-write rate limit keyed by authenticated principal, not IP — an
 * agent fleet behind one NAT must not share a bucket, and a rotating-IP
 * uploader must not get a fresh one. Falls back to the IP key only for
 * open non-production access. Shared by artifacts POST and evidence
 * import (contentBase64 → artifact — same disk-write surface).
 */
export function consumeArtifactUploadLimit(
  req: Request,
  principal: { agentId?: string | null; userId?: string | null },
): { ok: boolean; retryAfterSec: number } {
  const key = principal.agentId
    ? `artifactUpload:agent:${principal.agentId}`
    : principal.userId
      ? `artifactUpload:user:${principal.userId}`
      : clientRateKey(req, 'artifactUpload');
  const cfg = RATE_LIMIT_WINDOWS.artifactUpload;
  return rateLimitTake(key, cfg.limit, cfg.windowMs);
}

/**
 * Cancel is reachable without a session when the id is missing: getJob ran
 * before any auth check. Anonymous callers share an IP bucket. A presented
 * agent token gets its own bucket so one scanner does not shed the fleet.
 */
/**
 * Job detail and result call getJob before the access check. Anonymous
 * callers share an IP bucket. A presented agent token gets its own.
 */
/**
 * Artifact download calls getArtifact and stat before auth. Anonymous
 * callers share an IP bucket. A presented agent token gets its own.
 */
export function consumeArtifactReadLimit(
  req: Request,
  agentId?: string | null,
): { ok: boolean; retryAfterSec: number } {
  const cfg = RATE_LIMIT_WINDOWS.artifactRead;
  const key = agentId ? `artifactRead:agent:${agentId}` : clientRateKey(req, 'artifactRead');
  return rateLimitTake(key, cfg.limit, cfg.windowMs);
}

export function consumeJobReadLimit(
  req: Request,
  agentId?: string | null,
): { ok: boolean; retryAfterSec: number } {
  const cfg = RATE_LIMIT_WINDOWS.jobRead;
  const key = agentId ? `jobRead:agent:${agentId}` : clientRateKey(req, 'jobRead');
  return rateLimitTake(key, cfg.limit, cfg.windowMs);
}

export function consumeJobCancelLimit(
  req: Request,
  agentId?: string | null,
): { ok: boolean; retryAfterSec: number } {
  const cfg = RATE_LIMIT_WINDOWS.jobCancel;
  const key = agentId ? `jobCancel:agent:${agentId}` : clientRateKey(req, 'jobCancel');
  return rateLimitTake(key, cfg.limit, cfg.windowMs);
}

/**
 * Audit POST calls getJob before the access check and may write a
 * manifest. Anonymous callers share an IP bucket. A bearer agent
 * gets its own bucket.
 */
/** Per-agent capability rewrites. Checked before the body is read. */
/** Per-user project creates. Checked before the body is read. */
export function consumeProjectCreateLimit(userId: string): { ok: boolean; retryAfterSec: number } {
  const cfg = RATE_LIMIT_WINDOWS.projectCreate;
  return rateLimitTake(`projectCreate:user:${userId}`, cfg.limit, cfg.windowMs);
}

/** Per-user project-scoped writes (patch/delete, members, models, job attach). */
export function consumeProjectWriteLimit(userId: string): { ok: boolean; retryAfterSec: number } {
  const cfg = RATE_LIMIT_WINDOWS.projectWrite;
  return rateLimitTake(`projectWrite:user:${userId}`, cfg.limit, cfg.windowMs);
}

/** Per-user independent-review creates. Checked before the 1MB body. */
export function consumePublicationReviewLimit(userId: string): { ok: boolean; retryAfterSec: number } {
  const cfg = RATE_LIMIT_WINDOWS.publicationReview;
  return rateLimitTake(`publicationReview:user:${userId}`, cfg.limit, cfg.windowMs);
}

/** Per-user golden-case advances. Checked before dataset/evidence/job writes. */
export function consumeGoldenCaseAdvanceLimit(userId: string): { ok: boolean; retryAfterSec: number } {
  const cfg = RATE_LIMIT_WINDOWS.goldenCaseAdvance;
  return rateLimitTake(`goldenCaseAdvance:user:${userId}`, cfg.limit, cfg.windowMs);
}

export function consumeAgentCapabilityLimit(agentId: string): { ok: boolean; retryAfterSec: number } {
  const cfg = RATE_LIMIT_WINDOWS.agentCapability;
  return rateLimitTake(`agentCapability:agent:${agentId}`, cfg.limit, cfg.windowMs);
}

export function consumeJobAuditLimit(
  req: Request,
  agentId?: string | null,
): { ok: boolean; retryAfterSec: number } {
  const cfg = RATE_LIMIT_WINDOWS.jobAudit;
  const key = agentId ? `jobAudit:agent:${agentId}` : clientRateKey(req, 'jobAudit');
  return rateLimitTake(key, cfg.limit, cfg.windowMs);
}

export function consumeJobComposeLimit(userId: string): { ok: boolean; retryAfterSec: number } {
  const cfg = RATE_LIMIT_WINDOWS.jobCompose;
  return rateLimitTake(`jobCompose:user:${userId}`, cfg.limit, cfg.windowMs);
}

export function consumeJobShareLimit(userId: string): { ok: boolean; retryAfterSec: number } {
  const cfg = RATE_LIMIT_WINDOWS.jobShare;
  return rateLimitTake(`jobShare:user:${userId}`, cfg.limit, cfg.windowMs);
}

/**
 * Per-agent claim and heartbeat limits. Claim polling can be 1ms and
 * heartbeat 100ms; keying by agent id keeps a NAT'd fleet independent.
 */
export function consumeAgentJobLimit(
  bucket: 'jobClaim' | 'jobHeartbeat' | 'jobSettle',
  agentId: string,
): { ok: boolean; retryAfterSec: number } {
  const cfg = RATE_LIMIT_WINDOWS[bucket];
  return rateLimitTake(`${bucket}:agent:${agentId}`, cfg.limit, cfg.windowMs);
}

export function rateLimitedResponse(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: 'rate_limited' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfterSec),
    },
  });
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}
