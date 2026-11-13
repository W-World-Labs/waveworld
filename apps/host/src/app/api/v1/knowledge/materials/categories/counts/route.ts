/**
 * GET /api/v1/knowledge/materials/categories/counts — material_categories (K59).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countMaterialCategoriesSync } = await import(
    '../../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countMaterialCategoriesSync();
    return json({
      source: 'db',
      counts: {
        total: counts.total,
        withMaterials: counts.withMaterials,
        empty: counts.empty,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
