/**
 * GET /api/v1/knowledge/claims — list claims by state (K27).
 *
 * Ops/promote companion to K26. Requires registration key (not public Atlas
 * path — candidates must not leak to unauthenticated clients).
 *
 * Query: state=candidate|validated|quarantine|released|all (default candidate),
 *        kind, subjectId, q, limit, offset
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireKnowledgeRegistrationKey } from '../../../../../lib/knowledge-write-auth';

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function requireRegistrationKey(req: Request): Response | null {
  return requireKnowledgeRegistrationKey(
    req,
    'claims list requires AGENT_REGISTRATION_KEY or TASK_API_KEY on host',
  );
}

export async function GET(req: Request) {
  const authFail = requireRegistrationKey(req);
  if (authFail) return authFail;

  const { listClaimsSync } = await import('../../../../../lib/knowledge-db');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const url = new URL(req.url);
    const stateRaw = (url.searchParams.get('state') ?? 'candidate').trim();
    const allowed = new Set([
      'candidate',
      'quarantine',
      'validated',
      'released',
      'all',
    ]);
    const state = allowed.has(stateRaw) ? stateRaw : 'candidate';
    const result = listClaimsSync({
      state: state as 'candidate' | 'quarantine' | 'validated' | 'released' | 'all',
      kind: url.searchParams.get('kind') ?? undefined,
      subjectId:
        url.searchParams.get('subjectId') ??
        url.searchParams.get('subject') ??
        undefined,
      q: url.searchParams.get('q') ?? undefined,
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
