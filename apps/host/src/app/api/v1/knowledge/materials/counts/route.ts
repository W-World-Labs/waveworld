/**
 * GET /api/v1/knowledge/materials/counts — K41 by kind; K49 by fidelity.
 * Query: `by=kind` (default) | `by=fidelity`.
 * Public read companion to K35 kind filter.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const url = new URL(req.url);
    const by = (url.searchParams.get('by') ?? 'kind').toLowerCase();

    if (by === 'fidelity') {
      const { countMaterialsByFidelitySync } = await import(
        '../../../../../../lib/knowledge-db'
      );
      const counts = countMaterialsByFidelitySync();
      return json({
        source: 'db',
        by: 'fidelity',
        counts: {
          quantitative: counts.quantitative,
          qualitative: counts.qualitative,
          unknown: counts.unknown,
          other: counts.other,
          total: counts.total,
        },
      });
    }

    const { countMaterialsByKindSync } = await import(
      '../../../../../../lib/knowledge-db'
    );
    const counts = countMaterialsByKindSync();
    return json({
      source: 'db',
      by: 'kind',
      counts: {
        forcefield_lj: counts.forcefield_lj,
        fluid_continuum: counts.fluid_continuum,
        device_product: counts.device_product,
        other: counts.other,
        total: counts.total,
        unknown: counts.unknown,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
