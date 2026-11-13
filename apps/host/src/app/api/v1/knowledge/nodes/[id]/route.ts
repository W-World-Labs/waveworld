/**
 * GET /api/v1/knowledge/nodes/:id
 */
export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { getKnowledgeNode } = await import('../../../../../../lib/knowledge-db');
  const { json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  try {
    const params = await Promise.resolve(ctx.params);
    const id = decodeURIComponent(params.id);
    const node = getKnowledgeNode(id);
    if (!node) throw new HttpError(404, `node not found: ${id}`);
    return json({ source: 'db', item: node });
  } catch (err) {
    return errorResponse(err);
  }
}
