import { requireAgent } from '@/lib/tasks/auth-agent';
import { errorResponse, HttpError, json, readJson } from '@/lib/tasks/http';
import { consumeAgentJobLimit, rateLimitedResponse } from '@/lib/tasks/rate-limit';
import { claimJob } from '@/lib/tasks/service';
import type { JobKind } from '@/types/task';

export const runtime = 'nodejs';

/** 拉取下一条匹配能力的 queued 任务；无任务时 204 */
export async function POST(req: Request) {
  try {
    const agent = requireAgent(req);
    const limited = consumeAgentJobLimit('jobClaim', agent.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    let kinds: JobKind[] | undefined;
    let workspaceId: string | undefined;
    try {
      const body = await readJson<{
        kinds?: JobKind[];
        workspaceId?: string;
      }>(req, 64 * 1024);
      kinds = body?.kinds;
      workspaceId = body?.workspaceId;
    } catch (err) {
      if (err instanceof HttpError && err.status === 413) throw err;
      /* empty body ok */
    }
    const job = claimJob({
      agentId: agent.id,
      capabilities: agent.capabilities,
      kinds,
      workspaceId,
    });
    if (!job) {
      return new Response(null, { status: 204 });
    }
    return json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}
