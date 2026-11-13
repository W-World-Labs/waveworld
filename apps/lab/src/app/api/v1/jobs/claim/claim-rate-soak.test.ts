/**
 * Phase 2 soak: leftover Lab POST /api/v1/jobs/claim is public and was
 * uncapped. Host sheds a runaway agent at 240/min. This drives the real
 * Lab route for a fixed 250 claims, records p95 and wall time, and checks
 * that a second agent is not in the same bucket.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

let tmp = '';
const saved: Record<string, string | undefined> = {};
const KEYS = ['TASK_DB_PATH', 'W_COMPUTE_ENABLED', 'AGENT_WORKSPACE'] as const;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[idx] ?? 0;
}

before(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-lab-claim-soak-'));
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

describe('Lab leftover claim soak', { concurrency: false }, () => {
  it('250 claims shed after 240; peer stays 204; wall stays bounded', async () => {
    const { resetRateLimitsForTests } = await import('@/lib/tasks/rate-limit');
    resetRateLimitsForTests();
    const { registerAgent } = await import('@/lib/tasks/auth-agent');
    const { POST } = await import('./route.ts');
    const runaway = await registerAgent({ name: 'lab-runaway' });
    const peer = await registerAgent({ name: 'lab-peer' });
    const claim = async (token: string) => {
      const started = performance.now();
      const res = await POST(new Request('http://localhost/api/v1/jobs/claim', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }));
      return { status: res.status, ms: performance.now() - started, retryAfter: res.headers.get('retry-after') };
    };

    const samples: number[] = [];
    let passed = 0;
    let shed = 0;
    let other = 0;
    const wallStart = performance.now();
    for (let i = 0; i < 250; i++) {
      const res = await claim(runaway.token);
      samples.push(res.ms);
      if (res.status === 204) passed++;
      else if (res.status === 429) {
        shed++;
        assert.ok(Number(res.retryAfter) >= 1);
      } else other++;
    }
    const wallMs = performance.now() - wallStart;
    const peerRes = await claim(peer.token);
    const claimP95 = p95(samples);
    console.log(`[lab-claim-soak] passed=${passed} shed=${shed} other=${other} p95_ms=${claimP95.toFixed(2)} wall_ms=${wallMs.toFixed(0)} peer=${peerRes.status}`);
    assert.equal(other, 0);
    assert.equal(passed, 240);
    assert.equal(shed, 10);
    assert.equal(peerRes.status, 204);
    assert.ok(wallMs < 15_000, `soak wall ${wallMs}ms exceeded 15s`);
    assert.ok(claimP95 < 500, `claim p95 ${claimP95}ms`);
  });

  it('heartbeat and progress share the 480/min agent bucket', async () => {
    const { resetRateLimitsForTests } = await import('@/lib/tasks/rate-limit');
    resetRateLimitsForTests();
    const { registerAgent } = await import('@/lib/tasks/auth-agent');
    const { POST: heartbeat } = await import('../[id]/heartbeat/route.ts');
    const { POST: progress } = await import('../[id]/progress/route.ts');
    const agent = await registerAgent({ name: 'lab-heartbeat' });
    const missingId = '00000000-0000-4000-8000-000000000001';
    const ctx = { params: Promise.resolve({ id: missingId }) };
    const beat = () => heartbeat(new Request(`http://localhost/api/v1/jobs/${missingId}/heartbeat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${agent.token}`, 'content-type': 'application/json' },
      body: '{}',
    }), ctx);
    let notFound = 0;
    let shed = 0;
    const started = performance.now();
    for (let i = 0; i < 481; i++) {
      const res = await beat();
      if (res.status === 404) notFound++;
      else if (res.status === 429) shed++;
      else assert.fail(`unexpected heartbeat status ${res.status}`);
    }
    const wallMs = performance.now() - started;
    const progressed = await progress(new Request(`http://localhost/api/v1/jobs/${missingId}/progress`, {
      method: 'POST',
      headers: { authorization: `Bearer ${agent.token}`, 'content-type': 'application/json' },
      body: '{}',
    }), ctx);
    console.log(`[lab-heartbeat-soak] notFound=${notFound} shed=${shed} wall_ms=${wallMs.toFixed(0)} progress=${progressed.status}`);
    assert.equal(notFound, 480);
    assert.equal(shed, 1);
    assert.equal(progressed.status, 429);
    assert.ok(wallMs < 15_000, `heartbeat soak wall ${wallMs}ms exceeded 15s`);
  });
});
