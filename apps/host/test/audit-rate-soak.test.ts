/**
 * Audit POST calls getJob before the access check and can write a
 * manifest. Anonymous callers share jobAudit at 30/min. A bearer
 * agent is a separate bucket. A non-UUID stays 400.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentCapabilities } from '../src/types/task.ts';

const MISSING = '00000000-0000-4000-8000-000000000051';
const CAPS: AgentCapabilities = {
  backends: ['cpu'],
  maxGrid: 'fast',
  thermal: false,
  kinds: ['lbm-d3q19'],
};

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))] ?? 0;
}

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-audit-limit-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
  process.env.W_COMPUTE_ENABLED = '0';
});

after(() => {
  delete process.env.TASK_DB_PATH;
  delete process.env.W_COMPUTE_ENABLED;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('audit manifest create cap', { concurrency: false }, () => {
  it('40 anonymous audits shed after 30; garbage stays 400; an agent is not in that bucket', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { POST } = await import('../src/app/api/v1/jobs/[id]/audit/route.ts');
    const { token } = await registerAgent({ name: 'audit-agent', capabilities: CAPS });
    const audit = async (id: string, headers?: Record<string, string>) => {
      const started = performance.now();
      const res = await POST(new Request(`http://localhost/api/v1/jobs/${id}/audit`, {
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
    for (let i = 0; i < 40; i++) {
      const res = await audit(MISSING);
      samples.push(res.ms);
      if (res.status === 404) missed++;
      else if (res.status === 429) {
        shed++;
        assert.ok(Number(res.retryAfter) >= 1);
      } else other++;
    }
    const wallMs = performance.now() - wallStart;
    const garbage = await audit('not-a-uuid');
    const peer = await audit(MISSING, { 'cf-connecting-ip': '203.0.113.10' });
    const agent = await audit(MISSING, { authorization: `Bearer ${token}` });
    console.log(`[audit-soak] missed=${missed} shed=${shed} other=${other} p95_ms=${p95(samples).toFixed(2)} wall_ms=${wallMs.toFixed(0)} garbage=${garbage.status} peer=${peer.status} agent=${agent.status}`);
    assert.equal(other, 0);
    assert.equal(missed, 30);
    assert.equal(shed, 10);
    assert.equal(garbage.status, 400);
    assert.equal(peer.status, 404);
    assert.equal(agent.status, 404);
    assert.ok(wallMs < 15_000, `wall ${wallMs}ms`);
    assert.ok(p95(samples) < 500, `p95 ${p95(samples)}ms`);
  });
});
