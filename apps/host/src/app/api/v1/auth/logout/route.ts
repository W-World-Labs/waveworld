export const runtime = 'nodejs';

/**
 * Logout: revoke usr_* session (Bearer or cookie) and clear ww_session cookie.
 */
export async function POST(req: Request) {
  const { revokeSession, extractUserToken, withClearedSessionCookie } = await import(
    '../../../../../lib/user-auth'
  );
  const { json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  const { cookieWriteOriginAllowed } = await import('../../../../../lib/cors');

  try {
    const token = extractUserToken(req);
    const authorization = req.headers.get('authorization');
    const usesBearer = token !== null && authorization?.startsWith('Bearer ')
      && authorization.slice('Bearer '.length).trim() === token;
    // A cross-site form may omit a SameSite cookie while still accepting a
    // clearing Set-Cookie response. Authorize that mutation even without a token.
    if (!usesBearer && !cookieWriteOriginAllowed(req)) {
      throw new HttpError(403, 'forbidden: cookie-authenticated write origin is not allowed');
    }
    const revoked = await revokeSession(token);
    const res = json({ ok: true, revoked });
    return withClearedSessionCookie(res);
  } catch (error) {
    return errorResponse(error);
  }
}
