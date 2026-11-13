/**
 * GET /api/v1/knowledge/conflicts/members/counts — conflict_members totals (K52).
 * Public read companion to K40 conflicts counts / K31 list.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { countConflictMembersSync } = await import(
    '../../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const counts = countConflictMembersSync();
    return json({
      source: 'db',
      counts: {
        total: counts.total,
        conflictsWithMembers: counts.conflictsWithMembers,
        distinctClaims: counts.distinctClaims,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
