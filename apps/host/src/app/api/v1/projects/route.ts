import { ensureTaskEnv } from '../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../lib/user-auth');
  const { listProjectsForUser } = await import('../../../../lib/project-service');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const status = (url.searchParams.get('status') as 'active' | 'archived' | null) ?? 'active';
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const projects = await listProjectsForUser({
      userId: user.id,
      workspaceId: user.workspaceId,
      status: status === 'archived' ? 'archived' : 'active',
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return json({ projects });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../lib/user-auth');
  const { createProject } = await import('../../../../lib/project-service');
  const { json, errorResponse, readJson, HttpError } = await import('@/lib/tasks/http');
  try {
    const user = await requireUser(req);
    const { consumeProjectCreateLimit, rateLimitedResponse } = await import('../../../../lib/rate-limit');
    const limited = consumeProjectCreateLimit(user.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const body = await readJson<{
      name?: string;
      description?: string;
      visibility?: 'private' | 'workspace';
      settings?: Record<string, unknown>;
      workspaceId?: string;
    }>(req, 256 * 1024);
    if (!body.name?.trim()) throw new HttpError(400, 'name is required');
    const project = await createProject(
      { id: user.id, workspaceId: user.workspaceId, name: user.name },
      {
        name: body.name,
        description: body.description,
        visibility: body.visibility,
        settings: body.settings as import('../../../../lib/project-types').ProjectSettings | undefined,
        workspaceId: body.workspaceId,
      }
    );
    return json({ project }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
