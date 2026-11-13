/**
 * Phase 2: POST /jobs/:id/claim was outside the 240/min jobClaim bucket,
 * so a runaway agent bypassed the global claim cap by targeting ids.
 * Garbage ids stay 400 and do not consume the bucket.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const MISSING = '00000000-0000-4000-8000-000000000099';

let tmp = '';
const saved: Record<string, string | undefined> = {};
const KEYS = ['TASK_DB_PATH', 'W_COMPUTE_ENABLED', 'AGENT_WORKSPACE'] as const;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))] ?? 0;
}

before(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-lab-claimid-'));
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

describe('Lab claim-by-id shares the claim cap', { concurrency: false }, () => {
  it('250 targeted claims shed after 240; garbage stays 400; peer stays 409', async () => {
    const { resetRateLimitsForTests } = await import('@/lib/tasks/rate-limit');
    resetRateLimitsForTests();
    const { registerAgent } = await import('@/lib/tasks/auth-agent');
    const { POST: claimById } = await import('../[id]/claim/route.ts');
    const { POST: claimNext } = await import('./route.ts');
    const runaway = await registerAgent({ name: 'claim-id-runaway' });
    const peer = await registerAgent({ name: 'claim-id-peer' });
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });
    const targeted = async (token: string, id = MISSING) => {
      const started = performance.now();
      const res = await claimById(new Request(`http://localhost/api/v1/jobs/${id}/claim`, {
        method: 'POST',
        headers: auth(token),
      }), { params: Promise.resolve({ id }) });
      return { status: res.status, ms: performance.now() - started, retryAfter: res.headers.get('retry-after') };
    };

    const samples: number[] = [];
    let missed = 0;
    let shed = 0;
    let other = 0;
    const wallStart = performance.now();
    for (let i = 0; i < 250; i++) {
      const res = await targeted(runaway.token);
      samples.push(res.ms);
      if (res.status === 409) missed++;
      else if (res.status === 429) {
        shed++;
        assert.ok(Number(res.retryAfter) >= 1);
      } else other++;
    }
    const wallMs = performance.now() - wallStart;
    const garbage = await targeted(runaway.token, 'not-a-uuid');
    const peerRes = await targeted(peer.token);
    console.log(`[lab-claim-id-soak] missed=${missed} shed=${shed} other=${other} p95_ms=${p95(samples).toFixed(2)} wall_ms=${wallMs.toFixed(0)} garbage=${garbage.status} peer=${peerRes.status}`);
    assert.equal(other, 0);
    assert.equal(missed, 240);
    assert.equal(shed, 10);
    assert.equal(garbage.status, 400);
    assert.equal(peerRes.status, 409);
    assert.ok(wallMs < 15_000, `wall ${wallMs}ms`);
    assert.ok(p95(samples) < 500, `p95 ${p95(samples)}ms`);

    resetRateLimitsForTests();
    for (let i = 0; i < 240; i++) {
      const res = await claimNext(new Request('http://localhost/api/v1/jobs/claim', {
        method: 'POST',
        headers: auth(runaway.token),
      }));
      assert.equal(res.status, 204);
    }
    const bypass = await targeted(runaway.token);
    assert.equal(bypass.status, 429);
  });
});
