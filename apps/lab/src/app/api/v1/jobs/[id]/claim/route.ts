import { requireAgent } from '@/lib/tasks/auth-agent';
import { errorResponse, json } from '@/lib/tasks/http';
import { normalizeJobId } from '@/lib/tasks/job-id';
import { consumeAgentJobLimit, rateLimitedResponse } from '@/lib/tasks/rate-limit';
import { claimJob } from '@/lib/tasks/service';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const agent = requireAgent(req);
    const { id } = await ctx.params;
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
