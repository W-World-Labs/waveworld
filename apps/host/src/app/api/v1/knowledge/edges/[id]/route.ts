/**
 * GET /api/v1/knowledge/edges/:id — detail with released efficiency claims (default).
 * Query: embed=0 to omit claims.
 */
export const runtime = 'nodejs';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { getKnowledgeEdge } = await import('../../../../../../lib/knowledge-db');
  const { json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  try {
    const params = await Promise.resolve(ctx.params);
    const id = decodeURIComponent(params.id);
    const url = new URL(req.url);
    const embedRaw = url.searchParams.get('embed');
    const embed =
      embedRaw == null ||
      embedRaw === '' ||
      !['0', 'false', 'none', 'off'].includes(embedRaw.toLowerCase());
    const edge = getKnowledgeEdge(id, { embedReleasedClaims: embed });
    if (!edge) throw new HttpError(404, `edge not found: ${id}`);
    return json({ source: 'db', item: edge });
  } catch (err) {
    return errorResponse(err);
  }
}
