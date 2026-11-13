/**
 * POST /projects writes a project and an owner membership with no cap.
 * 30/min per user is checked before the 256KB body.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))] ?? 0;
}

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-project-create-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
  Object.assign(process.env, { NODE_ENV: 'test' });
});

after(() => {
  delete process.env.TASK_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('project create cap', { concurrency: false }, () => {
  it('40 creates shed after 30; a second user is not shed', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { POST } = await import('../src/app/api/v1/projects/route.ts');
    const create = async (userId: string, name: string) => {
      const started = performance.now();
      const res = await POST(new Request('http://localhost/api/v1/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': userId, 'x-workspace-id': 'ws-soak' },
        body: JSON.stringify({ name }),
      }));
      return { status: res.status, ms: performance.now() - started, retryAfter: res.headers.get('retry-after') };
    };

    const samples: number[] = [];
    let created = 0;
    let shed = 0;
    let other = 0;
    const wallStart = performance.now();
    for (let i = 0; i < 40; i++) {
      const res = await create('project-owner', `soak-${i}`);
      samples.push(res.ms);
      if (res.status === 201) created++;
      else if (res.status === 429) {
        shed++;
        assert.ok(Number(res.retryAfter) >= 1);
      } else other++;
    }
    const wallMs = performance.now() - wallStart;
    const peer = await create('project-peer', 'peer-project');
    console.log(`[project-create-soak] created=${created} shed=${shed} other=${other} p95_ms=${p95(samples).toFixed(2)} wall_ms=${wallMs.toFixed(0)} peer=${peer.status}`);
    assert.equal(other, 0);
    assert.equal(created, 30);
    assert.equal(shed, 10);
    assert.equal(peer.status, 201);
    assert.ok(wallMs < 15_000, `wall ${wallMs}ms`);
    assert.ok(p95(samples) < 500, `p95 ${p95(samples)}ms`);
  });
});
