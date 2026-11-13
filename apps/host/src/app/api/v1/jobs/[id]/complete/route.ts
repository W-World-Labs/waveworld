import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';
import { withRadarRoute } from '@/lib/radar-telemetry';

export const runtime = 'nodejs';

/**
 * Agent complete by job id.
 * Residual after wave37: normalizeJobId — garbage path ids → 400 invalid job id
 * (not dishonest 409). Parity cancel/result path consistency.
 * Do not claim Lab fully usable while #49 open.
 */
async function completeJobRoute(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { requireJobExecutor } = await import('@/lib/tasks/auth-agent');
  const { completeJob } = await import('@/lib/tasks/service');
  const { errorResponse, HttpError, json, readJson } = await import('@/lib/tasks/http');
  const validateMod = await import('@/lib/tasks/validate-result');
  // Dynamic import + assertion functions need an explicit type (TS assertion call rule).
  const validateJobResult: (result: unknown) => void = validateMod.validateJobResult;
  const { ResultValidationError } = validateMod;
  const { consumeAgentJobLimit, rateLimitedResponse } = await import('@/lib/rate-limit');
  try {
    const { id } = await ctx.params;
    const { normalizeJobId } = await import('../../../../../../lib/job-sharing');
    const jobId = normalizeJobId(id);
    if (!jobId) return json({ error: 'invalid job id' }, 400);
    const agent = await requireJobExecutor(req, jobId);
    const limited = consumeAgentJobLimit('jobSettle', agent.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const body = await readJson<{ result: import('@/types/task').JobResultV1; attempt?: number }>(req, 64 * 1024 * 1024);
    if (!body.result) {
      throw new HttpError(400, 'result with schemaVersion 1 required');
    }
    if (body.attempt !== undefined && (!Number.isSafeInteger(body.attempt) || body.attempt < 0)) {
      throw new HttpError(400, 'attempt must be a nonnegative safe integer');
    }
    try {
      validateJobResult(body.result);
    } catch (e) {
      if (e instanceof ResultValidationError) throw new HttpError(400, e.message);
      throw e;
    }
    const job = completeJob({
      jobId,
      agentId: agent.id,
      attempt: body.attempt,
      result: body.result,
    });
    if (!job) return json({ error: 'Cannot complete this job' }, 409);
    return json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}

const completeJobWithRadar = withRadarRoute('POST', '/api/v1/jobs/:id/complete', completeJobRoute);
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return completeJobWithRadar(req, ctx);
}
