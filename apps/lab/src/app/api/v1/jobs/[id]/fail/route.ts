import { requireJobExecutor } from '@/lib/tasks/auth-agent';
import { errorResponse, HttpError, json, readJson } from '@/lib/tasks/http';
import { normalizeJobId } from '@/lib/tasks/job-id';
import { consumeAgentJobLimit, rateLimitedResponse } from '@/lib/tasks/rate-limit';
import { failJob } from '@/lib/tasks/service';

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
    const limited = consumeAgentJobLimit('jobSettle', agent.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const body = await readJson<{ error?: string; retryable?: boolean }>(req, 256 * 1024);
    if (!body.error) throw new HttpError(400, 'error message required');
    const job = failJob({
      jobId,
      agentId: agent.id,
      error: body.error,
      retryable: body.retryable,
    });
    if (!job) return json({ error: 'Cannot fail this job' }, 409);
    return json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}
