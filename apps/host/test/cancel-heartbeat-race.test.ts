/**
 * Phase 2 fault+concurrency row: cancel lands mid-heartbeat-storm on the
 * real route handlers + real better-sqlite3. The atomic guard
 * (UPDATE … WHERE status IN ('leased','running')) means a heartbeat can
 * never revive a cancelled job. In-flight beats resolve to an honest
 * 200 (serialized pre-cancel) or 409 (post-cancel) — never 5xx, and the
 * final state is always cancelled.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-cancelrace-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
});

after(() => {
  delete process.env.TASK_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Phase 2: cancel mid-heartbeat-storm', () => {
  it('no 5xx, job stays cancelled, heartbeat never revives it', async () => {
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { createJob, claimJob, getJob } = await import('../src/lib/tasks/service.ts');
    const hbRoute = await import('../src/app/api/v1/jobs/[id]/heartbeat/route.ts');
    const cancelRoute = await import('../src/app/api/v1/jobs/[id]/cancel/route.ts');

    const { agent, token } = await registerAgent({
      name: 'race-agent',
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
        parameters: { inletVelocity: 1, gridPreset: 'fast' },
        run: { maxSteps: 1000 },
        outputs: {},
      } as never,
    });
    const claimed = claimJob({ agentId: agent.id, capabilities: agent.capabilities });
    assert.equal(claimed?.id, job.id, 'agent must hold the lease');

    const params = Promise.resolve({ id: job.id });
    const beat = () =>
      hbRoute.POST(
        new Request(`http://localhost/api/v1/jobs/${job.id}/heartbeat`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        }),
        { params },
      );
    const cancel = () =>
      cancelRoute.POST(new Request(`http://localhost/api/v1/jobs/${job.id}/cancel`, { method: 'POST' }), { params });

    const N = 32;
    const statuses = await Promise.all([cancel(), ...Array.from({ length: N }, beat)].map(async (p) => (await p).status));
    const cancelStatus = statuses[0];
    const beats = statuses.slice(1);
    const fiveXx = beats.filter((s) => s >= 500).length;
    const ok = beats.filter((s) => s === 200).length;
    const conflicted = beats.filter((s) => s === 409).length;
    const other = beats.length - ok - conflicted - fiveXx;
    console.log(`[cancel-race] N=${N} cancel=${cancelStatus} beats: 200=${ok} 409=${conflicted} 5xx=${fiveXx} other=${other}`);
    assert.equal(cancelStatus, 200, 'cancel must succeed');
    assert.equal(fiveXx, 0, 'a heartbeat racing cancel must never 5xx');
    assert.equal(other, 0, `unexpected beat statuses: ${JSON.stringify(beats)}`);
    assert.equal(getJob(job.id)!.status, 'cancelled', 'heartbeat must never revive a cancelled job');

    // Post-cancel beat: honest 409 with the cancelled reason (the wire
    // shape the agent maps to HostJobCancelledError → abort).
    const late = await beat();
    assert.equal(late.status, 409);
    assert.match(await late.text(), /cancelled/i);
  });
});
