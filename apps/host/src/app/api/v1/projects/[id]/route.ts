import { ensureTaskEnv } from '../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Project detail / update / soft-delete by id.
 * Residual after wave38: normalizeProjectId (createProject → crypto.randomUUID;
 * parity normalizeJobId / normalizeShareId) — garbage path ids → 400 invalid
 * project id (not dishonest 404 not-found/forbidden).
 * Do not claim Lab fully usable while #49 open.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../../lib/user-auth');
  const { canAccessProject, getProjectDetail } = await import(
    '../../../../../lib/project-service'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const user = await requireUser(req);
    const { normalizeProjectId } = await import('../../../../../lib/job-sharing');
    const projectId = normalizeProjectId((await ctx.params).id);
    if (!projectId) return json({ error: 'invalid project id' }, 400);
    const role = await canAccessProject(projectId, user.id, user.workspaceId);
    if (!role) return json({ error: 'project not found or forbidden' }, 404);
    const project = await getProjectDetail(projectId);
    if (!project) return json({ error: 'project not found' }, 404);
    return json({ project, role });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../../lib/user-auth');
  const { updateProject } = await import('../../../../../lib/project-service');
  const { json, errorResponse, readJson } = await import('@/lib/tasks/http');
  try {
    const user = await requireUser(req);
    const { consumeProjectWriteLimit, rateLimitedResponse } = await import('../../../../../lib/rate-limit');
    const limited = consumeProjectWriteLimit(user.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const { normalizeProjectId } = await import('../../../../../lib/job-sharing');
    const projectId = normalizeProjectId((await ctx.params).id);
    if (!projectId) return json({ error: 'invalid project id' }, 400);
    const body = await readJson<import('../../../../../lib/project-types').UpdateProjectInput>(req, 256 * 1024);
    const project = await updateProject(projectId, user.id, body);
    if (!project) return json({ error: 'project not found' }, 404);
    return json({ project });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../../lib/user-auth');
  const { deleteProject } = await import('../../../../../lib/project-service');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const user = await requireUser(req);
    const { consumeProjectWriteLimit, rateLimitedResponse } = await import('../../../../../lib/rate-limit');
    const limited = consumeProjectWriteLimit(user.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const { normalizeProjectId } = await import('../../../../../lib/job-sharing');
    const projectId = normalizeProjectId((await ctx.params).id);
    if (!projectId) return json({ error: 'invalid project id' }, 400);
    const ok = await deleteProject(projectId, user.id);
    if (!ok) return json({ error: 'project not found' }, 404);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
