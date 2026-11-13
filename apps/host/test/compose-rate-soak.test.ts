/**
 * Publication and comparison creates look up every job id and then write
 * a derived record. They share jobCompose at 30/min per user, before the
 * body is read.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MISSING = '00000000-0000-4000-8000-000000000041';

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))] ?? 0;
}

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-compose-limit-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
  Object.assign(process.env, { NODE_ENV: 'test' });
});

after(() => {
  delete process.env.TASK_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('publication and comparison create cap', { concurrency: false }, () => {
  it('40 publication creates shed after 30; the next comparison is 429; a second user is not shed', async () => {
    const coldStart = performance.now();
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { POST: publish } = await import('../src/app/api/v1/publications/route.ts');
    const { POST: compare } = await import('../src/app/api/v1/comparisons/route.ts');
    const postPub = async (userId: string) => {
      const started = performance.now();
      const res = await publish(new Request('http://localhost/api/v1/publications', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ jobIds: [MISSING], title: 'soak' }),
      }));
      return { status: res.status, ms: performance.now() - started, retryAfter: res.headers.get('retry-after') };
    };
    const postCompare = (userId: string) => compare(new Request('http://localhost/api/v1/comparisons', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify({ jobIds: [MISSING] }),
    }));

    // POST lazily imports its dependencies and opens SQLite. Measure startup
    // separately so the warm rate-limit soak does not include loader contention
    // from other test processes. Warmup must not consume the measured budget.
    const warmup = await postPub('compose-warmup');
    assert.equal(warmup.status, 404);
    assert.equal((await postCompare('compose-warmup')).status, 400);
    console.log(`[compose-soak:cold] startup_ms=${(performance.now() - coldStart).toFixed(0)} publication_ms=${warmup.ms.toFixed(0)}`);
    resetRateLimitsForTests();

    const samples: number[] = [];
    let missed = 0;
    let shed = 0;
    let other = 0;
    const wallStart = performance.now();
    for (let i = 0; i < 40; i++) {
      const res = await postPub('compose-owner');
      samples.push(res.ms);
      if (res.status === 404) missed++;
      else if (res.status === 429) {
        shed++;
        assert.ok(Number(res.retryAfter) >= 1);
      } else other++;
    }
    const wallMs = performance.now() - wallStart;
    const compared = await postCompare('compose-owner');
    const peer = await postPub('compose-peer');
    console.log(`[compose-soak] missed=${missed} shed=${shed} other=${other} p95_ms=${p95(samples).toFixed(2)} wall_ms=${wallMs.toFixed(0)} comparison=${compared.status} peer=${peer.status}`);
    assert.equal(other, 0);
    assert.equal(missed, 30);
    assert.equal(shed, 10);
    assert.equal(compared.status, 429);
    assert.equal(peer.status, 404);
    assert.ok(wallMs < 15_000, `wall ${wallMs}ms`);
    assert.ok(p95(samples) < 500, `p95 ${p95(samples)}ms`);
  });
});
