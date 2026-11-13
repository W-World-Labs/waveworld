/**
 * Review issues #61–#68: headers, rate limit, share query, sessions,
 * workspace bind, operator metrics, orphan artifacts, operator keys.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');
const testDb = path.join(waveRoot, 'data', 'tasks-test-review-61-68.db');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(testDb + suffix);
    } catch {
      /* absent */
    }
  }
});

describe('security headers (#61)', () => {
  it('Atlas, Host, Lab, and source Caddy example emit CSP + HSTS', () => {
    const files = [
      path.join(waveRoot, 'public/_headers'),
      path.join(waveRoot, 'apps/host/next.config.mjs'),
      path.join(waveRoot, 'apps/lab/next.config.ts'),
      path.join(waveRoot, 'config/Caddyfile.example'),
    ];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      assert.match(src, /Strict-Transport-Security/, file);
      if (!file.includes('next.config.')) {
        assert.match(src, /Content-Security-Policy/, file);
        assert.match(src, /script-src 'self'/, file);
      }
      assert.doesNotMatch(src, /script-src[^;]*'unsafe-inline'/, file);
      if (file.endsWith('Caddyfile.example')) {
        assert.match(src, /header_down Cache-Control "no-store"/);
        assert.doesNotMatch(src, /header_down -Cache-Control/);
      }
    }
    const { CONTENT_SECURITY_POLICY, STRICT_TRANSPORT_SECURITY } = require('../src/lib/security-headers.ts');
    assert.match(CONTENT_SECURITY_POLICY, /script-src 'self'/);
    assert.match(CONTENT_SECURITY_POLICY, /connect-src 'self' https:\/\/radar\.myfastools\.com/);
    assert.match(STRICT_TRANSPORT_SECURITY, /max-age=31536000/);
    const browserEntries = [
      ['apps/host/src/app/layout.tsx', 'waveworld-host'],
      ['apps/lab/src/app/layout.tsx', 'waveworld-lab'],
    ] as const;
    for (const [file, service] of browserEntries) {
      const layout = fs.readFileSync(path.join(waveRoot, file), 'utf8');
      assert.equal((layout.match(/platform\/bootstrap\.js/g) ?? []).length, 1, file);
      assert.match(layout, new RegExp(`data-client-kind="${service}"`), file);
      assert.match(layout, /data-code="W-WAVEWORLD-76B94EFF"/, file);
      assert.match(layout, /data-track-behavior="true"/, file);
      assert.match(layout, /data-error-capture="true"/, file);
      assert.match(layout, /data-track-performance="true"/, file);
    }
    const hostApi = fs.readFileSync(path.join(waveRoot, 'src/lib/hostApi.ts'), 'utf8');
    assert.match(hostApi, /XSS blast radius/);
  });

  it('Host authorizes only its own request nonce and does not cache documents', async () => {
    const { NextRequest } = await import('next/server');
    const { middleware } = await import('../src/middleware.ts');
    const request = new NextRequest('https://waveworld.example/lab', {
      headers: { 'x-nonce': 'attacker', 'Content-Security-Policy': "script-src 'unsafe-inline'" },
    });
    const first = middleware(request);
    const second = middleware(request);
    const policy = first.headers.get('Content-Security-Policy')!;
    assert.match(policy, /script-src 'self' https:\/\/radar\.myfastools\.com 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    assert.doesNotMatch(policy, /script-src[^;]*(unsafe-inline|unsafe-eval|attacker)/);
    assert.equal(first.headers.get('x-middleware-request-content-security-policy'), policy);
    const nonce = first.headers.get('x-middleware-request-x-nonce');
    assert.ok(nonce && policy.includes(`'nonce-${nonce}'`));
    assert.notEqual(second.headers.get('Content-Security-Policy'), policy);
    assert.equal(first.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(first.headers.get('Access-Control-Allow-Origin'), null);
  });

  it('only the configured exact loopback origin can embed the standalone Lab', async () => {
    const { documentRequestHeaders } = await import('../src/lib/security-headers.ts');
    const policy = (origin: string, dev = false) =>
      documentRequestHeaders(new Headers(), dev, origin).get('Content-Security-Policy')!;
    assert.match(policy('http://127.0.0.1:4173'), /frame-ancestors 'self' http:\/\/127.0.0.1:4173;/);
    for (const origin of ['https://evil.example', 'http://localhost:4173/path', 'http://localhost:4173@evil.example', 'invalid']) {
      assert.match(policy(origin), /frame-ancestors 'self';/);
    }
    assert.match(policy('', true), /'unsafe-eval'/);
    assert.match(policy('', true), /connect-src 'self' https:\/\/radar\.myfastools\.com ws:;/);
    assert.doesNotMatch(policy(''), /unsafe-eval|ws:/);
  });
});

describe('rate limit (#62)', () => {
  it('rateLimitTake fails closed after the window limit; login route returns 429', async () => {
    const { rateLimitTake, consumeRateLimit, resetRateLimitsForTests } = await import(
      '../src/lib/rate-limit.ts'
    );
    resetRateLimitsForTests();
    const key = 'test-login:1.2.3.4';
    for (let i = 0; i < 20; i++) {
      assert.equal(rateLimitTake(key, 20, 60_000).ok, true);
    }
    // The first rejection per key+window logs one [host:rate-limit] line;
    // later in-window rejections must not re-log (a flood must not spam logs).
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (m: string) => { warns.push(String(m)); };
    try {
      const blocked = rateLimitTake(key, 20, 60_000);
      assert.equal(blocked.ok, false);
      assert.ok(blocked.retryAfterSec >= 1);
      assert.equal(rateLimitTake(key, 20, 60_000).ok, false);
    } finally {
      console.warn = origWarn;
    }
    assert.equal(warns.length, 1);
    assert.match(warns[0], /host:rate-limit.*test-login/);

    resetRateLimitsForTests();
    const { POST } = await import('../src/app/api/v1/auth/dev-login/route.ts');
    const hit = () =>
      POST(
        new Request('http://localhost/api/v1/auth/dev-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
          body: JSON.stringify({ name: 'rate-user' }),
        }),
      );
    let saw429 = false;
    for (let i = 0; i < 25; i++) {
      const res = await hit();
      if (res.status === 429) {
        saw429 = true;
        const body = (await res.json()) as { error?: string };
        assert.equal(body.error, 'rate_limited');
        break;
      }
    }
    assert.equal(saw429, true);
    resetRateLimitsForTests();
    const sample = consumeRateLimit(
      new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.10' } }),
      'login',
    );
    assert.equal(sample.ok, true);
  });

  it('claim route rate-limits per agent; a runaway poller gets shed without touching peers', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { POST } = await import('../src/app/api/v1/jobs/claim/route.ts');
    const runaway = await registerAgent({ name: 'claim-runaway' });
    const bystander = await registerAgent({ name: 'claim-bystander' });
    const claim = (token: string) =>
      POST(new Request('http://localhost/api/v1/jobs/claim', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      }));

    let saw429 = false;
    for (let i = 0; i < 300; i++) {
      const res = await claim(runaway.token);
      if (res.status === 429) {
        saw429 = true;
        assert.equal(((await res.json()) as { error?: string }).error, 'rate_limited');
        assert.ok(Number(res.headers.get('retry-after')) >= 1);
        break;
      }
      assert.ok(res.status === 200 || res.status === 204, `unexpected claim status ${res.status}`);
    }
    assert.equal(saw429, true);

    // Per-agent keying: the bystander still claims normally (200 if a job
    // is queued, 204 when empty — either way it is not 429).
    const res = await claim(bystander.token);
    assert.ok(res.status === 200 || res.status === 204, `bystander got ${res.status}`);
    resetRateLimitsForTests();
  });

  it('heartbeat route rate-limits per executor; transient 429 is a retriable beat', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { createJob, claimJob } = await import('../src/lib/tasks/service.ts');
    const { POST } = await import('../src/app/api/v1/jobs/[id]/heartbeat/route.ts');
    const { agent, token } = await registerAgent({ name: 'hb-runaway' });
    const spec = {
      schemaVersion: 1 as const, kind: 'export-report' as const, name: 'hb-job',
      parameters: { reportType: 'audit' }, run: { maxSteps: 1 },
      outputs: { forces: false, history: false },
    };
    const job = createJob({ spec, createdBy: 'u' });
    const leased = claimJob({ agentId: agent.id, jobId: job.id, capabilities: { backends: ['cpu'], kinds: ['export-report'] } });
    assert.ok(leased);
    const beat = () =>
      POST(new Request(`http://localhost/api/v1/jobs/${job.id}/heartbeat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      }), { params: Promise.resolve({ id: job.id }) });

    let saw429 = false;
    for (let i = 0; i < 600; i++) {
      const res = await beat();
      if (res.status === 429) { saw429 = true; break; }
      assert.equal(res.status, 200, `beat ${i} → ${res.status}`);
    }
    assert.equal(saw429, true);
    resetRateLimitsForTests();
  });

  it('clientRateKey uses the edge-observed hop, not the client-forgeable leftmost XFF', async () => {
    const { clientRateKey, rateLimitTake, resetRateLimitsForTests } = await import(
      '../src/lib/rate-limit.ts'
    );
    // A spoofed leftmost chain: the rightmost entry is what our edge observed.
    const spoofed = new Request('http://x', {
      headers: { 'x-forwarded-for': '198.51.100.1, 198.51.100.2, 203.0.113.7' },
    });
    assert.equal(clientRateKey(spoofed, 'b'), 'b:203.0.113.7');
    // cf-connecting-ip (edge-rewritten by Cloudflare) wins over XFF entirely.
    const cf = new Request('http://x', {
      headers: {
        'cf-connecting-ip': '198.51.100.99',
        'x-forwarded-for': '203.0.113.7',
      },
    });
    assert.equal(clientRateKey(cf, 'b'), 'b:198.51.100.99');
    // x-real-ip outranks XFF but not cf-connecting-ip.
    const real = new Request('http://x', {
      headers: { 'x-real-ip': '198.51.100.5', 'x-forwarded-for': '203.0.113.7' },
    });
    assert.equal(clientRateKey(real, 'b'), 'b:198.51.100.5');
    // Rotating forged leftmost entries shares one bucket — the limit holds.
    resetRateLimitsForTests();
    for (let i = 0; i < 30; i++) {
      const req = new Request('http://x', {
        headers: { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` },
      });
      rateLimitTake(clientRateKey(req, 'login'), 20, 60_000);
    }
    const blocked = new Request('http://x', {
      headers: { 'x-forwarded-for': '10.9.9.9, 203.0.113.7' },
    });
    assert.equal(rateLimitTake(clientRateKey(blocked, 'login'), 20, 60_000).ok, false);
    resetRateLimitsForTests();
  });

  it('key table is bounded: full table sweeps expired, then fails closed for new keys', async () => {
    const { rateLimitTake, resetRateLimitsForTests, MAX_RATE_LIMIT_KEYS } = await import(
      '../src/lib/rate-limit.ts'
    );
    resetRateLimitsForTests();
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_RATE_LIMIT_KEYS; i++) {
      assert.equal(rateLimitTake(`flood:${i}`, 5, 60_000, t0).ok, true);
    }
    // Still inside the window: a fresh key must fail closed, not grow the map.
    const overflow = rateLimitTake('flood:new', 5, 60_000, t0 + 1_000);
    assert.equal(overflow.ok, false);
    assert.ok(overflow.retryAfterSec >= 1);
    // Tracked keys still work while the table is full.
    assert.equal(rateLimitTake('flood:0', 5, 60_000, t0 + 1_000).ok, true);
    // After the window the sweep reclaims expired entries for new keys.
    assert.equal(rateLimitTake('flood:later', 5, 60_000, t0 + 61_000).ok, true);
    resetRateLimitsForTests();
  });

  it('artifact POST is principal-rate-limited and kind is length-bound', async () => {
    const { resetRateLimitsForTests, RATE_LIMIT_WINDOWS } = await import('../src/lib/rate-limit.ts');
    const { devLogin } = await import('../src/lib/user-auth.ts');
    const upload = await import('../src/app/api/v1/artifacts/route.ts');
    const artifactRoot = path.join(waveRoot, 'data', 'artifacts-test-rl');
    process.env.ARTIFACT_ROOT = artifactRoot;
    fs.rmSync(artifactRoot, { recursive: true, force: true });
    resetRateLimitsForTests();
    const alice = await devLogin({ name: 'rl-alice', workspaceId: 'rl-tests' });
    const post = (kind = 'log') =>
      upload.POST(new Request('http://host.test/api/v1/artifacts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, base64: Buffer.from('x').toString('base64') }),
      }));
    // Overlong kind is rejected before any storage work.
    assert.equal((await post('k'.repeat(200))).status, 400);
    resetRateLimitsForTests();
    // 120 uploads/min per principal succeed; #121 is rate_limited.
    for (let i = 0; i < RATE_LIMIT_WINDOWS.artifactUpload.limit; i++) {
      const res = await post();
      assert.equal(res.status, 201, await res.clone().text());
    }
    const blocked = await post();
    assert.equal(blocked.status, 429);
    // A different principal keeps its own bucket — not collateral of alice's flood.
    const bob = await devLogin({ name: 'rl-bob', workspaceId: 'rl-tests' });
    const bobRes = await upload.POST(new Request('http://host.test/api/v1/artifacts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${bob.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'log', base64: Buffer.from('x').toString('base64') }),
    }));
    assert.equal(bobRes.status, 201, await bobRes.clone().text());
    resetRateLimitsForTests();
    fs.rmSync(artifactRoot, { recursive: true, force: true });
    delete process.env.ARTIFACT_ROOT;
  });
});

