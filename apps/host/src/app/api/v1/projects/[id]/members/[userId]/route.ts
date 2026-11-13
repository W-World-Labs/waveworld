import { ensureTaskEnv } from '../../../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Remove project member (owner-administered).
 * Residual after wave39: normalizeProjectId on path — garbage → 400 invalid
 * project id (not dishonest 404 project or member not found). Member userId
 * is a principal id (dev_/oidc_…), not a project UUID; empty/invalid principal
 * → 400 invalid user id (parity upsertProjectMember validPrincipalId).
 * Do not claim Lab fully usable while #49 open.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; userId: string }> }) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../../../../lib/user-auth');
  const { removeProjectMember } = await import('../../../../../../../lib/project-service');
  const { errorResponse, json } = await import('@/lib/tasks/http');
  try {
    const user = await requireUser(req);
    const { consumeProjectWriteLimit, rateLimitedResponse } = await import('../../../../../../../lib/rate-limit');
    const limited = consumeProjectWriteLimit(user.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const { normalizeProjectId } = await import('../../../../../../../lib/job-sharing');
    const params = await ctx.params;
    const projectId = normalizeProjectId(params.id);
    if (!projectId) return json({ error: 'invalid project id' }, 400);
    // Principal ids are not UUIDs (dev_/oidc_); refuse empty/garbage path segments.
    const memberUserId = decodeURIComponent(params.userId ?? '').trim();
    if (!memberUserId || !/^[A-Za-z0-9_.:@-]{1,160}$/.test(memberUserId)) {
      return json({ error: 'invalid user id' }, 400);
    }
    const removed = await removeProjectMember(projectId, user.id, memberUserId);
    if (!removed) return json({ error: 'project or member not found' }, 404);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
