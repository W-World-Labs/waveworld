/**
 * GET /api/v1/knowledge/edges/devices/counts — edge_devices totals (K57).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countEdgeDevicesSync } = await import(
    '../../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countEdgeDevicesSync();
    return json({
      source: 'db',
      counts: {
        total: counts.total,
        distinctEdges: counts.distinctEdges,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
