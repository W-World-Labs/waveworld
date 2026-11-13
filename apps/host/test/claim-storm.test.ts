/**
 * Phase 2 bounded-concurrency row on the PRODUCTION claim path: 32
 * concurrent POST /api/v1/jobs/claim calls against the real route
 * handler + real better-sqlite3. The atomic UPDATE … WHERE
 * status='queued' guard inside withTransaction must produce exactly one
 * 200 winner; every loser gets an honest 204 (never an error). p95 is
 * logged for the soak record — complements the agent-side drill storm
 * (job-drill.ts) with DB truth.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-claimstorm-'));
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

describe('Phase 2: claim storm on real SQLite', () => {
  it('32 concurrent claims → exactly 1 winner, 31 honest 204, 0 errors', async () => {
    const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
    const { createJob, getJob } = await import('../src/lib/tasks/service.ts');
    const { POST } = await import('../src/app/api/v1/jobs/claim/route.ts');

    // normalizeNewJobSpec stamps required features on every lbm job —
    // the agent must declare them to be claimable.
    const { agent, token } = await registerAgent({
      name: 'storm-agent',
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

    const N = 32;
    const lat: number[] = [];
    const statuses = await Promise.all(
      Array.from({ length: N }, async () => {
        const t0 = Date.now();
        const res = await POST(
          new Request('http://localhost/api/v1/jobs/claim', {
            method: 'POST',
            headers: { authorization: `Bearer ${token}` },
          }),
        );
        lat.push(Date.now() - t0);
        return res.status;
      }),
    );
    const wins = statuses.filter((s) => s === 200).length;
    const dry = statuses.filter((s) => s === 204).length;
    const errs = statuses.filter((s) => s >= 400).length;
    console.log(`[claim-storm:host] N=${N} p95=${p95(lat)}ms wins=${wins} dry=${dry} errs=${errs}`);
    assert.equal(wins, 1, 'exactly one claim must win');
    assert.equal(dry, N - 1, 'losers get honest 204');
    assert.equal(errs, 0, 'no loser may surface an error');
    const claimed = getJob(job.id)!;
    assert.equal(claimed.status, 'leased');
    assert.equal(claimed.agentId, agent.id);
  });
});
