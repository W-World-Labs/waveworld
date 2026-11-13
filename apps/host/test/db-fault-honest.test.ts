/**
 * Phase 2 fault injection: task-DB unavailable → honest 5xx, never an
 * empty-success 200. Drives the real shipped route handlers
 * (jobs GET + readiness GET) with TASK_DB_PATH pointed under a regular
 * file, so getDb() → mkdirSync(ENOTDIR) → better-sqlite3 never opens.
 *
 * Per-file process isolation (node --test) keeps the poisoned env from
 * leaking into sibling suites.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let blocker = '';
let savedDb: string | undefined;

before(() => {
  savedDb = process.env.TASK_DB_PATH;
  blocker = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-dbfault-'));
  fs.writeFileSync(path.join(blocker, 'file'), 'not a directory');
  // TASK_DB_PATH under a regular FILE: dirname is not a directory →
  // mkdirSync ENOTDIR / Database open fails — a real storage fault, not a mock.
  process.env.TASK_DB_PATH = path.join(blocker, 'file', 'tasks.db');
});

after(() => {
  if (savedDb === undefined) delete process.env.TASK_DB_PATH;
  else process.env.TASK_DB_PATH = savedDb;
  fs.rmSync(blocker, { recursive: true, force: true });
});

describe('Phase 2: task-DB fault → honest 5xx', () => {
  it('GET /api/readiness returns 503 not_ready (fail closed, never fake-ready)', async () => {
    const { GET } = await import('../src/app/api/readiness/route.ts');
    const res = await GET();
    assert.equal(res.status, 503);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ready, false);
    assert.equal(body.ok, false);
    assert.equal(body.dependency, 'task-db');
    assert.ok(typeof body.error === 'string' && body.error.length > 0);
  });

  it('GET /api/v1/jobs returns 5xx generic, never {jobs:[]}, no internals leak', async () => {
    const { GET } = await import('../src/app/api/v1/jobs/route.ts');
    const res = await GET(new Request('http://localhost/api/v1/jobs'));
    assert.ok(res.status >= 500, `expected 5xx, got ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'Internal error', '5xx bodies must be generic, never SQLite/fs diagnostics');
    assert.equal(body.jobs, undefined, 'must not return an empty-success job list');
    assert.ok(!String(body.error).includes(blocker), 'fs path must never leak to the client');
  });

  it('GET /api/v1/metrics returns 503 redacted, never a half-populated exposition', async () => {
    const { GET } = await import('../src/app/api/v1/metrics/route.ts');
    const res = await GET(new Request('http://localhost/api/v1/metrics'));
    assert.equal(res.status, 503);
    const body = await res.text();
    assert.ok(body.includes('metrics unavailable'), `want honest error, got: ${body.slice(0, 120)}`);
    // A scraper must never cache/store a fault response as real gauges.
    assert.ok(!body.includes('waveworld_jobs'), 'must not emit partial exposition under fault');
    assert.match(res.headers.get('cache-control') ?? '', /no-store|private|must-revalidate/);
  });
});
