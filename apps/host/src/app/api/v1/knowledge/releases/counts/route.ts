/**
 * GET /api/v1/knowledge/releases/counts — totals + export presence (K45).
 * Public read companion to releases list / K38 q filter.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countReleasesSync } = await import(
    '../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countReleasesSync();
    return json({
      source: 'db',
      counts: {
        total: counts.total,
        withExport: counts.withExport,
        withoutExport: counts.withoutExport,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
