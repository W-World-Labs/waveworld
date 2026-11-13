/**
 * Phase 2 bounded-traffic row on the real route handler: a runaway
 * agent hammering POST /api/v1/jobs/claim must be shed at the per-agent
 * jobClaim window (240/min) with honest 429 + Retry-After — while a
 * second agent's claim stays unaffected (per-agent keying: a fleet
 * behind one NAT does not share a bucket).
 *
 * Per-file process isolation keeps the temp TASK_DB_PATH and the
 * in-process limiter table private.
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

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-ratelimit-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
});

after(() => {
  delete process.env.TASK_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

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

describe('Phase 2: per-agent claim rate limit sheds a runaway agent', { concurrency: false }, () => {
  it('250 floods → 240 pass then 429+Retry-After; peer agent unaffected', async () => {
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { POST } = await import('../src/app/api/v1/jobs/claim/route.ts');

    const { agent: a, token: tokA } = await registerAgent({ name: 'runaway', capabilities: CAPS });
    const { agent: b, token: tokB } = await registerAgent({ name: 'peer', capabilities: CAPS });

    const claim = (token: string) =>
      POST(new Request('http://localhost/api/v1/jobs/claim', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }));

    // Empty queue: passing claims return honest 204. Sequential sends
    // keep the window deterministic (no clock games).
    let passed = 0; let shed = 0; let retryAfter = ''; let other = 0;
    for (let i = 0; i < 250; i++) {
      const res = await claim(tokA);
      if (res.status === 429) {
        shed++;
        retryAfter = res.headers.get('retry-after') ?? '';
        const body = (await res.json()) as { error?: string };
        assert.equal(body.error, 'rate_limited');
      } else if (res.status === 204) {
        passed++;
      } else {
        other++;
      }
    }
    console.log(`[rl-storm] agent=${a.id.slice(0, 8)} passed=${passed} shed=${shed} other=${other} retryAfter=${retryAfter}s`);
    assert.equal(passed, 240, 'exactly the window limit may pass');
    assert.equal(shed, 10, 'the rest must be shed 429');
    assert.equal(other, 0, 'no 5xx under flood');
    assert.ok(Number(retryAfter) >= 1 && Number(retryAfter) <= 60, 'Retry-After inside the window');

    // Per-agent keying: agent B's bucket is untouched by A's flood.
    const peer = await claim(tokB);
    assert.equal(peer.status, 204, `peer must not inherit the flood: ${peer.status}`);

    const { defaultJobSpec } = await import('../src/types/task.ts');
    const { createJob, claimJob } = await import('../src/lib/tasks/service.ts');
    const job = createJob({
      spec: defaultJobSpec({
        model: { source: 'preset', referenceLength: 0.1 },
        parameters: { gridPreset: 'fast', inletVelocity: 0.1 },
        run: { maxSteps: 1, warmupSteps: 0 },
        requirements: { backends: ['cpu'] },
      } as never),
    });
    // Service-level claim still works — the 429s were route shedding,
    // not a poisoned queue.
    const claimed = claimJob({ jobId: job.id, agentId: b.id, capabilities: b.capabilities });
    assert.equal(claimed?.id, job.id);
  });

  it('claim-by-id shares the 240/min bucket and still 400s a garbage id', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { POST: claimById } = await import('../src/app/api/v1/jobs/[id]/claim/route.ts');
    const { POST: claimNext } = await import('../src/app/api/v1/jobs/claim/route.ts');
    const { agent, token } = await registerAgent({ name: 'host-claim-id', capabilities: CAPS });
    const id = '00000000-0000-4000-8000-000000000099';
    const targeted = (pathId: string) => claimById(new Request(`http://localhost/api/v1/jobs/${pathId}/claim`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }), { params: Promise.resolve({ id: pathId }) });

    let missed = 0;
    let shed = 0;
    for (let i = 0; i < 241; i++) {
      const res = await targeted(id);
      if (res.status === 409) missed++;
      else if (res.status === 429) shed++;
    }
    const garbage = await targeted('not-a-uuid');
    console.log(`[host-claim-id] agent=${agent.id.slice(0, 8)} missed=${missed} shed=${shed} garbage=${garbage.status}`);
    assert.equal(missed, 240);
    assert.equal(shed, 1);
    assert.equal(garbage.status, 400);

    resetRateLimitsForTests();
    for (let i = 0; i < 240; i++) {
      const res = await claimNext(new Request('http://localhost/api/v1/jobs/claim', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }));
      assert.equal(res.status, 204);
    }
    assert.equal((await targeted(id)).status, 429);
  });
});
