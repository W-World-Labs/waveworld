/**
 * GET /api/v1/knowledge/snapshots — durable reverse index by content_sha256 (C2/K19).
 * Query: sha | contentSha | content_sha256 (required, 64-hex)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const {
    listSourceSnapshotsByContentSha,
  } = await import('../../../../../lib/knowledge-db');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const url = new URL(req.url);
    const sha = (
      url.searchParams.get('sha') ??
      url.searchParams.get('contentSha') ??
      url.searchParams.get('content_sha256') ??
      ''
    ).trim();
    if (!sha) {
      return json(
        { error: 'missing_sha', message: 'query sha|contentSha|content_sha256 required' },
        400,
      );
    }
    if (!/^[a-f0-9]{64}$/i.test(sha)) {
      return json(
        { error: 'invalid_sha', message: 'content sha must be 64 hex chars' },
        400,
      );
    }
    const items = listSourceSnapshotsByContentSha(sha);
    return json({
      source: 'db',
      contentSha256: sha.toLowerCase(),
      items,
      total: items.length,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
