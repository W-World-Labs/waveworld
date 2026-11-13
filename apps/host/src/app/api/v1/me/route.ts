export const runtime = 'nodejs';

/**
 * Current browser/user session (Bearer usr_*, HttpOnly ww_session, or dev x-user-id).
 * Agent tokens (non usr_) are rejected — use /api/v1/agents/me instead.
 *
 * Atlas: store token from dev-login / OIDC callback, then:
 *   GET /api/v1/me  Authorization: Bearer usr_...
 */
export async function GET(req: Request) {
  const { resolveUser, getOidcPublicConfig } = await import('../../../../lib/user-auth');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const user = await resolveUser(req);
    if (!user) {
      const oidc = getOidcPublicConfig();
      return json(
        {
          error: 'not authenticated',
          hint: oidc.configured
            ? 'GET /api/v1/auth/oidc/start or POST /api/v1/auth/dev-login'
            : 'POST /api/v1/auth/dev-login (Authorization: Bearer usr_…)',
        },
        401
      );
    }
    return json({ user });
  } catch (err) {
    return errorResponse(err);
  }
}
