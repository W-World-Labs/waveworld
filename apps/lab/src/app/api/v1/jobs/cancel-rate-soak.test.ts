/**
 * Phase 2 soak: leftover Lab cancel had no cap and treated a non-UUID as
 * "Job not found". 60/min is keyed by client IP. A garbage id stays 400.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const MISSING = '00000000-0000-4000-8000-0000000000cc';

let tmp = '';
const saved: Record<string, string | undefined> = {};
const KEYS = ['TASK_DB_PATH', 'NODE_ENV', 'TASK_API_KEY', 'W_COMPUTE_ENABLED'] as const;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))] ?? 0;
}

before(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-lab-cancel-'));
  process.env.TASK_DB_PATH = path.join(tmp, 'tasks.db');
  process.env.NODE_ENV = 'test';
  delete process.env.TASK_API_KEY;
  process.env.W_COMPUTE_ENABLED = '0';
});

after(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('Lab cancel rate soak', { concurrency: false }, () => {
  it('70 anonymous cancels shed after 60; garbage stays 400; another IP is not shed', async () => {
    const { resetRateLimitsForTests } = await import('@/lib/tasks/rate-limit');
    resetRateLimitsForTests();
    const { POST } = await import('./[id]/cancel/route.ts');
    const cancel = async (id: string, ip?: string) => {
      const started = performance.now();
      const headers = new Headers();
      if (ip) headers.set('cf-connecting-ip', ip);
      const res = await POST(new Request(`http://localhost/api/v1/jobs/${id}/cancel`, {
        method: 'POST',
        headers,
      }), { params: Promise.resolve({ id }) });
      return { status: res.status, ms: performance.now() - started, retryAfter: res.headers.get('retry-after') };
    };

    const samples: number[] = [];
    let missed = 0;
    let shed = 0;
    let other = 0;
    const wallStart = performance.now();
    for (let i = 0; i < 70; i++) {
      const res = await cancel(MISSING);
      samples.push(res.ms);
      if (res.status === 404) missed++;
      else if (res.status === 429) {
        shed++;
        assert.ok(Number(res.retryAfter) >= 1);
      } else other++;
    }
    const wallMs = performance.now() - wallStart;
    const garbage = await cancel('not-a-uuid');
    const peer = await cancel(MISSING, '203.0.113.7');
    console.log(`[lab-cancel-soak] missed=${missed} shed=${shed} other=${other} p95_ms=${p95(samples).toFixed(2)} wall_ms=${wallMs.toFixed(0)} garbage=${garbage.status} peer=${peer.status}`);
    assert.equal(other, 0);
    assert.equal(missed, 60);
    assert.equal(shed, 10);
    assert.equal(garbage.status, 400);
    assert.equal(peer.status, 404);
    assert.ok(wallMs < 15_000, `wall ${wallMs}ms`);
    assert.ok(p95(samples) < 500, `p95 ${p95(samples)}ms`);
  });
});
