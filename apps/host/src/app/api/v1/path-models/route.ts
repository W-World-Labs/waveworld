import { ensureTaskEnv } from '../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/** Authenticated catalog of model plugins currently advertised by compute Agents. */
export async function GET(req: Request) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../lib/user-auth');
  const { listPathModelCatalog } = await import('@/lib/tasks/auth-agent');
  const { errorResponse, json } = await import('@/lib/tasks/http');
  try {
    await requireUser(req);
    return json({ models: listPathModelCatalog(), generatedAt: new Date().toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}
