/**
 * GET /api/v1/knowledge/counts — aggregate inventory (K61 close-checklist).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countKnowledgeInventorySync } = await import(
    '@ww/lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countKnowledgeInventorySync();
    return json({
      source: 'db',
      counts,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
