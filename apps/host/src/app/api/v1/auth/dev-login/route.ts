export const runtime = 'nodejs';

/**
 * Local / Phase 3 dev login (kept for development).
 * Production prefers W-ID OIDC when W_ID_* env is set.
 * POST { name, workspaceId? } → { user, token } + Set-Cookie ww_session
 *
 * user.id is stable for the same name+workspace (projects survive re-login).
 */
export async function POST(req: Request) {
  const { allowDevLogin, devLogin, withSessionCookie } = await import('../../../../../lib/user-auth');
  const { errorResponse, json, readJson, HttpError } = await import('@/lib/tasks/http');
  try {
    const { consumeRateLimit, rateLimitedResponse } = await import('../../../../../lib/rate-limit');
    const limited = consumeRateLimit(req, 'login');
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    if (!allowDevLogin()) throw new HttpError(404, 'dev login is disabled');
    const body = await readJson<{ name?: string; workspaceId?: string }>(req, 16 * 1024);
    if (!body.name?.trim()) throw new HttpError(400, 'name is required');
    const result = await devLogin({ name: body.name, workspaceId: body.workspaceId });
    const res = json(
      {
        ...result,
        note: 'Dev token with stable user id; production: W-ID OIDC when W_ID_* configured',
      },
      201
    );
    return withSessionCookie(res, result.token);
  } catch (err) {
    return errorResponse(err);
  }
}
