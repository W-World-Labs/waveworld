/**
 * POST /api/v1/knowledge/conflicts/:id/reopen — reopen resolved conflict (K39).
 * Clears resolution_note; sets state=open. Registration key required.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireKnowledgeRegistrationKey } from '../../../../../../../lib/knowledge-write-auth';

function requireRegistrationKey(req: Request): Response | null {
  return requireKnowledgeRegistrationKey(
    req,
    'conflict reopen requires AGENT_REGISTRATION_KEY or TASK_API_KEY on host',
  );
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const authFail = requireRegistrationKey(req);
  if (authFail) return authFail;

  const { reopenConflictSync } = await import(
    '../../../../../../../lib/knowledge-db'
  );
  const { json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  try {
    const params = await Promise.resolve(ctx.params);
    const id = params?.id?.trim() ?? '';
    if (!id) throw new HttpError(400, 'missing id');
    try {
      const result = reopenConflictSync(id);
      return json({
        source: 'db',
        ok: true,
        conflictId: result.conflictId,
        previousState: result.previousState,
        state: result.state,
        changed: result.changed,
        item: result.item,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('invalid:')) {
        throw new HttpError(400, msg.replace(/^invalid:\s*/i, '') || msg);
      }
      throw e;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
