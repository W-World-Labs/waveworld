import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Idempotently materialize or repair the canonical audit-manifest artifact.
 * Residual after wave37: normalizeJobId path gate — garbage path ids → 400
 * invalid job id (not dishonest 404 Job not found). Parity jobs/[id] GET +
 * result + cancel (wave36). Do not claim Lab fully usable while #49 open.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureTaskEnv();
  const { getJob } = await import('@/lib/tasks/service');
  const { createAuditManifestArtifact, getAuditManifestStatus, recordAuditFailure } = await import('@/lib/tasks/audit-manifest');
  const { normalizeJobId, requestMayAccessJob } = await import('../../../../../../lib/job-sharing');
  const { json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  try {
    const { id } = await ctx.params;
    // Residual after wave37: format gate + trim before getJob (parity cancel/result).
    const jobId = normalizeJobId(id);
    if (!jobId) return json({ error: 'invalid job id' }, 400);
    const { authenticateAgent } = await import('@/lib/tasks/auth-agent');
    const { consumeJobAuditLimit, rateLimitedResponse } = await import('@/lib/rate-limit');
    const agent = authenticateAgent(req.headers.get('authorization'));
    const limited = consumeJobAuditLimit(req, agent?.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const job = getJob(jobId);
    if (!job || !await requestMayAccessJob(req, job, 'edit')) return json({ error: 'Job not found' }, 404);
    if (job.kind !== 'path-experiment' || job.status !== 'succeeded' || !job.result) throw new HttpError(409, 'audit manifest requires a succeeded path-experiment job');
    try {
      const { artifact, envelope } = createAuditManifestArtifact(job);
      return json({ audit: getAuditManifestStatus(jobId), artifact, manifestSha256: envelope.manifestSha256 });
    } catch (error) {
      recordAuditFailure(jobId, error);
      throw error;
    }
  } catch (error) { return errorResponse(error); }
}
