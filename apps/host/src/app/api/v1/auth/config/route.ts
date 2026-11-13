import {
  assertHostLabUsabilityHonesty,
  hostLabUsabilityHonesty,
} from '../../../../../lib/lab-entry';
import { PROBE_NO_STORE_HEADERS } from '../../../../../lib/safe-error-message';

export const runtime = 'nodejs';

/**
 * Public auth config (no secrets).
 * Atlas / clients use this to show OIDC vs dev-login UI.
 * Residual after a0c47ec: Cache-Control no-store; never echo secret env values;
 * expose labClaimFullyUsable so SSO UI cannot imply Lab is fully usable while #49 open.
 * Residual after 59a3fa3: pin blockerIssue/blockerOpen/pathLive (not a lone boolean).
 */
export async function GET() {
  const { allowDevLogin, getOidcPublicConfig } = await import('../../../../../lib/user-auth');
  const oidc = getOidcPublicConfig();
  const lab = hostLabUsabilityHonesty();
  assertHostLabUsabilityHonesty(lab);
  return Response.json(
    {
      devLogin: allowDevLogin(),
      sessionCookie: 'ww_session',
      oidc: {
        configured: oidc.configured,
        issuer: oidc.issuer,
        clientId: oidc.clientId,
        redirectUri: oidc.redirectUri,
        authorizationEndpoint: oidc.authorizationEndpoint,
        // missing listed so operators know what to set — never secrets
        missing: oidc.missing,
      },
      hints: {
        authorization: 'Authorization: Bearer usr_<token> (from dev-login or OIDC callback)',
        cookie: 'HttpOnly ww_session cookie set on successful login (same-origin host UI)',
        me: 'GET /api/v1/me',
        logout: 'POST /api/v1/auth/logout',
      },
      // Honesty pins only (no secrets). Auth configured ≠ Lab fully usable while #49 open.
      labClaimFullyUsable: lab.claimFullyUsable,
      labBlockerOpen: lab.blockerOpen,
      labBlockerIssue: lab.blockerIssue,
      labPathLiveNotFullyUsable: lab.pathLiveNotFullyUsable,
    },
    {
      status: 200,
      headers: PROBE_NO_STORE_HEADERS,
    },
  );
}
