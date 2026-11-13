/**
 * GET /api/v1/knowledge/evidence-bindings/counts — totals by support (K51).
 * Public read companion to evidence bindings / claims.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countEvidenceBindingsBySupportSync } = await import(
    '../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countEvidenceBindingsBySupportSync();
    return json({
      source: 'db',
      counts: {
        supports: counts.supports,
        refutes: counts.refutes,
        context: counts.context,
        other: counts.other,
        total: counts.total,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
