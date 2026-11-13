import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Agent claim by job id.
 * Residual after wave37: normalizeJobId — garbage path ids → 400 invalid job id
 * (not dishonest 409 "not available"). Parity cancel/result path consistency.
 * Claim-by-id shares the global jobClaim bucket so a targeted poll cannot
 * bypass the 240/min cap. The id gate stays ahead of that bucket.
 * Do not claim Lab fully usable while #49 open.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { requireAgent } = await import('@/lib/tasks/auth-agent');
  const { claimJob } = await import('@/lib/tasks/service');
  const { errorResponse, json } = await import('@/lib/tasks/http');
  const { consumeAgentJobLimit, rateLimitedResponse } = await import('@/lib/rate-limit');
  try {
    const agent = requireAgent(req);
    const { id } = await ctx.params;
    const { normalizeJobId } = await import('../../../../../../lib/job-sharing');
    const jobId = normalizeJobId(id);
    if (!jobId) return json({ error: 'invalid job id' }, 400);
    const limited = consumeAgentJobLimit('jobClaim', agent.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const job = claimJob({
      agentId: agent.id,
      capabilities: agent.capabilities,
      jobId,
    });
    if (!job) return json({ error: 'Job not available for claim' }, 409);
    return json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}
