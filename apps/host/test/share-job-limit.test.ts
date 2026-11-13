/**
 * One share body can carry thousands of UUIDs under the 256KB limit.
 * More than 64 distinct ids is 400 before getJob. Creates are 30/min
 * per user.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))] ?? 0;
}

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-share-limit-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
  Object.assign(process.env, { NODE_ENV: 'test' });
});

after(() => {
  delete process.env.TASK_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('share job id limit', { concurrency: false }, () => {
  it('65 ids are 400 before lookup; 40 creates shed after 30; a second user is not shed', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { MAX_SHARE_JOB_IDS, normalizeShareJobIds } = await import('../src/lib/job-sharing.ts');
    const { POST } = await import('../src/app/api/v1/shares/route.ts');
    const many = Array.from({ length: MAX_SHARE_JOB_IDS + 1 }, (_, i) => uuid(i + 1));
    assert.throws(
      () => normalizeShareJobIds(many),
      (err: Error & { status?: number }) => err.message === 'too many job ids' && err.status === 400,
    );
    assert.equal(normalizeShareJobIds(many.slice(0, MAX_SHARE_JOB_IDS)).length, MAX_SHARE_JOB_IDS);
    assert.equal(normalizeShareJobIds([...many.slice(0, MAX_SHARE_JOB_IDS), many[0]]).length, MAX_SHARE_JOB_IDS);

    const post = async (userId: string, jobIds: string[]) => {
      const started = performance.now();
      const res = await POST(new Request('http://localhost/api/v1/shares', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ jobIds }),
      }));
      const body = await res.json() as { error?: string };
      return { status: res.status, ms: performance.now() - started, error: body.error, retryAfter: res.headers.get('retry-after') };
    };

    const tooMany = await post('share-owner', many);
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.error, 'too many job ids');

    resetRateLimitsForTests();
    const samples: number[] = [];
    let missed = 0;
    let shed = 0;
    let other = 0;
    const wallStart = performance.now();
    for (let i = 0; i < 40; i++) {
      const res = await post('share-owner', [uuid(1)]);
      samples.push(res.ms);
      if (res.status === 404) missed++;
      else if (res.status === 429) {
        shed++;
        assert.equal(res.error, 'rate_limited');
        assert.ok(Number(res.retryAfter) >= 1);
      } else other++;
    }
    const wallMs = performance.now() - wallStart;
    const peer = await post('share-peer', [uuid(1)]);
    console.log(`[share-job-limit] missed=${missed} shed=${shed} other=${other} p95_ms=${p95(samples).toFixed(2)} wall_ms=${wallMs.toFixed(0)} peer=${peer.status}`);
    assert.equal(other, 0);
    assert.equal(missed, 30);
    assert.equal(shed, 10);
    assert.equal(peer.status, 404);
    assert.ok(wallMs < 15_000, `wall ${wallMs}ms`);
    assert.ok(p95(samples) < 500, `p95 ${p95(samples)}ms`);
  });
});
