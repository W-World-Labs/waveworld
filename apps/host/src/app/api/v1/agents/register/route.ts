import { ensureTaskEnv } from '../../../../../lib/ensure-task-env';
import { withRadarRoute } from '@/lib/radar-telemetry';
import {
  PROBE_NO_STORE_HEADERS,
  safeOperationalErrorMessage,
  sameSecret,
} from '../../../../../lib/safe-error-message';

export const runtime = 'nodejs';

/**
 * Agent self-registration. Residual after 7290c1c: registration x-api-key uses
 * shared timing-safe sameSecret (parity metrics/jobs-stats/job-sharing/jobs list).
 * Residual after 6d2ecaa: PROBE_NO_STORE_HEADERS on 401/201/400 (issued agent
 * tokens and auth failures must never be cached at CDN/edge); errors use
 * safeOperationalErrorMessage so secret env values never appear in bodies.
 * Residual after f8da984: configured registration key always enforced (even
 * outside production); JOB_REQUIRE_AUTH=1 also closes open registration when no
 * key is set (prod-like local parity with job-sharing / jobs list).
 * Do not claim Lab fully usable while #49 open.
 */
async function registerAgentRoute(req: Request) {
  ensureTaskEnv();
  const { registerAgent } = await import('@/lib/tasks/auth-agent');
  const { readJson } = await import('@/lib/tasks/http');
  try {
    const { consumeRateLimit, rateLimitedResponse } = await import('../../../../../lib/rate-limit');
    const limited = consumeRateLimit(req, 'register');
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const expected = (
      process.env.AGENT_REGISTRATION_KEY?.trim() ||
      (process.env.NODE_ENV === 'production' ? '' : process.env.TASK_API_KEY?.trim() || '')
    );
    const valid = sameSecret(req.headers.get('x-api-key'), expected);
    // Residual after f8da984: key configured → always require sameSecret;
    // production always require; JOB_REQUIRE_AUTH=1 closes no-key open registration.
    const requireRegistrationKey =
      process.env.NODE_ENV === 'production' ||
      process.env.JOB_REQUIRE_AUTH === '1' ||
      expected.length > 0;
    if (!valid && requireRegistrationKey) {
      return Response.json(
        { error: 'agent registration disabled without a valid registration key' },
        { status: 401, headers: PROBE_NO_STORE_HEADERS },
      );
    }
    const body = await readJson<{ name?: string; capabilities?: import('@/types/task').AgentCapabilities }>(req, 256 * 1024);
    const name = body.name?.trim() ?? '';
    // name lands raw in the agents table, listings and log lines — bound it
    // (the 256KB body cap alone would allow a ~256KB name per row).
    if (!name || name.length > 128 || /[\x00-\x1f\x7f]/.test(name)) {
      return Response.json(
        { error: 'name is required (≤128 chars, no control characters)' },
        { status: 400, headers: PROBE_NO_STORE_HEADERS },
      );
    }
    const { agent, token } = await registerAgent({
      name,
      capabilities: body.capabilities,
    });
    // 201 carries one-time agent token — always no-store (never edge-cache secrets).
    return Response.json({ agent, token }, { status: 201, headers: PROBE_NO_STORE_HEADERS });
  } catch (err) {
    const status =
      err instanceof Error && typeof (err as Error & { status?: number }).status === 'number'
        ? (err as Error & { status: number }).status
        : 500;
    return Response.json(
      { error: safeOperationalErrorMessage(err) },
      { status, headers: PROBE_NO_STORE_HEADERS },
    );
  }
}

const registerAgentWithRadar = withRadarRoute('POST', '/api/v1/agents/register', registerAgentRoute);
export async function POST(req: Request) {
  return registerAgentWithRadar(req);
}
