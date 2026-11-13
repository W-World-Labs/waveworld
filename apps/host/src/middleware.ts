import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { CONTENT_SECURITY_POLICY, documentRequestHeaders } from './lib/security-headers';
import { resolveCorsAllowlist, type CorsEnv } from './lib/cors';
export { defaultDevCorsOrigins, parseCorsAllowlist, resolveCorsAllowlist, type CorsEnv } from './lib/cors';

// Residual after c72cf29: allow x-waveworld-share so Atlas/browser clients can
// send share tokens via header (not only ?share=) without CORS preflight failure.
export const ALLOW_HEADERS =
  'Content-Type, Authorization, x-api-key, x-created-by, x-user-id, x-user-name, x-workspace-id, x-artifact-kind, x-job-id, x-project-id, x-waveworld-share, x-browser-agent';

/**
 * CORS headers for one request Origin. Never pairs an origin that is not on
 * the allowlist with Access-Control-Allow-Credentials. Never uses `*` with
 * credentials.
 */
export function corsHeadersForOrigin(
  origin: string | null | undefined,
  env: CorsEnv = process.env,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Expose-Headers': 'X-Artifact-SHA256, Content-Length',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  const allowlist = resolveCorsAllowlist(env);
  if (origin && allowlist.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

/**
 * CORS for atlas UI (Vite :5173) calling host API (:3001).
 * Only allowlisted origins receive ACAO + credentials. Arbitrary Origin is
 * not reflected (see WAVEWORLD_CORS_ORIGINS / #56).
 */
export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin');
  const isApi = req.nextUrl.pathname.startsWith('/api/');

  if (!isApi) {
    const headers = documentRequestHeaders(req.headers);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set('Content-Security-Policy', headers.get('Content-Security-Policy')!);
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  }

  const cors = {
    ...corsHeadersForOrigin(origin, process.env),
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  };

  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(cors)) {
    res.headers.set(k, v);
  }
  return res;
}

export const config = {
  matcher: '/((?!_next/static|_next/image|ww-next/|favicon.ico).*)',
};
