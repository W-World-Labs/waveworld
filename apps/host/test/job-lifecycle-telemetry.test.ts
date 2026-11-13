/**
 * [host:job] lifecycle telemetry — every committed transition emits exactly one
 * structured line (the host-side counterpart of the agent's [agent:telemetry]).
 * Uses an isolated temp DB — set TASK_DB_PATH first (singleton DB).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Temp dir outside the repo — an in-tree DB file dirties the checkout and the
// deploy's SPA artifact verification fails closed on it (run 1247).
const testDb = path.join(mkdtempSync(path.join(tmpdir(), 'waveworld-job-telemetry-')), 'tasks.db');

process.env.TASK_DB_PATH = testDb;
process.env.TASK_LEASE_SECONDS = '30';
delete process.env.AGENT_WORKSPACE;

function captureHostJobLogs(): { lines: Array<Record<string, unknown>>; restore: () => void } {
  const orig = console.log;
  const lines: Array<Record<string, unknown>> = [];
  console.log = (...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (text.startsWith('[host:job] ')) {
      lines.push(JSON.parse(text.slice('[host:job] '.length)) as Record<string, unknown>);
      return;
    }
    orig(...args);
  };
  return { lines, restore: () => { console.log = orig; } };
}

describe('[host:job] lifecycle telemetry', { concurrency: false }, () => {
  const cap = captureHostJobLogs();
  after(() => cap.restore());
  const events = () => cap.lines.map((l) => l.event);
  const last = (event: string) => [...cap.lines].reverse().find((l) => l.event === event);

  it('emits submitted → claimed → succeeded with agent/backend/latency fields', async () => {
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { createModuleJobSpec, computeModule, MODULE_JOB_KIND } = await import('../../../src/lib/sim/module-compute.ts');
    const { agent } = await registerAgent({ name: 'telem-agent-a', capabilities: { kinds: [MODULE_JOB_KIND], backends: ['cpu'] } });
    const input = { module: 'mutual' as const, scene: { k: 0.99, n: 0.3, mode: 'step' as const, steps: 4 } };
    const spec = createModuleJobSpec(input);
    const job = createJob({ spec });
    assert.equal(claimJob({ agentId: agent.id, capabilities: agent.capabilities })?.id, job.id);
    const result = { schemaVersion: 1 as const, summary: { steps: spec.run.maxSteps, wallTimeMs: 1 }, backend: { id: 'cpu', agentId: agent.id }, moduleResult: await computeModule(input) };
    assert.equal(completeJob({ jobId: job.id, agentId: agent.id, result })?.status, 'succeeded');

    assert.equal(last('job.submitted')?.job_id, job.id);
    assert.equal(last('job.submitted')?.managed, false);
    assert.equal(last('job.claimed')?.job_id, job.id);
    assert.equal(last('job.claimed')?.agent_id, agent.id);
    assert.equal(typeof last('job.claimed')?.lease_s, 'number');
    assert.equal(last('job.succeeded')?.job_id, job.id);
    assert.equal(last('job.succeeded')?.backend, 'cpu');
    assert.equal(typeof last('job.succeeded')?.latency_ms, 'number');
    // Ordering: submitted before claimed before succeeded.
    const order = events().filter((e) => ['job.submitted', 'job.claimed', 'job.succeeded'].includes(e as string));
    assert.deepEqual(order.slice(-3), ['job.submitted', 'job.claimed', 'job.succeeded']);
  });

  it('emits retried on requeue and failed at max attempts', async () => {
    const { createJob, claimJob, failJob, getJob } = await import('@/lib/tasks/service.ts');
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { createModuleJobSpec, MODULE_JOB_KIND } = await import('../../../src/lib/sim/module-compute.ts');
    const { agent } = await registerAgent({ name: 'telem-agent-b', capabilities: { kinds: [MODULE_JOB_KIND], backends: ['cpu'] } });
    const spec = createModuleJobSpec({ module: 'mutual' as const, scene: { k: 0.9, n: 0.4, mode: 'step' as const, steps: 2 } });

    const retryJob = createJob({ spec, maxAttempts: 3 });
    assert.equal(claimJob({ agentId: agent.id, capabilities: agent.capabilities, jobId: retryJob.id })?.id, retryJob.id);
    failJob({ jobId: retryJob.id, agentId: agent.id, error: 'boom-retry' });
    assert.equal(getJob(retryJob.id)?.status, 'queued');
    assert.equal(last('job.retried')?.job_id, retryJob.id);
    assert.equal(last('job.retried')?.attempt, 1);
    assert.equal(last('job.retried')?.error, 'boom-retry');

    const deadJob = createJob({ spec, maxAttempts: 1 });
    assert.equal(claimJob({ agentId: agent.id, capabilities: agent.capabilities, jobId: deadJob.id })?.id, deadJob.id);
    failJob({ jobId: deadJob.id, agentId: agent.id, error: 'boom-final' });
    assert.equal(getJob(deadJob.id)?.status, 'failed');
    assert.equal(last('job.failed')?.job_id, deadJob.id);
    assert.equal(last('job.failed')?.error, 'boom-final');
  });

  it('emits lease_expired per job on the reclaim sweep', async () => {
    const { createJob, claimJob, requeueExpiredLeases, getJob } = await import('@/lib/tasks/service.ts');
    const { getSqlite } = await import('@/lib/tasks/db.ts');
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { createModuleJobSpec, MODULE_JOB_KIND } = await import('../../../src/lib/sim/module-compute.ts');
    const { agent } = await registerAgent({ name: 'telem-agent-c', capabilities: { kinds: [MODULE_JOB_KIND], backends: ['cpu'] } });
    const spec = createModuleJobSpec({ module: 'mutual' as const, scene: { k: 0.8, n: 0.5, mode: 'step' as const, steps: 2 } });
    const job = createJob({ spec });
    assert.equal(claimJob({ agentId: agent.id, capabilities: agent.capabilities, jobId: job.id })?.id, job.id);
    // Force the lease into the past without waiting out the TTL.
    getSqlite().prepare(`UPDATE jobs SET lease_expires_at = ? WHERE id = ?`).run('2000-01-01T00:00:00.000Z', job.id);
    assert.equal(requeueExpiredLeases(), 1);
    assert.equal(getJob(job.id)?.status, 'queued');
    const line = last('job.lease_expired');
    assert.equal(line?.job_id, job.id);
    assert.equal(line?.outcome, 'requeued');
  });

  it('emits cancelled only when the guarded write lands', async () => {
    const { createJob, cancelJob, getJob } = await import('@/lib/tasks/service.ts');
    const { createModuleJobSpec } = await import('../../../src/lib/sim/module-compute.ts');
    const spec = createModuleJobSpec({ module: 'mutual' as const, scene: { k: 0.7, n: 0.6, mode: 'step' as const, steps: 2 } });
    const job = createJob({ spec });
    cancelJob(job.id);
    assert.equal(getJob(job.id)?.status, 'cancelled');
    assert.equal(last('job.cancelled')?.job_id, job.id);
    // Second cancel on a terminal job must not re-emit.
    const count = events().filter((e) => e === 'job.cancelled').length;
    cancelJob(job.id);
    assert.equal(events().filter((e) => e === 'job.cancelled').length, count);
  });
});
