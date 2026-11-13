/**
 * Drives the real shipped GET /api/health handler (not a mock).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GET } from '../src/app/api/health/route.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');
const testDb = path.join(waveRoot, 'data', 'tasks-test-health.db');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  for (const p of [testDb, testDb + '-wal', testDb + '-shm']) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ok */
    }
  }
});

describe('GET /api/health (shipped handler)', () => {
  it('returns 200 JSON with ok/healthy indicators', async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') ?? '', /no-store/i);
    // Residual after 6d08a42: private/must-revalidate + Pragma on probe surfaces
    assert.match(res.headers.get('cache-control') ?? '', /private|must-revalidate|no-cache/i);
    assert.match(res.headers.get('pragma') ?? '', /no-cache/i);
    // Residual after 1b367e7: Expires: 0 for HTTP/1.0 cache honesty
    assert.equal(res.headers.get('expires'), '0');
    // Residual after aabd0bf: Surrogate-Control no-store (CDN/edge must not cache health honesty)
    assert.match(res.headers.get('surrogate-control') ?? '', /no-store/i);
    const body = (await res.json()) as {
      ok: boolean;
      okScope?: string;
      status: string;
      service: string;
      version?: string;
      uptimeSeconds?: number;
      buildId?: string;
      features?: string[];
      phase?: number;
      lab?: {
        claimFullyUsable: boolean;
        blockerIssue: number;
        blockerOpen: boolean;
        pathLiveNotFullyUsable: boolean;
        noteEn: string;
      };
      jobs?: {
        queued: number;
        leased: number;
        running: number;
        failed: number;
        total: number;
        leaseSeconds: number;
      };
    };
    assert.equal(body.ok, true);
    // Residual after 1b367e7: okScope=process (not task-db, not Lab)
    assert.equal(body.okScope, 'process');
    assert.equal(body.status, 'healthy');
    assert.equal(body.service, 'waveworld-host');
    assert.equal(typeof body.version, 'string');
    assert.ok(body.version && body.version.length > 0);
    assert.equal(typeof body.uptimeSeconds, 'number');
    assert.ok((body.uptimeSeconds ?? -1) >= 0);
    if (body.features) {
      assert.ok(body.features.includes('projects') || (body.phase ?? 0) >= 1);
      assert.ok(body.features.includes('job-stats'));
      assert.ok(body.features.includes('lab-usability-honesty'));
    }
    // Host ok ≠ Lab fully usable while #49 open
    assert.ok(body.lab, 'health must expose lab honesty object');
    assert.equal(body.lab.claimFullyUsable, false);
    assert.equal(body.lab.blockerIssue, 53);
    assert.equal(body.lab.blockerOpen, true);
    assert.equal(body.lab.pathLiveNotFullyUsable, true);
    assert.match(body.lab.noteEn, /#53/);
    assert.match(body.lab.noteEn, /must not claim/i);
    // Job counters when task DB is available
    if (body.jobs) {
      assert.equal(typeof body.jobs.queued, 'number');
      assert.equal(typeof body.jobs.leaseSeconds, 'number');
      assert.ok(body.jobs.leaseSeconds > 0);
    }
  });

  it('includes buildId when BUILD_ID or GIT_SHA is set', async () => {
    const prev = process.env.BUILD_ID;
    process.env.BUILD_ID = 'test-build-abc';
    try {
      const res = await GET();
      assert.equal(res.status, 200);
      const body = (await res.json()) as { buildId?: string };
      assert.equal(body.buildId, 'test-build-abc');
    } finally {
      if (prev === undefined) delete process.env.BUILD_ID;
      else process.env.BUILD_ID = prev;
    }
  });

  it('never leaks secret env values into the health JSON body', async () => {
    const secrets = {
      TASK_API_KEY: 'leak-task-api-key-xyz-not-for-response',
      W_ID_CLIENT_SECRET: 'leak-oidc-client-secret-xyz-not-for-response',
      AGENT_REGISTRATION_KEY: 'leak-agent-reg-key-xyz-not-for-response',
      KNOWLEDGE_WRITE_API_KEY: 'leak-knowledge-write-key-xyz-not-for-response',
      KNOWLEDGE_WRITE_KEY: 'leak-knowledge-write-key-alias-xyz-not-for-response',
    };
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(secrets)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      const res = await GET();
      assert.equal(res.status, 200);
      assert.match(res.headers.get('cache-control') ?? '', /no-store/i);
      const raw = await res.text();
      for (const v of Object.values(secrets)) {
        assert.doesNotMatch(raw, new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
      const body = JSON.parse(raw) as {
        lab?: { claimFullyUsable: boolean; blockerOpen: boolean };
        features?: string[];
      };
      assert.ok(body.lab);
      assert.equal(body.lab.claimFullyUsable, false);
      assert.equal(body.lab.blockerOpen, true);
      assert.ok(body.features?.includes('lab-usability-honesty'));
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('reports only identity features that are actually enabled', async () => {
    const saved = {
      nodeEnv: process.env.NODE_ENV,
      dev: process.env.TASK_ALLOW_DEV_LOGIN,
      issuer: process.env.W_ID_ISSUER,
      clientId: process.env.W_ID_CLIENT_ID,
      secret: process.env.W_ID_CLIENT_SECRET,
      redirect: process.env.W_ID_REDIRECT_URI,
    };
    Object.assign(process.env, { NODE_ENV: 'production' });
    delete process.env.TASK_ALLOW_DEV_LOGIN;
    delete process.env.W_ID_ISSUER;
    delete process.env.W_ID_CLIENT_ID;
    delete process.env.W_ID_CLIENT_SECRET;
    delete process.env.W_ID_REDIRECT_URI;
    try {
      let body = await (await GET()).json() as { features: string[] };
      assert.ok(!body.features.includes('dev-login'));
      assert.ok(!body.features.includes('oidc'));

      process.env.W_ID_ISSUER = 'https://id.example';
      process.env.W_ID_CLIENT_ID = 'waveworld';
      process.env.W_ID_CLIENT_SECRET = 'secret';
      process.env.W_ID_REDIRECT_URI = 'https://wave.example/api/v1/auth/oidc/callback';
      body = await (await GET()).json() as { features: string[] };
      assert.ok(body.features.includes('oidc'));
      assert.ok(!body.features.includes('dev-login'));
    } finally {
      const restore = (key: string, value: string | undefined) => value === undefined
        ? delete process.env[key]
        : void (process.env[key] = value);
      restore('NODE_ENV', saved.nodeEnv);
      restore('TASK_ALLOW_DEV_LOGIN', saved.dev);
      restore('W_ID_ISSUER', saved.issuer);
      restore('W_ID_CLIENT_ID', saved.clientId);
      restore('W_ID_CLIENT_SECRET', saved.secret);
      restore('W_ID_REDIRECT_URI', saved.redirect);
    }
  });
});
