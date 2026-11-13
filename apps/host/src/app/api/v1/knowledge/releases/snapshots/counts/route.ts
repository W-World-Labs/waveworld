/**
 * GET /api/v1/knowledge/releases/snapshots/counts — release_snapshots totals (K54).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countReleaseSnapshotsSync } = await import(
    '../../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countReleaseSnapshotsSync();
    return json({
      source: 'db',
      counts: {
        total: counts.total,
        distinctReleases: counts.distinctReleases,
        distinctSnapshots: counts.distinctSnapshots,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
