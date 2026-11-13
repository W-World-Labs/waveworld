import { ensureTaskEnv } from '../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Create (or reuse) a path-comparison from succeeded path-experiment jobs.
 * Residual after wave41: normalizeShareJobIds on body.jobIds — non-array /
 * non-UUID entries → 400 (not dishonest 404 "path job … not found" from
 * createPathComparison). Parity shares POST (wave33) + publications POST
 * (wave34). Do not claim Lab fully usable while #49/#54 open.
 */
export async function POST(req: Request) {
  ensureTaskEnv();
  const { errorResponse, json, readJson } = await import('@/lib/tasks/http');
  try {
    const { resolveUser } = await import('../../../../lib/user-auth');
    const user = await resolveUser(req);
    if (!user) return json({ error: 'user authentication required' }, 401);
    const { consumeJobComposeLimit, rateLimitedResponse } = await import('../../../../lib/rate-limit');
    const limited = consumeJobComposeLimit(user.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const body = await readJson<{ jobIds?: unknown }>(req, 256 * 1024);
    // Residual after wave41: array + UUID gate before createPathComparison
    // (getJob never sees garbage → dishonest 404 "path job … not found").
    const { normalizeShareJobIds } = await import('../../../../lib/job-sharing');
    const jobIds = normalizeShareJobIds(body.jobIds);
    const { createPathComparison } = await import('@/lib/tasks/path-comparison');
    const created = await createPathComparison({ user, jobIds });
    return json(created, created.reused ? 200 : 201);
  } catch (error) {
    return errorResponse(error);
  }
}
