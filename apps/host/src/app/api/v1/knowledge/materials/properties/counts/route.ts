/**
 * GET /api/v1/knowledge/materials/properties/counts — material_properties totals (K50).
 * Public read companion to materials list / K41.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countMaterialPropertiesSync } = await import(
    '../../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countMaterialPropertiesSync();
    return json({
      source: 'db',
      counts: {
        total: counts.total,
        withNumeric: counts.withNumeric,
        textOnly: counts.textOnly,
        distinctKeys: counts.distinctKeys,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
