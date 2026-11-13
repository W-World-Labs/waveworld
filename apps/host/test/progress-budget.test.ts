/**
 * Host progress used to charge jobHeartbeat before the UUID gate.
 * 480 bad ids must stay 400 and leave a held job heartbeating.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LBM_GAUGE_FORCE_FEATURE,
  LBM_MASS_BALANCE_FEATURE,
  LBM_NEE_INLET_FEATURE,
  LBM_NEE_OUTLET_FEATURE,
} from '@w-sim/contracts';
import type { AgentCapabilities } from '../src/types/task.ts';

const CAPS: AgentCapabilities = {
  backends: ['cpu'],
  maxGrid: 'fast',
  thermal: false,
  kinds: ['lbm-d3q19'],
  features: [
    LBM_GAUGE_FORCE_FEATURE,
    LBM_MASS_BALANCE_FEATURE,
    LBM_NEE_INLET_FEATURE,
    LBM_NEE_OUTLET_FEATURE,
  ],
};

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-host-progress-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
  process.env.W_COMPUTE_ENABLED = '0';
});

after(() => {
  delete process.env.TASK_DB_PATH;
  delete process.env.W_COMPUTE_ENABLED;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Host progress budget', { concurrency: false }, () => {
  it('480 garbage progress calls stay 400 and the held job still heartbeats', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { createJob, claimJob } = await import('../src/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('../src/types/task.ts');
    const { POST: progress } = await import('../src/app/api/v1/jobs/[id]/progress/route.ts');
    const { POST: heartbeat } = await import('../src/app/api/v1/jobs/[id]/heartbeat/route.ts');
    const { token, agent } = await registerAgent({ name: 'host-progress', capabilities: CAPS });
    const queued = createJob({
      spec: defaultJobSpec({
        model: { source: 'preset', referenceLength: 0.1 },
        parameters: { gridPreset: 'fast', inletVelocity: 0.1 },
        run: { maxSteps: 1, warmupSteps: 0 },
        requirements: { backends: ['cpu'] },
      } as never),
    });
    assert.ok(claimJob({ jobId: queued.id, agentId: agent.id, capabilities: agent.capabilities }));
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    for (let i = 0; i < 480; i++) {
      const res = await progress(new Request('http://localhost/api/v1/jobs/nope/progress', {
        method: 'POST',
        headers,
        body: '{}',
      }), { params: Promise.resolve({ id: 'nope' }) });
      assert.equal(res.status, 400);
    }
    const held = await heartbeat(new Request(`http://localhost/api/v1/jobs/${queued.id}/heartbeat`, {
      method: 'POST',
      headers,
    }), { params: Promise.resolve({ id: queued.id }) });
    const body = await held.json() as { job?: { id?: string } };
    console.log(`[host-progress-budget] garbage=480 heartbeat=${held.status}`);
    assert.equal(held.status, 200);
    assert.equal(body.job?.id, queued.id);
  });
});
