import { ensureTaskEnv } from '../../../../lib/ensure-task-env';
import {
  PROBE_NO_STORE_HEADERS,
  safeOperationalErrorMessage,
} from '../../../../lib/safe-error-message';

export const runtime = 'nodejs';

/**
 * Create a revocable read-only job share. Residual after c72cf29: 201 carries a
 * one-time share token — always PROBE_NO_STORE_HEADERS (parity agents/register;
 * never CDN/edge-cache issued secrets).
 * Residual after wave31: all status paths (400/401/403/404/201/5xx) use
 * PROBE_NO_STORE + safeOperationalErrorMessage; expiresInSeconds normalized from
 * JSON (numeric string honesty) before clamp.
 * Residual after wave33: normalizeShareJobIds — non-array jobIds / non-UUID
 * entries → 400 (not char-spread Set or dishonest 404 not-found).
 * Do not claim Lab fully usable while #49 open.
 */
export async function POST(req: Request) {
  ensureTaskEnv();
  try {
    const { requireUser } = await import('../../../../lib/user-auth');
    const {
      createJobShare,
      normalizeShareExpiresInSeconds,
      normalizeShareJobIds,
    } = await import('../../../../lib/job-sharing');
    const { getJob } = await import('@/lib/tasks/service');
    const { readJson, HttpError } = await import('@/lib/tasks/http');
    const user = await requireUser(req);
    const { consumeJobShareLimit } = await import('../../../../lib/rate-limit');
    const limited = consumeJobShareLimit(user.id);
    if (!limited.ok) {
      return Response.json(
        { error: 'rate_limited' },
        {
          status: 429,
          headers: { ...PROBE_NO_STORE_HEADERS, 'Retry-After': String(limited.retryAfterSec) },
        },
      );
    }
    const body = await readJson<{
      jobIds?: unknown;
      title?: string;
      expiresInSeconds?: unknown;
    }>(req, 256 * 1024);
    // Residual after wave33: array + UUID gate before getJob (parity publications
    // "jobIds must be an array"; garbage ids are client errors, not "not found").
    const ids = normalizeShareJobIds(body.jobIds);
    if (!ids.length) throw new HttpError(400, 'jobIds required');
    const jobs = ids.map((id) => getJob(id));
    if (jobs.some((job) => !job)) throw new HttpError(404, 'one or more jobs not found');
    // Residual after wave31: normalize JSON number|string before clamp (string "600"
    // must apply 600s, not silently DEFAULT).
    const expiresInSeconds = normalizeShareExpiresInSeconds(body.expiresInSeconds);
    const share = await createJobShare({
      user,
      jobs: jobs as NonNullable<(typeof jobs)[number]>[],
      title: body.title,
      expiresInSeconds,
    });
    // 201 carries share token — always no-store (never edge-cache secrets).
    return Response.json({ share }, { status: 201, headers: PROBE_NO_STORE_HEADERS });
  } catch (error) {
    // Residual after wave31: parity agents/register — auth/validation outcomes
    // and errors never edge-cached; bodies never echo secret env values.
    const status =
      error instanceof Error && typeof (error as Error & { status?: number }).status === 'number'
        ? (error as Error & { status: number }).status
        : 500;
    return Response.json(
      { error: safeOperationalErrorMessage(error) },
      { status, headers: PROBE_NO_STORE_HEADERS },
    );
  }
}
