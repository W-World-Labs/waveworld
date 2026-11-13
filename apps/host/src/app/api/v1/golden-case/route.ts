import { ensureTaskEnv } from '../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../lib/user-auth');
  const { getGoldenCaseStatus } = await import('../../../../lib/golden-case-service');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try { return json(await getGoldenCaseStatus(await requireUser(req))); }
  catch (error) { return errorResponse(error); }
}

export async function POST(req: Request) {
  ensureTaskEnv();
  const { requireUser } = await import('../../../../lib/user-auth');
  const { advanceGoldenCase } = await import('../../../../lib/golden-case-service');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const user = await requireUser(req);
    // Advance composes evidence imports, jobs, a comparison and a publication;
    // shed a repeat loop before any of that work starts.
    const { consumeGoldenCaseAdvanceLimit, rateLimitedResponse } = await import('../../../../lib/rate-limit');
    const limited = consumeGoldenCaseAdvanceLimit(user.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    return json(await advanceGoldenCase(user));
  } catch (error) { return errorResponse(error); }
}
