/**
 * Host job detail and result call getJob before the access check.
 * They share jobRead at 120/min. An agent token is a separate bucket.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentCapabilities } from '../src/types/task.ts';

const MISSING = '00000000-0000-4000-8000-0000000000dd';
const CAPS: AgentCapabilities = {
  backends: ['cpu'],
  maxGrid: 'fast',
  thermal: false,
  kinds: ['lbm-d3q19'],
};

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-host-read-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
});

after(() => {
  delete process.env.TASK_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Host job read cap', { concurrency: false }, () => {
  it('121 detail reads shed the last; result shares the bucket; an agent does not', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { GET: getJobRoute } = await import('../src/app/api/v1/jobs/[id]/route.ts');
    const { GET: getResult } = await import('../src/app/api/v1/jobs/[id]/result/route.ts');
    const { token } = await registerAgent({ name: 'read-agent', capabilities: CAPS });
    const detail = (id: string, headers?: Record<string, string>) => getJobRoute(new Request(`http://localhost/api/v1/jobs/${id}`, {
      headers,
    }), { params: Promise.resolve({ id }) });
    const result = (id: string) => getResult(new Request(`http://localhost/api/v1/jobs/${id}/result`), {
      params: Promise.resolve({ id }),
    });

    let missed = 0;
    let shed = 0;
    for (let i = 0; i < 121; i++) {
      const res = await detail(MISSING);
      if (res.status === 404) missed++;
      else if (res.status === 429) shed++;
    }
    const garbage = await detail('not-a-uuid');
    const followed = await result(MISSING);
    const agent = await detail(MISSING, { authorization: `Bearer ${token}` });
    console.log(`[host-read-soak] missed=${missed} shed=${shed} garbage=${garbage.status} result=${followed.status} agent=${agent.status}`);
    assert.equal(missed, 120);
    assert.equal(shed, 1);
    assert.equal(garbage.status, 400);
    assert.equal(followed.status, 429);
    assert.equal(agent.status, 404);
  });
});
