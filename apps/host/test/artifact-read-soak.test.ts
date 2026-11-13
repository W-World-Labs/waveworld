/**
 * Host artifact download stats the store before auth. Anonymous callers
 * share artifactRead at 120/min. An agent token is a separate bucket.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentCapabilities } from '../src/types/task.ts';

const MISSING = '00000000-0000-4000-8000-0000000000ee';
const CAPS: AgentCapabilities = {
  backends: ['cpu'],
  maxGrid: 'fast',
  thermal: false,
  kinds: ['lbm-d3q19'],
};

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-host-artread-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
  process.env.ARTIFACT_ROOT = path.join(dir, 'artifacts');
});

after(() => {
  delete process.env.TASK_DB_PATH;
  delete process.env.ARTIFACT_ROOT;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Host artifact read cap', { concurrency: false }, () => {
  it('121 anonymous downloads shed the last; garbage stays 400; an agent is not in that bucket', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { GET } = await import('../src/app/api/v1/artifacts/[id]/route.ts');
    const { token } = await registerAgent({ name: 'artifact-reader', capabilities: CAPS });
    const read = (id: string, headers?: Record<string, string>) => GET(new Request(`http://localhost/api/v1/artifacts/${id}`, {
      headers,
    }), { params: Promise.resolve({ id }) });

    let missed = 0;
    let shed = 0;
    for (let i = 0; i < 121; i++) {
      const res = await read(MISSING);
      if (res.status === 404) missed++;
      else if (res.status === 429) shed++;
    }
    const garbage = await read('not-a-uuid');
    const agent = await read(MISSING, { authorization: `Bearer ${token}` });
    console.log(`[host-artifact-soak] missed=${missed} shed=${shed} garbage=${garbage.status} agent=${agent.status}`);
    assert.equal(missed, 120);
    assert.equal(shed, 1);
    assert.equal(garbage.status, 400);
    assert.equal(agent.status, 404);
  });
});
