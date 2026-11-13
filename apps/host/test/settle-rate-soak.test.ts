/**
 * Host fail/complete share jobSettle (120/min). The cap is before the body.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentCapabilities } from '../src/types/task.ts';

const MISSING = '00000000-0000-4000-8000-0000000000aa';
const CAPS: AgentCapabilities = {
  backends: ['cpu'],
  maxGrid: 'fast',
  thermal: false,
  kinds: ['lbm-d3q19'],
};

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-host-settle-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
});

after(() => {
  delete process.env.TASK_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Host settle rate cap', { concurrency: false }, () => {
  it('121 fails shed the last one; garbage stays 400; complete shares the bucket', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { POST: fail } = await import('../src/app/api/v1/jobs/[id]/fail/route.ts');
    const { POST: complete } = await import('../src/app/api/v1/jobs/[id]/complete/route.ts');
    const { token } = await registerAgent({ name: 'host-settle', capabilities: CAPS });
    const failOnce = (id: string) => fail(new Request(`http://localhost/api/v1/jobs/${id}/fail`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'soak' }),
    }), { params: Promise.resolve({ id }) });

    let missed = 0;
    let shed = 0;
    for (let i = 0; i < 121; i++) {
      const res = await failOnce(MISSING);
      if (res.status === 409) missed++;
      else if (res.status === 429) shed++;
    }
    const garbage = await failOnce('not-a-uuid');
    const completed = await complete(new Request(`http://localhost/api/v1/jobs/${MISSING}/complete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }), { params: Promise.resolve({ id: MISSING }) });
    console.log(`[host-settle-soak] missed=${missed} shed=${shed} garbage=${garbage.status} complete=${completed.status}`);
    assert.equal(missed, 120);
    assert.equal(shed, 1);
    assert.equal(garbage.status, 400);
    assert.equal(completed.status, 429);
  });
});
