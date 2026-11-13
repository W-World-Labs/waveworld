import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';
import { withRadarRoute } from '@/lib/radar-telemetry';

export const runtime = 'nodejs';

/**
 * Agent heartbeat by job id.
 * Residual after wave37: normalizeJobId — garbage path ids → 400 invalid job id
 * before service throw. Parity cancel/result path consistency.
 * Do not claim Lab fully usable while #49 open.
 */
async function heartbeatJobRoute(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { requireJobExecutor } = await import('@/lib/tasks/auth-agent');
  const { heartbeatJob } = await import('@/lib/tasks/service');
  const { errorResponse, json, HttpError, readJson } = await import('@/lib/tasks/http');
  try {
    const { id } = await ctx.params;
    const { normalizeJobId } = await import('../../../../../../lib/job-sharing');
    const jobId = normalizeJobId(id);
    if (!jobId) return json({ error: 'invalid job id' }, 400);
    const agent = await requireJobExecutor(req, jobId);
    const { consumeAgentJobLimit, rateLimitedResponse } = await import('@/lib/rate-limit');
    const rl = consumeAgentJobLimit('jobHeartbeat', agent.id);
    if (!rl.ok) return rateLimitedResponse(rl.retryAfterSec);
    let progress: import('@/types/task').JobProgress | undefined;
    try {
      const body = await readJson<{ progress?: import('@/types/task').JobProgress }>(req, 1024 * 1024);
      progress = body?.progress;
    } catch (err) {
      if (err instanceof HttpError && err.status === 413) throw err;
      /* empty */
    }
    const job = heartbeatJob({
      jobId,
      agentId: agent.id,
      progress,
    });
    return json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}

const heartbeatJobWithRadar = withRadarRoute('POST', '/api/v1/jobs/:id/heartbeat', heartbeatJobRoute);
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return heartbeatJobWithRadar(req, ctx);
}
