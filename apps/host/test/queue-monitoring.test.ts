import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(here, '../../../data/tasks-test-monitoring.db');

before(() => {
  process.env.TASK_DB_PATH = dbPath;
  process.env.TASK_API_KEY = 'monitor-secret';
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* absent */ }
  }
});

describe('production queue monitoring', { concurrency: false }, () => {
  it('reports queue age, observed expired leases, finite kind groups and recent outcomes', async () => {
    const { getSqlite } = await import('@/lib/tasks/db.ts');
    const { getJobStats } = await import('@/lib/tasks/service.ts');
    const db = getSqlite(); const now = Date.now();
    const insert = db.prepare(`INSERT INTO jobs (id,name,status,priority,kind,spec,result,error,created_by,agent_id,project_id,lease_expires_at,attempt,max_attempts,progress,created_at,updated_at,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const spec = JSON.stringify({ schemaVersion: 1, kind: 'lbm-d3q19', parameters: {}, run: { maxSteps: 1 }, outputs: { forces: false, history: false } });
    const iso = (deltaMs: number) => new Date(now + deltaMs).toISOString();
    insert.run('old-q', 'old', 'queued', 0, 'lbm-d3q19', spec, null, null, null, null, null, null, 0, 3, null, iso(-120_000), iso(-120_000), null, null);
    insert.run('expired', 'expired', 'leased', 0, 'fdtd-batch', spec, null, null, null, 'agent', null, iso(-10_000), 0, 3, null, iso(-60_000), iso(-60_000), iso(-50_000), null);
    insert.run('ok', 'ok', 'succeeded', 0, 'path-experiment', spec, '{}', null, null, null, null, null, 0, 3, null, iso(-30_000), iso(-5_000), iso(-20_000), iso(-5_000));
    insert.run('bad', 'bad', 'failed', 0, 'path-experiment', spec, null, 'failed', null, null, null, null, 0, 3, null, iso(-40_000), iso(-4_000), iso(-24_000), iso(-4_000));
    const stats = getJobStats();
    assert.ok(stats.oldestQueuedAgeSeconds >= 119);
    assert.equal(stats.expiredLeases, 1);
    assert.equal(stats.byKind['path-experiment'].succeeded, 1);
    assert.equal(stats.byKind['path-experiment'].failed, 1);
    assert.equal(stats.recent.succeeded, 1); assert.equal(stats.recent.failed, 1);
    assert.equal(stats.recent.averageDurationSeconds, 17.5);
  });

  it('reports artifact volume and the reclaimable (terminal-job) signal', async () => {
    // No artifact GC exists — these gauges are the only ops visibility into
    // disk growth; terminalJobArtifacts marks bytes with no live result refs.
    const { getSqlite } = await import('@/lib/tasks/db.ts');
    const { getJobStats } = await import('@/lib/tasks/service.ts');
    const db = getSqlite();
    const ins = db.prepare(`INSERT INTO artifacts (id, job_id, project_id, owner_user_id, kind, storage_key, content_type, bytes, sha256, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const now = new Date().toISOString();
    ins.run('a-fail-1', 'bad', null, 'alice', 'flow', 'job/bad/a1.bin', 'application/octet-stream', 100, null, now);
    ins.run('a-fail-2', 'bad', null, 'alice', 'flow', 'job/bad/a2.bin', 'application/octet-stream', 150, null, now);
    ins.run('a-ok', 'ok', null, 'alice', 'flow', 'job/ok/a1.bin', 'application/octet-stream', 300, null, now);
    ins.run('a-orphan', 'no-such-job', null, null, 'mesh', 'orphan/m.bin', 'model/stl', 50, null, now);
    ins.run('a-project', null, 'proj-x', 'alice', 'mesh', 'project/p.bin', 'model/stl', 70, null, now);
    const stats = getJobStats();
    assert.equal(stats.artifacts.total, 5);
    assert.equal(stats.artifacts.bytes, 670);
    // 'bad' is failed → reclaimable; 'ok' succeeded, orphan has no job row,
    // project artifacts carry no job_id — none of those count.
    assert.equal(stats.artifacts.terminalJobArtifacts, 2);
  });

  it('readiness is strict and metrics require auth', async () => {
    const readiness = await import('../src/app/api/readiness/route.ts');
    const metrics = await import('../src/app/api/v1/metrics/route.ts');
    const ready = await readiness.GET(); assert.equal(ready.status, 200);
    assert.match(ready.headers.get('cache-control') ?? '', /no-store/i);
    // Residual after 7290c1c: Surrogate-Control no-store on readiness (CDN/edge)
    assert.match(ready.headers.get('surrogate-control') ?? '', /no-store/i);
    const readyBody = await ready.json() as {
      ok: boolean;
      ready?: boolean;
      readyScope?: string;
      dependency?: string;
      lab?: {
        claimFullyUsable: boolean;
        blockerIssue: number;
        blockerOpen: boolean;
        pathLiveNotFullyUsable: boolean;
      };
    };
    // Host ready ≠ Lab fully usable while #49 open
    assert.equal(readyBody.ok, true);
    // Residual after 59a3fa3: explicit ready alias (task-DB only)
    assert.equal(readyBody.ready, true);
    // Residual after 6d08a42: readyScope + dependency always pin task-db (not Lab)
    assert.equal(readyBody.readyScope, 'task-db');
    assert.equal(readyBody.dependency, 'task-db');
    assert.match(ready.headers.get('cache-control') ?? '', /private|must-revalidate|no-cache/i);
    assert.ok(readyBody.lab, 'readiness must expose lab honesty');
    assert.equal(readyBody.lab.claimFullyUsable, false);
    assert.equal(readyBody.lab.blockerIssue, 53);
    assert.equal(readyBody.lab.blockerOpen, true);
    assert.equal(readyBody.lab.pathLiveNotFullyUsable, true);
    const denied = await metrics.GET(new Request('http://localhost/api/v1/metrics'));
    assert.equal(denied.status, 401);
    // Residual after 6b2e2fa: 401 must also be no-store and never echo secrets
    assert.match(denied.headers.get('cache-control') ?? '', /no-store/i);
    // Residual after 7290c1c: Surrogate-Control on metrics 401/200 (honesty gauges uncacheable at edge)
    assert.match(denied.headers.get('surrogate-control') ?? '', /no-store/i);
    const deniedText = await denied.text();
    assert.doesNotMatch(deniedText, /monitor-secret/);
    const allowed = await metrics.GET(new Request('http://localhost/api/v1/metrics', { headers: { 'x-api-key': 'monitor-secret' } }));
    assert.equal(allowed.status, 200);
    assert.match(allowed.headers.get('cache-control') ?? '', /no-store/i);
    assert.match(allowed.headers.get('surrogate-control') ?? '', /no-store/i);
    const text = await allowed.text();
    assert.match(text, /waveworld_queue_oldest_queued_age_seconds/);
    assert.match(text, /waveworld_jobs_by_kind\{kind="path-experiment",status="succeeded"\} 1/);
    assert.match(text, /waveworld_artifacts 5/);
    assert.match(text, /waveworld_artifact_bytes 670/);
    assert.match(text, /waveworld_artifacts_terminal_jobs 2/);
    assert.doesNotMatch(text, /job_id|agent_id|workspace_id/);
    // Residual after 6b2e2fa: Prometheus Lab honesty set (0 claim while #49 open)
    assert.match(text, /waveworld_lab_claim_fully_usable 0/);
    assert.match(text, /waveworld_lab_blocker_open 1/);
    assert.match(text, /waveworld_lab_blocker_issue 53/);
    assert.match(text, /waveworld_lab_path_live_not_fully_usable 1/);
    // Metrics text must never echo operator secrets
    assert.doesNotMatch(text, /monitor-secret/);
  });

  it('jobs/stats is no-store, timing-safe auth, labClaimFullyUsable false (residual after 1b367e7)', async () => {
    const statsRoute = await import('../src/app/api/v1/jobs/stats/route.ts');
    const denied = await statsRoute.GET(new Request('http://localhost/api/v1/jobs/stats'));
    // production requires auth; non-production may allow — assert no secret leak either way
    assert.match(denied.headers.get('cache-control') ?? '', /no-store/i);
    assert.equal(denied.headers.get('expires'), '0');
    // Residual after 7290c1c: Surrogate-Control on jobs/stats
    assert.match(denied.headers.get('surrogate-control') ?? '', /no-store/i);
    // Residual after 6d2ecaa: full PROBE suite on queue stats (private/Pragma parity health)
    assert.match(denied.headers.get('cache-control') ?? '', /private|must-revalidate|no-cache/i);
    assert.match(denied.headers.get('pragma') ?? '', /no-cache/i);
    const deniedText = await denied.text();
    assert.doesNotMatch(deniedText, /monitor-secret/);

    const allowed = await statsRoute.GET(
      new Request('http://localhost/api/v1/jobs/stats', {
        headers: { 'x-api-key': 'monitor-secret' },
      }),
    );
    assert.equal(allowed.status, 200);
    assert.match(allowed.headers.get('cache-control') ?? '', /no-store|private|must-revalidate/i);
    assert.equal(allowed.headers.get('expires'), '0');
    assert.match(allowed.headers.get('surrogate-control') ?? '', /no-store/i);
    const body = (await allowed.json()) as {
      stats?: { queued?: number; total?: number };
      labClaimFullyUsable?: boolean;
      labBlockerOpen?: boolean;
      labBlockerIssue?: number;
      labPathLiveNotFullyUsable?: boolean;
    };
    assert.ok(body.stats);
    assert.equal(body.labClaimFullyUsable, false);
    assert.equal(body.labBlockerOpen, true);
    assert.equal(body.labBlockerIssue, 53);
    assert.equal(body.labPathLiveNotFullyUsable, true);
  });

  it('jobs/stats JOB_REQUIRE_AUTH closes dev-open queue KPI (residual after f8da984)', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorRequire = process.env.JOB_REQUIRE_AUTH;
    Object.assign(process.env, { NODE_ENV: 'development' });
    process.env.JOB_REQUIRE_AUTH = '1';
    try {
      const statsRoute = await import('../src/app/api/v1/jobs/stats/route.ts');
      const denied = await statsRoute.GET(new Request('http://localhost/api/v1/jobs/stats'));
      assert.equal(denied.status, 401);
      assert.match(denied.headers.get('cache-control') ?? '', /no-store/i);
      assert.match(denied.headers.get('surrogate-control') ?? '', /no-store/i);
      assert.equal(denied.headers.get('expires'), '0');
      assert.match(denied.headers.get('pragma') ?? '', /no-cache/i);
      const deniedText = await denied.text();
      assert.doesNotMatch(deniedText, /monitor-secret/);
      // Wrong key still denied; honesty headers always present
      const wrong = await statsRoute.GET(
        new Request('http://localhost/api/v1/jobs/stats', {
          headers: { 'x-api-key': 'wrong-key' },
        }),
      );
      assert.equal(wrong.status, 401);
      assert.match(wrong.headers.get('cache-control') ?? '', /no-store/i);

      const allowed = await statsRoute.GET(
        new Request('http://localhost/api/v1/jobs/stats', {
          headers: { 'x-api-key': 'monitor-secret' },
        }),
      );
      assert.equal(allowed.status, 200);
      const body = (await allowed.json()) as {
        labClaimFullyUsable?: boolean;
        labBlockerOpen?: boolean;
        labBlockerIssue?: number;
        labPathLiveNotFullyUsable?: boolean;
      };
      // Queue KPI green must never imply Lab fully usable while #49 open
      assert.equal(body.labClaimFullyUsable, false);
      assert.equal(body.labBlockerOpen, true);
      assert.equal(body.labBlockerIssue, 53);
      assert.equal(body.labPathLiveNotFullyUsable, true);
      // Source pin: jobs/stats must honor JOB_REQUIRE_AUTH
      const src = fs.readFileSync(
        path.resolve(here, '../src/app/api/v1/jobs/stats/route.ts'),
        'utf8',
      );
      assert.match(src, /JOB_REQUIRE_AUTH/);
      assert.match(src, /devOpen/);
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
      if (priorRequire === undefined) delete process.env.JOB_REQUIRE_AUTH;
      else process.env.JOB_REQUIRE_AUTH = priorRequire;
    }
  });

  it('readiness never leaks secret env values (200 path)', async () => {
    const secrets = {
      TASK_API_KEY: 'ready-leak-task-api-key-xyz',
      W_ID_CLIENT_SECRET: 'ready-leak-oidc-secret-xyz',
      AGENT_REGISTRATION_KEY: 'ready-leak-agent-reg-xyz',
      KNOWLEDGE_WRITE_API_KEY: 'ready-leak-kw-api-xyz',
      KNOWLEDGE_WRITE_KEY: 'ready-leak-kw-key-xyz',
    };
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(secrets)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    // Keep metrics auth working for sibling tests if re-ordered
    process.env.TASK_API_KEY = secrets.TASK_API_KEY;
    try {
      const readiness = await import('../src/app/api/readiness/route.ts');
      const res = await readiness.GET();
      assert.equal(res.status, 200);
      assert.match(res.headers.get('cache-control') ?? '', /no-store/i);
      const raw = await res.text();
      for (const v of Object.values(secrets)) {
        assert.doesNotMatch(raw, new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
      const body = JSON.parse(raw) as {
        lab?: { claimFullyUsable: boolean; blockerOpen: boolean };
      };
      assert.ok(body.lab);
      assert.equal(body.lab.claimFullyUsable, false);
      assert.equal(body.lab.blockerOpen, true);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      // restore monitor-secret used by this suite
      process.env.TASK_API_KEY = 'monitor-secret';
    }
  });

  it('readiness returns 503 when the task database is unavailable', async () => {
    const { getSqlite } = await import('@/lib/tasks/db.ts');
    const readiness = await import('../src/app/api/readiness/route.ts');
    getSqlite().close();
    const response = await readiness.GET(); assert.equal(response.status, 503);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/i);
    const body = await response.json() as {
      status: string;
      dependency: string;
      readyScope?: string;
      ok?: boolean;
      ready?: boolean;
      lab?: { claimFullyUsable: boolean; blockerOpen: boolean };
    };
    assert.equal(body.status, 'not_ready'); assert.equal(body.dependency, 'task-db');
    assert.equal(body.readyScope, 'task-db');
    assert.equal(body.ok, false);
    assert.equal(body.ready, false);
    // 503 still carries #49 honesty (not_ready ≠ Lab claim)
    assert.ok(body.lab);
    assert.equal(body.lab.claimFullyUsable, false);
    assert.equal(body.lab.blockerOpen, true);
  });

  it('safeOperationalErrorMessage redacts secret env values (residual after a0c47ec)', async () => {
    const secretValue = 'metrics-leak-task-api-key-must-not-appear-xyz';
    const savedKey = process.env.TASK_API_KEY;
    process.env.TASK_API_KEY = secretValue;
    try {
      const {
        safeOperationalErrorMessage,
        redactOperationalSecrets,
        PROBE_NO_STORE_HEADERS,
        sameSecret,
      } = await import('../src/lib/safe-error-message.ts');
      const { safeOperationalErrorMessage: metricsSafeErrorMessage } = await import(
        '../src/lib/safe-error-message.ts'
      );
      const out = safeOperationalErrorMessage(new Error(`probe failed with key=${secretValue}`));
      assert.doesNotMatch(out, new RegExp(secretValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(out, /redacted:TASK_API_KEY/);
      // metrics re-export stays stable for older tests/callers
      assert.equal(
        metricsSafeErrorMessage(new Error(`k=${secretValue}`)),
        safeOperationalErrorMessage(new Error(`k=${secretValue}`)),
      );
      // Residual after 59a3fa3: string throws redacted; non-Error non-string → unknown error
      const strOut = safeOperationalErrorMessage(`string fail key=${secretValue}`);
      assert.doesNotMatch(strOut, new RegExp(secretValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(strOut, /redacted:TASK_API_KEY/);
      assert.equal(safeOperationalErrorMessage({ weird: true }), 'unknown error');
      assert.match(PROBE_NO_STORE_HEADERS['Cache-Control'], /no-store/i);
      // Residual after 6d08a42: tighter no-store suite + shared redactor for labels
      assert.match(PROBE_NO_STORE_HEADERS['Cache-Control'], /must-revalidate|private|no-cache/i);
      assert.match(PROBE_NO_STORE_HEADERS.Pragma, /no-cache/i);
      // Residual after 1b367e7: Expires: 0 on shared probe headers
      assert.equal(PROBE_NO_STORE_HEADERS.Expires, '0');
      // Residual after aabd0bf: Surrogate-Control no-store + shared sameSecret
      assert.match(PROBE_NO_STORE_HEADERS['Surrogate-Control'], /no-store/i);
      assert.equal(sameSecret(secretValue, secretValue), true);
      assert.equal(sameSecret('wrong-key', secretValue), false);
      assert.equal(sameSecret(null, secretValue), false);
      assert.equal(sameSecret('', secretValue), false);
      const labeled = redactOperationalSecrets(`kind-with-${secretValue}-embedded`);
      assert.doesNotMatch(labeled, new RegExp(secretValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(labeled, /redacted:TASK_API_KEY/);
    } finally {
      if (savedKey === undefined) delete process.env.TASK_API_KEY;
      else process.env.TASK_API_KEY = savedKey;
      process.env.TASK_API_KEY = 'monitor-secret';
    }
  });

  it('metrics 503 is no-store and does not echo TASK_API_KEY when DB unavailable', async () => {
    const { getSqlite } = await import('@/lib/tasks/db.ts');
    const metrics = await import('../src/app/api/v1/metrics/route.ts');
    getSqlite().close();
    const res = await metrics.GET(
      new Request('http://localhost/api/v1/metrics', {
        headers: { 'x-api-key': 'monitor-secret' },
      }),
    );
    // Closed DB may 503 or still work depending on sqlite reopen; assert no secret leak either way.
    assert.match(res.headers.get('cache-control') ?? '', /no-store/i);
    const text = await res.text();
    assert.doesNotMatch(text, /monitor-secret/);
    if (res.status === 503) {
      assert.match(text, /metrics unavailable/i);
    }
  });

  it('readiness 503 redacts secret env values in error (residual after a0c47ec)', async () => {
    const secretValue = 'ready-503-leak-task-api-key-must-not-appear-xyz';
    const savedKey = process.env.TASK_API_KEY;
    process.env.TASK_API_KEY = secretValue;
    const { getSqlite } = await import('@/lib/tasks/db.ts');
    const readiness = await import('../src/app/api/readiness/route.ts');
    // Force not_ready path after closing DB; inject secret into a synthetic failure via closed handle.
    getSqlite().close();
    try {
      const res = await readiness.GET();
      assert.equal(res.status, 503);
      assert.match(res.headers.get('cache-control') ?? '', /no-store/i);
      const raw = await res.text();
      assert.doesNotMatch(raw, new RegExp(secretValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      const body = JSON.parse(raw) as {
        error?: string;
        lab?: { claimFullyUsable: boolean; pathLiveNotFullyUsable: boolean; blockerIssue: number };
      };
      assert.ok(body.lab);
      assert.equal(body.lab.claimFullyUsable, false);
      assert.equal(body.lab.pathLiveNotFullyUsable, true);
      assert.equal(body.lab.blockerIssue, 53);
      // If message ever included the key value, redactor would replace it
      if (body.error) {
        assert.doesNotMatch(body.error, new RegExp(secretValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
    } finally {
      if (savedKey === undefined) delete process.env.TASK_API_KEY;
      else process.env.TASK_API_KEY = savedKey;
      process.env.TASK_API_KEY = 'monitor-secret';
    }
  });

  it('GET /api/v1/auth/config is no-store, no secrets, labClaimFullyUsable false', async () => {
    const secrets = {
      TASK_API_KEY: 'authcfg-leak-task-api-key-xyz',
      W_ID_CLIENT_SECRET: 'authcfg-leak-oidc-secret-xyz',
      AGENT_REGISTRATION_KEY: 'authcfg-leak-agent-reg-xyz',
      KNOWLEDGE_WRITE_API_KEY: 'authcfg-leak-kw-api-xyz',
      KNOWLEDGE_WRITE_KEY: 'authcfg-leak-kw-key-xyz',
    };
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(secrets)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      const authConfig = await import('../src/app/api/v1/auth/config/route.ts');
      const res = await authConfig.GET();
      assert.equal(res.status, 200);
      assert.match(res.headers.get('cache-control') ?? '', /no-store/i);
      // Residual after 7290c1c: Surrogate-Control on auth/config (SSO UI must not cache Lab claim)
      assert.match(res.headers.get('surrogate-control') ?? '', /no-store/i);
      const raw = await res.text();
      for (const v of Object.values(secrets)) {
        assert.doesNotMatch(raw, new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
      const body = JSON.parse(raw) as {
        labClaimFullyUsable?: boolean;
        labBlockerOpen?: boolean;
        labBlockerIssue?: number;
        labPathLiveNotFullyUsable?: boolean;
      };
      assert.equal(body.labClaimFullyUsable, false);
      // Residual after 59a3fa3: fuller honesty pins (not a lone boolean)
      assert.equal(body.labBlockerOpen, true);
      assert.equal(body.labBlockerIssue, 53);
      assert.equal(body.labPathLiveNotFullyUsable, true);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      process.env.TASK_API_KEY = 'monitor-secret';
    }
  });
});
