import { timingSafeEqual } from 'crypto';

export const runtime = 'nodejs';

const OIDC_STATE_COOKIE = 'ww_oidc_state';
const OIDC_NONCE_COOKIE = 'ww_oidc_nonce';
const OIDC_FLOW_COOKIE = 'ww_oidc_flow';

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/**
 * OIDC authorization-code callback.
 * When env unset → 503. When set, exchanges code for tokens (or accepts
 * W_ID_DEV_CALLBACK_STUB=1 test claims) and issues a host session with stable user id.
 */
export async function GET(req: Request) {
  const {
    getOidcEnvConfig,
    getOidcPublicConfig,
    loginFromOidcClaims,
    withSessionCookie,
  } = await import('../../../../../../lib/user-auth');
  const { json, errorResponse } = await import('@/lib/tasks/http');

  try {
    const cfg = getOidcEnvConfig();
    if (!cfg) {
      const pub = getOidcPublicConfig();
      return Response.json(
        {
          error: 'OIDC not configured',
          message:
            'Set W_ID_ISSUER, W_ID_CLIENT_ID, W_ID_CLIENT_SECRET, and W_ID_REDIRECT_URI. Until then use POST /api/v1/auth/dev-login.',
          missing: pub.missing,
        },
        { status: 503 }
      );
    }

    const url = new URL(req.url);
    const err = url.searchParams.get('error');
    if (err) {
      return json(
        {
          error: 'oidc_error',
          oidcError: err,
          description: url.searchParams.get('error_description'),
        },
        400
      );
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code) {
      return json({ error: 'missing code' }, 400);
    }

    const cookies = parseCookies(req.headers.get('cookie'));
    const expectedState = cookies[OIDC_STATE_COOKIE];
    if (!expectedState || !state || !timingSafeEqualText(expectedState, state)) {
      return json({ error: 'invalid state' }, 400);
    }
    const expectedNonce = cookies[OIDC_NONCE_COOKIE];
    if (!expectedNonce) return json({ error: 'missing oidc nonce' }, 400);
    const flow = parseBoundFlow(cookies[OIDC_FLOW_COOKIE]);
    if (!flow || !timingSafeEqualText(flow.state, expectedState)) {
      return json({ error: 'invalid oidc flow' }, 400);
    }

    let claims: {
      sub: string;
      name?: string;
      email?: string;
      preferred_username?: string;
      workspace_id?: string;
    };

    // Local / CI stub: skip real token endpoint when W_ID_DEV_CALLBACK_STUB=1
    if (process.env.W_ID_DEV_CALLBACK_STUB === '1' && process.env.NODE_ENV === 'production') {
      return json({ error: 'OIDC callback stub is disabled in production' }, 503);
    }
    if (process.env.W_ID_DEV_CALLBACK_STUB === '1') {
      claims = {
        sub: url.searchParams.get('sub') || `stub-${code.slice(0, 12)}`,
        name: url.searchParams.get('name') || 'oidc-user',
        email: url.searchParams.get('email') || undefined,
      };
    } else {
      // Remote IdP calls must be bounded: a hung or unreachable issuer must not
      // leave this route waiting forever. One shared 15s budget covers the whole
      // token → userinfo/discovery chain; client disconnect also aborts it.
      const upstreamSignal = AbortSignal.any([req.signal, AbortSignal.timeout(15_000)]);

      // Authorization code → token
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUri,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      });
      let tokenRes: Response;
      try {
        tokenRes = await fetch(cfg.tokenEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: body.toString(),
          signal: upstreamSignal,
        });
      } catch {
        return json({ error: 'token_exchange_failed', detail: 'token endpoint unreachable' }, 502);
      }
      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        return json(
          {
            error: 'token_exchange_failed',
            status: tokenRes.status,
            detail: text.slice(0, 400),
          },
          502
        );
      }
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        id_token?: string;
        token_type?: string;
      };

      // Prefer userinfo from the configured issuer. Any id_token fallback is fully verified.
      if (tokenJson.access_token && cfg.issuer) {
        const userinfoUrl =
          process.env.W_ID_USERINFO_ENDPOINT?.trim() ||
          `${cfg.issuer.replace(/\/$/, '')}/userinfo`;
        let uiRes: Response | null = null;
        try {
          uiRes = await fetch(userinfoUrl, {
            headers: { Authorization: `Bearer ${tokenJson.access_token}` },
            signal: upstreamSignal,
          });
        } catch {
          uiRes = null;
        }
        if (uiRes?.ok) {
          claims = (await uiRes.json()) as typeof claims;
        } else if (tokenJson.id_token) {
          // Any id_token fallback is fully verified.
          claims = await verifyIdToken(tokenJson.id_token, cfg, expectedNonce, upstreamSignal);
        } else if (uiRes) {
          return json({ error: 'userinfo_failed', status: uiRes.status }, 502);
        } else {
          return json({ error: 'userinfo_failed', detail: 'userinfo endpoint unreachable' }, 502);
        }
      } else if (tokenJson.id_token) {
        claims = await verifyIdToken(tokenJson.id_token, cfg, expectedNonce, upstreamSignal);
      } else {
        return json({ error: 'no_identity_in_token_response' }, 502);
      }
    }

    if (!claims.sub) {
      return json({ error: 'missing_sub_claim' }, 502);
    }

    // Workspace comes only from a verified/trusted IdP response, never callback query input.
    const workspaceId = claims.workspace_id || 'default';
    const { user, token } = await loginFromOidcClaims({ ...claims, workspaceId });

    const accept = req.headers.get('accept') || '';
    const wantsHtml = accept.includes('text/html');
    const configuredPostLogin = process.env.W_ID_POST_LOGIN_REDIRECT?.trim() || null;
    const { normalizeOidcReturnTo } = await import('../../../../../../lib/user-auth');
    const postLogin = flow.returnTo || normalizeOidcReturnTo(req.url, configuredPostLogin);

    if (wantsHtml && postLogin) {
      const headers = new Headers({ Location: postLogin });
      const { buildSessionCookie } = await import('../../../../../../lib/user-auth');
      headers.append('Set-Cookie', buildSessionCookie(token));
      // Clear OIDC state cookie
      headers.append(
        'Set-Cookie',
        `${OIDC_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
      );
      headers.append('Set-Cookie', `${OIDC_NONCE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      headers.append('Set-Cookie', `${OIDC_FLOW_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      return new Response(null, { status: 302, headers });
    }

    const res = json({
      user,
      token,
      note: 'W-ID OIDC session; store token as Authorization: Bearer or rely on ww_session cookie',
    });
    const withSession = withSessionCookie(res, token);
    const headers = new Headers(withSession.headers);
    headers.append('Set-Cookie', `${OIDC_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    headers.append('Set-Cookie', `${OIDC_NONCE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    headers.append('Set-Cookie', `${OIDC_FLOW_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return new Response(withSession.body, { status: withSession.status, headers });
  } catch (err) {
    return errorResponse(err);
  }
}

function parseBoundFlow(raw: string | undefined): { state: string; returnTo: string | null } | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (!value || typeof value !== 'object') return null;
    const flow = value as { state?: unknown; returnTo?: unknown };
    if (typeof flow.state !== 'string' || !flow.state) return null;
    if (flow.returnTo !== null && typeof flow.returnTo !== 'string') return null;
    return { state: flow.state, returnTo: flow.returnTo };
  } catch {
    return null;
  }
}

async function verifyIdToken(idToken: string, cfg: {
  issuer: string; clientId: string;
}, nonce: string, signal?: AbortSignal): Promise<{
  sub: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  workspace_id?: string;
}> {
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const issuer = cfg.issuer.replace(/\/$/, '');
  const discoveryUrl = new URL(`${issuer}/.well-known/openid-configuration`);
  let discovery: Response;
  try {
    discovery = await fetch(discoveryUrl, {
      headers: { Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new Error(`OIDC discovery request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!discovery.ok) throw new Error(`OIDC discovery failed: ${discovery.status}`);
  const metadata = await discovery.json() as { issuer?: string; jwks_uri?: string };
  if (!metadata.jwks_uri || metadata.issuer !== cfg.issuer) throw new Error('invalid OIDC discovery metadata');
  const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: cfg.issuer,
    audience: cfg.clientId,
  });
  if (typeof payload.nonce !== 'string' || !timingSafeEqualText(payload.nonce, nonce)) {
    throw new Error('invalid id_token nonce');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('missing id_token sub');
  return payload as { sub: string; name?: string; email?: string; preferred_username?: string; workspace_id?: string };
}

function timingSafeEqualText(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}
