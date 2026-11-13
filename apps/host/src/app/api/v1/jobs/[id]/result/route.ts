import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Load prior compute result by stable job id (no re-solve).
 * GET /api/v1/jobs/:id/result → KPI summary + artifact metas from completed job.
 * Residual after wave36: isPlausibleJobId path gate — garbage path ids → 400
 * invalid job id (not dishonest 404 "Succeeded result not found…"). Parity
 * jobs/[id] GET.
 * Residual after wave37: normalizeJobId (trim + UUID) for cancel/result path
 * consistency with audit/agent subroutes. Do not claim Lab fully usable while
 * #49 open.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { loadSucceededJobResult } = await import('@/lib/tasks/service');
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
    const { consumeJobReadLimit, rateLimitedResponse } = await import('@/lib/rate-limit');
    const agent = authenticateAgent(req.headers.get('authorization'));
    const limited = consumeJobReadLimit(req, agent?.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const { getJob } = await import('@/lib/tasks/service');
    const job = getJob(jobId);
    if (!job) return json({ error: 'Succeeded result not found for this job id' }, 404);
    if (!await requestMayAccessJob(req, job, 'read')) return json({ error: 'Succeeded result not found for this job id' }, 404);
    const loaded = loadSucceededJobResult(jobId);
    if (!loaded) {
      return json({ error: 'Succeeded result not found for this job id' }, 404);
    }
    const { getAuditManifestStatus } = await import('@/lib/tasks/audit-manifest');
    return json({
      jobId: loaded.jobId,
      status: loaded.status,
      specFingerprint: loaded.specFingerprint,
      result: loaded.result,
      artifacts: loaded.artifactMetas,
      audit: getAuditManifestStatus(jobId),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
