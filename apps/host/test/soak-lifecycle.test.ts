/**
 * Phase 2 sustained soak on the jobs plane: 200 full lifecycles against
 * real better-sqlite3 — create → claim → heartbeat → settle, with every
 * tenth job cancelled mid-lease instead of completed.
 *
 * The burst storms prove atomicity under concurrency; this row proves
 * the queue does not leak or degrade under sustained volume: after the
 * soak the store must show zero leased/running jobs, zero expired
 * leases, and per-op p95 stays inside the bound.
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
import { stationaryMassReport, fixtureUnits } from './lbm-result-fixture';

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-soak-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
});

after(() => {
  delete process.env.TASK_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

// Low-Re spec (referenceLength 0.1, inletVelocity 0.1) — passes the
// tau>=0.505 physical-stability gate at createJob.
const SPEC_OVERRIDES = {
  model: { source: 'preset', referenceLength: 0.1 },
  parameters: { gridPreset: 'fast', inletVelocity: 0.1 },
  run: { maxSteps: 1, warmupSteps: 0 },
  requirements: { backends: ['cpu'] },
};

function minimalResult(spec: JobSpecV1): JobResultV1 {
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

describe('Phase 2: sustained lifecycle soak', () => {
  it('200 mixed lifecycles: zero unexpected errors, p95 bound, queue drains clean', async () => {
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { defaultJobSpec } = await import('../src/types/task.ts');
    const { createJob, claimJob, heartbeatJob, completeJob, cancelJob, getJobStats } =
      await import('../src/lib/tasks/service.ts');

    const { agent } = await registerAgent({
      name: 'soak-agent',
      capabilities: {
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
      },
    });

    const N = 200;
    const opLat: number[] = [];
    let completed = 0; let cancelled = 0; let unexpected = 0;
    const op = <T>(fn: () => T): T => {
      const t0 = performance.now();
      const out = fn();
      opLat.push(performance.now() - t0);
      return out;
    };

    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      try {
        const job = op(() => createJob({ spec: defaultJobSpec(SPEC_OVERRIDES as never) }));
        const claimed = op(() =>
          claimJob({ jobId: job.id, agentId: agent.id, capabilities: agent.capabilities }));
        assert.equal(claimed?.id, job.id);
        op(() => heartbeatJob({
          jobId: job.id, agentId: agent.id,
          progress: { step: 5, total: 1000, message: 'soak' },
        }));
        if (i % 10 === 9) {
          op(() => cancelJob(job.id));
          cancelled++;
        } else {
          op(() => completeJob({
            jobId: job.id, agentId: agent.id,
            result: minimalResult(job.spec),
          }));
          completed++;
        }
      } catch (err) {
        unexpected++;
        console.error(`[soak] unexpected error at i=${i}:`, (err as Error).message);
      }
    }
    const wallMs = performance.now() - t0;

    const sorted = [...opLat].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const stats = getJobStats();
    console.log(
      `[soak] lifecycles=${N} completed=${completed} cancelled=${cancelled} ` +
      `unexpected=${unexpected} ops=${opLat.length} wall=${wallMs.toFixed(0)}ms p95=${p95.toFixed(2)}ms ` +
      `leased=${stats.leased} running=${stats.running} expired=${stats.expiredLeases}`,
    );

    assert.equal(unexpected, 0);
    assert.equal(completed + cancelled, N);
    assert.equal(stats.leased, 0, 'no stranded leases after soak');
    assert.equal(stats.running, 0, 'no orphaned running rows after soak');
    assert.equal(stats.queued, 0, 'queue must drain');
    assert.equal(stats.expiredLeases, 0);
    assert.ok(p95 < 50, `per-op p95 ${p95.toFixed(2)}ms exceeds 50ms bound`);
    assert.equal(stats.cancelled, cancelled);
    assert.equal(stats.succeeded, completed);
  });
});
