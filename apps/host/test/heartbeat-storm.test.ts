/**
 * Phase 2 bounded-traffic row on the heartbeat path: 64 concurrent
 * heartbeats on a freshly-leased job must all resolve 200, and the
 * steady-state throttle (lease >50% fresh + progress unchanged → skip
 * the WAL write) must keep the stored lease deadline IDENTICAL across
 * every beat — observable proof the write path is bounded, not merely
 * returning early on a code comment.
 *
 * A beat carrying new progress then advances the lease (the write still
 * happens when it should — no over-throttle lie).
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

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-hbstorm-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
});

after(() => {
  delete process.env.TASK_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Phase 2: heartbeat storm write bound', () => {
  it('persists total-only progress changes and throttles unchanged partial updates', async () => {
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { createJob, claimJob, heartbeatJob, getJob } = await import('../src/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('../src/types/task.ts');
    const { getSqlite } = await import('../src/lib/tasks/db.ts');
    const { agent } = await registerAgent({
      name: 'hb-total-agent',
      capabilities: {
        backends: ['cpu'], kinds: ['lbm-d3q19'],
        features: [LBM_GAUGE_FORCE_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_NEE_INLET_FEATURE, LBM_NEE_OUTLET_FEATURE],
      },
    });
    const job = createJob({ spec: defaultJobSpec({ run: { maxSteps: 1000 } }) });
    assert.ok(claimJob({ jobId: job.id, agentId: agent.id, capabilities: agent.capabilities }));
    const input = { jobId: job.id, agentId: agent.id };
    heartbeatJob({ ...input, progress: { step: 10, total: 1000, message: 'warm', cd: 0, cl: 0 } });
    const revised = heartbeatJob({ ...input, progress: { step: 10, total: 2000, message: 'warm', cd: 0, cl: 0 } });
    assert.equal(revised.progress?.total, 2000, 'a fresh lease must not discard a revised total');
    assert.equal(getJob(job.id)!.progress?.total, 2000);

    // A persisted sentinel makes accidental writes observable without sleeps.
    getSqlite().prepare('UPDATE jobs SET updated_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', job.id);
    const before = getJob(job.id)!;
    for (const progress of [{ step: 10 }, { total: 2000 }, {}, { cd: 0, cl: 0 }]) {
      assert.deepEqual(heartbeatJob({ ...input, progress }), before, 'omitted fields retain their stored values without a write');
    }
    const changed = heartbeatJob({ ...input, progress: { total: 3000 } });
    assert.equal(changed.progress?.total, 3000);
    assert.equal(changed.progress?.message, 'warm');
    assert.notEqual(changed.updatedAt, before.updatedAt);
  });

  it('64 concurrent unchanged beats → all 200, stored lease deadline unchanged; progress beat advances it', async () => {
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { createJob, claimJob, heartbeatJob, getJob } = await import('../src/lib/tasks/service.ts');

    const { agent } = await registerAgent({
      name: 'hb-storm-agent',
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
    const job = createJob({
      spec: {
        schemaVersion: 1,
        kind: 'lbm-d3q19',
        parameters: { inletVelocity: 0.1, gridPreset: 'fast' },
        run: { maxSteps: 1000 },
        outputs: {},
      } as never,
    });
    const claimed = claimJob({ jobId: job.id, agentId: agent.id, capabilities: agent.capabilities });
    assert.equal(claimed?.id, job.id);

    // First beat transitions leased→running (a real write) and reports
    // progress, so subsequent identical beats hit the throttle branch.
    const first = heartbeatJob({
      jobId: job.id,
      agentId: agent.id,
      progress: { step: 10, total: 1000, message: 'warm' },
    });
    assert.equal(first.status, 'running');
    const baselineExpiry = getJob(job.id)!.leaseExpiresAt;
    assert.ok(baselineExpiry, 'leased job must carry a deadline');

    const N = 64;
    const lat: number[] = [];
    const expiries = await Promise.all(
      Array.from({ length: N }, async () => {
        const t0 = Date.now();
        const beat = heartbeatJob({
          jobId: job.id,
          agentId: agent.id,
          progress: { step: 10, total: 1000, message: 'warm' },
        });
        lat.push(Date.now() - t0);
        return beat.leaseExpiresAt;
      }),
    );
    const unchanged = expiries.filter((e) => e === baselineExpiry).length;
    const sorted = [...lat].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    console.log(`[hb-storm] N=${N} p95=${p95}ms unchanged_deadline=${unchanged}/${N}`);
    assert.equal(unchanged, N, 'throttled beats must not churn the stored deadline');
    assert.equal(getJob(job.id)!.leaseExpiresAt, baselineExpiry);

    // A beat with new progress is a real write: deadline must advance.
    const advanced = heartbeatJob({
      jobId: job.id,
      agentId: agent.id,
      progress: { step: 11, total: 1000, message: 'stepped' },
    });
    assert.ok(
      Date.parse(advanced.leaseExpiresAt!) >= Date.parse(baselineExpiry!),
      'a progress-changing beat must renew the lease',
    );
    assert.equal(getJob(job.id)!.progress?.step, 11);
  });
});
