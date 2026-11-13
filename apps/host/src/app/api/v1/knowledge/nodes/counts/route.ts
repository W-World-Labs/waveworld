/**
 * GET /api/v1/knowledge/nodes/counts — roots vs children totals (K43).
 * Public read companion to K36 parentId filter.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countNodesByParentSync } = await import(
    '../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countNodesByParentSync();
    return json({
      source: 'db',
      counts: {
        roots: counts.roots,
        children: counts.children,
        total: counts.total,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
