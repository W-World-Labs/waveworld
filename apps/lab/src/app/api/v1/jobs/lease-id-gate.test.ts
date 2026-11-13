/**
 * Phase 2: leftover Lab lease routes must reject a non-UUID path id
 * before claim/heartbeat/fail/complete. A padded UUID still addresses
 * the held job and must not burn the heartbeat budget.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { JobSpecV1 } from '@/types/task';

const SPEC: JobSpecV1 = {
  schemaVersion: 1,
  kind: 'export-report',
  name: 'lease-id-gate',
  parameters: { reportType: 'audit' },
  run: { maxSteps: 1 },
  outputs: { forces: false, history: false },
};
const CAPS = { backends: ['cpu' as const], kinds: ['export-report' as const] };

let tmp = '';
const saved: Record<string, string | undefined> = {};
const KEYS = ['TASK_DB_PATH', 'W_COMPUTE_ENABLED', 'AGENT_WORKSPACE'] as const;

before(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-lab-lease-id-'));
  process.env.TASK_DB_PATH = path.join(tmp, 'tasks.db');
  process.env.W_COMPUTE_ENABLED = '0';
  delete process.env.AGENT_WORKSPACE;
});

after(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function bodyError(res: Response): Promise<string> {
  const body = await res.json() as { error?: string };
  return body.error ?? '';
}

describe('Lab lease path id gate', { concurrency: false }, () => {
  it('garbage ids are 400 and a padded id still heartbeats without burning the budget', async () => {
    const { resetRateLimitsForTests } = await import('@/lib/tasks/rate-limit');
    resetRateLimitsForTests();
    const { registerAgent } = await import('@/lib/tasks/auth-agent');
    const { createJob, claimJob } = await import('@/lib/tasks/service');
    const { POST: heartbeat } = await import('./[id]/heartbeat/route.ts');
    const { POST: claimById } = await import('./[id]/claim/route.ts');
    const { POST: fail } = await import('./[id]/fail/route.ts');
    const { POST: complete } = await import('./[id]/complete/route.ts');
    const holder = await registerAgent({ name: 'lease-holder', capabilities: CAPS });
    const auth = { authorization: `Bearer ${holder.token}` };

    const garbageBeat = await heartbeat(new Request('http://localhost/api/v1/jobs/not-a-uuid/heartbeat', {
      method: 'POST',
      headers: auth,
    }), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    assert.equal(garbageBeat.status, 400);
    assert.equal(await bodyError(garbageBeat), 'invalid job id');

    const garbageClaim = await claimById(new Request('http://localhost/api/v1/jobs/not-a-uuid/claim', {
      method: 'POST',
      headers: auth,
    }), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    assert.equal(garbageClaim.status, 400);
    assert.equal(await bodyError(garbageClaim), 'invalid job id');

    const garbageFail = await fail(new Request('http://localhost/api/v1/jobs/not-a-uuid/fail', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'x' }),
    }), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    assert.equal(garbageFail.status, 400);
    assert.equal(await bodyError(garbageFail), 'invalid job id');

    const garbageComplete = await complete(new Request('http://localhost/api/v1/jobs/not-a-uuid/complete', {
      method: 'POST',
      headers: auth,
    }), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    assert.equal(garbageComplete.status, 400);
    assert.equal(await bodyError(garbageComplete), 'invalid job id');

    const started = performance.now();
    for (let i = 0; i < 480; i++) {
      const res = await heartbeat(new Request('http://localhost/api/v1/jobs/nope/heartbeat', {
        method: 'POST',
        headers: auth,
      }), { params: Promise.resolve({ id: 'nope' }) });
      assert.equal(res.status, 400);
    }
    const garbageWallMs = performance.now() - started;

    const queued = createJob({ spec: SPEC, createdBy: 'owner-1' });
    const padded = ` ${queued.id} `;
    const claimed = await claimById(new Request(`http://localhost/api/v1/jobs/${encodeURIComponent(padded)}/claim`, {
      method: 'POST',
      headers: auth,
    }), { params: Promise.resolve({ id: padded }) });
    assert.equal(claimed.status, 200, await claimed.text());

    const beatStarted = performance.now();
    const held = await heartbeat(new Request(`http://localhost/api/v1/jobs/${encodeURIComponent(padded)}/heartbeat`, {
      method: 'POST',
      headers: auth,
    }), { params: Promise.resolve({ id: padded }) });
    const beatMs = performance.now() - beatStarted;
    const heldBody = await held.json() as { job?: { id?: string; agentId?: string; status?: string } };
    console.log(`[lab-lease-id] garbage_wall_ms=${garbageWallMs.toFixed(0)} padded_heartbeat_ms=${beatMs.toFixed(2)} status=${held.status}`);
    assert.equal(held.status, 200);
    assert.equal(heldBody.job?.id, queued.id);
    assert.equal(heldBody.job?.agentId, holder.agent.id);
    assert.ok(garbageWallMs < 15_000);
    assert.equal(claimJob({
      agentId: holder.agent.id,
      capabilities: holder.agent.capabilities,
      jobId: queued.id,
    }), null);
  });
});
