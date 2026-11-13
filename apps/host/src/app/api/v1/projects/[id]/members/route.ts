import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Upsert project member (owner-administered).
 * Residual after wave39: normalizeProjectId on path — garbage → 400 invalid
 * project id (not dishonest 404 project not found from service).
 * Do not claim Lab fully usable while #49 open.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../../../lib/user-auth');
  const { upsertProjectMember } = await import('../../../../../../lib/project-service');
  const { errorResponse, json, readJson } = await import('@/lib/tasks/http');
  try {
    const user = await requireUser(req);
    const { consumeProjectWriteLimit, rateLimitedResponse } = await import('../../../../../../lib/rate-limit');
    const limited = consumeProjectWriteLimit(user.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const { normalizeProjectId } = await import('../../../../../../lib/job-sharing');
    const projectId = normalizeProjectId((await ctx.params).id);
    if (!projectId) return json({ error: 'invalid project id' }, 400);
    const body = await readJson<import('../../../../../../lib/project-types').UpsertProjectMemberInput>(req, 256 * 1024);
    return json({ member: await upsertProjectMember(projectId, user.id, body) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
