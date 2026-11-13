import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * List jobs for a project + attach job body { jobId }.
 * Residual after wave38: normalizeProjectId on path + normalizeJobId on body.jobId
 * — garbage → 400 invalid project/job id (not dishonest 404 not-found/forbidden).
 * Parity shares/publications/jobs path gates. Do not claim Lab fully usable while #49 open.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../../../lib/user-auth');
  const { canAccessProject, listJobsForProject } = await import(
    '../../../../../../lib/project-service'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const user = await requireUser(req);
    const { normalizeProjectId } = await import('../../../../../../lib/job-sharing');
    const projectId = normalizeProjectId((await ctx.params).id);
    if (!projectId) return json({ error: 'invalid project id' }, 400);
    const role = await canAccessProject(projectId, user.id, user.workspaceId);
    if (!role) return json({ error: 'forbidden' }, 404);
    const rows = await listJobsForProject(projectId);
    // Parse job rows to public shape
    const jobs = rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        kind: row.kind,
        createdBy: row.created_by,
        projectId: row.project_id,
        result: row.result ? JSON.parse(String(row.result)) : null,
        progress: row.progress ? JSON.parse(String(row.progress)) : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
    return json({ jobs });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../../../lib/user-auth');
  const { attachJobToProject } = await import('../../../../../../lib/project-service');
  const { json, errorResponse, readJson, HttpError } = await import('@/lib/tasks/http');
  try {
    const user = await requireUser(req);
    const { consumeProjectWriteLimit, rateLimitedResponse } = await import('../../../../../../lib/rate-limit');
    const limited = consumeProjectWriteLimit(user.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const {
      normalizeProjectId,
      normalizeJobId,
    } = await import('../../../../../../lib/job-sharing');
    const projectId = normalizeProjectId((await ctx.params).id);
    if (!projectId) return json({ error: 'invalid project id' }, 400);
    const body = await readJson<{ jobId?: string }>(req, 64 * 1024);
    if (body.jobId == null || body.jobId === '') {
      throw new HttpError(400, 'jobId required');
    }
    // Residual after wave38: garbage jobId is client error, not attach 404 "job not found".
    const jobId = normalizeJobId(body.jobId);
    if (!jobId) return json({ error: 'invalid job id' }, 400);
    await attachJobToProject(projectId, jobId, user.id);
    return json({ ok: true, projectId, jobId });
  } catch (err) {
    return errorResponse(err);
  }
}
