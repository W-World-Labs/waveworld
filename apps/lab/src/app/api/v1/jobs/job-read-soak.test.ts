/**
 * Phase 2 soak: leftover Lab GET /jobs/:id called getJob before the
 * rate limit and treated a non-UUID as "Job not found". Detail reads
 * share jobRead at 120/min. A garbage id stays 400.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const MISSING = '00000000-0000-4000-8000-0000000000dd';

let tmp = '';
const saved: Record<string, string | undefined> = {};
const KEYS = ['TASK_DB_PATH', 'NODE_ENV', 'JOB_REQUIRE_AUTH', 'TASK_API_KEY', 'W_COMPUTE_ENABLED'] as const;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))] ?? 0;
}

before(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-lab-read-'));
  process.env.TASK_DB_PATH = path.join(tmp, 'tasks.db');
  process.env.NODE_ENV = 'production';
  delete process.env.JOB_REQUIRE_AUTH;
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

describe('Lab job detail read soak', { concurrency: false }, () => {
  it('130 anonymous reads shed after 120; garbage stays 400; another IP is not shed', async () => {
    const { resetRateLimitsForTests } = await import('@/lib/tasks/rate-limit');
    resetRateLimitsForTests();
    const { GET } = await import('./[id]/route.ts');
    const read = async (id: string, ip?: string) => {
      const started = performance.now();
      const headers = new Headers();
      if (ip) headers.set('cf-connecting-ip', ip);
      const res = await GET(new Request(`http://localhost/api/v1/jobs/${id}`, { headers }), {
        params: Promise.resolve({ id }),
      });
      const text = await res.text();
      return {
        status: res.status,
        ms: performance.now() - started,
        retryAfter: res.headers.get('retry-after'),
        leaked: text.includes('"job"'),
      };
    };

    const samples: number[] = [];
    let missed = 0;
    let shed = 0;
    let other = 0;
    const wallStart = performance.now();
    for (let i = 0; i < 130; i++) {
      const res = await read(MISSING);
      samples.push(res.ms);
      assert.equal(res.leaked, false);
      if (res.status === 404) missed++;
      else if (res.status === 429) {
        shed++;
        assert.ok(Number(res.retryAfter) >= 1);
      } else other++;
    }
    const wallMs = performance.now() - wallStart;
    const garbage = await read('not-a-uuid');
    const peer = await read(MISSING, '203.0.113.8');
    console.log(`[lab-read-soak] missed=${missed} shed=${shed} other=${other} p95_ms=${p95(samples).toFixed(2)} wall_ms=${wallMs.toFixed(0)} garbage=${garbage.status} peer=${peer.status}`);
    assert.equal(other, 0);
    assert.equal(missed, 120);
    assert.equal(shed, 10);
    assert.equal(garbage.status, 400);
    assert.equal(garbage.leaked, false);
    assert.equal(peer.status, 404);
    assert.ok(wallMs < 15_000, `wall ${wallMs}ms`);
    assert.ok(p95(samples) < 500, `p95 ${p95(samples)}ms`);
  });
});
