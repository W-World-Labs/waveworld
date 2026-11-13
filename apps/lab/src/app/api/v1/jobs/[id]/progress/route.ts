import { requireAgent } from '@/lib/tasks/auth-agent';
import { errorResponse, json, readJson } from '@/lib/tasks/http';
import { normalizeJobId } from '@/lib/tasks/job-id';
import { consumeAgentJobLimit, rateLimitedResponse } from '@/lib/tasks/rate-limit';
import { heartbeatJob } from '@/lib/tasks/service';
import type { JobProgress } from '@/types/task';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const jobId = normalizeJobId(id);
    if (!jobId) return json({ error: 'invalid job id' }, 400);
    const agent = requireAgent(req);
    const limited = consumeAgentJobLimit('jobHeartbeat', agent.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const body = await readJson<Partial<JobProgress>>(req, 1024 * 1024);
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
