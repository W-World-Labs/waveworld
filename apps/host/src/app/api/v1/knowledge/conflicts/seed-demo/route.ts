/**
 * POST /api/v1/knowledge/conflicts/seed-demo — idempotent K18/K20 demo conflict seed (K21).
 * Requires agent registration key (same as AGENT_REGISTRATION_KEY / TASK_API_KEY)
 * or is a no-op 401 without key. Used by ops / advance loop; not public write.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireKnowledgeRegistrationKey } from '../../../../../../lib/knowledge-write-auth';

export async function POST(req: Request) {
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const authFail = requireKnowledgeRegistrationKey(
      req,
      'demo conflict seed requires AGENT_REGISTRATION_KEY or TASK_API_KEY on host',
    );
    if (authFail) return authFail;

    const { seedDemoConflictSetsSync } = await import(
      '../../../../../../lib/knowledge-db'
    );
    const result = seedDemoConflictSetsSync();
    return json({
      source: 'db',
      ok: true,
      created: result.created,
      conflictId: result.conflictId,
      conflictIds: result.conflictIds,
      createdById: result.createdById,
      claimIds: result.claimIds,
      dbPath: result.dbPath,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
