/**
 * GET /api/v1/knowledge/snapshots/counts — K44 by locator_kind; K47 by capture_status.
 * Query: `by=locator_kind` (default, K44) | `by=capture_status` (K47).
 * Public read companion to K19 content-sha reverse index.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const url = new URL(req.url);
    const by = (url.searchParams.get('by') ?? 'locator_kind').toLowerCase();

    if (by === 'capture_status' || by === 'capture' || by === 'status') {
      const { countSnapshotsByCaptureStatusSync } = await import(
        '../../../../../../lib/knowledge-db'
      );
      const counts = countSnapshotsByCaptureStatusSync();
      return json({
        source: 'db',
        by: 'capture_status',
        counts: {
          locator_only: counts.locator_only,
          bytes_captured: counts.bytes_captured,
          other: counts.other,
          total: counts.total,
        },
      });
    }

    const { countSnapshotsByLocatorKindSync } = await import(
      '../../../../../../lib/knowledge-db'
    );
    const counts = countSnapshotsByLocatorKindSync();
    return json({
      source: 'db',
      by: 'locator_kind',
      counts: {
        url: counts.url,
        doi: counts.doi,
        citation: counts.citation,
        other: counts.other,
        total: counts.total,
        unknown: counts.unknown,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
