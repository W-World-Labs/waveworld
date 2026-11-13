import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const savedEnv = { ...process.env };
let dir: string;
before(() => {
  const root = path.resolve(__dirname, '../../../.runtime');
  fs.mkdirSync(root, { recursive: true });
  dir = fs.mkdtempSync(path.join(root, 'cookie-write-origin-'));
  Object.assign(process.env, { NODE_ENV: 'production', TASK_DB_PATH: path.join(dir, 'tasks.db') });
  delete process.env.WAVEWORLD_CORS_ORIGINS;
});
after(() => {
  for (const key of ['NODE_ENV', 'TASK_DB_PATH', 'WAVEWORLD_CORS_ORIGINS']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: savedEnv[key] });
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('foreign-origin simple POST cannot mutate a cookie-authenticated project', async () => {
  const { devLogin } = await import('../src/lib/user-auth');
  const { listProjectsForUser } = await import('../src/lib/project-service');
  const { POST } = await import('../src/app/api/v1/projects/route');
  const { user, token } = await devLogin({ name: 'csrf-project-owner', workspaceId: 'csrf' });
  for (const origin of ['https://untrusted.example.test', 'null']) {
    const response = await POST(new Request('https://waveworld.example.test/api/v1/projects', {
      method: 'POST', headers: { Origin: origin, Cookie: `ww_session=${token}`, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ name: 'forged project' }),
    }));
    assert.equal(response.status, 403, 'simple requests must be rejected before a mutation, not merely hidden by CORS');
    assert.deepEqual(await listProjectsForUser({ userId: user.id, workspaceId: user.workspaceId }), []);
  }
});

test('cookie logout also rejects foreign origins without revoking the session', async () => {
  const { devLogin, resolveUser } = await import('../src/lib/user-auth');
  const { POST } = await import('../src/app/api/v1/auth/logout/route');
  const { token } = await devLogin({ name: 'csrf-logout-owner', workspaceId: 'csrf' });
  const cookie = `ww_session=${token}`;
  const rejected = await POST(new Request('https://waveworld.example.test/api/v1/auth/logout', {
    method: 'POST', headers: { Origin: 'https://untrusted.example.test', Cookie: cookie },
  }));
  assert.equal(rejected.status, 403);
  assert.ok(await resolveUser(new Request('https://waveworld.example.test/api/v1/me', { headers: { Cookie: cookie } })));
  const accepted = await POST(new Request('https://waveworld.example.test/api/v1/auth/logout', {
    method: 'POST', headers: { Origin: 'https://waveworld.example.test', Cookie: cookie },
  }));
  assert.equal(accepted.status, 200);
  assert.equal(await resolveUser(new Request('https://waveworld.example.test/api/v1/me', { headers: { Cookie: cookie } })), null);
});

test('logout cannot clear a browser session through a foreign POST that omitted its SameSite cookie', async () => {
  const { POST } = await import('../src/app/api/v1/auth/logout/route');
  const foreignHeaders: Record<string, string>[] = [
    { Origin: 'https://untrusted.example.test' },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' },
  ];
  for (const headers of foreignHeaders) {
    const response = await POST(new Request('https://waveworld.example.test/api/v1/auth/logout', {
      method: 'POST', headers,
    }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null, 'rejected logout must not clear a cookie omitted by SameSite');
  }
  const sameOrigin = await POST(new Request('https://waveworld.example.test/api/v1/auth/logout', {
    method: 'POST', headers: { Origin: 'https://waveworld.example.test' },
  }));
  assert.equal(sameOrigin.status, 200);
  assert.match(sameOrigin.headers.get('set-cookie') ?? '', /ww_session=;.*Max-Age=0/);
});

test('explicit Bearer logout remains usable without ambient cookie authority', async () => {
  const { devLogin, resolveUser } = await import('../src/lib/user-auth');
  const { POST } = await import('../src/app/api/v1/auth/logout/route');
  const { token } = await devLogin({ name: 'bearer-logout-owner', workspaceId: 'csrf' });
  const response = await POST(new Request('https://waveworld.example.test/api/v1/auth/logout', {
    method: 'POST', headers: { Origin: 'https://untrusted.example.test', Authorization: `Bearer ${token}` },
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revoked, true);
  assert.equal(await resolveUser(new Request('https://waveworld.example.test/api/v1/me', {
    headers: { Authorization: `Bearer ${token}` },
  })), null);
});

test('same-origin, explicit CORS clients, and bearer clients retain write access behind the proxy', async () => {
  const { devLogin } = await import('../src/lib/user-auth');
  const { POST } = await import('../src/app/api/v1/projects/route');
  const { token } = await devLogin({ name: 'csrf-allowed-owner', workspaceId: 'csrf' });
  const cookie = `ww_session=${token}`;
  const create = (url: string, headers: Record<string, string>) => POST(new Request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'allowed project' }),
  }));
  assert.equal((await create('https://waveworld.example.test/api/v1/projects', { Origin: 'https://waveworld.example.test', Cookie: cookie })).status, 201);
  const proxy = { Host: 'waveworld.example.test', 'X-Forwarded-Proto': 'https', Cookie: cookie };
  assert.equal((await create('http://127.0.0.1:3001/api/v1/projects', { ...proxy, Origin: 'https://waveworld.example.test' })).status, 201);
  assert.equal((await create('http://127.0.0.1:3001/api/v1/projects', { ...proxy, Origin: 'http://waveworld.example.test' })).status, 403);
  assert.equal((await create('https://waveworld.example.test/api/v1/projects', { Origin: 'https://untrusted.example.test', Authorization: `Bearer ${token}`, Cookie: cookie })).status, 201);
  process.env.WAVEWORLD_CORS_ORIGINS = 'https://atlas.example.test';
  assert.equal((await create('https://waveworld.example.test/api/v1/projects', { Origin: 'https://atlas.example.test', Cookie: cookie })).status, 201);
  delete process.env.WAVEWORLD_CORS_ORIGINS;
  assert.equal((await create('https://waveworld.example.test/api/v1/projects', { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await create('https://waveworld.example.test/api/v1/projects', { Cookie: cookie, 'Sec-Fetch-Site': 'same-site' })).status, 403);
  assert.equal((await create('https://waveworld.example.test/api/v1/projects', { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' })).status, 201);
});
