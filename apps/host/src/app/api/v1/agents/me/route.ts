import { ensureTaskEnv } from '../../../../../lib/ensure-task-env';
import { withRadarRoute } from '@/lib/radar-telemetry';

export const runtime = 'nodejs';

async function getAgentRoute(req: Request) {
  ensureTaskEnv();
  const { requireAgent } = await import('@/lib/tasks/auth-agent');
  const { errorResponse, json } = await import('@/lib/tasks/http');
  try {
    const agent = requireAgent(req);
    return json({ agent });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Existing Agent rotates its truthful probed capabilities without re-registering. */
async function updateAgentRoute(req: Request) {
  ensureTaskEnv();
  const { requireAgent, updateAgentCapabilities } = await import('@/lib/tasks/auth-agent');
  const { errorResponse, json, readJson, HttpError } = await import('@/lib/tasks/http');
  try {
    const agent = requireAgent(req);
    // Capabilities are re-parsed on every authenticated control-plane call
    // (authenticateAgent) — an unbounded body would amplify into per-request
    // JSON parse cost. 256 KiB is far beyond any honest capability set.
    // The rewrite itself is also capped: a tight PUT loop would rewrite the
    // row that later auth calls parse.
    const { consumeAgentCapabilityLimit, rateLimitedResponse } = await import('../../../../../lib/rate-limit');
    const limited = consumeAgentCapabilityLimit(agent.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const body = await readJson<{ capabilities?: import('@/types/task').AgentCapabilities }>(req, 256 * 1024);
    if (!body.capabilities) throw new HttpError(400, 'capabilities required');
    const updated = updateAgentCapabilities(agent.id, body.capabilities);
    if (!updated) throw new HttpError(404, 'agent not found');
    return json({ agent: updated });
  } catch (err) { return errorResponse(err); }
}

const getAgentWithRadar = withRadarRoute('GET', '/api/v1/agents/me', getAgentRoute);
export async function GET(req: Request) {
  return getAgentWithRadar(req);
}

const updateAgentWithRadar = withRadarRoute('PUT', '/api/v1/agents/me', updateAgentRoute);
export async function PUT(req: Request) {
  return updateAgentWithRadar(req);
}
