import { checkSubmitAuth } from '@/lib/tasks/auth-agent';
import { errorResponse, json } from '@/lib/tasks/http';
import { normalizeJobId } from '@/lib/tasks/job-id';
import { consumeJobCancelLimit, rateLimitedResponse } from '@/lib/tasks/rate-limit';
import { cancelJob, getJob } from '@/lib/tasks/service';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    if (!checkSubmitAuth(req)) {
      return json({ error: 'Invalid or missing x-api-key' }, 401);
    }
    const { id } = await ctx.params;
    const jobId = normalizeJobId(id);
    if (!jobId) return json({ error: 'invalid job id' }, 400);
    const limited = consumeJobCancelLimit(req);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    if (!getJob(jobId)) return json({ error: 'Job not found' }, 404);
    const job = cancelJob(jobId);
    return json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}
