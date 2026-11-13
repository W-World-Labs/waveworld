import { registerAgent } from '@/lib/tasks/auth-agent';
import { sameSecret } from '../../../../../../../host/src/lib/safe-error-message';
import { errorResponse, json, readJson } from '@/lib/tasks/http';
import type { AgentCapabilities } from '@/types/task';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { consumeRateLimit, rateLimitedResponse } = await import('@/lib/tasks/rate-limit');
    const limited = consumeRateLimit(req, 'register');
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    // Same gate as the canonical Host route: a configured registration key is
    // always enforced, and production fails closed when no key is set.
    const expected = (
      process.env.AGENT_REGISTRATION_KEY?.trim() ||
      (process.env.NODE_ENV === 'production' ? '' : process.env.TASK_API_KEY?.trim() || '')
    );
    const requireRegistrationKey =
      process.env.NODE_ENV === 'production' ||
      process.env.JOB_REQUIRE_AUTH === '1' ||
      expected.length > 0;
    if (requireRegistrationKey && !sameSecret(req.headers.get('x-api-key'), expected)) {
      return json({ error: 'Invalid or missing x-api-key' }, 401);
    }
    const body = await readJson<{ name?: string; capabilities?: AgentCapabilities }>(req, 64 * 1024);
    if (!body.name?.trim()) {
      return json({ error: 'name is required' }, 400);
    }
    const { agent, token } = await registerAgent({
      name: body.name.trim(),
      capabilities: body.capabilities,
    });
    return json({ agent, token }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
