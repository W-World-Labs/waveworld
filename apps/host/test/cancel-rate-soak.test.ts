/**
 * Host cancel looked up a missing UUID before auth. Anonymous callers
 * now share a 60/min IP bucket. An agent token is a separate bucket.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentCapabilities } from '../src/types/task.ts';

const MISSING = '00000000-0000-4000-8000-0000000000cc';
const CAPS: AgentCapabilities = {
  backends: ['cpu'],
  maxGrid: 'fast',
  thermal: false,
  kinds: ['lbm-d3q19'],
};

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-host-cancel-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
});

after(() => {
  delete process.env.TASK_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Host cancel rate cap', { concurrency: false }, () => {
  it('61 anonymous cancels shed the last; garbage stays 400; an agent is not in that bucket', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { POST } = await import('../src/app/api/v1/jobs/[id]/cancel/route.ts');
    const { token } = await registerAgent({ name: 'cancel-agent', capabilities: CAPS });
    const cancel = (id: string, headers?: Record<string, string>) => POST(new Request(`http://localhost/api/v1/jobs/${id}/cancel`, {
      method: 'POST',
      headers,
    }), { params: Promise.resolve({ id }) });

    let missed = 0;
    let shed = 0;
    for (let i = 0; i < 61; i++) {
      const res = await cancel(MISSING);
      if (res.status === 404) missed++;
      else if (res.status === 429) shed++;
    }
    const garbage = await cancel('not-a-uuid');
    const agent = await cancel(MISSING, { authorization: `Bearer ${token}` });
    console.log(`[host-cancel-soak] missed=${missed} shed=${shed} garbage=${garbage.status} agent=${agent.status}`);
    assert.equal(missed, 60);
    assert.equal(shed, 1);
    assert.equal(garbage.status, 400);
    assert.equal(agent.status, 404);
  });
});
