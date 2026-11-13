/**
 * Phase 2 soak: leftover Lab fail/complete had no per-agent cap, and
 * complete reads up to 64MB before doing work. Both now share jobSettle
 * (120/min) after the UUID gate and before the body read.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const MISSING = '00000000-0000-4000-8000-0000000000aa';

let tmp = '';
const saved: Record<string, string | undefined> = {};
const KEYS = ['TASK_DB_PATH', 'W_COMPUTE_ENABLED', 'AGENT_WORKSPACE'] as const;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))] ?? 0;
}

before(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-lab-settle-'));
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

describe('Lab settle rate soak', { concurrency: false }, () => {
  it('130 fails shed after 120; garbage stays 400; the next complete is 429', async () => {
    const { resetRateLimitsForTests } = await import('@/lib/tasks/rate-limit');
    resetRateLimitsForTests();
    const { registerAgent } = await import('@/lib/tasks/auth-agent');
    const { POST: fail } = await import('./[id]/fail/route.ts');
    const { POST: complete } = await import('./[id]/complete/route.ts');
    const runaway = await registerAgent({ name: 'settle-runaway' });
    const peer = await registerAgent({ name: 'settle-peer' });
    const call = async (token: string, kind: 'fail' | 'complete', id = MISSING) => {
      const started = performance.now();
      const res = kind === 'fail'
        ? await fail(new Request(`http://localhost/api/v1/jobs/${id}/fail`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'soak' }),
        }), { params: Promise.resolve({ id }) })
        : await complete(new Request(`http://localhost/api/v1/jobs/${id}/complete`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        }), { params: Promise.resolve({ id }) });
      return { status: res.status, ms: performance.now() - started, retryAfter: res.headers.get('retry-after') };
    };

    const samples: number[] = [];
    let missed = 0;
    let shed = 0;
    let other = 0;
    const wallStart = performance.now();
    for (let i = 0; i < 130; i++) {
      const res = await call(runaway.token, 'fail');
      samples.push(res.ms);
      if (res.status === 409) missed++;
      else if (res.status === 429) {
        shed++;
        assert.ok(Number(res.retryAfter) >= 1);
      } else other++;
    }
    const wallMs = performance.now() - wallStart;
    const garbage = await call(runaway.token, 'fail', 'not-a-uuid');
    const peerRes = await call(peer.token, 'fail');
    const completed = await call(runaway.token, 'complete');
    console.log(`[lab-settle-soak] missed=${missed} shed=${shed} other=${other} p95_ms=${p95(samples).toFixed(2)} wall_ms=${wallMs.toFixed(0)} garbage=${garbage.status} peer=${peerRes.status} complete=${completed.status}`);
    assert.equal(other, 0);
    assert.equal(missed, 120);
    assert.equal(shed, 10);
    assert.equal(garbage.status, 400);
    assert.equal(peerRes.status, 409);
    assert.equal(completed.status, 429);
    assert.ok(wallMs < 15_000, `wall ${wallMs}ms`);
    assert.ok(p95(samples) < 500, `p95 ${p95(samples)}ms`);
  });
});
