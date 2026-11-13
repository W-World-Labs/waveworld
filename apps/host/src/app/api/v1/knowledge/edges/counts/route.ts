/**
 * GET /api/v1/knowledge/edges/counts — K42 by status; K48 by efficiency_kind.
 * Query: `by=status` (default) | `by=efficiency_kind`.
 * Public read companion to edge list filters (K37).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const url = new URL(req.url);
    const by = (url.searchParams.get('by') ?? 'status').toLowerCase();

    if (
      by === 'efficiency_kind' ||
      by === 'efficiency' ||
      by === 'kind'
    ) {
      const { countEdgesByEfficiencyKindSync } = await import(
        '../../../../../../lib/knowledge-db'
      );
      const counts = countEdgesByEfficiencyKindSync();
      return json({
        source: 'db',
        by: 'efficiency_kind',
        counts: {
          conversion: counts.conversion,
          transport: counts.transport,
          other: counts.other,
          total: counts.total,
        },
      });
    }

    const { countEdgesByStatusSync } = await import(
      '../../../../../../lib/knowledge-db'
    );
    const counts = countEdgesByStatusSync();
    return json({
      source: 'db',
      by: 'status',
      counts: {
        active: counts.active,
        inactive: counts.inactive,
        total: counts.total,
        other: counts.other,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
