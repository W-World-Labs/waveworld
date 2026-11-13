import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';
import { withRadarRoute } from '@/lib/radar-telemetry';

export const runtime = 'nodejs';

async function getAttemptOutcome(req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureTaskEnv();
  const { json } = await import('@/lib/tasks/http');
  try {
    const { id } = await ctx.params;
    const { normalizeJobId } = await import('../../../../../../lib/job-sharing');
    const jobId = normalizeJobId(id);
    const { authenticateAgent } = await import('@/lib/tasks/auth-agent');
    const agent = authenticateAgent(req.headers.get('authorization'));
    if (!jobId || !agent) return json({ error: 'Host outcome not found' }, 404);

    const rawAttempt = new URL(req.url).searchParams.get('attempt');
    if (rawAttempt === null || !/^(0|[1-9]\d*)$/.test(rawAttempt)) {
      return json({ error: 'Host outcome not found' }, 404);
    }
    const attempt = Number(rawAttempt);
    if (!Number.isSafeInteger(attempt)) return json({ error: 'Host outcome not found' }, 404);

    const { consumeJobReadLimit, rateLimitedResponse } = await import('@/lib/rate-limit');
    const limited = consumeJobReadLimit(req, agent.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const { getSqlite } = await import('@/lib/tasks/db');
    const { requeueExpiredLeases } = await import('@/lib/tasks/service');
    requeueExpiredLeases();
    const { readAttemptOutcome } = await import('@/lib/tasks/job-outcomes');
    const receipt = readAttemptOutcome(getSqlite(), { jobId, attempt, agentId: agent.id });
    if (!receipt) return json({ error: 'Host outcome not found' }, 404);
    return json({ attempt, outcome: receipt });
  } catch {
    // Do not reveal whether a job, a different agent's lease, or an attempt exists.
    const { json } = await import('@/lib/tasks/http');
    return json({ error: 'Unable to read Host outcome' }, 500);
  }
}

const getAttemptOutcomeWithRadar = withRadarRoute('GET', '/api/v1/jobs/:id/outcome', getAttemptOutcome);
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return getAttemptOutcomeWithRadar(req, ctx);
}
