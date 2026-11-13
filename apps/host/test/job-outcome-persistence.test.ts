import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/lib/tasks/db';
import { readAttemptOutcome, storeAttemptOutcome } from '../src/lib/tasks/job-outcomes';

test('attempt receipts survive reopening the task database and remain agent scoped', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'waveworld-outcome-db-'));
  const filename = path.join(dir, 'tasks.db');
  const jobId = 'receipt-persistence-test';
  const outcome = {
    jobId,
    status: 'succeeded' as const,
    result: { schemaVersion: 1 as const, summary: { steps: 2, wallTimeMs: 4 }, backend: { id: 'cpu' } },
  };
  try {
    const first = new Database(filename);
    ensureSchema(first);
    first.prepare(`INSERT INTO jobs (id, status, kind, spec, created_at, updated_at)
      VALUES (?, 'succeeded', 'export-report', '{}', 'now', 'now')`).run(jobId);
    storeAttemptOutcome(first, { jobId, attempt: 2, agentId: 'agent-owner', outcome, createdAt: 'now' });
    first.close();

    const restarted = new Database(filename);
    ensureSchema(restarted);
    assert.deepEqual(readAttemptOutcome(restarted, { jobId, attempt: 2, agentId: 'agent-owner' }), outcome);
    assert.equal(readAttemptOutcome(restarted, { jobId, attempt: 2, agentId: 'other-agent' }), null);
    assert.equal(readAttemptOutcome(restarted, { jobId, attempt: 1, agentId: 'agent-owner' }), null);
    restarted.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pre-receipt task database upgrade preserves existing jobs and audit history', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'waveworld-outcome-upgrade-'));
  const filename = path.join(dir, 'tasks.db');
  try {
    const old = new Database(filename);
    old.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, name TEXT, status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL, spec TEXT NOT NULL, result TEXT, error TEXT, created_by TEXT,
        agent_id TEXT, lease_expires_at TEXT, attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3, progress TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
      );
      CREATE TABLE job_audits (
        job_id TEXT PRIMARY KEY, status TEXT NOT NULL, artifact_id TEXT,
        manifest_sha256 TEXT, error TEXT, updated_at TEXT NOT NULL
      );
      INSERT INTO jobs (id, status, kind, spec, created_at, updated_at)
        VALUES ('pre-receipt-job', 'queued', 'export-report', '{"schemaVersion":1}', 'created', 'updated');
      INSERT INTO job_audits (job_id, status, updated_at)
        VALUES ('pre-receipt-job', 'pending', 'audit-created');
    `);

    ensureSchema(old);
    assert.equal(old.prepare("SELECT status FROM jobs WHERE id='pre-receipt-job'").pluck().get(), 'queued');
    assert.equal(old.prepare("SELECT updated_at FROM job_audits WHERE job_id='pre-receipt-job'").pluck().get(), 'audit-created');
    assert.equal(old.prepare('SELECT COUNT(*) FROM job_attempt_outcomes').pluck().get(), 0);
    assert.deepEqual(old.prepare('PRAGMA table_info(jobs)').all().map((column: unknown) => (column as { name: string }).name).includes('project_id'), true);
    old.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
