import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TaskApiClient } from './client.ts';
import { createJobHostFromTaskApi } from './host-client.ts';
import { runClaimedJobGuarded, runGuardedClaimLoopOnce } from './guarded-claim.ts';
import { createSolverRunnerRegistry } from '@w-sim/runtime';
import type { JobSpecV1 } from '@w-sim/contracts';

const claim = {
  job: {
    id: 'job-terminal-race',
    status: 'leased',
    attempt: 0,
    spec: {
      schemaVersion: 1 as const,
      kind: 'path-experiment',
      name: 'synthetic-host-race',
      parameters: {},
      run: { maxSteps: 1 },
      outputs: {},
      requirements: { backends: ['cpu'] },
    },
    leaseExpiresAt: '2099-01-01T00:00:00.000Z',
  },
};
const proposedResult = { schemaVersion: 1 as const, summary: { steps: 1, wallTimeMs: 2 }, backend: { id: 'cpu' } };
const storedResult = { schemaVersion: 1 as const, summary: { steps: 1, wallTimeMs: 9 }, backend: { id: 'cpu' } };

async function runHeartbeatRace(
  heartbeat: () => Response | Promise<Response>,
  failStatus: 'failed' | 'queued' | 'succeeded' = 'failed',
) {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const failErrors: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/api/v1/jobs/claim')) return Response.json(claim);
    if (url.endsWith('/heartbeat')) return heartbeat();
    if (url.endsWith('/fail')) {
      failErrors.push((JSON.parse(String(init?.body)) as { error: string }).error);
      return Response.json({ job: {
        ...claim.job,
        status: failStatus,
        error: failStatus === 'failed' ? failErrors.at(-1) : null,
        result: failStatus === 'succeeded' ? storedResult : null,
      } });
    }
    if (url.endsWith('/complete')) return Response.json({ job: { ...claim.job, status: 'succeeded', result: proposedResult } });
    throw new Error(`unexpected synthetic request: ${url}`);
  }) as typeof fetch;
  try {
    const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'synthetic-token'));
    const runner = {
      canRun: () => true,
      run: async (_spec: unknown, onProgress?: (progress: { step: number; total: number }) => Promise<void>, signal?: AbortSignal) => {
        await onProgress?.({ step: 1, total: 1 });
        if (signal?.aborted) throw new DOMException('synthetic runner interrupted', 'AbortError');
        throw new Error('runner continued after rejected heartbeat');
      },
    };
    const status = await runGuardedClaimLoopOnce(host, 'synthetic-agent', [runner]);
    return { status, calls, failErrors };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runSettlementScenario(options: {
  completeAck?: unknown;
  loseCompleteResponse?: boolean;
  completeHttpStatus?: number;
  failAck?: unknown;
  runnerFails?: boolean;
  cancelRequested?: boolean;
  receipt?: unknown;
} = {}) {
  const originalFetch = globalThis.fetch;
  const calls = { complete: 0, fail: 0, outcome: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/jobs/claim')) return Response.json(claim);
    if (url.endsWith('/heartbeat')) return Response.json({ job: { ...claim.job, leaseExpiresAt: '2099-01-01T00:01:00.000Z' } });
    if (url.endsWith('/complete')) {
      calls.complete += 1;
      if (options.loseCompleteResponse) throw new TypeError('synthetic lost response');
      if (options.completeHttpStatus) return new Response('synthetic complete conflict', { status: options.completeHttpStatus });
      return Response.json(options.completeAck ?? { job: { ...claim.job, status: 'succeeded', result: storedResult } });
    }
    if (url.endsWith('/fail')) {
      calls.fail += 1;
      return Response.json(options.failAck ?? { job: { ...claim.job, status: 'failed', error: 'synthetic solver error' } });
    }
    if (url.includes('/outcome?attempt=')) {
      calls.outcome += 1;
      return options.receipt === undefined
        ? new Response('no receipt', { status: 404 })
        : Response.json({ attempt: 0, outcome: options.receipt });
    }
    throw new Error(`unexpected synthetic request: ${url}`);
  }) as typeof fetch;
  try {
    const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'synthetic-token'));
    const claimed = await host.claim('synthetic-agent');
    assert.ok(claimed);
    const runner = {
      canRun: () => true,
      run: async (_spec: unknown, onProgress?: (progress: { step: number; total: number }) => Promise<void>) => {
        if (options.cancelRequested) await onProgress?.({ step: 1, total: 1 });
        if (options.runnerFails) throw new Error('synthetic solver error');
        return proposedResult;
      },
    };
    try {
      const outcome = await runClaimedJobGuarded(host, claimed!, 'synthetic-agent', [runner], {
        isCancelRequested: options.cancelRequested ? () => true : undefined,
      });
      return { outcome, calls };
    } catch (error) {
      return { error, calls };
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('confirmed Host cancellation returns cancelled without a redundant fail request', async () => {
  const { status, calls } = await runHeartbeatRace(() => new Response('Job was cancelled; cannot heartbeat', { status: 409 }));
  assert.equal(status, 'cancelled');
  assert.equal(calls.filter((url) => url.endsWith('/fail')).length, 0);
  assert.equal(calls.filter((url) => url.endsWith('/complete')).length, 0);
});

test('confirmed lease rejection returns lease_lost without a stale fail request', async () => {
  const { status, calls } = await runHeartbeatRace(() => new Response('Job is leased by another agent', { status: 409 }));
  assert.equal(status, 'lease_lost');
  assert.equal(calls.filter((url) => url.endsWith('/fail')).length, 0);
  assert.equal(calls.filter((url) => url.endsWith('/complete')).length, 0);
});

test('progress renewal returning null marks lease loss and skips fail settlement', async () => {
  const calls: string[] = [];
  const host = {
    registerAgent: async () => {},
    claim: async () => null,
    progress: async () => { calls.push('progress'); },
    renewLease: async () => { calls.push('renewLease'); return null; },
    complete: async () => { calls.push('complete'); return { jobId: claim.job.id, status: 'succeeded' as const, result: storedResult }; },
    fail: async () => { calls.push('fail'); return { jobId: claim.job.id, status: 'failed' as const, error: 'unexpected fail' }; },
  };
  const runner = {
    canRun: () => true,
    run: async (_spec: unknown, onProgress?: (progress: { step: number; total: number }) => Promise<void>) => {
      await onProgress?.({ step: 1, total: 1 });
      return proposedResult;
    },
  };

  const outcome = await runClaimedJobGuarded(
    host,
    { jobId: claim.job.id, spec: claim.job.spec as unknown as JobSpecV1, attempt: claim.job.attempt },
    'synthetic-agent',
    [runner],
    { keepaliveIntervalMs: 60_000 },
  );

  assert.equal(outcome.status, 'lease_lost');
  assert.deepEqual(calls, ['progress', 'renewLease']);
});

test('guard passes AbortSignal to a runner whose default third parameter makes length equal two', async () => {
  const shutdown = new AbortController();
  shutdown.abort();
  let receivedSignal: AbortSignal | undefined;
  const calls: string[] = [];
  const host = {
    registerAgent: async () => {},
    claim: async () => null,
    progress: async () => {},
    complete: async () => { calls.push('complete'); return { jobId: claim.job.id, status: 'succeeded' as const, result: storedResult }; },
    fail: async () => { calls.push('fail'); return { jobId: claim.job.id, status: 'queued' as const }; },
  };
  const runner = {
    canRun: () => true,
    async run(_spec: unknown, _progress?: unknown, signal: AbortSignal = new AbortController().signal) {
      receivedSignal = signal;
      return proposedResult;
    },
  };
  assert.equal(runner.run.length, 2);

  const outcome = await runClaimedJobGuarded(
    host,
    { jobId: claim.job.id, spec: claim.job.spec as unknown as JobSpecV1, attempt: claim.job.attempt },
    'synthetic-agent',
    [runner],
    { shutdownSignal: shutdown.signal, keepaliveIntervalMs: 60_000 },
  );

  assert.equal(receivedSignal?.aborted, true);
  assert.equal(outcome.status, 'requeued');
  assert.deepEqual(calls, ['fail']);
});

test('registry.asJobRunners forwards progress-time lease loss signal to its registered runner', async () => {
  let receivedSignal: AbortSignal | undefined;
  const calls: string[] = [];
  const host = {
    registerAgent: async () => {},
    claim: async () => null,
    progress: async () => { calls.push('progress'); },
    renewLease: async () => { calls.push('renewLease'); return null; },
    complete: async () => { calls.push('complete'); return { jobId: claim.job.id, status: 'succeeded' as const, result: storedResult }; },
    fail: async () => { calls.push('fail'); return { jobId: claim.job.id, status: 'queued' as const }; },
  };
  const registry = createSolverRunnerRegistry([{
    id: 'synthetic-path-runner',
    kinds: ['path-experiment'],
    contractVersions: [1],
    runtimes: ['node'],
    backends: ['cpu'],
    precision: ['float32'],
    dimensionality: ['graph'],
    createRunner: () => ({
      canRun: () => true,
      async run(_spec, onProgress, signal) {
        receivedSignal = signal;
        await onProgress?.({ step: 1, total: 1 });
        return proposedResult;
      },
    }),
  }]);

  const outcome = await runClaimedJobGuarded(
    host,
    { jobId: claim.job.id, spec: claim.job.spec as unknown as JobSpecV1, attempt: claim.job.attempt },
    'synthetic-agent',
    registry.asJobRunners(),
    { keepaliveIntervalMs: 60_000 },
  );

  assert.equal(receivedSignal?.aborted, true);
  assert.equal(outcome.status, 'lease_lost');
  assert.deepEqual(calls, ['progress', 'renewLease']);
});

test('unknown transport failure remains an ordinary failure, not cancellation or success', async () => {
  const { status, calls, failErrors } = await runHeartbeatRace(() => {
    throw new TypeError('synthetic connection reset');
  });
  assert.equal(status, 'failed');
  assert.equal(calls.filter((url) => url.endsWith('/fail')).length, 1);
  assert.equal(calls.filter((url) => url.endsWith('/complete')).length, 0);
  assert.match(failErrors[0] ?? '', /synthetic connection reset/);
});

test('complete uses the Host stored result instead of the runner proposal', async () => {
  const { outcome, calls, error } = await runSettlementScenario();
  assert.ok(outcome, error instanceof Error ? error.message : 'Expected Host complete outcome');
  assert.equal(outcome.status, 'completed');
  assert.deepEqual(outcome.result, storedResult);
  assert.equal(calls.complete, 1);
  assert.equal(calls.fail, 0);
});

test('complete acknowledgement loss is surfaced for reconciliation without a second fail', async () => {
  const { error, calls } = await runSettlementScenario({ loseCompleteResponse: true });
  assert.ok(error instanceof Error);
  assert.match(error.message, /outcome unresolved/);
  assert.equal(calls.complete, 1, 'terminal writes are never blindly retried');
  assert.equal(calls.outcome, 3, 'receipt GET is bounded to the initial read plus two retries');
  assert.equal(calls.fail, 0);
});

test('malformed complete acknowledgement is not treated as success and is never followed by fail', async () => {
  const { error, calls } = await runSettlementScenario({
    completeAck: { job: { ...claim.job, status: 'running', result: null } },
  });
  assert.ok(error instanceof Error);
  assert.match(error.message, /outcome unresolved/);
  assert.equal(calls.complete, 1);
  assert.equal(calls.outcome, 3);
  assert.equal(calls.fail, 0);
});

test('missing complete acknowledgement is surfaced without a second fail', async () => {
  const { error, calls } = await runSettlementScenario({ completeAck: {} });
  assert.ok(error instanceof Error);
  assert.match(error.message, /outcome unresolved/);
  assert.equal(calls.complete, 1);
  assert.equal(calls.outcome, 3);
  assert.equal(calls.fail, 0);
});

test('wrong-job complete acknowledgement is surfaced without a second fail', async () => {
  const { error, calls } = await runSettlementScenario({
    completeAck: { job: { ...claim.job, id: 'another-job', status: 'succeeded', result: storedResult } },
  });
  assert.ok(error instanceof Error);
  assert.match(error.message, /outcome unresolved/);
  assert.equal(calls.complete, 1);
  assert.equal(calls.outcome, 3);
  assert.equal(calls.fail, 0);
});

test('complete 409 is unresolved and never followed by a fail request', async () => {
  const { error, calls } = await runSettlementScenario({ completeHttpStatus: 409 });
  assert.ok(error instanceof Error);
  assert.match(error.message, /outcome unresolved/);
  assert.equal(calls.complete, 1);
  assert.equal(calls.outcome, 3);
  assert.equal(calls.fail, 0);
});

test('cancel probe with an invalid fail acknowledgement reports once and remains unresolved', async () => {
  const { error, calls } = await runSettlementScenario({ cancelRequested: true, failAck: {} });
  assert.ok(error instanceof Error);
  assert.match(error.message, /outcome unresolved/);
  assert.equal(calls.complete, 0);
  assert.equal(calls.fail, 1);
  assert.equal(calls.outcome, 3);
});

test('Host complete acknowledgement can report failed without a contradictory fail', async () => {
  const { outcome, calls } = await runSettlementScenario({
    completeAck: { job: { ...claim.job, status: 'failed', error: 'Host validation rejected result' } },
  });
  assert.equal(outcome?.status, 'failed');
  assert.equal(outcome?.message, 'Host validation rejected result');
  assert.equal(calls.fail, 0);
});

test('Host fail acknowledgement queued maps to requeued', async () => {
  const { outcome, calls } = await runSettlementScenario({ runnerFails: true, failAck: { job: { ...claim.job, status: 'queued' } } });
  assert.equal(outcome?.status, 'requeued');
  assert.equal(calls.fail, 1);
  assert.equal(calls.complete, 0);
});

test('Host fail acknowledgement succeeded returns the Host stored result', async () => {
  const { outcome, calls } = await runSettlementScenario({
    runnerFails: true,
    failAck: { job: { ...claim.job, status: 'succeeded', result: storedResult } },
  });
  assert.equal(outcome?.status, 'completed');
  assert.deepEqual(outcome?.result, storedResult);
  assert.equal(calls.fail, 1);
  assert.equal(calls.complete, 0);
});

test('missing fail acknowledgement is surfaced instead of claiming terminal failure', async () => {
  const { error, calls } = await runSettlementScenario({ runnerFails: true, failAck: {} });
  assert.ok(error instanceof Error);
  assert.match(error.message, /outcome unresolved/);
  assert.equal(calls.fail, 1);
  assert.equal(calls.complete, 0);
  assert.equal(calls.outcome, 3);
});
