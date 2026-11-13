/**
 * GET /api/v1/knowledge/conflicts — public conflict_sets list (K17 + K31).
 * Query: limit, offset, q, state=open|resolved|all (default all), subject|subjectId
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

export async function GET(req: Request) {
  const { listKnowledgeConflictSets } = await import('../../../../../lib/knowledge-db');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const url = new URL(req.url);
    const stateRaw = (url.searchParams.get('state') ?? 'all').trim().toLowerCase();
    const state =
      stateRaw === 'open' || stateRaw === 'resolved' || stateRaw === 'all'
        ? (stateRaw as 'open' | 'resolved' | 'all')
        : 'all';
    const result = listKnowledgeConflictSets({
      q: url.searchParams.get('q') ?? undefined,
      state,
      subjectId:
        url.searchParams.get('subject') ??
        url.searchParams.get('subjectId') ??
        undefined,
      limit: parseIntParam(url.searchParams.get('limit'), 50),
      offset: parseIntParam(url.searchParams.get('offset'), 0),
    });
    return json({
      source: 'db',
      state: result.state,
      items: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
