/**
 * GET /api/v1/knowledge/materials/:id — includes material_properties by default.
 */
export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { getKnowledgeMaterial } = await import('../../../../../../lib/knowledge-db');
  const { json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  try {
    const params = await Promise.resolve(ctx.params);
    const id = decodeURIComponent(params.id);
    const material = getKnowledgeMaterial(id, { includeProperties: true });
    if (!material) throw new HttpError(404, `material not found: ${id}`);
    return json({ source: 'db', item: material });
  } catch (err) {
    return errorResponse(err);
  }
}
