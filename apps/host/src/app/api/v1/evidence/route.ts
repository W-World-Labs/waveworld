import { ensureTaskEnv } from '../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/** Restore a user's personal evidence and evidence from every readable project. */
export async function GET(req: Request) {
  ensureTaskEnv();
  const { json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  const { resolveUser } = await import('../../../../lib/user-auth');
  try {
    const user = await resolveUser(req);
    if (!user) throw new HttpError(401, 'user authentication required');
    const url = new URL(req.url);
    const requestedLimit = Number(url.searchParams.get('limit') ?? 100);
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 100;
    const { listAccessibleProjectIds } = await import('../../../../lib/project-service');
    const projectIds = await listAccessibleProjectIds(user.id, user.workspaceId);
    const { listEvidence } = await import('@/lib/tasks/evidence');
    return json({ evidence: listEvidence({ ownerUserId: user.id, projectIds, limit }) });
  } catch (error) {
    return errorResponse(error);
  }
}
