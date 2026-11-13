/**
 * GET /api/v1/knowledge/claims/:id — single claim by id (K32).
 *
 * Ops/promote companion to K27 list. Requires registration key (not public
 * Atlas path — candidates must not leak to unauthenticated clients).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireKnowledgeRegistrationKey } from '../../../../../../lib/knowledge-write-auth';

function requireRegistrationKey(req: Request): Response | null {
  return requireKnowledgeRegistrationKey(
    req,
    'claims get requires AGENT_REGISTRATION_KEY or TASK_API_KEY on host',
  );
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const authFail = requireRegistrationKey(req);
  if (authFail) return authFail;

  const { getClaimSync } = await import('../../../../../../lib/knowledge-db');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const params = await Promise.resolve(ctx.params);
    const id = params?.id?.trim();
    if (!id) return json({ error: 'missing id' }, 400);
    if (id.includes('/') || id.includes('\\') || id.includes('..')) {
      return json({ error: 'invalid id' }, 400);
    }
    const item = getClaimSync(id);
    if (!item) return json({ error: 'not found' }, 404);
    return json({ source: 'db', item });
  } catch (err) {
    return errorResponse(err);
  }
}
