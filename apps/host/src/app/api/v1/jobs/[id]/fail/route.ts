import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';
import { withRadarRoute } from '@/lib/radar-telemetry';

export const runtime = 'nodejs';

/**
 * Agent fail by job id.
 * Residual after wave37: normalizeJobId — garbage path ids → 400 invalid job id
 * (not dishonest 409). Parity cancel/result path consistency.
 * Fail shares the jobSettle bucket with complete, and the cap is checked
 * before the body is read.
 * Do not claim Lab fully usable while #49 open.
 */
async function failJobRoute(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { requireJobExecutor } = await import('@/lib/tasks/auth-agent');
  const { failJob } = await import('@/lib/tasks/service');
  const { errorResponse, HttpError, json, readJson } = await import('@/lib/tasks/http');
  const { consumeAgentJobLimit, rateLimitedResponse } = await import('@/lib/rate-limit');
  try {
    const { id } = await ctx.params;
    const { normalizeJobId } = await import('../../../../../../lib/job-sharing');
    const jobId = normalizeJobId(id);
    if (!jobId) return json({ error: 'invalid job id' }, 400);
    const agent = await requireJobExecutor(req, jobId);
    const limited = consumeAgentJobLimit('jobSettle', agent.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const body = await readJson<{ error?: string; retryable?: boolean; attempt?: number }>(req, 256 * 1024);
    if (!body.error) throw new HttpError(400, 'error message required');
    if (body.attempt !== undefined && (!Number.isSafeInteger(body.attempt) || body.attempt < 0)) {
      throw new HttpError(400, 'attempt must be a nonnegative safe integer');
    }
    const job = failJob({
      jobId,
      agentId: agent.id,
      attempt: body.attempt,
      error: body.error,
      retryable: body.retryable,
    });
    if (!job) return json({ error: 'Cannot fail this job' }, 409);
    return json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}

const failJobWithRadar = withRadarRoute('POST', '/api/v1/jobs/:id/fail', failJobRoute);
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return failJobWithRadar(req, ctx);
}