describe('share query locked in production (#63)', () => {
  it('shareTokenFromRequest ignores ?share= when NODE_ENV=production', async () => {
    const { shareTokenFromRequest, shareQueryAllowed } = await import('../src/lib/job-sharing.ts');
    assert.equal(shareQueryAllowed({ NODE_ENV: 'production' }), false);
    assert.equal(shareQueryAllowed({ NODE_ENV: 'production', SHARE_ALLOW_QUERY: '1' }), true);
    const token = 'shr_' + 'a'.repeat(24);
    const q = new Request(`http://localhost/api/v1/jobs/x?share=${token}`);
    assert.equal(shareTokenFromRequest(q, { NODE_ENV: 'production' }), null);
    const h = new Request('http://localhost/api/v1/jobs/x', {
      headers: { 'x-waveworld-share': token },
    });
    assert.equal(shareTokenFromRequest(h, { NODE_ENV: 'production' }), token);
  });
});

describe('session revoke on re-login (#64)', () => {
  it('second issueSession invalidates the first token', async () => {
    const { devLogin, resolveUser } = await import('../src/lib/user-auth.ts');
    const a = await devLogin({ name: 'revoke-alice', workspaceId: 'ws-rev' });
    const b = await devLogin({ name: 'revoke-alice', workspaceId: 'ws-rev' });
    assert.notEqual(a.token, b.token);
    assert.equal(
      await resolveUser(new Request('http://x', { headers: { Authorization: `Bearer ${a.token}` } })),
      null,
    );
    const still = await resolveUser(
      new Request('http://x', { headers: { Authorization: `Bearer ${b.token}` } }),
    );
    assert.equal(still?.id, a.user.id);
  });
});

