/**
 * POST /api/v1/knowledge/claims/promote — set claim state (K26 single / K29 batch).
 * Body single: { claimId, state }
 * Body batch:  { claimIds: string[], state }
 * Registration key required. Cannot modify released claims.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireKnowledgeRegistrationKey } from '../../../../../../lib/knowledge-write-auth';

function requireRegistrationKey(req: Request): Response | null {
  return requireKnowledgeRegistrationKey(
    req,
    'claims promote requires AGENT_REGISTRATION_KEY or TASK_API_KEY on host',
  );
}

export async function POST(req: Request) {
  const authFail = requireRegistrationKey(req);
  if (authFail) return authFail;

  const {
    isBatchPromoteBody,
    normalizePromoteClaimBatchInput,
    normalizePromoteClaimInput,
    promoteClaimBatchSync,
    promoteClaimSync,
  } = await import('../../../../../../lib/knowledge-db');
  const { json, errorResponse, HttpError, readJson } = await import('@/lib/tasks/http');
  try {
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
    const raw = body as Record<string, unknown>;

    if (isBatchPromoteBody(raw)) {
      let batch;
      try {
        batch = normalizePromoteClaimBatchInput(raw);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new HttpError(400, msg.replace(/^invalid:\s*/i, '') || msg);
      }
      const result = promoteClaimBatchSync(batch);
      return json({
        source: 'db',
        ok: result.errors.length === 0,
        batch: true,
        state: result.state,
        total: result.total,
        changed: result.changed,
        items: result.items,
        errors: result.errors,
        dbPath: result.dbPath,
      });
    }

    let input;
    try {
      input = normalizePromoteClaimInput(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpError(400, msg.replace(/^invalid:\s*/i, '') || msg);
    }

    const result = promoteClaimSync(input);
    return json({
      source: 'db',
      ok: true,
      batch: false,
      claimId: result.claimId,
      previousState: result.previousState,
      state: result.state,
      changed: result.changed,
      kind: result.kind,
      subjectId: result.subjectId,
      dbPath: result.dbPath,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
