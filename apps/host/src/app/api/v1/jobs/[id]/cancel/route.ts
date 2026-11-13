import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';
import { withRadarRoute } from '@/lib/radar-telemetry';

export const runtime = 'nodejs';

/**
 * Cancel a job by id.
 * Residual after wave36: isPlausibleJobId path gate — garbage path ids → 400
 * invalid job id (not dishonest 404 Job not found). Parity jobs/[id] GET +
 * result.
 * Residual after wave37: normalizeJobId (trim + UUID) for cancel/result path
 * consistency with audit/agent subroutes. Do not claim Lab fully usable while
 * #49 open.
 */
async function cancelJobRoute(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { cancelJob, getJob } = await import('@/lib/tasks/service');
  const { errorResponse, json } = await import('@/lib/tasks/http');
  try {
    const { id } = await ctx.params;
    const { normalizeJobId, requestMayAccessJob } = await import(
      '../../../../../../lib/job-sharing'
    );
    // Residual after wave36/37: format gate + trim before getJob (parity jobs/[id] GET).
    const jobId = normalizeJobId(id);
    if (!jobId) return json({ error: 'invalid job id' }, 400);
    const { authenticateAgent } = await import('@/lib/tasks/auth-agent');
    const { consumeJobCancelLimit, rateLimitedResponse } = await import('@/lib/rate-limit');
    const agent = authenticateAgent(req.headers.get('authorization'));
    const limited = consumeJobCancelLimit(req, agent?.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const existing = getJob(jobId);
    if (!existing) return json({ error: 'Job not found' }, 404);
    if (!await requestMayAccessJob(req, existing, 'edit')) {
      return json({ error: 'Job not found' }, 404);
    }
    const job = cancelJob(jobId);
    return json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}

const cancelJobWithRadar = withRadarRoute('POST', '/api/v1/jobs/:id/cancel', cancelJobRoute);
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return cancelJobWithRadar(req, ctx);
}
