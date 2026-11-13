import { ensureTaskEnv } from '../../../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Remove a project model ref (owner/editor).
 * Residual after wave39: normalizeProjectId + normalizeModelId on path —
 * garbage project/model ids → 400 invalid project/model id (not dishonest
 * 404 not-found). addProjectModel issues crypto.randomUUID for model id.
 * Do not claim Lab fully usable while #49 open.
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; modelId: string }> }
) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../../../../lib/user-auth');
  const { removeProjectModel } = await import('../../../../../../../lib/project-service');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const user = await requireUser(req);
    const { consumeProjectWriteLimit, rateLimitedResponse } = await import('../../../../../../../lib/rate-limit');
    const limited = consumeProjectWriteLimit(user.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const {
      normalizeProjectId,
      normalizeModelId,
    } = await import('../../../../../../../lib/job-sharing');
    const params = await ctx.params;
    const projectId = normalizeProjectId(params.id);
    if (!projectId) return json({ error: 'invalid project id' }, 400);
    const modelId = normalizeModelId(params.modelId);
    if (!modelId) return json({ error: 'invalid model id' }, 400);
    const ok = await removeProjectModel(projectId, modelId, user.id);
    if (!ok) return json({ error: 'not found' }, 404);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
