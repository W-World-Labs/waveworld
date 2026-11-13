/**
 * GET /api/v1/knowledge/conflicts/:id — conflict set detail (K17).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { getKnowledgeConflictSet } = await import('../../../../../../lib/knowledge-db');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const params = await Promise.resolve(ctx.params);
    const id = params?.id?.trim();
    if (!id) return json({ error: 'missing id' }, 400);
    const item = getKnowledgeConflictSet(id);
    if (!item) return json({ error: 'not found' }, 404);
    return json({ source: 'db', item });
  } catch (err) {
    return errorResponse(err);
  }
}
