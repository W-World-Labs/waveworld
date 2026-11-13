/**
 * GET /api/v1/knowledge/releases/latest
 * Query: include=claims for full released claim bodies.
 */
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { getLatestKnowledgeRelease } = await import(
    '../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  try {
    const url = new URL(req.url);
    const include = (url.searchParams.get('include') ?? '').toLowerCase();
    const includeClaims =
      include.includes('claim') ||
      url.searchParams.get('includeClaims') === '1' ||
      url.searchParams.get('includeClaims') === 'true';
    const release = getLatestKnowledgeRelease({ includeClaims });
    if (!release) throw new HttpError(404, 'no knowledge releases');
    return json({ source: 'db', item: release });
  } catch (err) {
    return errorResponse(err);
  }
}
