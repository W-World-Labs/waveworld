/**
 * GET /api/v1/knowledge/conflicts/counts — open/resolved totals (K40).
 * Public read companion to K31 list-by-state.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countConflictsByStateSync } = await import(
    '../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countConflictsByStateSync();
    return json({
      source: 'db',
      counts: {
        open: counts.open,
        resolved: counts.resolved,
        total: counts.total,
        other: counts.other,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
