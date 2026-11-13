import { createHash, randomBytes } from 'crypto';
import { ensureTaskEnv } from './ensure-task-env';
import { cookieWriteOriginAllowed, type CorsEnv } from './cors';

/** HttpOnly session cookie name (Bearer usr_* remains primary for Atlas cross-origin). */
export const SESSION_COOKIE = 'ww_session';

export type HostUser = {
  id: string;
  name: string;
  workspaceId: string;
  createdAt: string;
  /** How the session was issued */
  authProvider?: 'dev' | 'oidc' | 'header';
};

type SessionRow = {
  token_hash: string;
  user_id: string;
  name: string;
  workspace_id: string;
  created_at: string;
  last_seen_at: string;
  auth_provider: string | null;
  subject: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

export type OidcPublicConfig = {
  configured: boolean;
  issuer: string | null;
  clientId: string | null;
  redirectUri: string | null;
  /** Authorization endpoint (derived or override) */
  authorizationEndpoint: string | null;
  /** Missing env var names when not fully configured */
  missing: string[];
};

export type OidcEnvConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Stable dev user id so re-login with the same display name + workspace
 * recovers the same projects (no random UUID each time).
 */
export function stableDevUserId(name: string, workspaceId: string): string {
  const key = `dev|${workspaceId.trim().toLowerCase()}|${name.trim().toLowerCase()}`;
  return `dev_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
}

/**
 * Stable OIDC user id from issuer + subject (hashed, prefixed).
 */
export function stableOidcUserId(issuer: string, sub: string): string {
  const key = `oidc|${issuer}|${sub}`;
  return `oidc_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
}

/** Public OIDC status for GET /api/v1/auth/config (no secrets). */
export function getOidcPublicConfig(): OidcPublicConfig {
  const issuer = process.env.W_ID_ISSUER?.trim() || null;
  const clientId = process.env.W_ID_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.W_ID_CLIENT_SECRET?.trim() || null;
  const redirectUri = process.env.W_ID_REDIRECT_URI?.trim() || null;
  const missing: string[] = [];
  if (!issuer) missing.push('W_ID_ISSUER');
  if (!clientId) missing.push('W_ID_CLIENT_ID');
  if (!clientSecret) missing.push('W_ID_CLIENT_SECRET');
  if (!redirectUri) missing.push('W_ID_REDIRECT_URI');
  const configured = missing.length === 0;
  // W-ID uses /oauth/* (see /.well-known/openid-configuration), not bare /authorize.
  const authorizationEndpoint =
    process.env.W_ID_AUTHORIZATION_ENDPOINT?.trim() ||
    (issuer ? `${issuer.replace(/\/$/, '')}/oauth/authorize` : null);
  return {
    configured,
    issuer,
    clientId,
    redirectUri,
    authorizationEndpoint,
    missing,
  };
}

/** Full OIDC env (throws-friendly null when incomplete). */
export function getOidcEnvConfig(): OidcEnvConfig | null {
  const pub = getOidcPublicConfig();
  if (!pub.configured || !pub.issuer || !pub.clientId || !pub.redirectUri) return null;
  const clientSecret = process.env.W_ID_CLIENT_SECRET!.trim();
  const base = pub.issuer.replace(/\/$/, '');
  return {
    issuer: pub.issuer,
    clientId: pub.clientId,
    clientSecret,
    redirectUri: pub.redirectUri,
    authorizationEndpoint:
      process.env.W_ID_AUTHORIZATION_ENDPOINT?.trim() || `${base}/oauth/authorize`,
    tokenEndpoint: process.env.W_ID_TOKEN_ENDPOINT?.trim() || `${base}/oauth/token`,
    scopes: process.env.W_ID_SCOPES?.trim() || 'openid profile email',
  };
}

/**
 * Normalize an OIDC post-login destination to a path on the current public
 * origin. Protocol-relative, cross-origin and malformed destinations are
 * rejected instead of being reflected into a redirect.
 */
export function normalizeOidcReturnTo(requestUrl: string, candidate: string | null | undefined): string | null {
  const value = candidate?.trim();
  if (!value || value.includes('\\')) return null;
  try {
    const request = new URL(requestUrl);
    const destination = new URL(value, request.origin);
    if (destination.origin !== request.origin || destination.username || destination.password) return null;
    if (!destination.pathname.startsWith('/')) return null;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return null;
  }
}

async function openSqlite() {
  ensureTaskEnv();
  const { getSqlite } = await import('@/lib/tasks/db');
  const sqlite = getSqlite();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS host_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT
    );
  `);
  // Best-effort migrations for OIDC metadata (SQLite ignores if already present).
  try {
    sqlite.exec(`ALTER TABLE host_sessions ADD COLUMN auth_provider TEXT`);
  } catch {
    /* column exists */
  }
  try {
    sqlite.exec(`ALTER TABLE host_sessions ADD COLUMN subject TEXT`);
  } catch {
    /* column exists */
  }
  try {
    sqlite.exec(`ALTER TABLE host_sessions ADD COLUMN expires_at TEXT`);
  } catch {
    /* column exists */
  }
  try {
    sqlite.exec(`ALTER TABLE host_sessions ADD COLUMN revoked_at TEXT`);
  } catch {
    /* column exists */
  }
  return sqlite;
}

export type IssueSessionInput = {
  userId: string;
  name: string;
  workspaceId?: string;
  authProvider?: 'dev' | 'oidc';
  /** OIDC sub or stable subject key */
  subject?: string | null;
};

/**
 * Issue a new host session (usr_* bearer + optional cookie).
 * Same path for dev-login and OIDC callback.
 */
export async function issueSession(
  input: IssueSessionInput
): Promise<{ user: HostUser; token: string }> {
  const sqlite = await openSqlite();
  const name = input.name.trim();
  if (!name) throw new Error('name required');
  if (!input.userId?.trim()) throw new Error('userId required');
  const workspaceId = input.workspaceId?.trim() || 'default';
  const token = `usr_${randomBytes(24).toString('base64url')}`;
  const now = new Date().toISOString();
  const ttlSeconds = sessionTtlSeconds();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const authProvider = input.authProvider ?? 'dev';
  // #64: re-login / new OIDC session revokes prior tokens for this user.
  sqlite
    .prepare(`UPDATE host_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .run(now, input.userId);
  sqlite
    .prepare(
      `INSERT INTO host_sessions (
         token_hash, user_id, name, workspace_id, created_at, last_seen_at, auth_provider, subject,
         expires_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      hashToken(token),
      input.userId,
      name,
      workspaceId,
      now,
      now,
      authProvider,
      input.subject ?? null,
      expiresAt
    );
  return {
    token,
    user: {
      id: input.userId,
      name,
      workspaceId,
      createdAt: now,
      authProvider,
    },
  };
}

/**
 * Dev / local login: stable user id from name+workspace, issues session token.
 */
export async function devLogin(input: {
  name: string;
  workspaceId?: string;
}): Promise<{ user: HostUser; token: string }> {
  const name = input.name.trim();
  if (!name) throw new Error('name required');
  const workspaceId = input.workspaceId?.trim() || 'default';
  const userId = stableDevUserId(name, workspaceId);
  return issueSession({
    userId,
    name,
    workspaceId,
    authProvider: 'dev',
    subject: `${workspaceId}:${name.toLowerCase()}`,
  });
}

/**
 * Complete OIDC login after IdP returns claims (callback path).
 */
export async function loginFromOidcClaims(claims: {
  sub: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  workspaceId?: string;
}): Promise<{ user: HostUser; token: string }> {
  const cfg = getOidcEnvConfig();
  if (!cfg) throw new Error('OIDC not configured');
  const sub = claims.sub?.trim();
  if (!sub) throw new Error('OIDC sub required');
  const name =
    claims.name?.trim() ||
    claims.preferred_username?.trim() ||
    claims.email?.trim() ||
    sub;
  const workspaceId = claims.workspaceId?.trim() || 'default';
  const userId = stableOidcUserId(cfg.issuer, sub);
  return issueSession({
    userId,
    name,
    workspaceId,
    authProvider: 'oidc',
    subject: sub,
  });
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function extractUserToken(req: Request, env: CorsEnv = process.env): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    // Only user sessions — never treat agent tokens as user auth
    if (token.startsWith('usr_')) return token;
  }
  const cookies = parseCookieHeader(req.headers.get('cookie'));
  const fromCookie = cookies[SESSION_COOKIE]?.trim();
  if (fromCookie?.startsWith('usr_')) {
    if (!cookieWriteOriginAllowed(req, env)) {
      throw Object.assign(new Error('forbidden: cookie-authenticated write origin is not allowed'), { status: 403 });
    }
    return fromCookie;
  }
  return null;
}

/**
 * Allow x-user-id bypass only outside production.
 * NODE_ENV=production always wins — TASK_DEV_AUTH cannot re-enable this (#57).
 */
export function allowDevUserHeader(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return true;
}

/**
 * Passwordless display-name login is local-only.
 * NODE_ENV=production always wins — TASK_ALLOW_DEV_LOGIN cannot re-enable this (#57).
 */
export function allowDevLogin(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return true;
}

/** Min interval between host_sessions.last_seen_at writes per token. */
const SESSION_LAST_SEEN_REFRESH_MS = 60_000;

async function lookupSession(token: string): Promise<HostUser | null> {
  const sqlite = await openSqlite();
  const row = sqlite
    .prepare(`SELECT * FROM host_sessions WHERE token_hash = ?`)
    .get(hashToken(token)) as SessionRow | undefined;
  if (!row) return null;

  const nowMs = Date.now();
  const expiresMs = row.expires_at ? Date.parse(row.expires_at) : Date.parse(row.created_at) + sessionTtlSeconds() * 1000;
  if (row.revoked_at || !Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    sqlite.prepare(`DELETE FROM host_sessions WHERE token_hash = ?`).run(row.token_hash);
    return null;
  }

  // Throttle last_seen_at writes — lookupSession runs per authenticated
  // request; an active UI would otherwise write WAL churn per call.
  const lastSeenMs = Date.parse(row.last_seen_at ?? '');
  if (!Number.isFinite(lastSeenMs) || nowMs - lastSeenMs > SESSION_LAST_SEEN_REFRESH_MS) {
    sqlite
      .prepare(`UPDATE host_sessions SET last_seen_at = ? WHERE token_hash = ?`)
      .run(new Date().toISOString(), row.token_hash);
  }

  return {
    id: row.user_id,
    name: row.name,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
    authProvider: (row.auth_provider as HostUser['authProvider']) || 'dev',
  };
}

/**
 * Resolve browser/user identity from (in order):
 * 1. Authorization: Bearer usr_*
 * 2. HttpOnly ww_session cookie
 * 3. x-user-id header (non-production only; ignored when NODE_ENV=production)
 *
 * Agent tokens (non usr_) are ignored here — use requireAgent.
 */
export async function resolveUser(
  req: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<HostUser | null> {
  const token = extractUserToken(req, env);
  if (token) {
    return lookupSession(token);
  }

  if (allowDevUserHeader(env)) {
    const headerUser = req.headers.get('x-user-id');
    const headerName = req.headers.get('x-user-name');
    const headerWs = req.headers.get('x-workspace-id');
    if (headerUser) {
      return {
        id: headerUser,
        name: headerName || headerUser,
        workspaceId: headerWs || 'default',
        createdAt: new Date().toISOString(),
        authProvider: 'header',
      };
    }
  }

  return null;
}

export async function requireUser(req: Request): Promise<HostUser> {
  const u = await resolveUser(req);
  if (!u) {
    const err = new Error(
      'user authentication required (Authorization: Bearer usr_…, session cookie, or dev-login)'
    );
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  return u;
}

/** Revoke a session by raw token (logout). */
export async function revokeSession(token: string | null | undefined): Promise<boolean> {
  if (!token?.startsWith('usr_')) return false;
  const sqlite = await openSqlite();
  const result = sqlite
    .prepare(`UPDATE host_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
    .run(new Date().toISOString(), hashToken(token));
  return (result.changes ?? 0) > 0;
}

/**
 * Session SameSite. Default is Lax even when Secure is on (#56).
 * Cross-site cookie use requires an explicit W_ID_COOKIE_SAMESITE override
 * (typically None, which also needs Secure).
 */
export function sessionCookieSameSite(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const override = env.W_ID_COOKIE_SAMESITE?.trim();
  if (override) return override;
  return 'Lax';
}

/** Set-Cookie value for host session (HttpOnly). */
export function buildSessionCookie(
  token: string,
  maxAgeSec = 30 * 24 * 3600,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  maxAgeSec = Math.min(maxAgeSec, sessionTtlSeconds());
  const secure =
    env.NODE_ENV === 'production' || env.W_ID_COOKIE_SECURE === '1' ? '; Secure' : '';
  const sameSite = sessionCookieSameSite(env);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSec}${secure}`;
}

/** Server-side session lifetime; cookies can never extend it. */
export function sessionTtlSeconds(): number {
  const configured = Number(process.env.W_ID_SESSION_TTL_SECONDS ?? 30 * 24 * 3600);
  return Number.isFinite(configured) && configured >= 300
    ? Math.floor(configured)
    : 30 * 24 * 3600;
}

/** Clear session cookie. */
export function clearSessionCookie(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const secure =
    env.NODE_ENV === 'production' || env.W_ID_COOKIE_SECURE === '1' ? '; Secure' : '';
  const sameSite = sessionCookieSameSite(env);
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure}`;
}

/** Attach Set-Cookie on a JSON Response without dropping existing headers. */
export function withSessionCookie(res: Response, token: string): Response {
  const headers = new Headers(res.headers);
  headers.append('Set-Cookie', buildSessionCookie(token));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function withClearedSessionCookie(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.append('Set-Cookie', clearSessionCookie());
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
