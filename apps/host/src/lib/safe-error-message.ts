/**
 * Operational error text for public probe surfaces (metrics / readiness).
 * Never echo configured secret env values; keep messages short.
 * Residual after a0c47ec: shared by metrics 503 and readiness 503.
 * Residual after 59a3fa3: string throws + shared probe no-store headers.
 * Residual after 6d08a42: tighter no-store suite; shared secret redactor for
 * error bodies and Prometheus label values (metrics must not echo secrets).
 * Residual after aabd0bf: shared timing-safe secret compare; Surrogate-Control
 * no-store so CDN/edge caches do not store probe honesty either.
 * Residual after 7290c1c: agents/register also uses sameSecret (parity operator
 * key surfaces); probe Surrogate-Control pinned on readiness/metrics/jobs-stats.
 * Residual after 6d2ecaa: agents/register also applies PROBE_NO_STORE_HEADERS on
 * 401/201/400 so issued agent tokens are never CDN/edge-cached.
 * Residual after f8da984: jobs/stats + agents/register honor JOB_REQUIRE_AUTH /
 * configured-key-always; share tokens min-length (header honesty + auth edge).
 * Residual after c72cf29: share create 201 uses PROBE_NO_STORE; share tokens
 * base64url+max; CORS allows x-waveworld-share (header honesty).
 * Residual after wave30: share TTL clamp honesty (MIN/MAX/DEFAULT; NaN→default);
 * createJobShare returns applied expiresInSeconds; revoke DELETE no-store.
 * Residual after wave31: shares POST/DELETE all paths PROBE_NO_STORE +
 * safeOperationalErrorMessage; normalizeShareExpiresInSeconds (JSON string TTL);
 * share title clamp; SHARE_JOBS_MAX exported.
 * Residual after wave32: isPlausibleShareId (UUID) on DELETE — numeric/garbage
 * path ids → 400 invalid share id (not dishonest 404); revokeJobShare early reject.
 * Residual after wave33: normalizeShareJobIds on shares POST — non-array jobIds /
 * non-UUID entries → 400 (not char-spread or dishonest 404 not-found).
 * Residual after wave34: publications POST reuses normalizeShareJobIds — garbage
 * jobIds → 400 (not dishonest 404 not-found/not-publishable).
 * Residual after wave35: isPlausiblePublicId + normalizePublicationVersion on
 * publications detail/download/reviews — garbage publicId / invalid version → 400
 * (not dishonest 404).
 * Residual after wave36: isPlausibleJobId on jobs/[id] GET + result + cancel —
 * garbage path ids → 400 invalid job id (not dishonest 404 Job not found).
 * Residual after wave37: normalizeJobId + audit/agent job subroutes + shareAllowsJob
 * jobId gate (cancel/result path consistency across jobs/[id]/*).
 * Residual after wave38: normalizeShareId on shares DELETE; normalizeProjectId on
 * projects/[id] GET/PATCH/DELETE + projects/[id]/jobs; normalizeJobId on attach
 * body.jobId — garbage → 400 (not dishonest 404). No Lab claim while #49 open.
 * Residual after wave39: projects/[id]/members|models (+ modelId) path gates.
 * Residual after wave40: normalizeArtifactId/EvidenceId/ComparisonId on path GET
 * + artifacts POST body.jobId normalizeJobId — garbage → 400 (not dishonest 404).
 * Residual after wave41: comparisons POST normalizeShareJobIds; artifacts
 * POST/GET projectId + GET jobId; evidence import projectId — garbage → 400.
 */

import { timingSafeEqual } from 'node:crypto';

/** Env keys whose values must never appear in probe error bodies or metric labels. */
export const OPERATIONAL_SECRET_ENV_KEYS = [
  'TASK_API_KEY',
  'W_ID_CLIENT_SECRET',
  'AGENT_REGISTRATION_KEY',
  'AGENT_TOKEN',
  'KNOWLEDGE_WRITE_KEY',
  'KNOWLEDGE_WRITE_API_KEY',
] as const;

/**
 * JSON probe surfaces (health / readiness / auth-config / jobs-stats) and metrics:
 * never cache honesty, process identity, or scrape gauges. Shared so all operator
 * probes stay consistent. Residual after 6d08a42: private + must-revalidate + Pragma
 * so intermediate caches that ignore bare no-store still refuse to store.
 * Residual after 1b367e7: Expires: 0 for HTTP/1.0 intermediaries that honor Expires
 * more than Cache-Control alone.
 * Residual after aabd0bf: Surrogate-Control: no-store for CDN/edge (CF/Caddy caches)
 * that may treat Surrogate-Control independently of Cache-Control.
 */
export const PROBE_NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
  Expires: '0',
  'Surrogate-Control': 'no-store',
} as const;

/**
 * Timing-safe equality for API keys / registration secrets.
 * Residual after aabd0bf: shared by metrics, jobs/stats, job-sharing, jobs list
 * so operator x-api-key checks never use plain === (length + content).
 * Residual after 7290c1c: agents/register also uses this helper (AGENT_REGISTRATION_KEY
 * / TASK_API_KEY) — never local timingSafeEqual for registration keys.
 * Null/empty actual never matches (even empty expected).
 */
export function sameSecret(actual: string | null | undefined, expected: string): boolean {
  if (actual == null || actual === '') return false;
  if (!expected) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Strip secret env values from free text (error messages, metric labels).
 * Exported for unit tests and metrics label safety.
 */
export function redactOperationalSecrets(text: string): string {
  let msg = text;
  for (const key of OPERATIONAL_SECRET_ENV_KEYS) {
    const val = process.env[key]?.trim();
    if (val && val.length >= 4 && msg.includes(val)) {
      msg = msg.split(val).join(`[redacted:${key}]`);
    }
  }
  return msg;
}

/**
 * Strip secret env values from operational error text (no secrets in fixtures).
 * Exported for unit tests.
 */
export function safeOperationalErrorMessage(error: unknown): string {
  // Residual after 59a3fa3: accept string throws (some sqlite/native paths)
  // without String(object) dumps that could embed env values.
  let msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'unknown error';
  msg = redactOperationalSecrets(msg);
  // Cap length so accidental dumps stay short (still no secrets after redaction).
  if (msg.length > 200) msg = `${msg.slice(0, 200)}…`;
  return msg;
}