describe('project workspace from session (#65)', () => {
  it('createProject rejects a foreign workspaceId', async () => {
    const { createProject } = await import('../src/lib/project-service.ts');
    const owner = { id: 'user-ws-65', workspaceId: 'ws-home', name: 'Pat' };
    await assert.rejects(
      () => createProject(owner, { name: 'x', workspaceId: 'ws-foreign' }),
      /workspaceId must match/,
    );
    const ok = await createProject(owner, { name: 'home-proj' });
    assert.equal(ok.workspaceId, 'ws-home');
  });
});

describe('operator-only metrics (#66)', () => {
  it('allowOperatorProbe rejects a logged-in user without operator key', async () => {
    const { allowOperatorProbe } = await import('../src/lib/operator-auth.ts');
    const prior = process.env.TASK_API_KEY;
    const priorEnv = process.env.NODE_ENV;
    process.env.TASK_API_KEY = 'metrics-op-key-66';
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const user = await devLogin({ name: 'metrics-user', workspaceId: 'ws-m' });
      const userReq = new Request('http://localhost/api/v1/metrics', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      assert.equal(allowOperatorProbe(userReq), false);
      const opReq = new Request('http://localhost/api/v1/metrics', {
        headers: { 'x-api-key': 'metrics-op-key-66' },
      });
      assert.equal(allowOperatorProbe(opReq), true);
      const { GET } = await import('../src/app/api/v1/metrics/route.ts');
      const denied = await GET(userReq);
      assert.equal(denied.status, 401);
      const allowed = await GET(opReq);
      assert.equal(allowed.status, 200);
    } finally {
      Object.assign(process.env, { NODE_ENV: priorEnv });
      if (prior === undefined) delete process.env.TASK_API_KEY;
      else process.env.TASK_API_KEY = prior;
    }
  });
});

