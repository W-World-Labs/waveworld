/**
 * Phase 2: progress shared the heartbeat budget but charged it before
 * the UUID gate. 480 bad ids could 429 the real keepalive and drop
 * the lease. Bad ids must stay 400 and leave the held job heartbeating.
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
  name: 'progress-budget',
  parameters: { reportType: 'audit' },
  run: { maxSteps: 1 },
  outputs: { forces: false, history: false },
};
const CAPS = { backends: ['cpu' as const], kinds: ['export-report' as const] };

let tmp = '';
const saved: Record<string, string | undefined> = {};
const KEYS = ['TASK_DB_PATH', 'W_COMPUTE_ENABLED', 'AGENT_WORKSPACE'] as const;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))] ?? 0;
}

before(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-lab-progress-'));
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

describe('Lab progress does not spend the heartbeat budget on a bad id', { concurrency: false }, () => {
  it('480 garbage progress calls stay 400 and the held job still heartbeats', async () => {
    const { resetRateLimitsForTests } = await import('@/lib/tasks/rate-limit');
    resetRateLimitsForTests();
    const { registerAgent } = await import('@/lib/tasks/auth-agent');
    const { createJob, claimJob } = await import('@/lib/tasks/service');
    const { POST: progress } = await import('./[id]/progress/route.ts');
    const { POST: heartbeat } = await import('./[id]/heartbeat/route.ts');
    const holder = await registerAgent({ name: 'progress-holder', capabilities: CAPS });
    const queued = createJob({ spec: SPEC, createdBy: 'owner-1' });
    const claimed = claimJob({
      agentId: holder.agent.id,
      capabilities: holder.agent.capabilities,
      jobId: queued.id,
    });
    assert.ok(claimed);
    const auth = { authorization: `Bearer ${holder.token}`, 'content-type': 'application/json' };
    const samples: number[] = [];
    const wallStart = performance.now();
    for (let i = 0; i < 480; i++) {
      const started = performance.now();
      const res = await progress(new Request('http://localhost/api/v1/jobs/nope/progress', {
        method: 'POST',
        headers: auth,
        body: '{}',
      }), { params: Promise.resolve({ id: 'nope' }) });
      samples.push(performance.now() - started);
      assert.equal(res.status, 400);
    }
    const wallMs = performance.now() - wallStart;
    const beatStarted = performance.now();
    const held = await heartbeat(new Request(`http://localhost/api/v1/jobs/${queued.id}/heartbeat`, {
      method: 'POST',
      headers: auth,
    }), { params: Promise.resolve({ id: queued.id }) });
    const beatMs = performance.now() - beatStarted;
    const body = await held.json() as { job?: { id?: string; agentId?: string } };
    console.log(`[lab-progress-budget] garbage=480 wall_ms=${wallMs.toFixed(0)} p95_ms=${p95(samples).toFixed(2)} heartbeat=${held.status} beat_ms=${beatMs.toFixed(2)}`);
    assert.equal(held.status, 200);
    assert.equal(body.job?.id, queued.id);
    assert.equal(body.job?.agentId, holder.agent.id);
    assert.ok(wallMs < 15_000, `wall ${wallMs}ms`);
    assert.ok(p95(samples) < 500, `p95 ${p95(samples)}ms`);
  });
});
