import { requireJobExecutor } from '@/lib/tasks/auth-agent';
import { errorResponse, HttpError, json, readJson } from '@/lib/tasks/http';
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
    const agent = await requireJobExecutor(req, jobId);
    const limited = consumeAgentJobLimit('jobHeartbeat', agent.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    let progress: Partial<JobProgress> | undefined;
    try {
      const body = await readJson<{ progress?: Partial<JobProgress> }>(req, 1024 * 1024);
      progress = body?.progress;
    } catch (err) {
      if (err instanceof HttpError && err.status === 413) throw err;
      /* empty body ok */
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
