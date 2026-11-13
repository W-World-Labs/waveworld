/**
 * PUT /agents/me rewrites the capability row parsed on later auth calls.
 * There was no per-agent cap. 30/min is checked before the 256KB body.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentCapabilities } from '../src/types/task.ts';

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-agent-cap-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
  process.env.W_COMPUTE_ENABLED = '0';
});

after(() => {
  delete process.env.TASK_DB_PATH;
  delete process.env.W_COMPUTE_ENABLED;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('agent capability update cap', { concurrency: false }, () => {
  it('40 capability PUTs shed after 30; a second agent is not shed', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { PUT } = await import('../src/app/api/v1/agents/me/route.ts');
    const runaway = await registerAgent({ name: 'cap-runaway', capabilities: CAPS });
    const peer = await registerAgent({ name: 'cap-peer', capabilities: CAPS });
    const put = async (token: string, capabilities: AgentCapabilities) => {
      const started = performance.now();
      const res = await PUT(new Request('http://localhost/api/v1/agents/me', {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ capabilities }),
      }));
      return { status: res.status, ms: performance.now() - started, retryAfter: res.headers.get('retry-after') };
    };

    const samples: number[] = [];
    let updated = 0;
    let shed = 0;
    let other = 0;
    const wallStart = performance.now();
    for (let i = 0; i < 40; i++) {
      const res = await put(runaway.token, runaway.agent.capabilities);
      samples.push(res.ms);
      if (res.status === 200) updated++;
      else if (res.status === 429) {
        shed++;
        assert.ok(Number(res.retryAfter) >= 1);
      } else other++;
    }
    const wallMs = performance.now() - wallStart;
    const peerRes = await put(peer.token, peer.agent.capabilities);
    console.log(`[agent-cap-soak] updated=${updated} shed=${shed} other=${other} p95_ms=${p95(samples).toFixed(2)} wall_ms=${wallMs.toFixed(0)} peer=${peerRes.status}`);
    assert.equal(other, 0);
    assert.equal(updated, 30);
    assert.equal(shed, 10);
    assert.equal(peerRes.status, 200);
    assert.ok(wallMs < 15_000, `wall ${wallMs}ms`);
    assert.ok(p95(samples) < 500, `p95 ${p95(samples)}ms`);
  });
});
