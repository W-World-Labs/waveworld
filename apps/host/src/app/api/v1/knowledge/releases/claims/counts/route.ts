/**
 * GET /api/v1/knowledge/releases/claims/counts — release_claims totals (K53).
 * Public read companion to K45 releases counts / release publish.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countReleaseClaimsSync } = await import(
    '../../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countReleaseClaimsSync();
    return json({
      source: 'db',
      counts: {
        total: counts.total,
        distinctReleases: counts.distinctReleases,
        distinctClaims: counts.distinctClaims,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
