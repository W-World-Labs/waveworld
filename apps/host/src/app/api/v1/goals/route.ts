/**
 * GET /api/v1/goals — goal / loop harness meta (read-only).
 * Does not replace static docs/ paths; exposes inventory + snapshot for tools/UI.
 */
export const runtime = 'nodejs';

export async function GET() {
  const { getGoalLoopMeta } = await import('../../../../lib/goal-loop-meta');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    return json(getGoalLoopMeta());
  } catch (err) {
    return errorResponse(err);
  }
}
