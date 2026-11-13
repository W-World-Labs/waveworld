/**
 * User identity: stable dev-login ids, resolveUser (Bearer + cookie), session revoke.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');
const testDb = path.join(waveRoot, 'data', 'tasks-test-user-auth.db');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  Object.assign(process.env, { NODE_ENV: 'test' });
  delete process.env.W_ID_ISSUER;
  delete process.env.W_ID_CLIENT_ID;
  delete process.env.W_ID_CLIENT_SECRET;
  delete process.env.W_ID_REDIRECT_URI;
  for (const p of [testDb, testDb + '-wal', testDb + '-shm']) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ok */
    }
  }
});

describe('user-auth stable identity + session', () => {
  it('stableDevUserId is deterministic for name+workspace', async () => {
    const { stableDevUserId, stableOidcUserId } = await import('../src/lib/user-auth.ts');
    const a = stableDevUserId('Alice', 'default');
    const b = stableDevUserId('alice', 'default');
    const c = stableDevUserId('Alice', 'other');
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.ok(a.startsWith('dev_'));
    const o1 = stableOidcUserId('https://id.example', 'sub-1');
    const o2 = stableOidcUserId('https://id.example', 'sub-1');
    const o3 = stableOidcUserId('https://id.example', 'sub-2');
    assert.equal(o1, o2);
    assert.notEqual(o1, o3);
    assert.ok(o1.startsWith('oidc_'));
  });

  it('dev-login issues session; re-login same name keeps user id; resolveUser via Bearer', async () => {
    const {
      devLogin,
      resolveUser,
      requireUser,
      revokeSession,
      SESSION_COOKIE,
    } = await import('../src/lib/user-auth.ts');

    const first = await devLogin({ name: 'wave-tester', workspaceId: 'ws-a' });
    assert.ok(first.token.startsWith('usr_'));
    assert.ok(first.user.id.startsWith('dev_'));
    assert.equal(first.user.name, 'wave-tester');
    assert.equal(first.user.workspaceId, 'ws-a');

    const second = await devLogin({ name: 'wave-tester', workspaceId: 'ws-a' });
    assert.equal(second.user.id, first.user.id, 'stable user id across re-login');
    assert.notEqual(second.token, first.token, 'new session token each login');
    assert.equal(
      await resolveUser(new Request('http://localhost/api/v1/me', {
        headers: { Authorization: `Bearer ${first.token}` },
      })),
      null,
      're-login revokes the previous token (#64)',
    );

    const other = await devLogin({ name: 'other-user', workspaceId: 'ws-a' });
    assert.notEqual(other.user.id, first.user.id);

    const reqBearer = new Request('http://localhost/api/v1/me', {
      headers: { Authorization: `Bearer ${second.token}` },
    });
    const resolved = await resolveUser(reqBearer);
    assert.ok(resolved);
    assert.equal(resolved!.id, first.user.id);
    assert.equal(resolved!.name, 'wave-tester');

    const required = await requireUser(reqBearer);
    assert.equal(required.id, first.user.id);

    // Cookie path
    const reqCookie = new Request('http://localhost/api/v1/me', {
      headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(second.token)}` },
    });
    const fromCookie = await resolveUser(reqCookie);
    assert.ok(fromCookie);
    assert.equal(fromCookie!.id, first.user.id);

    // Agent-style token must not resolve as user
    const agentReq = new Request('http://localhost/api/v1/me', {
      headers: { Authorization: 'Bearer agt_not_a_user_session' },
    });
    assert.equal(await resolveUser(agentReq), null);

    // Revoke current token
    assert.equal(await revokeSession(second.token), true);
    assert.equal(await resolveUser(reqBearer), null);
  });

  it('getOidcPublicConfig reports missing when unset; 503 path via config helper', async () => {
    const { getOidcPublicConfig, getOidcEnvConfig } = await import('../src/lib/user-auth.ts');
    const pub = getOidcPublicConfig();
    assert.equal(pub.configured, false);
    assert.ok(pub.missing.includes('W_ID_ISSUER'));
    assert.equal(getOidcEnvConfig(), null);

    process.env.W_ID_ISSUER = 'https://id.example/realms/wave';
    process.env.W_ID_CLIENT_ID = 'waveworld';
    process.env.W_ID_CLIENT_SECRET = 'test-secret-not-real';
    process.env.W_ID_REDIRECT_URI = 'http://127.0.0.1:3001/api/v1/auth/oidc/callback';
    try {
      const configured = getOidcPublicConfig();
      assert.equal(configured.configured, true);
      assert.equal(configured.missing.length, 0);
      assert.ok(configured.authorizationEndpoint?.includes('/authorize'));
      const full = getOidcEnvConfig();
      assert.ok(full);
      assert.equal(full!.clientId, 'waveworld');
    } finally {
      delete process.env.W_ID_ISSUER;
      delete process.env.W_ID_CLIENT_ID;
      delete process.env.W_ID_CLIENT_SECRET;
      delete process.env.W_ID_REDIRECT_URI;
    }
  });

  it('loginFromOidcClaims issues stable oidc_ user id', async () => {
    process.env.W_ID_ISSUER = 'https://id.example/realms/wave';
    process.env.W_ID_CLIENT_ID = 'waveworld';
    process.env.W_ID_CLIENT_SECRET = 'test-secret-not-real';
    process.env.W_ID_REDIRECT_URI = 'http://127.0.0.1:3001/api/v1/auth/oidc/callback';
    try {
      const { loginFromOidcClaims, resolveUser } = await import('../src/lib/user-auth.ts');
      const a = await loginFromOidcClaims({
        sub: 'oidc-subject-42',
        name: 'OIDC Alice',
        workspaceId: 'default',
      });
      const b = await loginFromOidcClaims({
        sub: 'oidc-subject-42',
        name: 'OIDC Alice Updated',
        workspaceId: 'default',
      });
      assert.equal(a.user.id, b.user.id);
      assert.ok(a.user.id.startsWith('oidc_'));
      assert.equal(a.user.authProvider, 'oidc');

      const resolved = await resolveUser(
        new Request('http://x/me', { headers: { Authorization: `Bearer ${b.token}` } })
      );
      assert.equal(resolved?.id, a.user.id);
      assert.equal(
        await resolveUser(
          new Request('http://x/me', { headers: { Authorization: `Bearer ${a.token}` } }),
        ),
        null,
      );
    } finally {
      delete process.env.W_ID_ISSUER;
      delete process.env.W_ID_CLIENT_ID;
      delete process.env.W_ID_CLIENT_SECRET;
      delete process.env.W_ID_REDIRECT_URI;
    }
  });

  it('auth config route returns public JSON', async () => {
    const { GET } = await import('../src/app/api/v1/auth/config/route.ts');
    const res = await GET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      devLogin: boolean;
      oidc: { configured: boolean };
      sessionCookie: string;
    };
    assert.equal(body.devLogin, true);
    assert.equal(body.sessionCookie, 'ww_session');
    assert.equal(body.oidc.configured, false);
  });

  it('oidc start returns 503 when not configured', async () => {
    const { GET } = await import('../src/app/api/v1/auth/oidc/start/route.ts');
    const res = await GET(new Request('http://localhost/api/v1/auth/oidc/start'));
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string; missing: string[] };
    assert.equal(body.error, 'OIDC not configured');
    assert.ok(body.missing.length > 0);
  });

  it('OIDC start emits state+nonce and callback fails closed when either cookie is missing', async () => {
    process.env.W_ID_ISSUER = 'https://id.example/realms/wave';
    process.env.W_ID_CLIENT_ID = 'waveworld';
    process.env.W_ID_CLIENT_SECRET = 'test-secret-not-real';
    process.env.W_ID_REDIRECT_URI = 'http://127.0.0.1:3001/api/v1/auth/oidc/callback';
    process.env.W_ID_DEV_CALLBACK_STUB = '1';
    try {
      const start = await import('../src/app/api/v1/auth/oidc/start/route.ts');
      const callback = await import('../src/app/api/v1/auth/oidc/callback/route.ts');
      const started = await start.GET(new Request('http://localhost/api/v1/auth/oidc/start'));
      assert.equal(started.status, 302);
      const location = new URL(started.headers.get('location')!);
      assert.ok(location.searchParams.get('state'));
      assert.ok(location.searchParams.get('nonce'));
      const setCookies = started.headers.getSetCookie();
      assert.ok(setCookies.some((value) => value.startsWith('ww_oidc_state=')));
      assert.ok(setCookies.some((value) => value.startsWith('ww_oidc_nonce=')));
      assert.ok(setCookies.some((value) => value.startsWith('ww_oidc_flow=')));

      const missingBoth = await callback.GET(new Request(
        `http://localhost/api/v1/auth/oidc/callback?code=test&state=${location.searchParams.get('state')}`
      ));
      assert.equal(missingBoth.status, 400);
      assert.equal((await missingBoth.json() as { error: string }).error, 'invalid state');

      const stateOnly = setCookies.find((value) => value.startsWith('ww_oidc_state='))!.split(';')[0];
      const missingNonce = await callback.GET(new Request(
        `http://localhost/api/v1/auth/oidc/callback?code=test&state=${location.searchParams.get('state')}`,
        { headers: { Cookie: stateOnly } }
      ));
      assert.equal(missingNonce.status, 400);
      assert.equal((await missingNonce.json() as { error: string }).error, 'missing oidc nonce');
    } finally {
      delete process.env.W_ID_ISSUER;
      delete process.env.W_ID_CLIENT_ID;
      delete process.env.W_ID_CLIENT_SECRET;
      delete process.env.W_ID_REDIRECT_URI;
      delete process.env.W_ID_DEV_CALLBACK_STUB;
    }
  });

  it('binds a same-origin returnTo to state and ignores callback query overrides', async () => {
    process.env.W_ID_ISSUER = 'https://id.example/realms/wave';
    process.env.W_ID_CLIENT_ID = 'waveworld';
    process.env.W_ID_CLIENT_SECRET = 'test-secret-not-real';
    process.env.W_ID_REDIRECT_URI = 'https://wave.example/api/v1/auth/oidc/callback';
    process.env.W_ID_DEV_CALLBACK_STUB = '1';
    try {
      const start = await import('../src/app/api/v1/auth/oidc/start/route.ts');
      const callback = await import('../src/app/api/v1/auth/oidc/callback/route.ts');

      for (const attack of ['https://evil.example/steal', '//evil.example/steal', '/\\evil.example/steal']) {
        const rejected = await start.GET(new Request(
          `https://wave.example/api/v1/auth/oidc/start?returnTo=${encodeURIComponent(attack)}`
        ));
        assert.equal(rejected.status, 400);
      }

      const started = await start.GET(new Request(
        'https://wave.example/api/v1/auth/oidc/start?returnTo=%2Fprojects%3Ftab%3Dmine'
      ));
      assert.equal(started.status, 302);
      const authorization = new URL(started.headers.get('location')!);
      const cookie = started.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
      const completed = await callback.GET(new Request(
        `https://wave.example/api/v1/auth/oidc/callback?code=test&state=${authorization.searchParams.get('state')}&returnTo=${encodeURIComponent('https://evil.example/steal')}`,
        { headers: { Cookie: cookie, Accept: 'text/html' } }
      ));
      assert.equal(completed.status, 302);
      assert.equal(completed.headers.get('location'), '/projects?tab=mine');

      const cookies = started.headers.getSetCookie();
      const stateCookie = cookies.find((value) => value.startsWith('ww_oidc_state='))!.split(';')[0];
      const nonceCookie = cookies.find((value) => value.startsWith('ww_oidc_nonce='))!.split(';')[0];
      const flowCookie = cookies.find((value) => value.startsWith('ww_oidc_flow='))!.split(';')[0];
      const flowValue = flowCookie.slice('ww_oidc_flow='.length);
      const flow = JSON.parse(Buffer.from(flowValue, 'base64url').toString('utf8')) as { state: string; returnTo: string };
      flow.state = 'attacker-state';
      const tamperedFlow = `ww_oidc_flow=${Buffer.from(JSON.stringify(flow)).toString('base64url')}`;
      const rejectedFlow = await callback.GET(new Request(
        `https://wave.example/api/v1/auth/oidc/callback?code=test&state=${authorization.searchParams.get('state')}`,
        { headers: { Cookie: `${stateCookie}; ${nonceCookie}; ${tamperedFlow}` } }
      ));
      assert.equal(rejectedFlow.status, 400);
      assert.equal((await rejectedFlow.json() as { error: string }).error, 'invalid oidc flow');
    } finally {
      delete process.env.W_ID_ISSUER;
      delete process.env.W_ID_CLIENT_ID;
      delete process.env.W_ID_CLIENT_SECRET;
      delete process.env.W_ID_REDIRECT_URI;
      delete process.env.W_ID_DEV_CALLBACK_STUB;
    }
  });
});
