/**
 * GET /api/v1/knowledge/releases/conflicts/counts — release_conflicts totals (K56).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countReleaseConflictsSync } = await import(
    '../../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countReleaseConflictsSync();
    return json({
      source: 'db',
      counts: {
        total: counts.total,
        distinctReleases: counts.distinctReleases,
        distinctConflicts: counts.distinctConflicts,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
