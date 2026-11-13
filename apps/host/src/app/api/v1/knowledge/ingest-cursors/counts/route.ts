/**
 * GET /api/v1/knowledge/ingest-cursors/counts — ingest_cursors totals (K60).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countIngestCursorsSync } = await import(
    '../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countIngestCursorsSync();
    return json({
      source: 'db',
      counts: {
        total: counts.total,
        withCursor: counts.withCursor,
        withoutCursor: counts.withoutCursor,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
