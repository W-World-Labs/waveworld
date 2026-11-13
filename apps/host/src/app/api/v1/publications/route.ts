import { ensureTaskEnv } from '../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  ensureTaskEnv();
  const { json, errorResponse } = await import('@/lib/tasks/http');
  const { requireUser } = await import('../../../../lib/user-auth');
  try {
    const user = await requireUser(req);
    const { listAccessibleProjectIds } = await import('../../../../lib/project-service');
    const projectIds = await listAccessibleProjectIds(user.id, user.workspaceId);
    const { listPublicationsForUser } = await import('@/lib/tasks/publications');
    return json({ publications: listPublicationsForUser(user.id, projectIds) });
  } catch (error) { return errorResponse(error); }
}

/**
 * Create a research publication from succeeded jobs.
 * Residual after wave34: normalizeShareJobIds on jobIds — non-array /
 * non-UUID entries → 400 (not dishonest 404 not-found/not-publishable).
 * Parity shares POST (wave33). Do not claim Lab fully usable while #49 open.
 */
export async function POST(req: Request) {
  ensureTaskEnv();
  const { json, errorResponse, readJson, HttpError } = await import('@/lib/tasks/http');
  const { requireUser } = await import('../../../../lib/user-auth');
  try {
    const user = await requireUser(req);
    const { consumeJobComposeLimit, rateLimitedResponse } = await import('../../../../lib/rate-limit');
    const limited = consumeJobComposeLimit(user.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const body = await readJson<{
      jobIds?: unknown;
      title?: string;
      public?: boolean;
      evidencePolicies?: Record<string, import('@/lib/tasks/publications').EvidencePublicationPolicy>;
    }>(req, 1024 * 1024);
    // Residual after wave34: array + UUID gate before getJob (parity shares
    // normalizeShareJobIds wave33; garbage ids are client errors, not "not found").
    const { normalizeShareJobIds, userMayAccessJob } = await import('../../../../lib/job-sharing');
    const ids = normalizeShareJobIds(body.jobIds);
    const { getJob } = await import('@/lib/tasks/service');
    for (const id of ids) {
      const job = getJob(id);
      if (!job || !await userMayAccessJob(user, job, 'edit')) {
        throw new HttpError(404, `job ${id} not found or not publishable`);
      }
    }
    const { createPublication } = await import('@/lib/tasks/publications');
    const publication = createPublication({
      jobIds: ids,
      title: body.title ?? '',
      public: body.public,
      ownerUserId: user.id,
      evidencePolicies: body.evidencePolicies,
    });
    return json({ publication }, 201);
  } catch (error) { return errorResponse(error); }
}
