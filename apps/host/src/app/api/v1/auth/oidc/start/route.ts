import { randomBytes } from 'crypto';

export const runtime = 'nodejs';

const OIDC_STATE_COOKIE = 'ww_oidc_state';
const OIDC_NONCE_COOKIE = 'ww_oidc_nonce';
const OIDC_FLOW_COOKIE = 'ww_oidc_flow';

/**
 * Begin W-ID OIDC authorization code flow.
 * When W_ID_* env is incomplete → 503 with clear message (use dev-login).
 */
export async function GET(req: Request) {
  const { consumeRateLimit, rateLimitedResponse } = await import(
    '../../../../../../lib/rate-limit'
  );
  const limited = consumeRateLimit(req, 'oidc');
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
  const { getOidcEnvConfig, getOidcPublicConfig, normalizeOidcReturnTo } = await import(
    '../../../../../../lib/user-auth'
  );
  const cfg = getOidcEnvConfig();
  if (!cfg) {
    const pub = getOidcPublicConfig();
    return Response.json(
      {
        error: 'OIDC not configured',
        message:
          'Set W_ID_ISSUER, W_ID_CLIENT_ID, W_ID_CLIENT_SECRET, and W_ID_REDIRECT_URI to enable W-ID login. Until then use POST /api/v1/auth/dev-login.',
        missing: pub.missing,
      },
      { status: 503 }
    );
  }

  const state = randomBytes(16).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');
  const reqUrl = new URL(req.url);
  const requestedReturnTo = reqUrl.searchParams.get('returnTo');
  const returnTo = normalizeOidcReturnTo(req.url, requestedReturnTo);
  if (requestedReturnTo && !returnTo) {
    return Response.json({ error: 'invalid returnTo' }, { status: 400 });
  }
  const url = new URL(cfg.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', cfg.scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);

  // Optional workspace hint for multi-tenant IdPs
  const workspace = reqUrl.searchParams.get('workspaceId');
  if (workspace) url.searchParams.set('workspace_id', workspace);

  const secure =
    process.env.NODE_ENV === 'production' || process.env.W_ID_COOKIE_SECURE === '1'
      ? '; Secure'
      : '';
  const headers = new Headers({ Location: url.toString() });
  headers.append('Set-Cookie', `${OIDC_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
  headers.append('Set-Cookie', `${OIDC_NONCE_COOKIE}=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
  // Bind the validated destination to this exact state. The callback never
  // accepts returnTo from its query string.
  const flow = Buffer.from(JSON.stringify({ state, returnTo }), 'utf8').toString('base64url');
  headers.append('Set-Cookie', `${OIDC_FLOW_COOKIE}=${flow}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
  return new Response(null, { status: 302, headers });
}
