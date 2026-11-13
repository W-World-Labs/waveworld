/**
 * GET /api/v1/knowledge/releases/bindings/counts — release_bindings totals (K55).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countReleaseBindingsSync } = await import(
    '../../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countReleaseBindingsSync();
    return json({
      source: 'db',
      counts: {
        total: counts.total,
        distinctReleases: counts.distinctReleases,
        distinctBindings: counts.distinctBindings,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
