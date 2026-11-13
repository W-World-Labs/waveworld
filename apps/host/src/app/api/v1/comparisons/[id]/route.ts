import { ensureTaskEnv } from '../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Path-comparison detail by id.
 * Residual after wave40: normalizeComparisonId path gate — garbage path ids → 400
 * invalid comparison id (not dishonest 404 "comparison not found").
 * createPathComparison issues randomUUID. Do not claim Lab fully usable while #49 open.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureTaskEnv();
  const { errorResponse, json } = await import('@/lib/tasks/http');
  try {
    const { resolveUser } = await import('../../../../../lib/user-auth');
    const user = await resolveUser(req);
    if (!user) return json({ error: 'user authentication required' }, 401);
    const { id } = await ctx.params;
    const { normalizeComparisonId } = await import('../../../../../lib/job-sharing');
    const comparisonId = normalizeComparisonId(id);
    if (!comparisonId) return json({ error: 'invalid comparison id' }, 400);
    const { getPathComparison } = await import('@/lib/tasks/path-comparison');
    const comparison = await getPathComparison({ user, id: comparisonId });
    if (!comparison) return json({ error: 'comparison not found' }, 404);
    return json({ comparison });
  } catch (error) {
    return errorResponse(error);
  }
}
