import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Add a model ref to a project (owner/editor).
 * Residual after wave39: normalizeProjectId on path — garbage → 400 invalid
 * project id (not dishonest 404 project not found from service).
 * Do not claim Lab fully usable while #49 open.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../../../lib/user-auth');
  const { addProjectModel } = await import('../../../../../../lib/project-service');
  const { json, errorResponse, readJson, HttpError } = await import('@/lib/tasks/http');
  try {
    const user = await requireUser(req);
    const { consumeProjectWriteLimit, rateLimitedResponse } = await import('../../../../../../lib/rate-limit');
    const limited = consumeProjectWriteLimit(user.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const { normalizeProjectId } = await import('../../../../../../lib/job-sharing');
    const projectId = normalizeProjectId((await ctx.params).id);
    if (!projectId) return json({ error: 'invalid project id' }, 400);
    const body = await readJson<import('../../../../../../lib/project-types').CreateProjectModelInput>(
      req, 256 * 1024
    );
    if (!body.name || !body.source) throw new HttpError(400, 'name and source required');
    const model = await addProjectModel(projectId, user.id, body);
    return json({ model }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
