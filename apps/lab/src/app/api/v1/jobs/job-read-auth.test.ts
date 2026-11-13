/**
 * Phase 2: leftover Lab job reads must not publish the queue in production.
 * Drives the shipped list, detail, and stats handlers.
 *
 * Before: anonymous GET /api/v1/jobs and /stats returned 200, and
 * GET /api/v1/jobs/:id returned the full record (spec, result, createdBy).
 * Host's copies of those routes already require auth.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { JobSpecV1 } from '@/types/task';

const MARKER = 'WW_LAB_JOB_SPEC_MARKER';
const SPEC: JobSpecV1 = {
  schemaVersion: 1,
  kind: 'export-report',
  name: MARKER,
  parameters: { reportType: 'audit' },
  run: { maxSteps: 1 },
  outputs: { forces: false, history: false },
};
const CAPS = { backends: ['cpu' as const], kinds: ['export-report' as const] };

let tmp = '';
const saved: Record<string, string | undefined> = {};
const KEYS = ['TASK_DB_PATH', 'NODE_ENV', 'JOB_REQUIRE_AUTH', 'TASK_API_KEY', 'W_COMPUTE_ENABLED', 'AGENT_WORKSPACE'] as const;

before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-lab-jobread-'));
  process.env.TASK_DB_PATH = path.join(tmp, 'tasks.db');
  process.env.NODE_ENV = 'test';
  delete process.env.JOB_REQUIRE_AUTH;
  delete process.env.TASK_API_KEY;
  process.env.W_COMPUTE_ENABLED = '0';
  delete process.env.AGENT_WORKSPACE;
});

after(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) {
    prev[key] = process.env[key];
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

async function plantJob() {
  const { createJob } = await import('@/lib/tasks/service');
  return createJob({ spec: SPEC, createdBy: 'owner-1' });
}

describe('Lab leftover job reads', { concurrency: false }, () => {
  it('production anonymous list is 401 and omits the spec', async () => {
    const job = await plantJob();
    await withEnv({
      NODE_ENV: 'production',
      TASK_API_KEY: undefined,
      JOB_REQUIRE_AUTH: undefined,
      WAVEWORLD_HOST_URL: undefined,
      TASK_API_URL: undefined,
    }, async () => {
      const { GET } = await import('./route.ts');
      const res = await GET(new Request('http://localhost/api/v1/jobs?limit=50'));
      const text = await res.text();
      assert.equal(res.status, 401);
      assert.equal(text.includes(MARKER), false);
      assert.equal(text.includes(job.id), false);
      assert.equal(text.includes('"jobs"'), false);
      const body = JSON.parse(text) as { error?: string };
      assert.equal(body.error, 'user authentication required');
      assert.match(res.headers.get('cache-control') ?? '', /no-store/);
      assert.equal(res.headers.get('deprecation'), 'true');
      const link = res.headers.get('link') ?? '';
      assert.equal(link.includes('127.0.0.1'), false);
      assert.equal(link.includes('localhost'), false);
      assert.equal(link, '</api/v1/jobs>; rel="successor-version"');
      assert.equal(res.headers.get('x-waveworld-canonical-jobs'), '/api/v1/jobs');

      const forged = await GET(new Request('http://localhost/api/v1/jobs', {
        headers: { 'x-api-key': 'forged' },
      }));
      const forgedText = await forged.text();
      assert.equal(forged.status, 401);
      assert.equal(forgedText.includes(MARKER), false);
    });
  });

  it('production anonymous stats is 401 and has no counters', async () => {
    await withEnv({ NODE_ENV: 'production', TASK_API_KEY: undefined }, async () => {
      const { GET } = await import('./stats/route.ts');
      const res = await GET(new Request('http://localhost/api/v1/jobs/stats'));
      const text = await res.text();
      assert.equal(res.status, 401);
      assert.equal(text.includes('leaseSeconds'), false);
      assert.equal(text.includes('"stats"'), false);
      const body = JSON.parse(text) as { error?: string };
      assert.equal(body.error, 'authentication required');
      assert.match(res.headers.get('cache-control') ?? '', /no-store/);
    });
  });

  it('production anonymous detail of an existing job is 404 and omits the record', async () => {
    const job = await plantJob();
    await withEnv({ NODE_ENV: 'production', TASK_API_KEY: undefined }, async () => {
      const { GET } = await import('./[id]/route.ts');
      const res = await GET(new Request(`http://localhost/api/v1/jobs/${job.id}`), {
        params: Promise.resolve({ id: job.id }),
      });
      const text = await res.text();
      assert.equal(res.status, 404);
      assert.equal(text.includes(MARKER), false);
      assert.equal(text.includes('"job"'), false);
      const body = JSON.parse(text) as { error?: string };
      assert.equal(body.error, 'Job not found');
    });
  });

  it('production wrong operator key is 401; the right key lists the job', async () => {
    const job = await plantJob();
    await withEnv({ NODE_ENV: 'production', TASK_API_KEY: 'lab-job-read-key' }, async () => {
      const { GET } = await import('./route.ts');
      const denied = await GET(new Request('http://localhost/api/v1/jobs', {
        headers: { 'x-api-key': 'nope' },
      }));
      const deniedText = await denied.text();
      assert.equal(denied.status, 401);
      assert.equal(deniedText.includes(MARKER), false);

      const allowed = await GET(new Request('http://localhost/api/v1/jobs', {
        headers: { 'x-api-key': 'lab-job-read-key' },
      }));
      const allowedText = await allowed.text();
      assert.equal(allowed.status, 200);
      assert.equal(allowedText.includes(job.id), true);
      assert.equal(allowedText.includes(MARKER), true);
    });
  });

  it('production holding agent can read the job; a different agent cannot', async () => {
    const job = await plantJob();
    const { claimJob } = await import('@/lib/tasks/service');
    const { registerAgent } = await import('@/lib/tasks/auth-agent');
    const holder = await registerAgent({ name: 'holder', capabilities: CAPS });
    const stranger = await registerAgent({ name: 'stranger', capabilities: CAPS });
    const claimed = claimJob({
      agentId: holder.agent.id,
      capabilities: holder.agent.capabilities,
      jobId: job.id,
    });
    assert.ok(claimed, 'holder must claim the planted job');
    await withEnv({ NODE_ENV: 'production', TASK_API_KEY: undefined }, async () => {
      const { GET } = await import('./[id]/route.ts');
      const ctx = { params: Promise.resolve({ id: job.id }) };
      const strangerRes = await GET(new Request(`http://localhost/api/v1/jobs/${job.id}`, {
        headers: { authorization: `Bearer ${stranger.token}` },
      }), ctx);
      const strangerText = await strangerRes.text();
      assert.equal(strangerRes.status, 404);
      assert.equal(strangerText.includes(MARKER), false);

      const holderRes = await GET(new Request(`http://localhost/api/v1/jobs/${job.id}`, {
        headers: { authorization: `Bearer ${holder.token}` },
      }), ctx);
      const holderBody = await holderRes.json() as { job?: { id?: string; name?: string; agentId?: string } };
      assert.equal(holderRes.status, 200);
      assert.equal(holderBody.job?.id, job.id);
      assert.equal(holderBody.job?.name, MARKER);
      assert.equal(holderBody.job?.agentId, holder.agent.id);
    });
  });

  it('artifact-source 400 cites the public path and not a loopback host', async () => {
    await withEnv({
      NODE_ENV: 'test',
      TASK_API_KEY: undefined,
      JOB_REQUIRE_AUTH: undefined,
      WAVEWORLD_HOST_URL: undefined,
      TASK_API_URL: undefined,
    }, async () => {
      const { POST } = await import('./route.ts');
      const res = await POST(new Request('http://localhost/api/v1/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          spec: {
            schemaVersion: 1,
            kind: 'lbm-d3q19',
            model: { source: 'artifact', artifactId: 'mesh-1' },
            parameters: {},
            run: { maxSteps: 1 },
            outputs: { forces: false, history: false },
          },
        }),
      }));
      const text = await res.text();
      assert.equal(res.status, 400);
      assert.equal(text.includes('127.0.0.1'), false);
      assert.equal(text.includes('localhost'), false);
      assert.equal(text.includes('/api/v1/jobs'), true);
    });
  });

  it('non-production stays open unless JOB_REQUIRE_AUTH=1', async () => {
    const job = await plantJob();
    const { GET } = await import('./route.ts');
    await withEnv({ NODE_ENV: 'test', JOB_REQUIRE_AUTH: undefined, TASK_API_KEY: undefined }, async () => {
      const open = await GET(new Request('http://localhost/api/v1/jobs'));
      const openText = await open.text();
      assert.equal(open.status, 200);
      assert.equal(openText.includes(job.id), true);
    });
    await withEnv({ NODE_ENV: 'test', JOB_REQUIRE_AUTH: '1', TASK_API_KEY: undefined }, async () => {
      const closed = await GET(new Request('http://localhost/api/v1/jobs'));
      const closedText = await closed.text();
      assert.equal(closed.status, 401);
      assert.equal(closedText.includes(MARKER), false);
      assert.equal(closedText.includes(job.id), false);
    });
  });
});
