/**
 * Phase 2 bounded-concurrency row on the heaviest write path: N
 * concurrent completeJob calls against real better-sqlite3.
 *
 * Contracts asserted:
 * - Same settlement key (a legit retry of the same result): every call
 *   resolves succeeded — idempotent retry never 5xxs or double-writes.
 * - Different settlement key racing a settled job: every call throws
 *   409 double_settlement — a second distinct result can never land.
 * - Final state: exactly one stored result, status succeeded.
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
import type { JobResultV1 } from '@w-sim/contracts';
import { stationaryMassReport, fixtureUnits } from './lbm-result-fixture';

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-settlestorm-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
});

after(() => {
  delete process.env.TASK_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

function p95(lat: number[]): number {
  const s = [...lat].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

describe('Phase 2: settle storm on real SQLite', () => {
  it('concurrent completes — same key idempotent, different key 409, single stored result', async () => {
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { createJob, claimJob, completeJob, getJob } = await import('../src/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('../src/types/task.ts');

    const { agent } = await registerAgent({
      name: 'settle-storm-agent',
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
    // Low-Re spec (referenceLength 0.1, inletVelocity 0.1) — passes the
    // tau>=0.505 physical-stability gate at createJob.
    const spec = defaultJobSpec({
      model: { source: 'preset', referenceLength: 0.1 },
      parameters: { gridPreset: 'fast', inletVelocity: 0.1 },
      run: { maxSteps: 1, warmupSteps: 0 },
      requirements: { backends: ['cpu'] },
    } as never);
    const job = createJob({ spec });
    const claimed = claimJob({ jobId: job.id, agentId: agent.id, capabilities: agent.capabilities });
    assert.equal(claimed?.id, job.id);

    const result: JobResultV1 = {
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

    // Same-key storm: N concurrent identical completes — all succeed
    // idempotently (a retrying agent is not an error).
    const N = 16;
    const lat: number[] = [];
    const sameKey = await Promise.all(
      Array.from({ length: N }, async () => {
        const t0 = Date.now();
        try {
          const settled = completeJob({ jobId: job.id, agentId: agent.id, result });
          lat.push(Date.now() - t0);
          return settled?.status ?? 'null';
        } catch (err) {
          lat.push(Date.now() - t0);
          return `threw:${err instanceof Error ? err.message.slice(0, 60) : err}`;
        }
      }),
    );
    console.log(`[settle-storm] same-key N=${N} p95=${p95(lat)}ms statuses=${JSON.stringify(sameKey)}`);
    assert.ok(sameKey.every((s) => s === 'succeeded'), `same-key storm must be idempotent: ${JSON.stringify(sameKey)}`);
    assert.equal(getJob(job.id)!.status, 'succeeded');

    // Different-key storm: N concurrent completes with a distinct result —
    // every one must throw 409 double_settlement, never write.
    const other: JobResultV1 = { ...result, summary: { ...result.summary, cd: 0.5 } };
    const diffKey = await Promise.all(
      Array.from({ length: N }, async () => {
        try {
          completeJob({ jobId: job.id, agentId: agent.id, result: other });
          return 'wrote';
        } catch (err) {
          return (err as { status?: number }).status === 409 ? '409' : `unexpected:${err}`;
        }
      }),
    );
    assert.ok(diffKey.every((s) => s === '409'), `different-key settle must be rejected: ${JSON.stringify(diffKey)}`);
    // Single stored result preserved — the storm's payload never landed.
    assert.deepEqual(getJob(job.id)!.result?.summary, result.summary);
  });
});
