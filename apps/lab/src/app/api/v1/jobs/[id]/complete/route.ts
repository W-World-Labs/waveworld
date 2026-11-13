import { requireJobExecutor } from '@/lib/tasks/auth-agent';
import { errorResponse, HttpError, json, readJson } from '@/lib/tasks/http';
import { normalizeJobId } from '@/lib/tasks/job-id';
import { consumeAgentJobLimit, rateLimitedResponse } from '@/lib/tasks/rate-limit';
import { completeJob } from '@/lib/tasks/service';
import { ResultValidationError, validateJobResult as validateJobResultAssert } from '@/lib/tasks/validate-result';
import type { JobResultV1 } from '@/types/task';

export const runtime = 'nodejs';

// Explicit annotation so assertion-function call sites typecheck under Next build.
const validateJobResult: (result: unknown) => void = validateJobResultAssert;

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
    const body = await readJson<{ result: JobResultV1 }>(req, 64 * 1024 * 1024);
    if (!body.result) {
      throw new HttpError(400, 'result with schemaVersion 1 required');
    }
    try {
      validateJobResult(body.result);
    } catch (e) {
      if (e instanceof ResultValidationError) throw new HttpError(400, e.message);
      throw e;
    }
    const job = completeJob({
      jobId,
      agentId: agent.id,
      result: body.result,
    });
    if (!job) return json({ error: 'Cannot complete this job' }, 409);
    return json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}
