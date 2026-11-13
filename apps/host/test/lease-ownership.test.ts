/**
 * Phase 2 honesty row: lease ownership is hostile-safe on real sqlite.
 *
 * Contracts asserted:
 * - A second agent cannot heartbeat, complete, or fail a job it does
 *   not own — every mutation is agent-guarded (409 / null reject),
 *   and the true owner's lease stays intact.
 * - A cancelled job's heartbeat/complete/fail are dead ends — the
 *   atomic guard can never resurrect terminal state.
 * - Retry bound: retryable fails requeue with attempt+1 until
 *   maxAttempts, then converge to terminal failed — never an
 *   unbounded requeue loop.
 *
 * Per-file process isolation keeps the temp TASK_DB_PATH private.
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
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts';
import type { AgentCapabilities } from '../src/types/task.ts';
import { stationaryMassReport, fixtureUnits } from './lbm-result-fixture';

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-own-'));
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

const SPEC_OVERRIDES = {
  model: { source: 'preset', referenceLength: 0.1 },
  parameters: { gridPreset: 'fast', inletVelocity: 0.1 },
  run: { maxSteps: 1, warmupSteps: 0 },
  requirements: { backends: ['cpu'] },
};

function resultFor(spec: JobSpecV1): JobResultV1 {
  return {
    schemaVersion: 1,
    backend: { id: 'cpu' },
    summary: { steps: 1, wallTimeMs: 1, cd: 0, cl: 0, dragN: 0, liftN: 0 },
    history: { step: [1], cd: [0], cl: [0], dragN: [0], liftN: [0] },
    lbmMassBalance: stationaryMassReport(),
    derived: {
      [LBM_MASS_BALANCE_FEATURE]: 1,
      [LBM_NEE_INLET_FEATURE]: 1,
      [LBM_NEE_OUTLET_FEATURE]: 1,
      [LBM_GAUGE_FORCE_FEATURE]: 1,
      ...fixtureUnits(spec),
      viscosityMode: 'physical',
      requestedViscosityM2s: 1.48e-5,
      simulatedViscosityM2s: 1.48e-5,
    },
  };
}

describe('Phase 2: lease ownership + retry bound', () => {
  it('cross-agent heartbeat/complete/fail are rejected; owner lease intact', async () => {
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { defaultJobSpec } = await import('../src/types/task.ts');
    const { createJob, claimJob, heartbeatJob, completeJob, failJob, getJob } =
      await import('../src/lib/tasks/service.ts');

    const { agent: a } = await registerAgent({ name: 'owner-a', capabilities: CAPS });
    const { agent: b } = await registerAgent({ name: 'hostile-b', capabilities: CAPS });
    const job = createJob({ spec: defaultJobSpec(SPEC_OVERRIDES as never) });
    assert.equal(claimJob({ jobId: job.id, agentId: a.id, capabilities: a.capabilities })?.id, job.id);
    const ownerExpiry = getJob(job.id)!.leaseExpiresAt;

    // Hostile beats must not renew or perturb the lease.
    assert.throws(
      () => heartbeatJob({ jobId: job.id, agentId: b.id, progress: { step: 1 } }),
      (err) => (err as { status?: number }).status === 409,
    );
    assert.equal(getJob(job.id)!.leaseExpiresAt, ownerExpiry, 'hostile beat must not write');

    // Hostile settle/fail return null (silently rejected) and change nothing.
    assert.equal(completeJob({ jobId: job.id, agentId: b.id, result: resultFor(job.spec) }), null);
    assert.equal(failJob({ jobId: job.id, agentId: b.id, error: 'hostile' }), null);
    const intact = getJob(job.id)!;
    assert.equal(intact.agentId, a.id);
    assert.equal(intact.status, 'leased');
    assert.equal(intact.error, null);

    // The real owner can still heartbeat (sanity — guard rejects thieves, not owners).
    const beat = heartbeatJob({ jobId: job.id, agentId: a.id, progress: { step: 1 } });
    assert.equal(beat.status, 'running');
  });

  it('cancelled job: heartbeat/complete/fail are dead ends', async () => {
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { defaultJobSpec } = await import('../src/types/task.ts');
    const { createJob, claimJob, heartbeatJob, completeJob, failJob, cancelJob, getJob } =
      await import('../src/lib/tasks/service.ts');

    const { agent: a } = await registerAgent({ name: 'owner-c', capabilities: CAPS });
    const job = createJob({ spec: defaultJobSpec(SPEC_OVERRIDES as never) });
    claimJob({ jobId: job.id, agentId: a.id, capabilities: a.capabilities });
    cancelJob(job.id);
    assert.equal(getJob(job.id)!.status, 'cancelled');

    assert.throws(
      () => heartbeatJob({ jobId: job.id, agentId: a.id }),
      (err) => (err as { status?: number }).status === 409,
    );
    assert.equal(completeJob({ jobId: job.id, agentId: a.id, result: resultFor(job.spec) }), null);
    assert.equal(failJob({ jobId: job.id, agentId: a.id, error: 'late' }), null);
    assert.equal(getJob(job.id)!.status, 'cancelled', 'terminal state never revived');
  });

  it('retryable fails requeue bounded by maxAttempts, then terminal', async () => {
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { defaultJobSpec } = await import('../src/types/task.ts');
    const { createJob, claimJob, failJob, getJob } =
      await import('../src/lib/tasks/service.ts');

    const { agent: a } = await registerAgent({ name: 'owner-r', capabilities: CAPS });
    const job = createJob({ spec: defaultJobSpec(SPEC_OVERRIDES as never) });
    const max = getJob(job.id)!.maxAttempts;
    assert.ok(max >= 1, 'job must carry a finite attempt bound');

    // Each retryable fail: running→queued with attempt+1, agent cleared —
    // the job is claimable again. Converges to terminal failed at the bound.
    let requeues = 0;
    for (let i = 0; i < max + 2; i++) {
      const cur = getJob(job.id)!;
      if (cur.status === 'failed') break;
      assert.equal(cur.status, 'queued', `cycle ${i}: job must be requeued, got ${cur.status}`);
      const claimed = claimJob({ jobId: job.id, agentId: a.id, capabilities: a.capabilities });
      assert.equal(claimed?.id, job.id);
      const failed = failJob({ jobId: job.id, agentId: a.id, error: `cycle ${i}`, retryable: true });
      if (failed?.status === 'queued') requeues++;
    }
    const terminal = getJob(job.id)!;
    assert.equal(terminal.status, 'failed', `must converge to terminal failed, got ${terminal.status}`);
    // attempt is the last used index: attempts 0..max-1 = exactly max
    // claims, so terminal.attempt = max-1 and requeues = max-1.
    assert.equal(terminal.attempt, max - 1, 'last attempt index bounded at maxAttempts-1');
    assert.equal(requeues, max - 1, 'requeue count bounded exactly at maxAttempts-1');

    // Terminal: no more claims, no more mutations.
    assert.equal(claimJob({ jobId: job.id, agentId: a.id, capabilities: a.capabilities }), null);
    assert.equal(failJob({ jobId: job.id, agentId: a.id, error: 'post-terminal' }), null);
  });
});
