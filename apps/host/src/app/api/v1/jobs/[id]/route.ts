import { ensureTaskEnv } from '../../../../../lib/ensure-task-env';
import { withRadarRoute } from '@/lib/radar-telemetry';

export const runtime = 'nodejs';

/**
 * Job detail by id.
 * Residual after wave36: isPlausibleJobId path gate — numeric/garbage path ids
 * → 400 invalid job id (not dishonest 404 Job not found). Parity shares DELETE
 * isPlausibleShareId (wave32) + publications publicId (wave35); jobIds body gate
 * already on shares/publications POST (wave33/34).
 * Residual after wave37: normalizeJobId (trim + UUID) so padded path ids resolve
 * consistently; same contract as result/cancel/audit/agent subroutes.
 * Do not claim Lab fully usable while #49 open.
 */
async function getJobRoute(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { getJob } = await import('@/lib/tasks/service');
  const { errorResponse, json } = await import('@/lib/tasks/http');
  try {
    const { id } = await ctx.params;
    const { normalizeJobId, requestMayAccessJob } = await import(
      '../../../../../lib/job-sharing'
    );
    // Residual after wave36/37: format gate + trim before getJob (createJob → UUID).
    const jobId = normalizeJobId(id);
    if (!jobId) return json({ error: 'invalid job id' }, 400);
    const { authenticateAgent } = await import('@/lib/tasks/auth-agent');
    const { consumeJobReadLimit, rateLimitedResponse } = await import('@/lib/rate-limit');
    const agent = authenticateAgent(req.headers.get('authorization'));
    const limited = consumeJobReadLimit(req, agent?.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const job = getJob(jobId);
    if (!job) return json({ error: 'Job not found' }, 404);
    if (!await requestMayAccessJob(req, job, 'read')) return json({ error: 'Job not found' }, 404);
    return json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}

const getJobWithRadar = withRadarRoute('GET', '/api/v1/jobs/:id', getJobRoute);
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return getJobWithRadar(req, ctx);
}
