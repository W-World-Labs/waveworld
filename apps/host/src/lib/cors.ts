export type CorsEnv = {
  NODE_ENV?: string;
  WAVEWORLD_CORS_ORIGINS?: string;
};

export function parseCorsAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Atlas and Lab origins used only when NODE_ENV is not production. */
export function defaultDevCorsOrigins(): string[] {
  return [
    'http://127.0.0.1:3000', 'http://localhost:3000',
    'http://127.0.0.1:5173', 'http://localhost:5173',
    'http://127.0.0.1:4173', 'http://localhost:4173',
  ];
}

export function resolveCorsAllowlist(env: CorsEnv = process.env): string[] {
  const configured = parseCorsAllowlist(env.WAVEWORLD_CORS_ORIGINS);
  if (configured.length > 0) return configured;
  return env.NODE_ENV === 'production' ? [] : defaultDevCorsOrigins();
}

/** CORS alone does not prevent simple requests from spending session cookies. */
export function cookieWriteOriginAllowed(req: Request, env: CorsEnv = process.env): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const origin = req.headers.get('origin');
  if (origin === null) {
    const site = req.headers.get('sec-fetch-site');
    // Non-browser cookie clients may omit both headers. Browser requests from
    // another origin must supply an Origin we can actually authorize.
    return site === null || site === 'same-origin' || site === 'none';
  }
  let parsedOrigin: URL;
  try { parsedOrigin = new URL(origin); } catch { return false; }
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) return false;
  if (resolveCorsAllowlist(env).includes(origin)) return true;

  // Next can construct req.url with its loopback listener. Caddy preserves
  // the public Host and sets X-Forwarded-Proto at the TLS termination hop.
  const target = new URL(req.url);
  const host = req.headers.get('host') ?? target.host;
  const forwardedProtocol = req.headers.get('x-forwarded-proto');
  const protocol = forwardedProtocol === 'https' || forwardedProtocol === 'http'
    ? `${forwardedProtocol}:` : target.protocol;
  try {
    // Reconstruct instead of setting URL.host: that setter can retain the
    // internal :3001 port when the public Host has no explicit port.
    return origin === new URL(`${protocol}//${host}`).origin;
  } catch {
    return false;
  }
}
