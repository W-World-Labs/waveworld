/**
 * POST /api/v1/knowledge/conflicts/:id/resolve — close open conflict (K30).
 * Body: { resolutionNote | note }
 * Registration key required.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireKnowledgeRegistrationKey } from '../../../../../../../lib/knowledge-write-auth';

function requireRegistrationKey(req: Request): Response | null {
  return requireKnowledgeRegistrationKey(
    req,
    'conflict resolve requires AGENT_REGISTRATION_KEY or TASK_API_KEY on host',
  );
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const authFail = requireRegistrationKey(req);
  if (authFail) return authFail;

  const {
    normalizeResolveConflictInput,
    resolveConflictSync,
  } = await import('../../../../../../../lib/knowledge-db');
  const { json, errorResponse, HttpError, readJson } = await import('@/lib/tasks/http');
  try {
    const params = await Promise.resolve(ctx.params);
    const id = params?.id?.trim() ?? '';
    let body: unknown;
    try {
      body = await readJson(req, 4 * 1024 * 1024);
    } catch (err) {
      if (err instanceof HttpError && err.status === 413) throw err;
      throw new HttpError(400, 'invalid JSON body');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'body must be a JSON object');
    }

    let input;
    try {
      input = normalizeResolveConflictInput(id, body as Record<string, unknown>);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpError(400, msg.replace(/^invalid:\s*/i, '') || msg);
    }

    const result = resolveConflictSync(input);
    return json({
      source: 'db',
      ok: true,
      conflictId: result.conflictId,
      previousState: result.previousState,
      state: result.state,
      changed: result.changed,
      resolutionNote: result.resolutionNote,
      item: result.item,
      dbPath: result.dbPath,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
