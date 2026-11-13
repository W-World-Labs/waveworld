/**
 * GET /api/v1/knowledge/edges/products/counts — edge_products totals (K58).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countEdgeProductsSync } = await import(
    '../../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countEdgeProductsSync();
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
