/**
 * GET /api/v1/knowledge/releases/:id
 * Query: include=claims for released claim bodies (public = released only).
 */
export const runtime = 'nodejs';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const {
    getKnowledgeRelease,
    getLatestKnowledgeRelease,
  } = await import('../../../../../../lib/knowledge-db');
  const { json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  try {
    const params = await Promise.resolve(ctx.params);
    const id = decodeURIComponent(params.id);
    const url = new URL(req.url);
    const include = (url.searchParams.get('include') ?? '').toLowerCase();
    const includeClaims =
      include.includes('claim') ||
      url.searchParams.get('includeClaims') === '1' ||
      url.searchParams.get('includeClaims') === 'true';

    if (id === 'latest') {
      const release = getLatestKnowledgeRelease({ includeClaims });
      if (!release) throw new HttpError(404, 'no knowledge releases');
      return json({ source: 'db', item: release });
    }

    const release = getKnowledgeRelease(id, { includeClaims });
    if (!release) throw new HttpError(404, `release not found: ${id}`);
    return json({ source: 'db', item: release });
  } catch (err) {
    return errorResponse(err);
  }
}
