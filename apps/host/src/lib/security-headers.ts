/**
 * Shared production security headers (#61).
 * style-src includes 'unsafe-inline' because Atlas/Host/Lab use Tailwind
 * utility injection and React inline style props. Next documents additionally
 * authorize their generated startup scripts with a fresh request nonce.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://radar.myfastools.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://radar.myfastools.com",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';

/** Shared by Host middleware and Lab proxy; Next reads CSP from the request. */
export function documentRequestHeaders(
  incoming: Headers,
  development = process.env.NODE_ENV === 'development',
  frameAncestor?: string,
): Headers {
  const nonce = btoa(crypto.randomUUID());
  let policy = CONTENT_SECURITY_POLICY.replace(
    "script-src 'self' https://radar.myfastools.com",
    `script-src 'self' https://radar.myfastools.com 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
  );
  if (development) policy = policy.replace("connect-src 'self' https://radar.myfastools.com", "connect-src 'self' https://radar.myfastools.com ws:");
  // CI embeds the Lab from another loopback origin. Never accept arbitrary URLs.
  const configured = frameAncestor?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
      const exactOrigin = configured === url.origin;
      if (url.protocol === 'http:' && loopback && exactOrigin) {
        policy = policy.replace("frame-ancestors 'self'", `frame-ancestors 'self' ${url.origin}`);
      }
    } catch {
      /* Invalid or non-loopback input stays fail-closed. */
    }
  }
  const headers = new Headers(incoming);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  return headers;
}

export function productionSecurityHeaders(): { key: string; value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
    { key: 'Strict-Transport-Security', value: STRICT_TRANSPORT_SECURITY },
  ];
}
