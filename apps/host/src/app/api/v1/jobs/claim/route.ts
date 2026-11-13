import { ensureTaskEnv } from '../../../../../lib/ensure-task-env';
import { withRadarRoute } from '@/lib/radar-telemetry';

export const runtime = 'nodejs';

async function claimJobRoute(req: Request) {
  ensureTaskEnv();
  const { requireAgent } = await import('@/lib/tasks/auth-agent');
  const { claimJob } = await import('@/lib/tasks/service');
  const { errorResponse, json, HttpError, readJson } = await import('@/lib/tasks/http');
  try {
    const agent = requireAgent(req);
    const { consumeAgentJobLimit, rateLimitedResponse } = await import('@/lib/rate-limit');
    const rl = consumeAgentJobLimit('jobClaim', agent.id);
    if (!rl.ok) return rateLimitedResponse(rl.retryAfterSec);
    let kinds: import('@/types/task').JobKind[] | undefined;
    let workspaceId: string | undefined;
    try {
      const body = await readJson<{
        kinds?: import('@/types/task').JobKind[];
        workspaceId?: string;
      }>(req, 64 * 1024);
      kinds = body?.kinds;
      workspaceId = body?.workspaceId;
    } catch (err) {
      if (err instanceof HttpError && err.status === 413) throw err;
      /* empty body ok — global claim by agent capabilities */
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

const claimJobWithRadar = withRadarRoute('POST', '/api/v1/jobs/claim', claimJobRoute);
export async function POST(req: Request) {
  return claimJobWithRadar(req);
}
