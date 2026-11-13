import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';
import { withRadarRoute } from '@/lib/radar-telemetry';

export const runtime = 'nodejs';

/**
 * Agent progress by job id (heartbeat with body progress).
 * Residual after wave37: normalizeJobId — garbage path ids → 400 invalid job id
 * before service throw. Parity cancel/result path consistency.
 * Do not claim Lab fully usable while #49 open.
 */
async function progressJobRoute(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { requireAgent } = await import('@/lib/tasks/auth-agent');
  const { heartbeatJob } = await import('@/lib/tasks/service');
  const { errorResponse, json, readJson } = await import('@/lib/tasks/http');
  try {
    const { id } = await ctx.params;
    const { normalizeJobId } = await import('../../../../../../lib/job-sharing');
    const jobId = normalizeJobId(id);
    if (!jobId) return json({ error: 'invalid job id' }, 400);
    const agent = requireAgent(req);
    const { consumeAgentJobLimit, rateLimitedResponse } = await import('@/lib/rate-limit');
    const rl = consumeAgentJobLimit('jobHeartbeat', agent.id);
    if (!rl.ok) return rateLimitedResponse(rl.retryAfterSec);
    const body = await readJson<Partial<import('@/types/task').JobProgress>>(req, 1024 * 1024);
    const job = heartbeatJob({
      jobId,
      agentId: agent.id,
      progress: body,
    });
    return json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}

const progressJobWithRadar = withRadarRoute('POST', '/api/v1/jobs/:id/progress', progressJobRoute);
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return progressJobWithRadar(req, ctx);
}
