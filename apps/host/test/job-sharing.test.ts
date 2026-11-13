import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const testDb = path.resolve(here, '../../../data/tasks-test-job-sharing.db');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  for (const suffix of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + suffix); } catch { /* absent */ }
});

function spec() {
  return {
    schemaVersion: 1 as const, kind: 'export-report' as const, name: 'private-result',
    parameters: { reportType: 'audit' }, run: { maxSteps: 1 }, outputs: { forces: false, history: false },
  };
}

describe('production job authorization and scoped sharing', { concurrency: false }, () => {
  it('denies anonymous/other users, grants owner and revocable read-only share token', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const { createJob } = await import('@/lib/tasks/service.ts');
      const { saveArtifact } = await import('@/lib/tasks/artifacts.ts');
      const { createJobShare, requestMayAccessJob, revokeJobShare, shareAllowsJob } = await import('../src/lib/job-sharing.ts');
      const alice = await devLogin({ name: 'share-alice', workspaceId: 'ws-share' });
      const bob = await devLogin({ name: 'share-bob', workspaceId: 'ws-share' });
      const job = createJob({ spec: spec(), createdBy: alice.user.id });
      const req = (token?: string) => new Request('http://localhost/api/v1/jobs/' + job.id, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
      assert.equal(await requestMayAccessJob(req(), job, 'read'), false);
      assert.equal(await requestMayAccessJob(req(bob.token), job, 'read'), false);
      assert.equal(await requestMayAccessJob(req(alice.token), job, 'read'), true);

      const share = await createJobShare({ user: alice.user, jobs: [job], expiresInSeconds: 600 });
      assert.ok(share.token.startsWith('shr_'));
      assert.equal(await shareAllowsJob(share.token, job.id), true);
      const shareHeaders = { 'x-waveworld-share': share.token };
      assert.equal(await requestMayAccessJob(new Request(`http://localhost/api/v1/jobs/${job.id}`, { headers: shareHeaders }), job, 'read'), true);
      assert.equal(await requestMayAccessJob(new Request(`http://localhost/api/v1/jobs/${job.id}`, { headers: shareHeaders }), job, 'edit'), false);
      assert.equal(await requestMayAccessJob(new Request(`http://localhost/api/v1/jobs/${job.id}?share=${share.token}`), job, 'read'), false);
      const jobRoute = await import('../src/app/api/v1/jobs/[id]/route.ts');
      const sharedJob = await jobRoute.GET(new Request(`http://localhost/api/v1/jobs/${job.id}`, { headers: shareHeaders }), { params: Promise.resolve({ id: job.id }) });
      assert.equal(sharedJob.status, 200);
      const deniedJob = await jobRoute.GET(req(bob.token), { params: Promise.resolve({ id: job.id }) });
      assert.equal(deniedJob.status, 404);
      const artifact = saveArtifact({ jobId: job.id, ownerUserId: alice.user.id, kind: 'report', contentType: 'application/json', data: Buffer.from('{"ok":true}') });
      const artifactRoute = await import('../src/app/api/v1/artifacts/[id]/route.ts');
      const downloaded = await artifactRoute.GET(new Request(`http://localhost/api/v1/artifacts/${artifact.id}`, { headers: shareHeaders }), { params: Promise.resolve({ id: artifact.id }) });
      assert.equal(downloaded.status, 200);
      assert.equal(downloaded.headers.get('x-artifact-sha256'), artifact.sha256);
      assert.equal(await revokeJobShare(share.id, bob.user.id), false);
      assert.equal(await revokeJobShare(share.id, alice.user.id), true);
      assert.equal(await shareAllowsJob(share.token, job.id), false);
      const deniedArtifact = await artifactRoute.GET(new Request(`http://localhost/api/v1/artifacts/${artifact.id}`, { headers: shareHeaders }), { params: Promise.resolve({ id: artifact.id }) });
      assert.equal(deniedArtifact.status, 401);
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
    }
  });

  it('fails closed for Agent registration and queue stats in production', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorKey = process.env.AGENT_REGISTRATION_KEY;
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.AGENT_REGISTRATION_KEY = 'registration-secret';
    try {
      const register = await import('../src/app/api/v1/agents/register/route.ts');
      const body = JSON.stringify({ name: 'unauthorized-agent' });
      const denied = await register.POST(new Request('http://localhost/api/v1/agents/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
      assert.equal(denied.status, 401);
      const accepted = await register.POST(new Request('http://localhost/api/v1/agents/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'registration-secret' }, body }));
      assert.equal(accepted.status, 201);

      const stats = await import('../src/app/api/v1/jobs/stats/route.ts');
      const hidden = await stats.GET(new Request('http://localhost/api/v1/jobs/stats'));
      assert.equal(hidden.status, 401);
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
      if (priorKey === undefined) delete process.env.AGENT_REGISTRATION_KEY;
      else process.env.AGENT_REGISTRATION_KEY = priorKey;
    }
  });

  it('agents/register bounds name length and rejects control characters', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorKey = process.env.AGENT_REGISTRATION_KEY;
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.AGENT_REGISTRATION_KEY = 'registration-secret';
    try {
      const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
      resetRateLimitsForTests();
      const register = await import('../src/app/api/v1/agents/register/route.ts');
      const post = (name: string) =>
        register.POST(new Request('http://localhost/api/v1/agents/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': 'registration-secret' },
          body: JSON.stringify({ name }),
        }));
      assert.equal((await post('x'.repeat(200))).status, 400);
      assert.equal((await post('ok-agent\nforged-log-line')).status, 400);
      assert.equal((await post('valid-agent-name')).status, 201);
    } finally {
      // The register bucket is 10/min and even denied calls consume slots —
      // leave a clean slate so sibling tests keep their own budget.
      const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
      resetRateLimitsForTests();
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
      if (priorKey === undefined) delete process.env.AGENT_REGISTRATION_KEY;
      else process.env.AGENT_REGISTRATION_KEY = priorKey;
    }
  });

  it('requestMayAccessJob accepts operator x-api-key via shared sameSecret (residual after aabd0bf)', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorKey = process.env.TASK_API_KEY;
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.TASK_API_KEY = 'job-share-operator-key-wave25';
    try {
      const { createJob } = await import('@/lib/tasks/service.ts');
      const { requestMayAccessJob } = await import('../src/lib/job-sharing.ts');
      const job = createJob({ spec: spec(), createdBy: 'ops-user' });
      const denied = new Request(`http://localhost/api/v1/jobs/${job.id}`, {
        headers: { 'x-api-key': 'wrong-key' },
      });
      const allowed = new Request(`http://localhost/api/v1/jobs/${job.id}`, {
        headers: { 'x-api-key': 'job-share-operator-key-wave25' },
      });
      assert.equal(await requestMayAccessJob(denied, job, 'read'), false);
      assert.equal(await requestMayAccessJob(allowed, job, 'read'), true);
      // Source pin: job-sharing must use shared sameSecret (not plain ===)
      const src = fs.readFileSync(path.resolve(here, '../src/lib/job-sharing.ts'), 'utf8');
      assert.match(src, /sameSecret/);
      assert.doesNotMatch(src, /x-api-key'\)\s*===\s*apiKey/);
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
      if (priorKey === undefined) delete process.env.TASK_API_KEY;
      else process.env.TASK_API_KEY = priorKey;
    }
  });

  it('agents/register uses shared sameSecret for registration key (residual after 7290c1c)', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorKey = process.env.AGENT_REGISTRATION_KEY;
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.AGENT_REGISTRATION_KEY = 'agent-reg-same-secret-wave26';
    try {
      const register = await import('../src/app/api/v1/agents/register/route.ts');
      const body = JSON.stringify({ name: 'wave26-reg-agent' });
      const wrong = await register.POST(
        new Request('http://localhost/api/v1/agents/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong-reg-key' },
          body,
        }),
      );
      assert.equal(wrong.status, 401);
      const ok = await register.POST(
        new Request('http://localhost/api/v1/agents/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'agent-reg-same-secret-wave26',
          },
          body,
        }),
      );
      assert.equal(ok.status, 201);
      const raw = await ok.text();
      assert.doesNotMatch(raw, /agent-reg-same-secret-wave26/);
      // Source pin: register must use shared sameSecret (not local timingSafeEqual)
      const src = fs.readFileSync(
        path.resolve(here, '../src/app/api/v1/agents/register/route.ts'),
        'utf8',
      );
      assert.match(src, /sameSecret/);
      assert.doesNotMatch(src, /timingSafeEqual/);
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
      if (priorKey === undefined) delete process.env.AGENT_REGISTRATION_KEY;
      else process.env.AGENT_REGISTRATION_KEY = priorKey;
    }
  });

  it('agents/register is no-store on 401/201 and accepts TASK_API_KEY fallback (residual after 6d2ecaa)', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorReg = process.env.AGENT_REGISTRATION_KEY;
    const priorTask = process.env.TASK_API_KEY;
    Object.assign(process.env, { NODE_ENV: 'production' });
    delete process.env.AGENT_REGISTRATION_KEY;
    process.env.TASK_API_KEY = 'task-api-fallback-reg-wave27';
    try {
      const register = await import('../src/app/api/v1/agents/register/route.ts');
      const body = JSON.stringify({ name: 'wave27-reg-agent' });
      const wrong = await register.POST(
        new Request('http://localhost/api/v1/agents/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong' },
          body,
        }),
      );
      assert.equal(wrong.status, 401);
      // Residual after 6d2ecaa: 401 no-store + Surrogate-Control (never cache auth failures)
      assert.match(wrong.headers.get('cache-control') ?? '', /no-store/i);
      assert.match(wrong.headers.get('surrogate-control') ?? '', /no-store/i);
      assert.equal(wrong.headers.get('expires'), '0');
      const wrongText = await wrong.text();
      assert.doesNotMatch(wrongText, /task-api-fallback-reg-wave27/);

      const ok = await register.POST(
        new Request('http://localhost/api/v1/agents/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'task-api-fallback-reg-wave27',
          },
          body,
        }),
      );
      // #68: production must not fall back from AGENT_REGISTRATION_KEY to TASK_API_KEY
      assert.equal(ok.status, 401);
      assert.match(ok.headers.get('cache-control') ?? '', /no-store/i);
      assert.match(ok.headers.get('surrogate-control') ?? '', /no-store/i);
      const payload = await ok.text();
      assert.doesNotMatch(payload, /task-api-fallback-reg-wave27/);

      // Source pin: PROBE_NO_STORE_HEADERS + safeOperationalErrorMessage on register
      const src = fs.readFileSync(
        path.resolve(here, '../src/app/api/v1/agents/register/route.ts'),
        'utf8',
      );
      assert.match(src, /PROBE_NO_STORE_HEADERS/);
      assert.match(src, /safeOperationalErrorMessage/);
      assert.match(src, /sameSecret/);
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
      if (priorReg === undefined) delete process.env.AGENT_REGISTRATION_KEY;
      else process.env.AGENT_REGISTRATION_KEY = priorReg;
      if (priorTask === undefined) delete process.env.TASK_API_KEY;
      else process.env.TASK_API_KEY = priorTask;
    }
  });

  it('job-sharing edge: non-shr_ share param denied; JOB_REQUIRE_AUTH=1 closes dev open (residual after 6d2ecaa)', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorRequire = process.env.JOB_REQUIRE_AUTH;
    const priorKey = process.env.TASK_API_KEY;
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env.JOB_REQUIRE_AUTH = '1';
    delete process.env.TASK_API_KEY;
    try {
      const { createJob } = await import('@/lib/tasks/service.ts');
      const {
        requestMayAccessJob,
        shareTokenFromRequest,
      } = await import('../src/lib/job-sharing.ts');
      const job = createJob({ spec: spec(), createdBy: 'edge-owner' });
      // bare ?share= without shr_ prefix must not grant access
      const bare = new Request(`http://localhost/api/v1/jobs/${job.id}?share=not-a-share-token`);
      assert.equal(shareTokenFromRequest(bare), null);
      assert.equal(await requestMayAccessJob(bare, job, 'read'), false);
      // empty share
      assert.equal(
        shareTokenFromRequest(new Request(`http://localhost/api/v1/jobs/${job.id}?share=`)),
        null,
      );
      // no credentials + JOB_REQUIRE_AUTH=1 → deny even outside production
      assert.equal(
        await requestMayAccessJob(new Request(`http://localhost/api/v1/jobs/${job.id}`), job, 'read'),
        false,
      );
      // empty/missing TASK_API_KEY never grants via x-api-key
      assert.equal(
        await requestMayAccessJob(
          new Request(`http://localhost/api/v1/jobs/${job.id}`, {
            headers: { 'x-api-key': 'anything' },
          }),
          job,
          'read',
        ),
        false,
      );
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
      if (priorRequire === undefined) delete process.env.JOB_REQUIRE_AUTH;
      else process.env.JOB_REQUIRE_AUTH = priorRequire;
      if (priorKey === undefined) delete process.env.TASK_API_KEY;
      else process.env.TASK_API_KEY = priorKey;
    }
  });

  it('auth edge residual after f8da984: configured register key always; bare shr_ rejected; JOB_REQUIRE_AUTH register', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorRequire = process.env.JOB_REQUIRE_AUTH;
    const priorReg = process.env.AGENT_REGISTRATION_KEY;
    const priorTask = process.env.TASK_API_KEY;
    Object.assign(process.env, { NODE_ENV: 'development' });
    delete process.env.JOB_REQUIRE_AUTH;
    process.env.AGENT_REGISTRATION_KEY = 'dev-reg-key-wave28-must-enforce';
    delete process.env.TASK_API_KEY;
    try {
      const {
        shareTokenFromRequest,
        isPlausibleShareToken,
      } = await import('../src/lib/job-sharing.ts');
      // Residual after f8da984: bare shr_ / too-short prefixes never grant
      assert.equal(isPlausibleShareToken('shr_'), false);
      assert.equal(isPlausibleShareToken('shr_short'), false);
      assert.equal(isPlausibleShareToken('not-a-share'), false);
      assert.equal(isPlausibleShareToken('shr_longenough'), true);
      assert.equal(
        shareTokenFromRequest(new Request('http://localhost/api/v1/jobs/x?share=shr_')),
        null,
      );
      assert.equal(
        shareTokenFromRequest(
          new Request('http://localhost/api/v1/jobs/x', {
            headers: { 'x-waveworld-share': 'shr_' },
          }),
        ),
        null,
      );
      assert.equal(
        shareTokenFromRequest(
          new Request('http://localhost/api/v1/jobs/x', {
            headers: { 'x-waveworld-share': 'shr_longenough' },
          }),
        ),
        'shr_longenough',
      );

      const register = await import('../src/app/api/v1/agents/register/route.ts');
      const body = JSON.stringify({ name: 'wave28-reg-agent' });
      // Configured key outside production must still reject wrong/missing key
      const missing = await register.POST(
        new Request('http://localhost/api/v1/agents/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
      );
      assert.equal(missing.status, 401);
      assert.match(missing.headers.get('cache-control') ?? '', /no-store/i);
      assert.match(missing.headers.get('surrogate-control') ?? '', /no-store/i);
      assert.equal(missing.headers.get('expires'), '0');
      assert.doesNotMatch(await missing.text(), /dev-reg-key-wave28-must-enforce/);

      const wrong = await register.POST(
        new Request('http://localhost/api/v1/agents/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'wrong-dev-key',
          },
          body,
        }),
      );
      assert.equal(wrong.status, 401);
      assert.match(wrong.headers.get('cache-control') ?? '', /no-store/i);

      const ok = await register.POST(
        new Request('http://localhost/api/v1/agents/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'dev-reg-key-wave28-must-enforce',
          },
          body,
        }),
      );
      assert.equal(ok.status, 201);
      assert.match(ok.headers.get('cache-control') ?? '', /no-store/i);
      const payload = (await ok.json()) as { token?: string };
      assert.ok(payload.token && payload.token.length > 8);
      assert.doesNotMatch(JSON.stringify(payload), /dev-reg-key-wave28-must-enforce/);

      // JOB_REQUIRE_AUTH=1 with no registration key → closed even outside production
      delete process.env.AGENT_REGISTRATION_KEY;
      delete process.env.TASK_API_KEY;
      process.env.JOB_REQUIRE_AUTH = '1';
      const closed = await register.POST(
        new Request('http://localhost/api/v1/agents/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'wave28-closed-agent' }),
        }),
      );
      assert.equal(closed.status, 401);
      assert.match(closed.headers.get('cache-control') ?? '', /no-store/i);
      assert.match(closed.headers.get('pragma') ?? '', /no-cache/i);
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
      if (priorRequire === undefined) delete process.env.JOB_REQUIRE_AUTH;
      else process.env.JOB_REQUIRE_AUTH = priorRequire;
      if (priorReg === undefined) delete process.env.AGENT_REGISTRATION_KEY;
      else process.env.AGENT_REGISTRATION_KEY = priorReg;
      if (priorTask === undefined) delete process.env.TASK_API_KEY;
      else process.env.TASK_API_KEY = priorTask;
    }
  });

  it('share token residual after c72cf29: base64url+max; header prefers; shareAllowsJob early reject; CORS+no-store pins', async () => {
    const {
      isPlausibleShareToken,
      shareTokenFromRequest,
      shareAllowsJob,
      createJobShare,
    } = await import('../src/lib/job-sharing.ts');
    // Charset: punctuation / spaces never plausible (even when length >= 12)
    assert.equal(isPlausibleShareToken('shr_!!!!!!!!'), false);
    assert.equal(isPlausibleShareToken('shr_with space'), false);
    assert.equal(isPlausibleShareToken('shr_ok-body1'), true);
    assert.equal(isPlausibleShareToken('shr_ok_body1'), true);
    // Max length: body > 80 chars rejected (absurd payloads never hit DB)
    assert.equal(isPlausibleShareToken(`shr_${'a'.repeat(81)}`), false);
    assert.equal(isPlausibleShareToken(`shr_${'a'.repeat(80)}`), true);
    // shareAllowsJob short-circuits non-plausible before any grant
    assert.equal(await shareAllowsJob('shr_!!!!!!!!', 'any-job'), false);
    assert.equal(await shareAllowsJob('not-a-share', 'any-job'), false);
    assert.equal(await shareAllowsJob(null, 'any-job'), false);
    // Header wins when both header and ?share= are plausible and differ
    const dual = shareTokenFromRequest(
      new Request('http://localhost/api/v1/jobs/x?share=shr_fromquery1', {
        headers: { 'x-waveworld-share': 'shr_fromheader1' },
      }),
    );
    assert.equal(dual, 'shr_fromheader1');
    // Implausible header falls through to plausible query
    assert.equal(
      shareTokenFromRequest(
        new Request('http://localhost/api/v1/jobs/x?share=shr_fromquery1', {
          headers: { 'x-waveworld-share': 'shr_!!!bad!!!' },
        }),
      ),
      'shr_fromquery1',
    );
    // createJobShare issued tokens remain plausible under tightened gate
    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const { createJob } = await import('@/lib/tasks/service.ts');
      const alice = await devLogin({ name: 'share-wave29', workspaceId: 'ws-share29' });
      const job = createJob({ spec: spec(), createdBy: alice.user.id });
      const share = await createJobShare({ user: alice.user, jobs: [job], expiresInSeconds: 600 });
      assert.equal(isPlausibleShareToken(share.token), true);
      assert.ok(share.token.length >= 12 && share.token.length <= 84);
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
    }
    // Source pins: CORS allows share header; shares POST uses PROBE_NO_STORE
    const middlewareSrc = fs.readFileSync(path.resolve(here, '../src/middleware.ts'), 'utf8');
    assert.match(middlewareSrc, /x-waveworld-share/);
    const sharesSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/shares/route.ts'),
      'utf8',
    );
    assert.match(sharesSrc, /PROBE_NO_STORE_HEADERS/);
    assert.match(sharesSrc, /status:\s*201/);
    const jobShareSrc = fs.readFileSync(path.resolve(here, '../src/lib/job-sharing.ts'), 'utf8');
    assert.match(jobShareSrc, /A-Za-z0-9_/);
    assert.match(jobShareSrc, /isPlausibleShareToken\(token\)/);
  });

  it('share TTL residual after wave30: clamp MIN/MAX/DEFAULT; NaN→default; applied expiresInSeconds; revoke no-store', async () => {
    const {
      clampShareTtlSeconds,
      SHARE_TTL_MIN_SECONDS,
      SHARE_TTL_MAX_SECONDS,
      SHARE_TTL_DEFAULT_SECONDS,
      createJobShare,
      shareAllowsJob,
      revokeJobShare,
    } = await import('../src/lib/job-sharing.ts');

    // Pure clamp honesty (no secrets)
    assert.equal(clampShareTtlSeconds(), SHARE_TTL_DEFAULT_SECONDS);
    assert.equal(clampShareTtlSeconds(undefined), SHARE_TTL_DEFAULT_SECONDS);
    // Non-finite (NaN / ±Infinity) never invents a TTL — fall back to DEFAULT
    assert.equal(clampShareTtlSeconds(Number.NaN), SHARE_TTL_DEFAULT_SECONDS);
    assert.equal(clampShareTtlSeconds(Number.POSITIVE_INFINITY), SHARE_TTL_DEFAULT_SECONDS);
    assert.equal(clampShareTtlSeconds(Number.NEGATIVE_INFINITY), SHARE_TTL_DEFAULT_SECONDS);
    assert.equal(clampShareTtlSeconds(1), SHARE_TTL_MIN_SECONDS);
    assert.equal(clampShareTtlSeconds(0), SHARE_TTL_MIN_SECONDS);
    assert.equal(clampShareTtlSeconds(-100), SHARE_TTL_MIN_SECONDS);
    assert.equal(clampShareTtlSeconds(600), 600);
    assert.equal(clampShareTtlSeconds(SHARE_TTL_MAX_SECONDS + 999), SHARE_TTL_MAX_SECONDS);
    assert.equal(clampShareTtlSeconds(600.9), 600);
    assert.equal(SHARE_TTL_MIN_SECONDS, 300);
    assert.equal(SHARE_TTL_DEFAULT_SECONDS, 30 * 24 * 3600);
    assert.equal(SHARE_TTL_MAX_SECONDS, 365 * 24 * 3600);

    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const { createJob } = await import('@/lib/tasks/service.ts');
      const alice = await devLogin({ name: 'share-wave30-ttl', workspaceId: 'ws-share30' });
      const job = createJob({ spec: spec(), createdBy: alice.user.id });

      // Too-short request → floor to MIN; applied field honesty
      const short = await createJobShare({ user: alice.user, jobs: [job], expiresInSeconds: 1 });
      assert.equal(short.expiresInSeconds, SHARE_TTL_MIN_SECONDS);
      const shortMs = Date.parse(short.expiresAt) - Date.now();
      assert.ok(shortMs > (SHARE_TTL_MIN_SECONDS - 30) * 1000);
      assert.ok(shortMs < (SHARE_TTL_MIN_SECONDS + 30) * 1000);
      assert.equal(await shareAllowsJob(short.token, job.id), true);

      // Non-finite request → DEFAULT (never NaN expiresAt)
      const nanShare = await createJobShare({
        user: alice.user,
        jobs: [job],
        expiresInSeconds: Number.NaN,
      });
      assert.equal(nanShare.expiresInSeconds, SHARE_TTL_DEFAULT_SECONDS);
      assert.ok(Number.isFinite(Date.parse(nanShare.expiresAt)));

      // Default when omitted
      const def = await createJobShare({ user: alice.user, jobs: [job] });
      assert.equal(def.expiresInSeconds, SHARE_TTL_DEFAULT_SECONDS);

      // Revoke route: PROBE_NO_STORE on 200
      const revokeRoute = await import('../src/app/api/v1/shares/[id]/route.ts');
      const revoked = await revokeRoute.DELETE(
        new Request(`http://localhost/api/v1/shares/${short.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${alice.token}` },
        }),
        { params: Promise.resolve({ id: short.id }) },
      );
      assert.equal(revoked.status, 200);
      assert.match(revoked.headers.get('cache-control') ?? '', /no-store/i);
      assert.match(revoked.headers.get('surrogate-control') ?? '', /no-store/i);
      assert.equal(revoked.headers.get('expires'), '0');
      assert.equal(await shareAllowsJob(short.token, job.id), false);
      assert.equal(await revokeJobShare(short.id, alice.user.id), false);

      // 404 revoke (well-formed UUID, missing row) also no-store
      // Residual after wave32: non-UUID path ids are 400; use a real UUID form here.
      const missingId = '00000000-0000-4000-8000-000000000030';
      const missing = await revokeRoute.DELETE(
        new Request(`http://localhost/api/v1/shares/${missingId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${alice.token}` },
        }),
        { params: Promise.resolve({ id: missingId }) },
      );
      assert.equal(missing.status, 404);
      assert.match(missing.headers.get('cache-control') ?? '', /no-store/i);
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
    }

    // Source pins
    const jobShareSrc = fs.readFileSync(path.resolve(here, '../src/lib/job-sharing.ts'), 'utf8');
    assert.match(jobShareSrc, /clampShareTtlSeconds/);
    assert.match(jobShareSrc, /SHARE_TTL_MIN_SECONDS/);
    assert.match(jobShareSrc, /expiresInSeconds:\s*ttl/);
    const revokeSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/shares/[id]/route.ts'),
      'utf8',
    );
    assert.match(revokeSrc, /PROBE_NO_STORE_HEADERS/);
  });

  it('share residual after wave31: normalize TTL string; title clamp; POST/DELETE all-path no-store', async () => {
    const {
      normalizeShareExpiresInSeconds,
      clampShareTitle,
      clampShareTtlSeconds,
      SHARE_TTL_DEFAULT_SECONDS,
      SHARE_TTL_MIN_SECONDS,
      SHARE_JOBS_MAX,
      SHARE_TITLE_MAX_CHARS,
      createJobShare,
    } = await import('../src/lib/job-sharing.ts');

    // JSON numeric-string honesty: "600" must apply 600 after normalize+clamp
    assert.equal(normalizeShareExpiresInSeconds('600'), 600);
    assert.equal(normalizeShareExpiresInSeconds('  900  '), 900);
    assert.equal(normalizeShareExpiresInSeconds(600), 600);
    assert.equal(normalizeShareExpiresInSeconds(null), undefined);
    assert.equal(normalizeShareExpiresInSeconds(undefined), undefined);
    assert.equal(normalizeShareExpiresInSeconds(''), undefined);
    assert.equal(normalizeShareExpiresInSeconds('   '), undefined);
    assert.equal(normalizeShareExpiresInSeconds('not-a-number'), undefined);
    assert.equal(normalizeShareExpiresInSeconds(Number.NaN), undefined);
    assert.equal(normalizeShareExpiresInSeconds(Number.POSITIVE_INFINITY), undefined);
    assert.equal(normalizeShareExpiresInSeconds(true), undefined);
    assert.equal(normalizeShareExpiresInSeconds({ n: 600 }), undefined);
    assert.equal(normalizeShareExpiresInSeconds([600]), undefined);
    // normalize → clamp pipeline (string short TTL floors to MIN)
    assert.equal(
      clampShareTtlSeconds(normalizeShareExpiresInSeconds('1')),
      SHARE_TTL_MIN_SECONDS,
    );
    assert.equal(
      clampShareTtlSeconds(normalizeShareExpiresInSeconds('garbage')),
      SHARE_TTL_DEFAULT_SECONDS,
    );
    assert.equal(SHARE_JOBS_MAX, 20);
    assert.equal(SHARE_TITLE_MAX_CHARS, 200);

    // Title clamp honesty
    assert.equal(clampShareTitle(null), null);
    assert.equal(clampShareTitle(undefined), null);
    assert.equal(clampShareTitle(''), null);
    assert.equal(clampShareTitle('   '), null);
    assert.equal(clampShareTitle('  hello  '), 'hello');
    assert.equal(clampShareTitle('x'.repeat(250))?.length, SHARE_TITLE_MAX_CHARS);

    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const { createJob } = await import('@/lib/tasks/service.ts');
      const alice = await devLogin({ name: 'share-wave31', workspaceId: 'ws-share31' });
      const job = createJob({ spec: spec(), createdBy: alice.user.id });

      // createJobShare applied title + numeric-string path via normalize at route
      const longTitle = 'T'.repeat(250);
      const created = await createJobShare({
        user: alice.user,
        jobs: [job],
        title: longTitle,
        expiresInSeconds: normalizeShareExpiresInSeconds('600'),
      });
      assert.equal(created.expiresInSeconds, 600);
      assert.equal(created.title?.length, SHARE_TITLE_MAX_CHARS);
      assert.ok(created.token.startsWith('shr_'));

      // POST shares: unauth → 401 no-store; empty jobIds → 400 no-store; never echo secrets
      const priorKey = process.env.TASK_API_KEY;
      process.env.TASK_API_KEY = 'wave31-task-key-must-not-echo-zzz';
      try {
        const sharesRoute = await import('../src/app/api/v1/shares/route.ts');
        const unauth = await sharesRoute.POST(
          new Request('http://localhost/api/v1/shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobIds: [job.id] }),
          }),
        );
        assert.equal(unauth.status, 401);
        assert.match(unauth.headers.get('cache-control') ?? '', /no-store/i);
        assert.match(unauth.headers.get('surrogate-control') ?? '', /no-store/i);
        assert.equal(unauth.headers.get('expires'), '0');
        assert.doesNotMatch(await unauth.text(), /wave31-task-key-must-not-echo-zzz/);

        const badBody = await sharesRoute.POST(
          new Request('http://localhost/api/v1/shares', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${alice.token}`,
            },
            body: JSON.stringify({ jobIds: [] }),
          }),
        );
        assert.equal(badBody.status, 400);
        assert.match(badBody.headers.get('cache-control') ?? '', /no-store/i);
        assert.match(badBody.headers.get('surrogate-control') ?? '', /no-store/i);

        // Numeric-string expiresInSeconds via HTTP body
        const withStringTtl = await sharesRoute.POST(
          new Request('http://localhost/api/v1/shares', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${alice.token}`,
            },
            body: JSON.stringify({ jobIds: [job.id], expiresInSeconds: '600' }),
          }),
        );
        assert.equal(withStringTtl.status, 201);
        assert.match(withStringTtl.headers.get('cache-control') ?? '', /no-store/i);
        assert.match(withStringTtl.headers.get('surrogate-control') ?? '', /no-store/i);
        const payload = (await withStringTtl.json()) as {
          share?: { expiresInSeconds?: number; token?: string; title?: string | null };
        };
        assert.equal(payload.share?.expiresInSeconds, 600);
        assert.ok(payload.share?.token?.startsWith('shr_'));
        assert.doesNotMatch(JSON.stringify(payload), /wave31-task-key-must-not-echo-zzz/);

        // DELETE shares: unauth → 401 no-store
        const revokeRoute = await import('../src/app/api/v1/shares/[id]/route.ts');
        const unauthDel = await revokeRoute.DELETE(
          new Request('http://localhost/api/v1/shares/any-id-wave31', { method: 'DELETE' }),
          { params: Promise.resolve({ id: 'any-id-wave31' }) },
        );
        assert.equal(unauthDel.status, 401);
        assert.match(unauthDel.headers.get('cache-control') ?? '', /no-store/i);
        assert.match(unauthDel.headers.get('surrogate-control') ?? '', /no-store/i);
        assert.equal(unauthDel.headers.get('expires'), '0');
        assert.doesNotMatch(await unauthDel.text(), /wave31-task-key-must-not-echo-zzz/);
      } finally {
        if (priorKey === undefined) delete process.env.TASK_API_KEY;
        else process.env.TASK_API_KEY = priorKey;
      }
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
    }

    // Source pins
    const jobShareSrc = fs.readFileSync(path.resolve(here, '../src/lib/job-sharing.ts'), 'utf8');
    assert.match(jobShareSrc, /normalizeShareExpiresInSeconds/);
    assert.match(jobShareSrc, /clampShareTitle/);
    assert.match(jobShareSrc, /SHARE_JOBS_MAX/);
    assert.match(jobShareSrc, /SHARE_TITLE_MAX_CHARS/);
    const postSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/shares/route.ts'),
      'utf8',
    );
    assert.match(postSrc, /PROBE_NO_STORE_HEADERS/);
    assert.match(postSrc, /safeOperationalErrorMessage/);
    assert.match(postSrc, /normalizeShareExpiresInSeconds/);
    const delSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/shares/[id]/route.ts'),
      'utf8',
    );
    assert.match(delSrc, /PROBE_NO_STORE_HEADERS/);
    assert.match(delSrc, /safeOperationalErrorMessage/);
  });

  it('share residual after wave32: isPlausibleShareId UUID gate; numeric/garbage DELETE → 400', async () => {
    const {
      isPlausibleShareId,
      revokeJobShare,
      createJobShare,
    } = await import('../src/lib/job-sharing.ts');

    // UUID honesty: createJobShare issues crypto.randomUUID form only
    assert.equal(isPlausibleShareId('550e8400-e29b-41d4-a716-446655440000'), true);
    assert.equal(isPlausibleShareId('550E8400-E29B-41D4-A716-446655440000'), true);
    assert.equal(isPlausibleShareId('123'), false);
    assert.equal(isPlausibleShareId('999999'), false);
    assert.equal(isPlausibleShareId('not-a-uuid'), false);
    assert.equal(isPlausibleShareId('does-not-exist-wave30'), false);
    assert.equal(isPlausibleShareId(''), false);
    assert.equal(isPlausibleShareId('   '), false);
    assert.equal(isPlausibleShareId('shr_notanid'), false);
    assert.equal(isPlausibleShareId('550e8400e29b41d4a716446655440000'), false); // no hyphens
    assert.equal(isPlausibleShareId('x'.repeat(40)), false);

    // revokeJobShare refuses non-UUID without DB hit semantics (false, not throw)
    assert.equal(await revokeJobShare('123', 'any-user'), false);
    assert.equal(await revokeJobShare('garbage-id', 'any-user'), false);

    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const { createJob } = await import('@/lib/tasks/service.ts');
      const alice = await devLogin({ name: 'share-wave32', workspaceId: 'ws-share32' });
      const job = createJob({ spec: spec(), createdBy: alice.user.id });
      const share = await createJobShare({
        user: alice.user,
        jobs: [job],
        expiresInSeconds: 600,
      });
      assert.equal(isPlausibleShareId(share.id), true);

      const priorKey = process.env.TASK_API_KEY;
      process.env.TASK_API_KEY = 'wave32-task-key-must-not-echo-zzz';
      try {
        const revokeRoute = await import('../src/app/api/v1/shares/[id]/route.ts');

        // Numeric-string path id → 400 invalid share id (not 404), no-store, no secret
        for (const badId of ['123', '999999', 'not-a-uuid', 'shr_fake', '../etc/passwd']) {
          const bad = await revokeRoute.DELETE(
            new Request(`http://localhost/api/v1/shares/${encodeURIComponent(badId)}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${alice.token}` },
            }),
            { params: Promise.resolve({ id: badId }) },
          );
          assert.equal(bad.status, 400, `expected 400 for id=${badId}`);
          assert.match(bad.headers.get('cache-control') ?? '', /no-store/i);
          assert.match(bad.headers.get('surrogate-control') ?? '', /no-store/i);
          assert.equal(bad.headers.get('expires'), '0');
          const body = (await bad.json()) as { error?: string };
          assert.equal(body.error, 'invalid share id');
          assert.doesNotMatch(JSON.stringify(body), /wave32-task-key-must-not-echo-zzz/);
        }

        // Well-formed UUID that does not exist → 404 share not found (distinct from invalid)
        const missingUuid = '00000000-0000-4000-8000-000000000099';
        assert.equal(isPlausibleShareId(missingUuid), true);
        const missing = await revokeRoute.DELETE(
          new Request(`http://localhost/api/v1/shares/${missingUuid}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${alice.token}` },
          }),
          { params: Promise.resolve({ id: missingUuid }) },
        );
        assert.equal(missing.status, 404);
        assert.match(missing.headers.get('cache-control') ?? '', /no-store/i);
        const missingBody = (await missing.json()) as { error?: string };
        assert.equal(missingBody.error, 'share not found');

        // Valid owned share still revokes 200
        const ok = await revokeRoute.DELETE(
          new Request(`http://localhost/api/v1/shares/${share.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${alice.token}` },
          }),
          { params: Promise.resolve({ id: share.id }) },
        );
        assert.equal(ok.status, 200);
        assert.match(ok.headers.get('cache-control') ?? '', /no-store/i);
      } finally {
        if (priorKey === undefined) delete process.env.TASK_API_KEY;
        else process.env.TASK_API_KEY = priorKey;
      }
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
    }

    // Source pins (wave32 gate; wave38 upgraded route to normalizeShareId trim+UUID)
    const jobShareSrc = fs.readFileSync(path.resolve(here, '../src/lib/job-sharing.ts'), 'utf8');
    assert.match(jobShareSrc, /isPlausibleShareId/);
    assert.match(jobShareSrc, /SHARE_ID_RE/);
    const delSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/shares/[id]/route.ts'),
      'utf8',
    );
    assert.match(delSrc, /normalizeShareId|isPlausibleShareId/);
    assert.match(delSrc, /invalid share id/);
    assert.match(delSrc, /PROBE_NO_STORE_HEADERS/);
  });

  it('share residual after wave33: normalizeShareJobIds array+UUID gate; non-array/garbage POST → 400', async () => {
    const {
      isPlausibleJobId,
      normalizeShareJobIds,
      createJobShare,
    } = await import('../src/lib/job-sharing.ts');

    // Job id UUID honesty (createJob issues crypto.randomUUID)
    assert.equal(isPlausibleJobId('550e8400-e29b-41d4-a716-446655440000'), true);
    assert.equal(isPlausibleJobId('550E8400-E29B-41D4-A716-446655440000'), true);
    assert.equal(isPlausibleJobId('123'), false);
    assert.equal(isPlausibleJobId('not-a-uuid'), false);
    assert.equal(isPlausibleJobId(''), false);
    assert.equal(isPlausibleJobId('   '), false);
    assert.equal(isPlausibleJobId('shr_notajob'), false);
    assert.equal(isPlausibleJobId('550e8400e29b41d4a716446655440000'), false);

    // normalizeShareJobIds: null/undefined → []; non-array throws; garbage throws
    assert.deepEqual(normalizeShareJobIds(undefined), []);
    assert.deepEqual(normalizeShareJobIds(null), []);
    assert.deepEqual(normalizeShareJobIds([]), []);
    for (const bad of ['abc', 123, { 0: 'x' }, true]) {
      assert.throws(
        () => normalizeShareJobIds(bad),
        (err: Error & { status?: number }) =>
          err.message === 'jobIds must be an array' && err.status === 400,
        `expected array error for ${JSON.stringify(bad)}`,
      );
    }
    // String body would previously char-spread via Set — must not become ['a','b','c']
    assert.throws(() => normalizeShareJobIds('abc'), /jobIds must be an array/);

    for (const badEntry of ['123', 'not-a-uuid', '', '   ', 'shr_x']) {
      assert.throws(
        () => normalizeShareJobIds([badEntry]),
        (err: Error & { status?: number }) =>
          err.message === 'invalid job id' && err.status === 400,
        `expected invalid job id for ${JSON.stringify(badEntry)}`,
      );
    }
    assert.throws(
      () => normalizeShareJobIds([123 as unknown as string]),
      (err: Error & { status?: number }) =>
        err.message === 'invalid job id' && err.status === 400,
    );

    const good = '550e8400-e29b-41d4-a716-446655440000';
    const good2 = '00000000-0000-4000-8000-000000000001';
    assert.deepEqual(normalizeShareJobIds([good]), [good]);
    assert.deepEqual(normalizeShareJobIds([`  ${good}  `, good, good2]), [good, good2]); // trim+dedupe
    assert.deepEqual(normalizeShareJobIds([good2, good, good2]), [good2, good]); // order preserved

    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const { createJob } = await import('@/lib/tasks/service.ts');
      const alice = await devLogin({ name: 'share-wave33', workspaceId: 'ws-share33' });
      const job = createJob({ spec: spec(), createdBy: alice.user.id });
      assert.equal(isPlausibleJobId(job.id), true);

      const priorKey = process.env.TASK_API_KEY;
      process.env.TASK_API_KEY = 'wave33-task-key-must-not-echo-zzz';
      try {
        const createRoute = await import('../src/app/api/v1/shares/route.ts');
        const post = (body: unknown) =>
          createRoute.POST(
            new Request('http://localhost/api/v1/shares', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${alice.token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
            }),
          );

        // Non-array jobIds → 400 jobIds must be an array, no-store, no secret
        for (const bad of [{ jobIds: 'not-an-array' }, { jobIds: 42 }, { jobIds: { x: 1 } }]) {
          const res = await post(bad);
          assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
          assert.match(res.headers.get('cache-control') ?? '', /no-store/i);
          assert.match(res.headers.get('surrogate-control') ?? '', /no-store/i);
          assert.equal(res.headers.get('expires'), '0');
          const body = (await res.json()) as { error?: string };
          assert.equal(body.error, 'jobIds must be an array');
          assert.doesNotMatch(JSON.stringify(body), /wave33-task-key-must-not-echo-zzz/);
        }

        // Garbage / non-UUID job id → 400 invalid job id (not 404 not-found)
        for (const badId of ['123', 'not-a-uuid', 'shr_fake', '../etc/passwd', '']) {
          const res = await post({ jobIds: [badId] });
          assert.equal(res.status, 400, `expected 400 for jobId=${badId}`);
          assert.match(res.headers.get('cache-control') ?? '', /no-store/i);
          const body = (await res.json()) as { error?: string };
          assert.equal(body.error, 'invalid job id');
          assert.doesNotMatch(JSON.stringify(body), /wave33-task-key-must-not-echo-zzz/);
        }

        // Well-formed UUID that does not exist → 404 (distinct from invalid)
        const missingUuid = '00000000-0000-4000-8000-000000000033';
        assert.equal(isPlausibleJobId(missingUuid), true);
        const missing = await post({ jobIds: [missingUuid] });
        assert.equal(missing.status, 404);
        assert.match(missing.headers.get('cache-control') ?? '', /no-store/i);
        const missingBody = (await missing.json()) as { error?: string };
        assert.equal(missingBody.error, 'one or more jobs not found');

        // Valid owned job still creates 201; applied ids are UUID
        const ok = await post({ jobIds: [job.id], expiresInSeconds: 600 });
        assert.equal(ok.status, 201);
        assert.match(ok.headers.get('cache-control') ?? '', /no-store/i);
        const payload = (await ok.json()) as {
          share?: { token?: string; jobIds?: string[]; id?: string };
        };
        assert.ok(payload.share?.token?.startsWith('shr_'));
        assert.deepEqual(payload.share?.jobIds, [job.id]);
        assert.equal(isPlausibleJobId(payload.share?.id ?? ''), true);
        assert.doesNotMatch(JSON.stringify(payload), /wave33-task-key-must-not-echo-zzz/);

        // Empty jobIds still required (not "must be an array")
        const empty = await post({ jobIds: [] });
        assert.equal(empty.status, 400);
        const emptyBody = (await empty.json()) as { error?: string };
        assert.equal(emptyBody.error, 'jobIds required');
      } finally {
        if (priorKey === undefined) delete process.env.TASK_API_KEY;
        else process.env.TASK_API_KEY = priorKey;
      }
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
    }

    // Source pins
    const jobShareSrc = fs.readFileSync(path.resolve(here, '../src/lib/job-sharing.ts'), 'utf8');
    assert.match(jobShareSrc, /normalizeShareJobIds/);
    assert.match(jobShareSrc, /isPlausibleJobId/);
    assert.match(jobShareSrc, /jobIds must be an array/);
    assert.match(jobShareSrc, /invalid job id/);
    const postSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/shares/route.ts'),
      'utf8',
    );
    assert.match(postSrc, /normalizeShareJobIds/);
    assert.match(postSrc, /PROBE_NO_STORE_HEADERS/);
    assert.match(postSrc, /safeOperationalErrorMessage/);
  });

  it('job path residual after wave36: isPlausibleJobId on GET/result/cancel; garbage → 400', async () => {
    const { isPlausibleJobId } = await import('../src/lib/job-sharing.ts');
    const jobRoute = await import('../src/app/api/v1/jobs/[id]/route.ts');
    const resultRoute = await import('../src/app/api/v1/jobs/[id]/result/route.ts');
    const cancelRoute = await import('../src/app/api/v1/jobs/[id]/cancel/route.ts');

    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const { createJob } = await import('@/lib/tasks/service.ts');
      const alice = await devLogin({ name: 'job-wave36', workspaceId: 'ws-job36' });
      const job = createJob({ spec: spec(), createdBy: alice.user.id });
      assert.equal(isPlausibleJobId(job.id), true);

      const priorKey = process.env.TASK_API_KEY;
      process.env.TASK_API_KEY = 'wave36-task-key-must-not-echo-zzz';
      try {
        const authHeaders = { Authorization: `Bearer ${alice.token}` };

        // Garbage / non-UUID path id → 400 invalid job id (not 404 not-found)
        for (const badId of ['123', 'not-a-uuid', 'shr_fake', '../etc/passwd', 'pub_short', '']) {
          assert.equal(isPlausibleJobId(badId), false, `expected implausible ${badId}`);

          const detail = await jobRoute.GET(
            new Request(`http://localhost/api/v1/jobs/${encodeURIComponent(badId)}`, {
              headers: authHeaders,
            }),
            { params: Promise.resolve({ id: badId }) },
          );
          assert.equal(detail.status, 400, `expected 400 GET for id=${badId}`);
          const detailBody = (await detail.json()) as { error?: string };
          assert.equal(detailBody.error, 'invalid job id');
          assert.doesNotMatch(JSON.stringify(detailBody), /wave36-task-key-must-not-echo-zzz/);

          const result = await resultRoute.GET(
            new Request(`http://localhost/api/v1/jobs/${encodeURIComponent(badId)}/result`, {
              headers: authHeaders,
            }),
            { params: Promise.resolve({ id: badId }) },
          );
          assert.equal(result.status, 400, `expected 400 result for id=${badId}`);
          const resultBody = (await result.json()) as { error?: string };
          assert.equal(resultBody.error, 'invalid job id');
          assert.doesNotMatch(JSON.stringify(resultBody), /wave36-task-key-must-not-echo-zzz/);

          const cancel = await cancelRoute.POST(
            new Request(`http://localhost/api/v1/jobs/${encodeURIComponent(badId)}/cancel`, {
              method: 'POST',
              headers: authHeaders,
            }),
            { params: Promise.resolve({ id: badId }) },
          );
          assert.equal(cancel.status, 400, `expected 400 cancel for id=${badId}`);
          const cancelBody = (await cancel.json()) as { error?: string };
          assert.equal(cancelBody.error, 'invalid job id');
          assert.doesNotMatch(JSON.stringify(cancelBody), /wave36-task-key-must-not-echo-zzz/);
        }

        // Plausible UUID form but missing row stays 404 (distinct from invalid format)
        const missingUuid = '00000000-0000-4000-8000-000000000036';
        assert.equal(isPlausibleJobId(missingUuid), true);
        const missing = await jobRoute.GET(
          new Request(`http://localhost/api/v1/jobs/${missingUuid}`, {
            headers: authHeaders,
          }),
          { params: Promise.resolve({ id: missingUuid }) },
        );
        assert.equal(missing.status, 404);
        const missingBody = (await missing.json()) as { error?: string };
        assert.match(missingBody.error ?? '', /Job not found/i);

        // Owned well-formed job still 200
        const ok = await jobRoute.GET(
          new Request(`http://localhost/api/v1/jobs/${job.id}`, {
            headers: authHeaders,
          }),
          { params: Promise.resolve({ id: job.id }) },
        );
        assert.equal(ok.status, 200);
        const okBody = (await ok.json()) as { job?: { id?: string } };
        assert.equal(okBody.job?.id, job.id);
        assert.doesNotMatch(JSON.stringify(okBody), /wave36-task-key-must-not-echo-zzz/);
      } finally {
        if (priorKey === undefined) delete process.env.TASK_API_KEY;
        else process.env.TASK_API_KEY = priorKey;
      }
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
    }

    // Source pins: jobs/[id] GET + result + cancel must gate path id (wave36/37)
    const detailSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/jobs/[id]/route.ts'),
      'utf8',
    );
    const resultSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/jobs/[id]/result/route.ts'),
      'utf8',
    );
    const cancelSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/jobs/[id]/cancel/route.ts'),
      'utf8',
    );
    for (const src of [detailSrc, resultSrc, cancelSrc]) {
      assert.match(src, /normalizeJobId/);
      assert.match(src, /invalid job id/);
      assert.match(src, /wave36/);
    }
    const jobShareSrc = fs.readFileSync(path.resolve(here, '../src/lib/job-sharing.ts'), 'utf8');
    assert.match(jobShareSrc, /wave36/);
    assert.match(jobShareSrc, /isPlausibleJobId/);
  });

  it('job path residual after wave37: normalizeJobId on audit/agent + shareAllowsJob; garbage → 400', async () => {
    const {
      isPlausibleJobId,
      normalizeJobId,
      shareAllowsJob,
      createJobShare,
    } = await import('../src/lib/job-sharing.ts');

    // normalizeJobId honesty: trim UUID, refuse garbage / non-string
    const good = '550e8400-e29b-41d4-a716-446655440000';
    assert.equal(normalizeJobId(good), good);
    assert.equal(normalizeJobId(`  ${good}  `), good);
    assert.equal(normalizeJobId('123'), null);
    assert.equal(normalizeJobId('not-a-uuid'), null);
    assert.equal(normalizeJobId(''), null);
    assert.equal(normalizeJobId(null), null);
    assert.equal(normalizeJobId(123 as unknown as string), null);
    assert.equal(isPlausibleJobId(`  ${good}  `), true);
    assert.equal(isPlausibleJobId('123'), false);

    // shareAllowsJob refuses non-UUID jobId before DB (no secrets)
    assert.equal(await shareAllowsJob('shr_longenough', '123'), false);
    assert.equal(await shareAllowsJob('shr_longenough', 'not-a-uuid'), false);
    assert.equal(await shareAllowsJob('shr_longenough', ''), false);

    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const { createJob } = await import('@/lib/tasks/service.ts');
      const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
      const alice = await devLogin({ name: 'job-wave37', workspaceId: 'ws-job37' });
      const job = createJob({ spec: spec(), createdBy: alice.user.id });
      assert.equal(normalizeJobId(job.id), job.id);

      const { agent, token: agentToken } = await registerAgent({
        name: 'wave37-path-agent',
        capabilities: {
          backends: ['cpu'],
          kinds: ['export-report'],
        },
      });
      assert.ok(agent.id && agentToken.length > 8);

      const priorKey = process.env.TASK_API_KEY;
      process.env.TASK_API_KEY = 'wave37-task-key-must-not-echo-zzz';
      try {
        const authHeaders = { Authorization: `Bearer ${alice.token}` };
        const agentHeaders = { Authorization: `Bearer ${agentToken}` };

        const auditRoute = await import('../src/app/api/v1/jobs/[id]/audit/route.ts');
        const claimRoute = await import('../src/app/api/v1/jobs/[id]/claim/route.ts');
        const completeRoute = await import('../src/app/api/v1/jobs/[id]/complete/route.ts');
        const failRoute = await import('../src/app/api/v1/jobs/[id]/fail/route.ts');
        const heartbeatRoute = await import('../src/app/api/v1/jobs/[id]/heartbeat/route.ts');
        const progressRoute = await import('../src/app/api/v1/jobs/[id]/progress/route.ts');
        const jobRoute = await import('../src/app/api/v1/jobs/[id]/route.ts');

        // Garbage / non-UUID on audit + agent subroutes → 400 invalid job id
        for (const badId of ['123', 'not-a-uuid', 'shr_fake', '../etc/passwd', '']) {
          const audit = await auditRoute.POST(
            new Request(`http://localhost/api/v1/jobs/${encodeURIComponent(badId)}/audit`, {
              method: 'POST',
              headers: authHeaders,
            }),
            { params: Promise.resolve({ id: badId }) },
          );
          assert.equal(audit.status, 400, `expected 400 audit for id=${badId}`);
          const auditBody = (await audit.json()) as { error?: string };
          assert.equal(auditBody.error, 'invalid job id');
          assert.doesNotMatch(JSON.stringify(auditBody), /wave37-task-key-must-not-echo-zzz/);

          for (const [name, route, methodBody] of [
            ['claim', claimRoute, undefined],
            ['fail', failRoute, JSON.stringify({ error: 'x' })],
            ['heartbeat', heartbeatRoute, '{}'],
            ['progress', progressRoute, '{}'],
            [
              'complete',
              completeRoute,
              JSON.stringify({
                result: {
                  schemaVersion: 1,
                  summary: { steps: 1, cd: 0, cl: 0, wallTimeMs: 1 },
                  backend: { id: 't', agentId: agent.id },
                },
              }),
            ],
          ] as const) {
            const res = await route.POST(
              new Request(
                `http://localhost/api/v1/jobs/${encodeURIComponent(badId)}/${name}`,
                {
                  method: 'POST',
                  headers: {
                    ...agentHeaders,
                    ...(methodBody ? { 'Content-Type': 'application/json' } : {}),
                  },
                  body: methodBody,
                },
              ),
              { params: Promise.resolve({ id: badId }) },
            );
            assert.equal(res.status, 400, `expected 400 ${name} for id=${badId}`);
            const body = (await res.json()) as { error?: string };
            assert.equal(body.error, 'invalid job id');
            assert.doesNotMatch(JSON.stringify(body), /wave37-task-key-must-not-echo-zzz/);
          }
        }

        // Trimmed path id resolves owned job (normalize honesty)
        const padded = `  ${job.id}  `;
        assert.equal(normalizeJobId(padded), job.id);
        const trimmedOk = await jobRoute.GET(
          new Request(`http://localhost/api/v1/jobs/${job.id}`, {
            headers: authHeaders,
          }),
          { params: Promise.resolve({ id: padded }) },
        );
        assert.equal(trimmedOk.status, 200);
        const trimmedBody = (await trimmedOk.json()) as { job?: { id?: string } };
        assert.equal(trimmedBody.job?.id, job.id);

        // shareAllowsJob with real share + good/bad jobId
        const share = await createJobShare({
          user: alice.user,
          jobs: [job],
          expiresInSeconds: 600,
        });
        assert.equal(await shareAllowsJob(share.token, job.id), true);
        assert.equal(await shareAllowsJob(share.token, `  ${job.id}  `), true);
        assert.equal(await shareAllowsJob(share.token, '123'), false);
        assert.equal(
          await shareAllowsJob(share.token, '00000000-0000-4000-8000-000000000037'),
          false,
        );
      } finally {
        if (priorKey === undefined) delete process.env.TASK_API_KEY;
        else process.env.TASK_API_KEY = priorKey;
      }
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
    }

    // Source pins: normalizeJobId on audit + agent routes + shareAllowsJob
    const jobShareSrc = fs.readFileSync(path.resolve(here, '../src/lib/job-sharing.ts'), 'utf8');
    assert.match(jobShareSrc, /normalizeJobId/);
    assert.match(jobShareSrc, /wave37/);
    assert.match(jobShareSrc, /shareAllowsJob[\s\S]*normalizeJobId/);
    for (const rel of [
      '../src/app/api/v1/jobs/[id]/audit/route.ts',
      '../src/app/api/v1/jobs/[id]/claim/route.ts',
      '../src/app/api/v1/jobs/[id]/complete/route.ts',
      '../src/app/api/v1/jobs/[id]/fail/route.ts',
      '../src/app/api/v1/jobs/[id]/heartbeat/route.ts',
      '../src/app/api/v1/jobs/[id]/progress/route.ts',
    ]) {
      const src = fs.readFileSync(path.resolve(here, rel), 'utf8');
      assert.match(src, /normalizeJobId/, `missing normalizeJobId in ${rel}`);
      assert.match(src, /invalid job id/, `missing invalid job id in ${rel}`);
      assert.match(src, /wave37/, `missing wave37 pin in ${rel}`);
    }
  });

  it('project/share residual after wave38: normalizeProjectId/ShareId + attach jobId; garbage → 400', async () => {
    const {
      normalizeProjectId,
      normalizeShareId,
      normalizeJobId,
      isPlausibleProjectId,
      isPlausibleShareId,
      createJobShare,
      revokeJobShare,
    } = await import('../src/lib/job-sharing.ts');

    const good = '550e8400-e29b-41d4-a716-446655440038';
    assert.equal(normalizeProjectId(good), good);
    assert.equal(normalizeProjectId(`  ${good}  `), good);
    assert.equal(normalizeProjectId('123'), null);
    assert.equal(normalizeProjectId('not-a-uuid'), null);
    assert.equal(normalizeProjectId(null), null);
    assert.equal(isPlausibleProjectId(good), true);
    assert.equal(isPlausibleProjectId('123'), false);

    assert.equal(normalizeShareId(good), good);
    assert.equal(normalizeShareId(`  ${good}  `), good);
    assert.equal(normalizeShareId('shr_fake'), null);
    assert.equal(isPlausibleShareId('123'), false);

    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const { createJob } = await import('@/lib/tasks/service.ts');
      const { createProject } = await import('../src/lib/project-service.ts');
      const alice = await devLogin({ name: 'job-wave38', workspaceId: 'ws-job38' });
      const project = await createProject(alice.user, { name: 'wave38 project' });
      assert.equal(normalizeProjectId(project.id), project.id);
      const job = createJob({ spec: spec(), createdBy: alice.user.id });
      assert.equal(normalizeJobId(job.id), job.id);

      const priorKey = process.env.TASK_API_KEY;
      process.env.TASK_API_KEY = 'wave38-task-key-must-not-echo-zzz';
      try {
        const authHeaders = {
          Authorization: `Bearer ${alice.token}`,
          'Content-Type': 'application/json',
        };

        const projectRoute = await import('../src/app/api/v1/projects/[id]/route.ts');
        const projectJobsRoute = await import('../src/app/api/v1/projects/[id]/jobs/route.ts');
        const shareDeleteRoute = await import('../src/app/api/v1/shares/[id]/route.ts');

        // Garbage project path ids → 400 invalid project id (not 404)
        for (const badId of ['123', 'not-a-uuid', 'shr_fake', '../etc/passwd', '']) {
          const getRes = await projectRoute.GET(
            new Request(`http://localhost/api/v1/projects/${encodeURIComponent(badId)}`, {
              headers: authHeaders,
            }),
            { params: Promise.resolve({ id: badId }) },
          );
          assert.equal(getRes.status, 400, `expected 400 GET project for id=${badId}`);
          const getBody = (await getRes.json()) as { error?: string };
          assert.equal(getBody.error, 'invalid project id');
          assert.doesNotMatch(JSON.stringify(getBody), /wave38-task-key-must-not-echo-zzz/);

          const patchRes = await projectRoute.PATCH(
            new Request(`http://localhost/api/v1/projects/${encodeURIComponent(badId)}`, {
              method: 'PATCH',
              headers: authHeaders,
              body: JSON.stringify({ description: 'x' }),
            }),
            { params: Promise.resolve({ id: badId }) },
          );
          assert.equal(patchRes.status, 400, `expected 400 PATCH project for id=${badId}`);
          assert.equal(((await patchRes.json()) as { error?: string }).error, 'invalid project id');

          const delRes = await projectRoute.DELETE(
            new Request(`http://localhost/api/v1/projects/${encodeURIComponent(badId)}`, {
              method: 'DELETE',
              headers: authHeaders,
            }),
            { params: Promise.resolve({ id: badId }) },
          );
          assert.equal(delRes.status, 400, `expected 400 DELETE project for id=${badId}`);
          assert.equal(((await delRes.json()) as { error?: string }).error, 'invalid project id');

          const listJobs = await projectJobsRoute.GET(
            new Request(`http://localhost/api/v1/projects/${encodeURIComponent(badId)}/jobs`, {
              headers: authHeaders,
            }),
            { params: Promise.resolve({ id: badId }) },
          );
          assert.equal(listJobs.status, 400, `expected 400 list jobs for id=${badId}`);
          assert.equal(((await listJobs.json()) as { error?: string }).error, 'invalid project id');

          const attachBadProject = await projectJobsRoute.POST(
            new Request(`http://localhost/api/v1/projects/${encodeURIComponent(badId)}/jobs`, {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({ jobId: job.id }),
            }),
            { params: Promise.resolve({ id: badId }) },
          );
          assert.equal(attachBadProject.status, 400);
          assert.equal(
            ((await attachBadProject.json()) as { error?: string }).error,
            'invalid project id',
          );
        }

        // Garbage body.jobId on attach → 400 invalid job id (not 404 job not found)
        for (const badJob of ['123', 'not-a-uuid', 'shr_fake', '  ']) {
          const attach = await projectJobsRoute.POST(
            new Request(`http://localhost/api/v1/projects/${project.id}/jobs`, {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({ jobId: badJob }),
            }),
            { params: Promise.resolve({ id: project.id }) },
          );
          assert.equal(attach.status, 400, `expected 400 attach for jobId=${badJob}`);
          const attachBody = (await attach.json()) as { error?: string };
          assert.equal(attachBody.error, 'invalid job id');
          assert.doesNotMatch(JSON.stringify(attachBody), /wave38-task-key-must-not-echo-zzz/);
        }

        // Valid attach still works; response echoes normalized ids
        const attachOk = await projectJobsRoute.POST(
          new Request(`http://localhost/api/v1/projects/${project.id}/jobs`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ jobId: `  ${job.id}  ` }),
          }),
          { params: Promise.resolve({ id: `  ${project.id}  ` }) },
        );
        assert.equal(attachOk.status, 200);
        const attachOkBody = (await attachOk.json()) as {
          ok?: boolean;
          projectId?: string;
          jobId?: string;
        };
        assert.equal(attachOkBody.ok, true);
        assert.equal(attachOkBody.projectId, project.id);
        assert.equal(attachOkBody.jobId, job.id);

        // Trimmed project GET resolves
        const trimmedGet = await projectRoute.GET(
          new Request(`http://localhost/api/v1/projects/${project.id}`, {
            headers: authHeaders,
          }),
          { params: Promise.resolve({ id: `  ${project.id}  ` }) },
        );
        assert.equal(trimmedGet.status, 200);
        const trimmedBody = (await trimmedGet.json()) as { project?: { id?: string } };
        assert.equal(trimmedBody.project?.id, project.id);

        // shares DELETE: garbage → 400; padded UUID path works via normalizeShareId
        for (const badShare of ['123', 'not-a-uuid', '']) {
          const badDel = await shareDeleteRoute.DELETE(
            new Request(`http://localhost/api/v1/shares/${encodeURIComponent(badShare)}`, {
              method: 'DELETE',
              headers: authHeaders,
            }),
            { params: Promise.resolve({ id: badShare }) },
          );
          assert.equal(badDel.status, 400, `expected 400 DELETE share for id=${badShare}`);
          assert.equal(((await badDel.json()) as { error?: string }).error, 'invalid share id');
        }

        const share = await createJobShare({
          user: alice.user,
          jobs: [job],
          expiresInSeconds: 600,
        });
        assert.equal(normalizeShareId(share.id), share.id);
        const rev = await shareDeleteRoute.DELETE(
          new Request(`http://localhost/api/v1/shares/${share.id}`, {
            method: 'DELETE',
            headers: authHeaders,
          }),
          { params: Promise.resolve({ id: `  ${share.id}  ` }) },
        );
        assert.equal(rev.status, 200);
        assert.equal(await revokeJobShare(share.id, alice.user.id), false); // already revoked
      } finally {
        if (priorKey === undefined) delete process.env.TASK_API_KEY;
        else process.env.TASK_API_KEY = priorKey;
      }
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
    }

    // Source pins: wave38 normalize helpers on project/share routes
    const jobShareSrc = fs.readFileSync(path.resolve(here, '../src/lib/job-sharing.ts'), 'utf8');
    assert.match(jobShareSrc, /normalizeProjectId/);
    assert.match(jobShareSrc, /normalizeShareId/);
    assert.match(jobShareSrc, /wave38/);
    assert.match(jobShareSrc, /normalizeUuidPathParam/);

    const shareDelSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/shares/[id]/route.ts'),
      'utf8',
    );
    assert.match(shareDelSrc, /normalizeShareId/);
    assert.match(shareDelSrc, /wave38/);

    const projectSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/projects/[id]/route.ts'),
      'utf8',
    );
    assert.match(projectSrc, /normalizeProjectId/);
    assert.match(projectSrc, /invalid project id/);
    assert.match(projectSrc, /wave38/);

    const projectJobsSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/projects/[id]/jobs/route.ts'),
      'utf8',
    );
    assert.match(projectJobsSrc, /normalizeProjectId/);
    assert.match(projectJobsSrc, /normalizeJobId/);
    assert.match(projectJobsSrc, /invalid job id/);
    assert.match(projectJobsSrc, /wave38/);
  });

  it('project members/models residual after wave39: normalizeProjectId/ModelId; garbage → 400', async () => {
    const {
      normalizeProjectId,
      normalizeModelId,
      isPlausibleModelId,
    } = await import('../src/lib/job-sharing.ts');

    const good = '550e8400-e29b-41d4-a716-446655440039';
    assert.equal(normalizeModelId(good), good);
    assert.equal(normalizeModelId(`  ${good}  `), good);
    assert.equal(normalizeModelId('123'), null);
    assert.equal(normalizeModelId('not-a-uuid'), null);
    assert.equal(normalizeModelId(null), null);
    assert.equal(isPlausibleModelId(good), true);
    assert.equal(isPlausibleModelId('123'), false);
    assert.equal(normalizeProjectId(good), good);

    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const { createProject, addProjectModel } = await import('../src/lib/project-service.ts');
      const alice = await devLogin({ name: 'job-wave39', workspaceId: 'ws-job39' });
      const project = await createProject(alice.user, { name: 'wave39 project' });
      assert.equal(normalizeProjectId(project.id), project.id);
      const model = await addProjectModel(project.id, alice.user.id, {
        name: 'wave39-model',
        source: 'url',
        url: 'https://example.invalid/model.glb',
      });
      assert.equal(normalizeModelId(model.id), model.id);

      const priorKey = process.env.TASK_API_KEY;
      process.env.TASK_API_KEY = 'wave39-task-key-must-not-echo-zzz';
      try {
        const authHeaders = {
          Authorization: `Bearer ${alice.token}`,
          'Content-Type': 'application/json',
        };
        const membersRoute = await import('../src/app/api/v1/projects/[id]/members/route.ts');
        const memberDelRoute = await import(
          '../src/app/api/v1/projects/[id]/members/[userId]/route.ts'
        );
        const modelsRoute = await import('../src/app/api/v1/projects/[id]/models/route.ts');
        const modelDelRoute = await import(
          '../src/app/api/v1/projects/[id]/models/[modelId]/route.ts'
        );

        // Garbage project path ids → 400 invalid project id (not dishonest 404)
        for (const bad of ['123', 'not-a-uuid', '']) {
          const memPost = await membersRoute.POST(
            new Request(`http://localhost/api/v1/projects/${encodeURIComponent(bad)}/members`, {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({ userId: 'dev_other', role: 'viewer' }),
            }),
            { params: Promise.resolve({ id: bad }) },
          );
          assert.equal(memPost.status, 400, `expected 400 members POST for id=${bad}`);
          const memBody = (await memPost.json()) as { error?: string };
          assert.equal(memBody.error, 'invalid project id');
          assert.doesNotMatch(JSON.stringify(memBody), /wave39-task-key-must-not-echo-zzz/);

          const memDel = await memberDelRoute.DELETE(
            new Request(
              `http://localhost/api/v1/projects/${encodeURIComponent(bad)}/members/dev_other`,
              { method: 'DELETE', headers: authHeaders },
            ),
            { params: Promise.resolve({ id: bad, userId: 'dev_other' }) },
          );
          assert.equal(memDel.status, 400, `expected 400 members DELETE for id=${bad}`);
          assert.equal(((await memDel.json()) as { error?: string }).error, 'invalid project id');

          const modPost = await modelsRoute.POST(
            new Request(`http://localhost/api/v1/projects/${encodeURIComponent(bad)}/models`, {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({ name: 'x', source: 'url', url: 'https://example.invalid/x' }),
            }),
            { params: Promise.resolve({ id: bad }) },
          );
          assert.equal(modPost.status, 400, `expected 400 models POST for id=${bad}`);
          assert.equal(((await modPost.json()) as { error?: string }).error, 'invalid project id');

          const modDel = await modelDelRoute.DELETE(
            new Request(
              `http://localhost/api/v1/projects/${encodeURIComponent(bad)}/models/${model.id}`,
              { method: 'DELETE', headers: authHeaders },
            ),
            { params: Promise.resolve({ id: bad, modelId: model.id }) },
          );
          assert.equal(modDel.status, 400, `expected 400 models DELETE for project id=${bad}`);
          assert.equal(((await modDel.json()) as { error?: string }).error, 'invalid project id');
        }

        // Garbage model id → 400 invalid model id (not dishonest 404)
        for (const badModel of ['123', 'not-a-uuid', '']) {
          const modDel = await modelDelRoute.DELETE(
            new Request(
              `http://localhost/api/v1/projects/${project.id}/models/${encodeURIComponent(badModel)}`,
              { method: 'DELETE', headers: authHeaders },
            ),
            { params: Promise.resolve({ id: project.id, modelId: badModel }) },
          );
          assert.equal(modDel.status, 400, `expected 400 models DELETE for modelId=${badModel}`);
          assert.equal(((await modDel.json()) as { error?: string }).error, 'invalid model id');
        }

        // Invalid principal userId path → 400 (not dishonest 404)
        for (const badUser of ['', 'bad user', '!!!', 'x'.repeat(200)]) {
          const memDel = await memberDelRoute.DELETE(
            new Request(
              `http://localhost/api/v1/projects/${project.id}/members/${encodeURIComponent(badUser || ' ')}`,
              { method: 'DELETE', headers: authHeaders },
            ),
            { params: Promise.resolve({ id: project.id, userId: badUser || ' ' }) },
          );
          assert.equal(memDel.status, 400, `expected 400 members DELETE for userId=${JSON.stringify(badUser)}`);
          assert.equal(((await memDel.json()) as { error?: string }).error, 'invalid user id');
        }

        // Valid model DELETE still works with padded UUIDs
        const trimmedDel = await modelDelRoute.DELETE(
          new Request(`http://localhost/api/v1/projects/${project.id}/models/${model.id}`, {
            method: 'DELETE',
            headers: authHeaders,
          }),
          {
            params: Promise.resolve({
              id: `  ${project.id}  `,
              modelId: `  ${model.id}  `,
            }),
          },
        );
        assert.equal(trimmedDel.status, 200);
        assert.equal(((await trimmedDel.json()) as { ok?: boolean }).ok, true);

        // Valid models POST with padded project id
        const modOk = await modelsRoute.POST(
          new Request(`http://localhost/api/v1/projects/${project.id}/models`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              name: 'wave39-model-2',
              source: 'url',
              url: 'https://example.invalid/model2.glb',
            }),
          }),
          { params: Promise.resolve({ id: `  ${project.id}  ` }) },
        );
        assert.equal(modOk.status, 201);
        const modOkBody = (await modOk.json()) as { model?: { id?: string; projectId?: string } };
        assert.ok(modOkBody.model?.id);
        assert.equal(normalizeModelId(modOkBody.model!.id!), modOkBody.model!.id);
      } finally {
        if (priorKey === undefined) delete process.env.TASK_API_KEY;
        else process.env.TASK_API_KEY = priorKey;
      }
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
    }

    // Source pins: wave39 normalize helpers on members/models routes
    const jobShareSrc = fs.readFileSync(path.resolve(here, '../src/lib/job-sharing.ts'), 'utf8');
    assert.match(jobShareSrc, /normalizeModelId/);
    assert.match(jobShareSrc, /wave39/);

    const membersSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/projects/[id]/members/route.ts'),
      'utf8',
    );
    assert.match(membersSrc, /normalizeProjectId/);
    assert.match(membersSrc, /invalid project id/);
    assert.match(membersSrc, /wave39/);

    const memberDelSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/projects/[id]/members/[userId]/route.ts'),
      'utf8',
    );
    assert.match(memberDelSrc, /normalizeProjectId/);
    assert.match(memberDelSrc, /invalid user id/);
    assert.match(memberDelSrc, /wave39/);

    const modelsSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/projects/[id]/models/route.ts'),
      'utf8',
    );
    assert.match(modelsSrc, /normalizeProjectId/);
    assert.match(modelsSrc, /wave39/);

    const modelDelSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/projects/[id]/models/[modelId]/route.ts'),
      'utf8',
    );
    assert.match(modelDelSrc, /normalizeProjectId/);
    assert.match(modelDelSrc, /normalizeModelId/);
    assert.match(modelDelSrc, /invalid model id/);
    assert.match(modelDelSrc, /wave39/);
  });

  it('artifacts/evidence/comparisons residual after wave40: normalize*Id; garbage → 400', async () => {
    const {
      normalizeArtifactId,
      normalizeEvidenceId,
      normalizeComparisonId,
      normalizeJobId,
      isPlausibleArtifactId,
      isPlausibleEvidenceId,
      isPlausibleComparisonId,
    } = await import('../src/lib/job-sharing.ts');

    const good = '550e8400-e29b-41d4-a716-446655440040';
    assert.equal(normalizeArtifactId(good), good);
    assert.equal(normalizeArtifactId(`  ${good}  `), good);
    assert.equal(normalizeArtifactId('123'), null);
    assert.equal(normalizeArtifactId('../etc/passwd'), null);
    assert.equal(normalizeArtifactId('a/b'), null);
    assert.equal(normalizeArtifactId(null), null);
    assert.equal(isPlausibleArtifactId(good), true);
    assert.equal(isPlausibleArtifactId('123'), false);
    assert.equal(normalizeEvidenceId(good), good);
    assert.equal(normalizeEvidenceId('not-a-uuid'), null);
    assert.equal(isPlausibleEvidenceId(good), true);
    assert.equal(normalizeComparisonId(good), good);
    assert.equal(normalizeComparisonId(''), null);
    assert.equal(isPlausibleComparisonId(good), true);
    assert.equal(normalizeJobId('123'), null);

    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const { saveArtifact } = await import('@/lib/tasks/artifacts.ts');
      const alice = await devLogin({ name: 'job-wave40', workspaceId: 'ws-job40' });
      const art = saveArtifact({
        kind: 'log',
        contentType: 'text/plain',
        ownerUserId: alice.user.id,
        data: Buffer.from('wave40-artifact'),
      });
      assert.equal(normalizeArtifactId(art.id), art.id);

      const priorKey = process.env.TASK_API_KEY;
      process.env.TASK_API_KEY = 'wave40-task-key-must-not-echo-zzz';
      try {
        const authHeaders = {
          Authorization: `Bearer ${alice.token}`,
          'Content-Type': 'application/json',
        };
        const artRoute = await import('../src/app/api/v1/artifacts/[id]/route.ts');
        const artPostRoute = await import('../src/app/api/v1/artifacts/route.ts');
        const evidenceRoute = await import('../src/app/api/v1/evidence/[id]/route.ts');
        const comparisonRoute = await import('../src/app/api/v1/comparisons/[id]/route.ts');

        // Garbage artifact path ids → 400 invalid artifact id (not dishonest 404)
        for (const bad of ['123', 'not-a-uuid', '', '../x', 'a/b']) {
          const res = await artRoute.GET(
            new Request(`http://localhost/api/v1/artifacts/${encodeURIComponent(bad || ' ')}`, {
              headers: authHeaders,
            }),
            { params: Promise.resolve({ id: bad || ' ' }) },
          );
          assert.equal(res.status, 400, `expected 400 artifacts GET for id=${JSON.stringify(bad)}`);
          const body = (await res.json()) as { error?: string };
          assert.equal(body.error, 'invalid artifact id');
          assert.doesNotMatch(JSON.stringify(body), /wave40-task-key-must-not-echo-zzz/);
        }

        // Garbage evidence path ids → 400
        for (const bad of ['123', 'not-a-uuid', '']) {
          const res = await evidenceRoute.GET(
            new Request(`http://localhost/api/v1/evidence/${encodeURIComponent(bad || ' ')}`, {
              headers: authHeaders,
            }),
            { params: Promise.resolve({ id: bad || ' ' }) },
          );
          assert.equal(res.status, 400, `expected 400 evidence GET for id=${JSON.stringify(bad)}`);
          assert.equal(((await res.json()) as { error?: string }).error, 'invalid evidence id');
        }

        // Garbage comparison path ids → 400 (auth required first)
        for (const bad of ['123', 'not-a-uuid', '']) {
          const res = await comparisonRoute.GET(
            new Request(`http://localhost/api/v1/comparisons/${encodeURIComponent(bad || ' ')}`, {
              headers: authHeaders,
            }),
            { params: Promise.resolve({ id: bad || ' ' }) },
          );
          assert.equal(res.status, 400, `expected 400 comparisons GET for id=${JSON.stringify(bad)}`);
          assert.equal(((await res.json()) as { error?: string }).error, 'invalid comparison id');
        }

        // artifacts POST garbage jobId → 400 invalid job id (not dishonest 404)
        for (const badJob of ['123', 'not-a-uuid', '../x']) {
          const res = await artPostRoute.POST(
            new Request('http://localhost/api/v1/artifacts', {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({
                kind: 'log',
                base64: Buffer.from('x').toString('base64'),
                jobId: badJob,
              }),
            }),
          );
          assert.equal(res.status, 400, `expected 400 artifacts POST for jobId=${badJob}`);
          assert.equal(((await res.json()) as { error?: string }).error, 'invalid job id');
        }

        // Valid artifact download with padded UUID still works
        const okGet = await artRoute.GET(
          new Request(`http://localhost/api/v1/artifacts/${art.id}`, {
            headers: authHeaders,
          }),
          { params: Promise.resolve({ id: `  ${art.id}  ` }) },
        );
        assert.equal(okGet.status, 200);
        assert.equal(okGet.headers.get('X-Artifact-SHA256'), art.sha256);

        // Valid UUID that is not stored → 404 not-found (honest)
        const missing = '550e8400-e29b-41d4-a716-446655440099';
        const missRes = await artRoute.GET(
          new Request(`http://localhost/api/v1/artifacts/${missing}`, {
            headers: authHeaders,
          }),
          { params: Promise.resolve({ id: missing }) },
        );
        assert.equal(missRes.status, 404);
        assert.equal(((await missRes.json()) as { error?: string }).error, 'Artifact not found');
      } finally {
        if (priorKey === undefined) delete process.env.TASK_API_KEY;
        else process.env.TASK_API_KEY = priorKey;
      }
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
    }

    // Source pins: wave40 normalize helpers on artifacts/evidence/comparisons
    const jobShareSrc = fs.readFileSync(path.resolve(here, '../src/lib/job-sharing.ts'), 'utf8');
    assert.match(jobShareSrc, /normalizeArtifactId/);
    assert.match(jobShareSrc, /normalizeEvidenceId/);
    assert.match(jobShareSrc, /normalizeComparisonId/);
    assert.match(jobShareSrc, /wave40/);

    const artSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/artifacts/[id]/route.ts'),
      'utf8',
    );
    assert.match(artSrc, /normalizeArtifactId/);
    assert.match(artSrc, /invalid artifact id/);
    assert.match(artSrc, /wave40/);

    const artPostSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/artifacts/route.ts'),
      'utf8',
    );
    assert.match(artPostSrc, /normalizeJobId/);
    assert.match(artPostSrc, /invalid job id/);
    assert.match(artPostSrc, /wave40/);

    const evidenceSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/evidence/[id]/route.ts'),
      'utf8',
    );
    assert.match(evidenceSrc, /normalizeEvidenceId/);
    assert.match(evidenceSrc, /invalid evidence id/);
    assert.match(evidenceSrc, /wave40/);

    const comparisonSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/comparisons/[id]/route.ts'),
      'utf8',
    );
    assert.match(comparisonSrc, /normalizeComparisonId/);
    assert.match(comparisonSrc, /invalid comparison id/);
    assert.match(comparisonSrc, /wave40/);
  });

  it('comparisons/artifacts/evidence residual after wave41: jobIds/projectId gates; garbage → 400', async () => {
    const {
      normalizeShareJobIds,
      normalizeProjectId,
      normalizeJobId,
    } = await import('../src/lib/job-sharing.ts');

    const good = '550e8400-e29b-41d4-a716-446655440041';
    assert.equal(normalizeProjectId(good), good);
    assert.equal(normalizeProjectId('123'), null);
    assert.equal(normalizeJobId('not-a-uuid'), null);
    assert.deepEqual(normalizeShareJobIds([good]), [good]);
    assert.throws(
      () => normalizeShareJobIds(['123']),
      (err: Error & { status?: number }) =>
        err.message === 'invalid job id' && err.status === 400,
    );
    assert.throws(
      () => normalizeShareJobIds('not-array'),
      (err: Error & { status?: number }) =>
        err.message === 'jobIds must be an array' && err.status === 400,
    );

    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const alice = await devLogin({ name: 'job-wave41', workspaceId: 'ws-job41' });

      const priorKey = process.env.TASK_API_KEY;
      process.env.TASK_API_KEY = 'wave41-task-key-must-not-echo-zzz';
      try {
        const authHeaders = {
          Authorization: `Bearer ${alice.token}`,
          'Content-Type': 'application/json',
        };
        const comparisonsPost = await import('../src/app/api/v1/comparisons/route.ts');
        const artRoute = await import('../src/app/api/v1/artifacts/route.ts');
        const evidenceImport = await import('../src/app/api/v1/evidence/import/route.ts');

        // comparisons POST: non-array jobIds → 400 (not silent empty → length error only)
        for (const bad of ['not-an-array', 42, { x: 1 }]) {
          const res = await comparisonsPost.POST(
            new Request('http://localhost/api/v1/comparisons', {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({ jobIds: bad }),
            }),
          );
          assert.equal(res.status, 400, `expected 400 comparisons POST for jobIds=${JSON.stringify(bad)}`);
          const body = (await res.json()) as { error?: string };
          assert.equal(body.error, 'jobIds must be an array');
          assert.doesNotMatch(JSON.stringify(body), /wave41-task-key-must-not-echo-zzz/);
        }

        // comparisons POST: garbage job ids → 400 invalid job id (not dishonest 404)
        for (const badId of ['123', 'not-a-uuid', '../x']) {
          const res = await comparisonsPost.POST(
            new Request('http://localhost/api/v1/comparisons', {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({ jobIds: [badId, good] }),
            }),
          );
          assert.equal(res.status, 400, `expected 400 comparisons POST for id=${badId}`);
          assert.equal(((await res.json()) as { error?: string }).error, 'invalid job id');
        }

        // artifacts POST garbage projectId → 400 invalid project id (not dishonest 403)
        for (const bad of ['123', 'not-a-uuid', '../x']) {
          const res = await artRoute.POST(
            new Request('http://localhost/api/v1/artifacts', {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({
                kind: 'log',
                base64: Buffer.from('x').toString('base64'),
                projectId: bad,
              }),
            }),
          );
          assert.equal(res.status, 400, `expected 400 artifacts POST for projectId=${bad}`);
          assert.equal(((await res.json()) as { error?: string }).error, 'invalid project id');
        }

        // artifacts GET garbage jobId/projectId query → 400
        for (const bad of ['123', 'not-a-uuid']) {
          const jobRes = await artRoute.GET(
            new Request(`http://localhost/api/v1/artifacts?jobId=${encodeURIComponent(bad)}`, {
              headers: authHeaders,
            }),
          );
          assert.equal(jobRes.status, 400, `expected 400 artifacts GET jobId=${bad}`);
          assert.equal(((await jobRes.json()) as { error?: string }).error, 'invalid job id');

          const projRes = await artRoute.GET(
            new Request(`http://localhost/api/v1/artifacts?projectId=${encodeURIComponent(bad)}`, {
              headers: authHeaders,
            }),
          );
          assert.equal(projRes.status, 400, `expected 400 artifacts GET projectId=${bad}`);
          assert.equal(((await projRes.json()) as { error?: string }).error, 'invalid project id');
        }

        // evidence import garbage projectId → 400
        for (const bad of ['123', 'not-a-uuid', '../x']) {
          const res = await evidenceImport.POST(
            new Request('http://localhost/api/v1/evidence/import', {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({
                projectId: bad,
                kind: 'note',
                title: 'wave41',
                content: 'x',
              }),
            }),
          );
          assert.equal(res.status, 400, `expected 400 evidence import for projectId=${bad}`);
          assert.equal(((await res.json()) as { error?: string }).error, 'invalid project id');
        }
      } finally {
        if (priorKey === undefined) delete process.env.TASK_API_KEY;
        else process.env.TASK_API_KEY = priorKey;
      }
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
    }

    // Source pins: wave41 gates on comparisons POST, artifacts, evidence import
    const cmpPostSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/comparisons/route.ts'),
      'utf8',
    );
    assert.match(cmpPostSrc, /normalizeShareJobIds/);
    assert.match(cmpPostSrc, /wave41/);

    const artPostSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/artifacts/route.ts'),
      'utf8',
    );
    assert.match(artPostSrc, /normalizeProjectId/);
    assert.match(artPostSrc, /invalid project id/);
    assert.match(artPostSrc, /wave41/);

    const evidenceImportSrc = fs.readFileSync(
      path.resolve(here, '../src/app/api/v1/evidence/import/route.ts'),
      'utf8',
    );
    assert.match(evidenceImportSrc, /normalizeProjectId/);
    assert.match(evidenceImportSrc, /invalid project id/);
    assert.match(evidenceImportSrc, /wave41/);
  });
});