describe('orphan artifacts (#67)', () => {
  it('userMayAccessArtifact is false without project or owner', async () => {
    const { userMayAccessArtifact } = await import('@/lib/tasks/artifacts.ts');
    assert.equal(
      userMayAccessArtifact(
        {
          id: 'a',
          jobId: null,
          projectId: null,
          ownerUserId: null,
          kind: 'log',
          storageKey: 'x',
          contentType: 'text/plain',
          bytes: 1,
          sha256: null,
          createdAt: new Date().toISOString(),
        },
        { id: 'anyone' },
        null,
      ),
      false,
    );
  });
});

describe('operator key radius (#68)', () => {
  it('checkSubmitAuth uses constant-time compare and production has no TASK_API_KEY register fallback', async () => {
    const { checkSubmitAuth } = await import('@/lib/tasks/auth-agent.ts');
    const priorKey = process.env.TASK_API_KEY;
    const priorEnv = process.env.NODE_ENV;
    process.env.TASK_API_KEY = 'submit-secret-68';
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      assert.equal(
        checkSubmitAuth(new Request('http://x', { headers: { 'x-api-key': 'wrong-secret-68' } })), // gitleaks:allow -- deliberately rejected synthetic auth fixture.
        false,
      );
      assert.equal(
        checkSubmitAuth(new Request('http://x', { headers: { 'x-api-key': 'submit-secret-68' } })),
        true,
      );
      const src = fs.readFileSync(
        path.join(waveRoot, 'apps/host/src/lib/tasks/auth-agent.ts'),
        'utf8',
      );
      assert.match(src, /timingSafeEqual|sameSecretLocal/);
      assert.doesNotMatch(src, /x-api-key'\) === key/);
      const regSrc = fs.readFileSync(
        path.join(waveRoot, 'apps/host/src/app/api/v1/agents/register/route.ts'),
        'utf8',
      );
      assert.match(regSrc, /NODE_ENV === 'production'/);
    } finally {
      Object.assign(process.env, { NODE_ENV: priorEnv });
      if (priorKey === undefined) delete process.env.TASK_API_KEY;
      else process.env.TASK_API_KEY = priorKey;
    }
  });
});
