import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Residual after wave66: listJobs must clamp the caller-supplied page size,
 * parity listEvidence/listProjectsForUser (bounded [1, 200], NaN → default).
 * Before the bound, GET /api/v1/jobs?limit=-1 sliced (0, -1) — an all-but-last
 * table dump — and any oversized finite limit defeated paging entirely.
 * Uses an isolated temp DB — set TASK_DB_PATH first (singleton DB).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(here, '../../../data/tasks-test-list-limit.db');

before(() => {
  process.env.TASK_DB_PATH = dbPath;
  delete process.env.JOB_REQUIRE_AUTH;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* absent */
    }
  }
});

describe('jobs list limit bound', { concurrency: false }, () => {
  it('clamps negative, zero, fractional, NaN and oversized limits', async () => {
    const { getSqlite } = await import('@/lib/tasks/db.ts');
    const { listJobs } = await import('@/lib/tasks/service.ts');
    const spec = JSON.stringify({
      schemaVersion: 1,
      kind: 'lbm-d3q19',
      parameters: {},
      run: { maxSteps: 1 },
      outputs: { forces: false, history: false },
    });
    const insert = getSqlite().prepare(
      `INSERT INTO jobs (id,name,status,priority,kind,spec,result,error,created_by,agent_id,project_id,lease_expires_at,attempt,max_attempts,progress,created_at,updated_at,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    const total = 210; // above the 200-row page cap
    for (let i = 0; i < total; i++) {
      const t = new Date(1_700_000_000_000 + i).toISOString();
      insert.run(`limit-${i}`, 'limit', 'queued', 0, 'lbm-d3q19', spec, null, null, null, null, null, null, 0, 3, null, t, t, null, null);
    }
    assert.equal(listJobs().length, 50);
    assert.equal(listJobs({ limit: 3 }).length, 3);
    // Previously slice(0, -1): all-but-last — effectively the whole table.
    assert.equal(listJobs({ limit: -1 }).length, 1);
    assert.equal(listJobs({ limit: 0 }).length, 1);
    assert.equal(listJobs({ limit: 2.9 }).length, 2);
    assert.equal(listJobs({ limit: Number.NaN }).length, 50);
    assert.equal(listJobs({ limit: 1e9 }).length, 200);
    assert.equal(listJobs({ limit: 200 }).length, 200);
    assert.ok(listJobs({ limit: 1e9 }).length < total, 'oversized limit must not dump the table');
  });

  it('GET /api/v1/jobs applies the same bound to the limit query param', async () => {
    const route = await import('../src/app/api/v1/jobs/route.ts');
    const negative = await route.GET(new Request('http://localhost/api/v1/jobs?limit=-5'));
    assert.equal(negative.status, 200);
    assert.equal(((await negative.json()) as { jobs: unknown[] }).jobs.length, 1);
    const oversized = await route.GET(new Request('http://localhost/api/v1/jobs?limit=1000000'));
    assert.equal(oversized.status, 200);
    assert.equal(((await oversized.json()) as { jobs: unknown[] }).jobs.length, 200);
  });
});
