import { authenticateAgent } from '@/lib/tasks/auth-agent';
import { errorResponse, json } from '@/lib/tasks/http';
import { normalizeJobId } from '@/lib/tasks/job-id';
import { LAB_JOB_READ_CACHE, mayReadLabJob } from '@/lib/tasks/job-read-gate';
import { consumeJobReadLimit, rateLimitedResponse } from '@/lib/tasks/rate-limit';
import { getJob } from '@/lib/tasks/service';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const jobId = normalizeJobId(id);
    if (!jobId) return json({ error: 'invalid job id' }, 400, LAB_JOB_READ_CACHE);
    const agent = authenticateAgent(req.headers.get('authorization'));
    const limited = consumeJobReadLimit(req, agent?.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const job = getJob(jobId);
    // Same hiding rule as Host: unauthorized and missing are both 404,
    // and the body never carries the record.
    if (!job || !mayReadLabJob(req, job)) {
      return json({ error: 'Job not found' }, 404, LAB_JOB_READ_CACHE);
    }
    return json({ job }, 200, LAB_JOB_READ_CACHE);
  } catch (err) {
    return errorResponse(err);
  }
}
