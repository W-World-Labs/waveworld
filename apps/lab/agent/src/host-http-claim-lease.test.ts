/**
 * A-agent / S20 residual: TaskApiClient HTTP → JobHostClient claim + renewLease (heartbeat).
 *
 * Default: mock fetch (always on CI).
 * Live: HOST_HTTP_E2E=1 + TASK_API_URL (default http://127.0.0.1:3001) + AGENT_REGISTRATION_KEY or open register.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertSubmitableJobSpec, TaskApiClient } from './client.ts';
import {
  createJobHostFromTaskApi,
  hasIsoDateTimeShape,
  isAuthoritativeLeaseExpiresAt,
  isRealCalendarDatePrefix,
  isUsableClaimJobId,
  isUsableLeaseDeadline,
  LEASE_CLOCK_SKEW_MS,
  MAX_JOB_ID_LEN,
  retryableForHostFail,
  SOFT_LEASE_RENEW_MS,
} from './host-client.ts';
import {
  failRetryableForMessage,
  isLeaseLostFailMessage,
  LEASE_LOST_MESSAGE,
  UNABLE_TO_INTERRUPT_MESSAGE,
  runGuardedClaimLoopOnce,
  type InterruptibleJobRunner,
} from './guarded-claim.ts';
import {
  CLAIM_ERROR_BACKOFF_CAP_MS,
  MAX_CLAIM_POLL_MS,
  claimErrorBackoffMs,
  classifyClaimError,
  processJob,
  runClaimLoop,
} from './claim-loop.ts';
import {
  AgentResultValidationError,
  assertCompleteResult,
  MAX_BACKEND_IDENTITY_LEN,
} from './validate-result.ts';
import { buildSmokeJobSpec } from '@w-sim/solvers-path-experiment';
import type { JobRecord } from '../../src/types/task.ts';
import type { JobRunner } from '@w-sim/runtime';

describe('host-http claim+lease renew (mock)', () => {
  it('createJobHostFromTaskApi maps claim and renewLease via heartbeat', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push(`${method} ${url}`);
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        return new Response(
          JSON.stringify({
            job: {
              id: 'job-http-1',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'path-experiment',
                name: 'http-smoke',
                parameters: {},
                run: { maxSteps: 2 },
                outputs: {},
                requirements: { backends: ['cpu'] },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        return new Response(
          JSON.stringify({
            job: { id: 'job-http-1', leaseExpiresAt: '2099-01-01T00:01:00.000Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/complete') && method === 'POST') {
        return new Response(JSON.stringify({ job: {
          id: 'job-http-1', status: 'succeeded',
          result: { schemaVersion: 1, summary: { steps: 2, wallTimeMs: 1 }, backend: { id: 'cpu' } },
        } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;

    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      const host = createJobHostFromTaskApi(client);
      const claimed = await host.claim('agent-1');
      assert.ok(claimed);
      assert.equal(claimed!.jobId, 'job-http-1');
      const lease = await host.renewLease!('job-http-1', 'agent-1');
      assert.ok(lease);
      assert.match(lease!, /^2099/);
      await host.complete('job-http-1', {
        schemaVersion: 1,
        summary: { steps: 2, wallTimeMs: 1 },
        backend: { id: 'cpu' },
      }, claimed!.attempt);
      assert.ok(calls.some((c) => c.includes('/claim')));
      assert.ok(calls.some((c) => c.includes('/heartbeat')));
      assert.ok(calls.some((c) => c.includes('/complete')));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renewLease returns null when heartbeat fails (lease loss)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('nope', { status: 409 })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const lease = await host.renewLease!('j1', 'a1');
      assert.equal(lease, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/**
 * #7 / A-agent residual: TaskApiClient error paths + header edge cases.
 * Complements happy-path mock/live claim+lease without requiring a live Host.
 */
describe('TaskApiClient edge cases (mock)', () => {
  it('claim 204 maps to null (idle queue) via host adapter', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      assert.equal(await host.claim('agent-idle'), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('claim throws on non-ok status (error path)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('claim boom', { status: 503 })) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      await assert.rejects(() => client.claim(), /claim failed: 503/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('submitJob sends Bearer token and x-api-key when both configured', async () => {
    const originalFetch = globalThis.fetch;
    let seenAuth: string | null = null;
    let seenKey: string | null = null;
    let body: unknown;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      seenAuth = h.get('Authorization');
      seenKey = h.get('x-api-key');
      body = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(JSON.stringify({ job: { id: 'sub-1', status: 'queued' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'agent-tok', 'op-key');
      const { job } = await client.submitJob({
        schemaVersion: 1,
        kind: 'path-experiment',
        parameters: {},
        run: { maxSteps: 1 },
        outputs: {},
      } as never);
      assert.equal(job.id, 'sub-1');
      assert.equal(seenAuth, 'Bearer agent-tok');
      assert.equal(seenKey, 'op-key');
      assert.equal((body as { priority: number }).priority, 0);
      assert.equal((body as { spec: { kind: string } }).spec.kind, 'path-experiment');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host.fail maps to POST /fail; complete 409 surfaces as throw', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push(`${method} ${url}`);
      if (url.includes('/fail') && method === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        assert.equal(body.error, 'solver-crash');
        assert.equal(body.retryable, true);
        const id = new URL(url).pathname.split('/').at(-2)!;
        return new Response(JSON.stringify({ job: { id, status: 'failed', error: 'solver-crash' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/complete') && method === 'POST') {
        return new Response('stale lease', { status: 409 });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const failed = await host.fail('j-fail', 'solver-crash', 0);
      assert.equal(failed.jobId, 'j-fail');
      assert.equal(failed.status, 'failed');
      assert.ok(calls.some((c) => c.includes('/fail')));

      await assert.rejects(
        () =>
          host.complete('j-stale', {
            schemaVersion: 1,
            summary: { steps: 1, wallTimeMs: 1 },
            backend: { id: 'cpu' },
          }, 0),
        /complete outcome unresolved/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renewLease soft-deadline when heartbeat omits leaseExpiresAt', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ job: { id: 'j-soft' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const lease = await host.renewLease!('j-soft', 'a1');
      assert.ok(lease);
      // Soft 30s deadline is an ISO timestamp in the near future.
      assert.ok(Date.parse(lease!) > Date.now() - 1_000);
      assert.ok(Date.parse(lease!) <= Date.now() + 35_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('progress maps to heartbeat with progress body; heartbeat 503 → renewLease throws (transient)', async () => {
    const originalFetch = globalThis.fetch;
    let progressBody: unknown;
    let hbCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/heartbeat')) {
        hbCalls += 1;
        if (hbCalls === 1) {
          progressBody = init?.body ? JSON.parse(String(init.body)) : null;
          return new Response(
            JSON.stringify({ job: { id: 'j-hb', leaseExpiresAt: '2099-01-01T00:00:00.000Z' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('hb boom', { status: 503 });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      await host.progress('j-hb', { step: 3, total: 10, message: 'mid' });
      assert.equal((progressBody as { progress: { step: number } }).progress.step, 3);
      // Transient (5xx/transport) heartbeat failure must NOT collapse into
      // lease loss — a still-leased job failed retryable=false otherwise.
      await assert.rejects(() => host.renewLease!('j-hb', 'a1'), /heartbeat failed: 503/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renewLease taxonomy: definitive 4xx → null; 409 cancelled → AbortError; transient → throw', async () => {
    const originalFetch = globalThis.fetch;
    let status = 409;
    let body = 'Job is leased by another agent';
    globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      // Definitive ownership rejections → null (lease lost, non-retryable).
      assert.equal(await host.renewLease!('j1', 'a1'), null);
      status = 404; body = 'Job not found';
      assert.equal(await host.renewLease!('j1', 'a1'), null);
      status = 401; body = 'unauthorized';
      assert.equal(await host.renewLease!('j1', 'a1'), null);
      // Host cancel → AbortError so settlement records 'cancelled'.
      status = 409; body = 'Job was cancelled; cannot heartbeat';
      await assert.rejects(
        () => host.renewLease!('j1', 'a1'),
        (err: unknown) => err instanceof Error && err.name === 'AbortError',
      );
      // Transient responses rethrow — never lease loss.
      status = 503; body = 'hb boom';
      await assert.rejects(() => host.renewLease!('j1', 'a1'), /503/);
      status = 429; body = 'rate limited';
      await assert.rejects(() => host.renewLease!('j1', 'a1'), /429/);
      status = 408; body = 'request timeout';
      await assert.rejects(() => host.renewLease!('j1', 'a1'), /408/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('TaskApiClient register/heartbeat/fail/getJob non-ok throw', async () => {
    const originalFetch = globalThis.fetch;
    const statusFor = (url: string): number => {
      if (url.includes('/register')) return 401;
      if (url.includes('/heartbeat')) return 410;
      if (url.includes('/fail')) return 502;
      if (url.includes('/jobs/j-get')) return 404;
      return 500;
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(`err ${statusFor(url)}`, { status: statusFor(url) });
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      await assert.rejects(() => client.register('n'), /register failed: 401/);
      await assert.rejects(() => client.heartbeat('j1'), /heartbeat failed: 410/);
      await assert.rejects(() => client.fail('j1', 'x', 0), /fail outcome unresolved/);
      await assert.rejects(() => client.getJob('j-get'), /getJob failed: 404/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('guarded claim via HTTP host: mid-run renewLease null → lease_lost', async () => {
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let hbCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'j-lease-mid',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 5 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        hbCount += 1;
        // First heartbeat (progress) ok; subsequent renewLease fails → lease loss.
        if (hbCount <= 1) {
          return new Response(
            JSON.stringify({
              job: { id: 'j-lease-mid', leaseExpiresAt: '2099-01-01T00:01:00.000Z' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('stale', { status: 409 });
      }
      if (url.includes('/fail') && method === 'POST') {
        return new Response(JSON.stringify({ job: { id: 'j-lease-mid', status: 'failed', error: 'synthetic failure' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;

    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const runner: InterruptibleJobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run(spec, onProgress, signal) {
          await onProgress?.({ step: 1, total: spec.run.maxSteps });
          // Terminal-gate renewLease is the second heartbeat → 409 → lease_lost.
          if (signal?.aborted) throw new DOMException('lease abort', 'AbortError');
          return {
            schemaVersion: 1,
            summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 1 },
            backend: { id: 'cpu', agentId: 'a' },
          };
        },
      };
      const status = await runGuardedClaimLoopOnce(host, 'agent-http', [runner]);
      assert.equal(status, 'lease_lost');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('guarded claim via HTTP host: progress reuses heartbeat lease — one POST per event', async () => {
    // C7 amplification regression: each runner progress event used to cost a
    // heartbeat POST plus a redundant renewLease POST. The heartbeat response
    // already carries leaseExpiresAt, so the adapter's progressWithLease
    // consumes it — bare (progress-less) heartbeats should only come from the
    // terminal lease gate.
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let progressHb = 0;
    let bareHb = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'j-hb-lease',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 4 },
                outputs: {},
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (body && typeof body === 'object' && 'progress' in body) progressHb += 1;
        else bareHb += 1;
        return new Response(
          JSON.stringify({
            job: { id: 'j-hb-lease', leaseExpiresAt: '2099-01-01T00:01:00.000Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/complete') && method === 'POST') {
        return new Response(
          JSON.stringify({ job: { id: 'j-hb-lease', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;

    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const runner: InterruptibleJobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run(spec, onProgress) {
          for (let step = 1; step <= 3; step += 1) {
            await onProgress?.({ step, total: spec.run.maxSteps });
          }
          return {
            schemaVersion: 1,
            summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 1 },
            backend: { id: 'cpu', agentId: 'a' },
          };
        },
      };
      const status = await runGuardedClaimLoopOnce(host, 'agent-http', [runner]);
      assert.equal(status, 'completed');
      assert.equal(progressHb, 3, 'one heartbeat POST per progress event');
      assert.equal(bareHb, 1, 'only the terminal lease gate posts a bare heartbeat');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── More unit matrix residual (post cancel/lease smoke) ─────────────────

  it('claim maps missing leaseExpiresAt to undefined (adapter cell)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          job: {
            id: 'j-no-lease',
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const claimed = await host.claim('agent-x');
      assert.ok(claimed);
      assert.equal(claimed!.jobId, 'j-no-lease');
      assert.equal(claimed!.leaseExpiresAt, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host.progress throws when heartbeat fails (renewLease rethrows transient too)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('hb dead', { status: 503 })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      await assert.rejects(() => host.progress('j1', { step: 1, total: 2 }), /heartbeat failed: 503/);
      // A transient transport failure is not lease loss on renewLease either —
      // it propagates so the keepalive can retry inside the lease window.
      await assert.rejects(() => host.renewLease!('j1', 'a1'), /heartbeat failed: 503/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('guarded claim via HTTP host: isCancelRequested mid-run → cancelled', async () => {
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let failBody: unknown;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'j-http-cancel',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 8 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        return new Response(
          JSON.stringify({
            job: { id: 'j-http-cancel', leaseExpiresAt: '2099-01-01T00:02:00.000Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/fail') && method === 'POST') {
        failBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ job: { id: 'j-http-cancel', status: 'cancelled' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/complete') && method === 'POST') {
        return new Response('should-not-complete', { status: 500 });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;

    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      let ticks = 0;
      const runner: InterruptibleJobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run(spec, onProgress, signal) {
          await onProgress?.({ step: 0, total: spec.run.maxSteps });
          ticks += 1;
          if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
          await onProgress?.({ step: 1, total: spec.run.maxSteps });
          ticks += 1;
          if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
          return {
            schemaVersion: 1,
            summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 1 },
            backend: { id: 'cpu', agentId: 'a' },
          };
        },
      };
      const status = await runGuardedClaimLoopOnce(host, 'agent-http-cancel', [runner], {
        isCancelRequested: () => ticks >= 1,
      });
      assert.equal(status, 'cancelled');
      assert.ok(failBody);
      assert.equal((failBody as { retryable: boolean }).retryable, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('submitJob 403 error path; me requires auth', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/jobs') || url.includes('/api/v1/jobs?')) {
        return new Response('forbidden', { status: 403 });
      }
      if (url.includes('/agents/me')) {
        return new Response('unauthorized', { status: 401 });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      await assert.rejects(
        () =>
          client.submitJob({
            schemaVersion: 1,
            kind: 'path-experiment',
            parameters: {},
            run: { maxSteps: 1 },
            outputs: {},
          } as never),
        /submit failed: 403/,
      );
      await assert.rejects(() => client.me(), /me failed: 401/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Residual unit matrix after expanded cancel/lease (more unit only) ───

  it('host.fail adapter: non-lease → retryable true; lease-lost → retryable false', async () => {
    // Honesty residual: classify fail retryable from error text (lease loss non-retryable).
    const originalFetch = globalThis.fetch;
    const failBodies: unknown[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/fail') && (init?.method ?? 'GET').toUpperCase() === 'POST') {
        failBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        const id = new URL(url).pathname.split('/').at(-2)!;
        return new Response(JSON.stringify({ job: { id, status: 'failed', error: 'synthetic failure' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      await host.fail('j-fail', 'operator cancel', 0);
      await host.fail('j-lease', LEASE_LOST_MESSAGE, 0);
      assert.equal(failBodies.length, 2);
      assert.equal((failBodies[0] as { error: string }).error, 'operator cancel');
      assert.equal((failBodies[0] as { retryable: boolean }).retryable, true);
      assert.equal((failBodies[1] as { error: string }).error, LEASE_LOST_MESSAGE);
      assert.equal((failBodies[1] as { retryable: boolean }).retryable, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('guarded claim HTTP: requireLeaseForPublish false completes despite renew null', async () => {
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let completed = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'j-no-require-lease',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 2 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        return new Response('lease dead', { status: 409 });
      }
      if (url.includes('/complete') && method === 'POST') {
        completed = true;
        return new Response(
          JSON.stringify({ job: { id: 'j-no-require-lease', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const runner: InterruptibleJobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run(spec) {
          return {
            schemaVersion: 1,
            summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 0.4 },
            backend: { id: 'cpu', agentId: 'a' },
          };
        },
      };
      const status = await runGuardedClaimLoopOnce(host, 'agent-no-req', [runner], {
        requireLeaseForPublish: false,
      });
      assert.equal(status, 'completed');
      assert.equal(completed, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('guarded claim HTTP: terminal renewLease null after silent runner → lease_lost', async () => {
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let failBody: unknown;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'j-term-lease-null',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 2 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        return new Response('stale', { status: 409 });
      }
      if (url.includes('/fail') && method === 'POST') {
        failBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({ job: { id: 'j-term-lease-null', status: 'failed', error: 'synthetic failure' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/complete') && method === 'POST') {
        return new Response('should-not-complete', { status: 500 });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      // Silent 2-arg runner: no mid-progress; only terminal lease gate fires.
      const runner: InterruptibleJobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run(spec) {
          return {
            schemaVersion: 1,
            summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 0.3 },
            backend: { id: 'cpu', agentId: 'a' },
          };
        },
      };
      const status = await runGuardedClaimLoopOnce(host, 'agent-term-null', [runner]);
      assert.equal(status, 'lease_lost');
      assert.equal(failBody, undefined, 'confirmed lease loss must not send a stale terminal write');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('guarded claim HTTP: terminal renewLease soft-deadline still allows complete', async () => {
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let completed = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'j-soft-complete',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 2 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        // Omit leaseExpiresAt → soft 30s deadline (adapter unit cell).
        return new Response(JSON.stringify({ job: { id: 'j-soft-complete' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/complete') && method === 'POST') {
        completed = true;
        return new Response(
          JSON.stringify({ job: { id: 'j-soft-complete', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;

    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const runner: InterruptibleJobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run(spec, onProgress) {
          await onProgress?.({ step: 1, total: spec.run.maxSteps });
          return {
            schemaVersion: 1,
            summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 0.5 },
            backend: { id: 'cpu', agentId: 'a' },
          };
        },
      };
      const status = await runGuardedClaimLoopOnce(host, 'agent-soft', [runner]);
      assert.equal(status, 'completed');
      assert.equal(completed, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Residual unit matrix after b64cfb2 (more unit only) ─────────────────

  it('HTTP residual post-b64: 2-arg cancel → unable-to-interrupt fail body', async () => {
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let failBody: unknown;
    let completed = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'j-arity2-cancel',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 2 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        return new Response(
          JSON.stringify({
            job: { id: 'j-arity2-cancel', leaseExpiresAt: '2099-01-01T00:03:00.000Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/fail') && method === 'POST') {
        failBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({ job: { id: 'j-arity2-cancel', status: 'failed', error: 'synthetic failure' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/complete') && method === 'POST') {
        completed = true;
        return new Response('should-not-complete', { status: 500 });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const twoArg: InterruptibleJobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        // Two-arg only — run.length < 3; cancel post-check uses UNABLE_TO_INTERRUPT.
        async run(spec) {
          return {
            schemaVersion: 1,
            summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 0.2 },
            backend: { id: 'cpu', agentId: 'a' },
          };
        },
      };
      assert.ok(twoArg.run.length < 3);
      const status = await runGuardedClaimLoopOnce(host, 'agent-arity2', [twoArg], {
        isCancelRequested: () => true,
      });
      assert.equal(status, 'failed');
      assert.equal(completed, false);
      assert.ok(failBody);
      assert.match(String((failBody as { error: string }).error), /unable to interrupt/i);
      assert.equal((failBody as { retryable: boolean }).retryable, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP residual post-b64: complete 409 after lease ok → unresolved, no contradictory fail', async () => {
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let failBody: unknown;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'j-complete-409',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 2 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        return new Response(
          JSON.stringify({
            job: { id: 'j-complete-409', leaseExpiresAt: '2099-01-01T00:04:00.000Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/complete') && method === 'POST') {
        return new Response('stale lease', { status: 409 });
      }
      if (url.includes('/fail') && method === 'POST') {
        failBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({ job: { id: 'j-complete-409', status: 'failed', error: 'synthetic failure' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const runner: InterruptibleJobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run(spec) {
          return {
            schemaVersion: 1,
            summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 0.1 },
            backend: { id: 'cpu', agentId: 'a' },
          };
        },
      };
      await assert.rejects(() => runGuardedClaimLoopOnce(host, 'agent-c409', [runner]), /complete outcome unresolved/);
      assert.equal(failBody, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP residual post-b64: progress throw mid-run → failed (not lease_lost)', async () => {
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let failBody: unknown;
    let hbCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'j-prog-throw',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 4 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        hbCount += 1;
        // progress() uses heartbeat with body → 503 throws (transient → failed).
        return new Response('hb dead', { status: 503 });
      }
      if (url.includes('/fail') && method === 'POST') {
        failBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({ job: { id: 'j-prog-throw', status: 'failed', error: 'synthetic failure' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/complete') && method === 'POST') {
        return new Response('should-not-complete', { status: 500 });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const runner: InterruptibleJobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run(spec, onProgress, signal) {
          await onProgress?.({ step: 1, total: spec.run.maxSteps });
          if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
          return {
            schemaVersion: 1,
            summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 0.7 },
            backend: { id: 'cpu', agentId: 'a' },
          };
        },
      };
      const status = await runGuardedClaimLoopOnce(host, 'agent-prog-throw', [runner]);
      // host.progress throws (heartbeat failed) → failed classification, not lease_lost.
      assert.equal(status, 'failed');
      assert.ok(hbCount >= 1);
      assert.ok(failBody);
      const errMsg = String((failBody as { error: string }).error);
      assert.match(errMsg, /heartbeat failed: 503/);
      assert.equal(/lease lost/i.test(errMsg), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP residual post-b64: registerAgent no-op; claim 204 idle after empty queue', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      await host.registerAgent!({ id: 'a1', name: 'n', capabilities: { backends: ['cpu'] } } as never);
      assert.equal(await host.claim('a1'), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP residual: mid-run renew null → fail retryable false (lease honesty)', async () => {
    // Host adapter maps lease-loss fail text → retryable:false (parity with processJob).
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let hbCount = 0;
    let failBody: unknown;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'j-mid-retryable',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 5 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        hbCount += 1;
        if (hbCount <= 1) {
          return new Response(
            JSON.stringify({
              job: { id: 'j-mid-retryable', leaseExpiresAt: '2099-01-01T00:05:00.000Z' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('stale', { status: 409 });
      }
      if (url.includes('/fail') && method === 'POST') {
        failBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({ job: { id: 'j-mid-retryable', status: 'failed', error: 'synthetic failure' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const runner: InterruptibleJobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run(spec, onProgress, signal) {
          await onProgress?.({ step: 1, total: spec.run.maxSteps });
          if (signal?.aborted) throw new DOMException('lease abort', 'AbortError');
          return {
            schemaVersion: 1,
            summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 1 },
            backend: { id: 'cpu', agentId: 'a' },
          };
        },
      };
      const status = await runGuardedClaimLoopOnce(host, 'agent-mid-retry', [runner]);
      assert.equal(status, 'lease_lost');
      assert.equal(failBody, undefined, 'confirmed lease loss must not send a stale terminal write');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Residual after 8500598 / 9a3ec93: network/timeout abort + processJob ──

  it('HTTP residual: fetch network reject → renewLease throws (transient ≠ lease loss)', async () => {
    // Transport failure is not proof of lease loss: collapsing it into null
    // permanently failed a still-leased job (failRetryableForMessage(LEASE_LOST)
    // === false). renewLease rethrows so the guarded core retries inside the
    // last-known lease window.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed: ECONNRESET');
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      await assert.rejects(() => host.renewLease!('j-net', 'a1'), /ECONNRESET|fetch failed/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP residual: TimeoutError-shaped reject → renewLease throws (transient)', async () => {
    // A timeout-shaped DOMException is a transport failure, not host cancel —
    // it must propagate for keepalive retry, never surface as lease loss.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      await assert.rejects(
        () => host.renewLease!('j-timeout', 'a1'),
        /aborted due to timeout|TimeoutError/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP residual: claim still throws on network reject', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed: ENOTFOUND');
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      await assert.rejects(() => client.claim(), /ENOTFOUND|fetch failed/);
      const host = createJobHostFromTaskApi(client);
      await assert.rejects(() => host.claim('a1'), /ENOTFOUND|fetch failed/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP residual: mid-run network reject on renew → retryable failed (no complete)', async () => {
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let hbCount = 0;
    let failBody: unknown;
    let completed = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'j-net-mid',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 4 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        hbCount += 1;
        // Progress heartbeat ok; mid-run renewLease (2nd+) network-aborts.
        if (hbCount <= 1) {
          return new Response(
            JSON.stringify({
              job: { id: 'j-net-mid', leaseExpiresAt: '2099-01-01T00:01:00.000Z' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new TypeError('fetch failed: socket hang up');
      }
      if (url.includes('/fail') && method === 'POST') {
        failBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ job: { id: 'j-net-mid', status: 'failed', error: 'synthetic failure' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/complete') && method === 'POST') {
        completed = true;
        return new Response('should-not-complete', { status: 500 });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;

    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const runner: InterruptibleJobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run(spec, onProgress, signal) {
          await onProgress?.({ step: 1, total: spec.run.maxSteps });
          if (signal?.aborted) throw new DOMException('lease abort', 'AbortError');
          return {
            schemaVersion: 1,
            summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 1 },
            backend: { id: 'cpu', agentId: 'a' },
          };
        },
      };
      const status = await runGuardedClaimLoopOnce(host, 'agent-net-mid', [runner]);
      // A transport outage is not proof of lease loss: the job settles as a
      // *retryable* failure so a peer can reclaim, never lease_lost.
      assert.equal(status, 'failed');
      assert.equal(completed, false);
      assert.ok(failBody);
      assert.match(String((failBody as { error: string }).error), /socket hang up|fetch failed/i);
      assert.equal((failBody as { retryable: boolean }).retryable, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('TaskApiClient residual: trailing slash baseUrl + updateCapabilities + fail retryable false', async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    let failBody: unknown;
    let capBody: unknown;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/agents/me') && method === 'PUT') {
        capBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response('capability rejected', { status: 422 });
      }
      if (url.includes('/fail') && method === 'POST') {
        failBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ job: { id: 'j-r', status: 'failed', error: 'synthetic failure' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test/', 'tok');
      assert.equal(client.baseUrl, 'http://host.test');
      await assert.rejects(
        () =>
          client.updateCapabilities({
            backends: ['cpu'],
            kinds: ['path-experiment'],
          } as never),
        /capability update failed: 422/,
      );
      assert.ok(capBody);
      await client.fail('j-r', LEASE_LOST_MESSAGE, 0, false);
      assert.ok(failBody);
      assert.equal((failBody as { retryable: boolean }).retryable, false);
      assert.equal((failBody as { error: string }).error, LEASE_LOST_MESSAGE);
      // No double-slash from trailing baseUrl.
      assert.ok(urls.every((u) => !u.includes('host.test//')));
      assert.ok(urls.some((u) => u === 'http://host.test/api/v1/agents/me'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('processJob residual: post-run renew transport failure → retryable fail + throw', async () => {
    // Terminal renewLease transport failure is not proof of lease loss —
    // settlement records a retryable failure (peer reclaim), never complete.
    let hb = 0;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    let completed = false;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async (_id: string, progress?: unknown) => {
        hb += 1;
        // Converged semantics: progress heartbeats are now awaited by the
        // runner, so a transport failure mid-run would abort it — only the
        // terminal bare renewLease (progress === undefined) may fail here.
        if (progress !== undefined || hb === 1) {
          return { job: { id: 'job-pj-lease', leaseExpiresAt: '2099-01-01T00:00:00.000Z' } };
        }
        throw new TypeError('fetch failed: ECONNRESET');
      },
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;

    const smoke = buildSmokeJobSpec({ maxSteps: 3 });
    const job = {
      id: 'job-pj-lease',
      name: 'pkg-smoke',
      status: 'leased',
              attempt: 0,
      spec: smoke,
    } as unknown as JobRecord;

    await assert.rejects(
      () => processJob(client, job, 'agent-pj-lease'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /fetch failed|ECONNRESET/);
        return true;
      },
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /fetch failed|ECONNRESET/);
    assert.equal(failArgs!.retryable, true);
    assert.ok(hb >= 2, 'loading + terminal renew (and optional progress) heartbeats');
  });

  it('processJob residual: heartbeat 409 aborts the runner instead of running on a dead lease', async () => {
    // C10 residual: processJob's AbortController must actually fire — a
    // heartbeat reporting lease loss (host atomic guard → 409) interrupts
    // the runner instead of letting it complete on a dead lease.
    let aborted = false;
    let hb = 0;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => {
        hb += 1;
        // Loading heartbeat (awaited) must succeed; progress heartbeats then
        // report the host's atomic lease-loss guard → the runner is aborted.
        if (hb === 1) {
          return { job: { id: 'job-pj-abort', leaseExpiresAt: '2099-01-01T00:00:00.000Z' } };
        }
        throw new Error('heartbeat failed: 409 lease lost');
      },
      complete: async (_id: string, result: unknown) => ({ jobId: _id, status: 'succeeded', result }),
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runners = [{
      canRun: () => true,
      run: (_spec: JobSpecV1, onProgress?: (p: JobProgress) => void, signal?: AbortSignal) =>
        new Promise<JobResultV1>((_resolve, reject) => {
          const backstop = setTimeout(() => reject(new Error('runner was never aborted')), 10_000);
          signal?.addEventListener('abort', () => {
            aborted = true;
            clearTimeout(backstop);
            reject(new DOMException('interrupted by signal', 'AbortError'));
          });
          queueMicrotask(() => onProgress?.({ step: 1, total: 3 }));
        }),
    }];
    const job = {
      id: 'job-pj-abort',
      name: 'abort-check',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 3 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-pj-abort', undefined, undefined, runners),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
    assert.equal(aborted, true, 'heartbeat 409 must abort the runner signal');
    assert.equal(failArgs, undefined, 'confirmed heartbeat lease loss must not send a stale terminal write');
  });

  // ── Residual unit matrix after 788a583 (more unit only; not #7 close) ─────

  it('processJob residual: unknown kind fails host then throws (not complete)', async () => {
    // Honesty residual after registry-error-paths: processJob must terminal-fail
    // when resolveJobRunner misses (parity with runGuardedClaimLoopOnce), not leave
    // the job leased without complete/fail. Does not close #7 product AC.
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({ job: { id: 'job-unk' } }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const job = {
      id: 'job-unk',
      name: 'unknown-kind',
      status: 'leased',
              attempt: 0,
      spec: {
        schemaVersion: 1,
        kind: 'unregistered-test-kind',
        parameters: {},
        run: { maxSteps: 1 },
        outputs: {},
      },
    } as unknown as JobRecord;
    await assert.rejects(() => processJob(client, job, 'agent-unk'), /no runner/i);
    assert.equal(completed, false);
    assert.ok(failArgs, 'unknown kind must call client.fail');
    assert.match(failArgs!.error, /no runner/i);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual: package smoke lease ok → complete (retryable path unused)', async () => {
    let completed = false;
    let failCalled = false;
    let completeResult: unknown;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-pj-ok', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, result: unknown) => {
        completed = true;
        completeResult = result;
        return { job: { id: 'job-pj-ok', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } };
      },
      fail: async (_id: string, error = 'synthetic failure') => {
        failCalled = true;
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const smoke = buildSmokeJobSpec({ maxSteps: 3 });
    const job = {
      id: 'job-pj-ok',
      name: 'pkg-ok',
      status: 'leased',
              attempt: 0,
      spec: smoke,
    } as unknown as JobRecord;
    await processJob(client, job, 'agent-pj-ok');
    assert.equal(completed, true);
    assert.equal(failCalled, false);
    assert.ok(completeResult);
    assert.equal((completeResult as { summary: { steps: number } }).summary.steps, 3);
  });

  it('processJob residual: complete throw after lease ok surfaces (no fail)', async () => {
    let failCalled = false;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-pj-c409', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async () => {
        throw new Error('complete failed: 409 conflict');
      },
      fail: async (_id: string, error = 'synthetic failure') => {
        failCalled = true;
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const smoke = buildSmokeJobSpec({ maxSteps: 2 });
    const job = {
      id: 'job-pj-c409',
      name: 'pkg-c409',
      status: 'leased',
              attempt: 0,
      spec: smoke,
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-pj-c409'),
      /complete failed: 409/,
    );
    // processJob does not wrap complete errors into client.fail (Host owns settlement).
    assert.equal(failCalled, false);
  });

  it('runClaimLoop residual: once+idle exits without throw', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      await runClaimLoop({ client, agentId: 'agent-once-idle', once: true, pollMs: 1 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('runClaimLoop residual: unusable pollMs rejects before any control-plane HTTP', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      // NaN / 0 / negative / Infinity / >2^31-1 collapse setTimeout to ~0-1ms:
      // without validation the idle and error sleeps become a hot claim loop.
      for (const pollMs of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY, MAX_CLAIM_POLL_MS + 1]) {
        await assert.rejects(
          () => runClaimLoop({ client, agentId: 'agent-bad-poll', once: true, pollMs }),
          /pollMs/,
          `pollMs=${pollMs}`,
        );
      }
      assert.equal(fetchCalls, 0);
      // Boundary: the max setTimeout delay is still usable; once+idle returns
      // before sleeping, so this completes immediately with one claim call.
      await runClaimLoop({ client, agentId: 'agent-bad-poll', once: true, pollMs: MAX_CLAIM_POLL_MS });
      assert.equal(fetchCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('claim error backoff doubles per failure and caps at 60s', () => {
    // Flat pollMs error retry = ~43k failures/day/agent on a sustained outage;
    // the backoff ramps and caps so the loop self-heals without spamming.
    assert.equal(claimErrorBackoffMs(2000, 1), 2000);
    assert.equal(claimErrorBackoffMs(2000, 2), 4000);
    assert.equal(claimErrorBackoffMs(2000, 3), 8000);
    assert.equal(claimErrorBackoffMs(2000, 6), 60000); // 2000*2^5=64000 → cap
    assert.equal(claimErrorBackoffMs(2000, 100), CLAIM_ERROR_BACKOFF_CAP_MS);
    // Defensive edges: non-positive/zero count never divides to a hot loop.
    assert.equal(claimErrorBackoffMs(2000, 0), 2000);
    assert.equal(claimErrorBackoffMs(1, 31), 1024); // exponent shift clamped at 2^10
  });

  it('classifyClaimError flags 401/403 as auth (dead token ≠ transient outage)', () => {
    assert.equal(classifyClaimError(new Error('claim failed: 401 {"error":"unauthorized"}')), 'auth');
    assert.equal(classifyClaimError(new Error('claim failed: 403 token revoked')), 'auth');
    assert.equal(classifyClaimError(new Error('claim failed: 503 unavailable')), 'other');
    assert.equal(classifyClaimError(new Error('fetch failed')), 'other');
    assert.equal(classifyClaimError('not an error'), 'other');
  });

  it('uploadFlowSequence retries transient failures, never retries definitive ones', async () => {
    // One transient blip during artifact upload must not discard a run's
    // completed compute; definitive 4xx and caller aborts still fail fast.
    const frame = {
      nx: 1, ny: 1, nz: 1, step: 1, displayStride: 2 as const,
      uLattice: 0.01, display: new Float32Array(2), flags: new Uint32Array(1),
    };
    const client = new TaskApiClient('http://host.test', 'tok');
    const heartbeatOk = () => new Response(JSON.stringify({ job: { id: 'j1', status: 'leased' } }), { status: 200 });
    const originalFetch = globalThis.fetch;
    try {
      // (a) 503 then success → retried; each attempt re-heartbeats.
      // The encoder's kind/contentType are internal — echo the request's own
      // headers back so the artifact-shape check sees honest values.
      let posts = 0;
      let heartbeats = 0;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/heartbeat')) { heartbeats++; return heartbeatOk(); }
        posts++;
        if (posts === 1) return new Response('oops', { status: 503 });
        const kind = (init?.headers as Record<string, string>)['X-Artifact-Kind'];
        const ct = (init?.headers as Record<string, string>)['Content-Type'];
        const bytes = (init?.body as ArrayBuffer).byteLength;
        return new Response(
          JSON.stringify({ artifact: { id: 'a1', bytes, kind, contentType: ct } }),
          { status: 200 },
        );
      }) as typeof fetch;
      const art = await client.uploadFlowSequence('j1', [frame]);
      assert.equal(art.artifactId, 'a1');
      assert.equal(posts, 2);
      assert.equal(heartbeats, 2);

      // (b) 401 → definitive, single POST.
      posts = 0;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/heartbeat')) return heartbeatOk();
        posts++;
        return new Response('denied', { status: 401 });
      }) as typeof fetch;
      await assert.rejects(() => client.uploadFlowSequence('j1', [frame]), /flow sequence upload failed: HTTP 401/);
      assert.equal(posts, 1);

      // (c) network TypeError → retried to success.
      posts = 0;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/heartbeat')) return heartbeatOk();
        posts++;
        if (posts === 1) throw new TypeError('fetch failed');
        const kind = (init?.headers as Record<string, string>)['X-Artifact-Kind'];
        const ct = (init?.headers as Record<string, string>)['Content-Type'];
        const bytes = (init?.body as ArrayBuffer).byteLength;
        return new Response(
          JSON.stringify({ artifact: { id: 'a2', bytes, kind, contentType: ct } }),
          { status: 200 },
        );
      }) as typeof fetch;
      const art2 = await client.uploadFlowSequence('j1', [frame]);
      assert.equal(art2.artifactId, 'a2');
      assert.equal(posts, 2);

      // (d) A terminal write is sent once; a transient response is reconciled
      // through the exact lease receipt rather than replaying the write.
      let completes = 0, outcomeReads = 0;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/outcome?')) {
          outcomeReads++;
          return Response.json({ attempt: 0, outcome: { jobId: 'j1', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } });
        }
        completes++;
        assert.equal(init?.method, 'POST');
        return new Response('blip', { status: 500 });
      }) as typeof fetch;
      const settled = await client.complete('j1', {
        schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' },
      }, 0);
      assert.equal(settled.status, 'succeeded');
      assert.equal(completes, 1);
      assert.equal(outcomeReads, 1);

      completes = 0;
      outcomeReads = 0;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        if (String(input).includes('/outcome?')) { outcomeReads++; return new Response('missing', { status: 404 }); }
        completes++; return new Response('conflict', { status: 409 });
      }) as typeof fetch;
      await assert.rejects(
        () => client.complete('j1', { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } }, 0),
        /complete outcome unresolved/,
      );
      assert.equal(completes, 1);
      assert.equal(outcomeReads, 3);

      // (e) downloadModel: transient 500 retried; sha256 still enforced per attempt.
      const mesh = new ArrayBuffer(20);
      new DataView(mesh).setUint32(0, 0x324d4757, true); // WGM2 magic
      const meshSha = createHash('sha256').update(new Uint8Array(mesh)).digest('hex');
      let gets = 0;
      globalThis.fetch = (async () => {
        gets++;
        if (gets === 1) return new Response('blip', { status: 500 });
        return new Response(mesh, {
          status: 200,
          headers: { 'Content-Type': 'application/vnd.waveworld.mesh-v2', 'x-artifact-sha256': meshSha },
        });
      }) as typeof fetch;
      const buf = await client.downloadModel('m1', 'j1');
      assert.equal(buf.byteLength, 20);
      assert.equal(gets, 2);

      // (f) downloadModel: bad sha is definitive — never retried.
      gets = 0;
      globalThis.fetch = (async () => {
        gets++;
        return new Response(mesh, {
          status: 200,
          headers: { 'Content-Type': 'application/vnd.waveworld.mesh-v2', 'x-artifact-sha256': 'deadbeef' },
        });
      }) as typeof fetch;
      await assert.rejects(() => client.downloadModel('m1', 'j1'), /integrity check failed/);
      assert.equal(gets, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('shutdownSignal aborts the in-flight run and settles a retryable agent-shutdown fail', async () => {
    // Deploy/restart (SIGTERM) used to strand the job leased until expiry.
    // The shutdown abort must classify as retryable 'failed' — not
    // 'cancelled' (no host cancel happened) and not 'lease_lost'.
    const originalFetch = globalThis.fetch;
    const shutdown = new AbortController();
    let failBody: { error?: string; retryable?: boolean } | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        return new Response(
          JSON.stringify({
            job: {
              id: 'j-shutdown',
              status: 'leased',
              attempt: 0,
              spec: { schemaVersion: 1, kind: 'lbm-d3q19', parameters: {}, run: { maxSteps: 4 }, outputs: {} },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        return new Response(
          JSON.stringify({ job: { id: 'j-shutdown', leaseExpiresAt: '2099-01-01T00:01:00.000Z' } }),
          { status: 200 },
        );
      }
      if (url.includes('/fail') && method === 'POST') {
        failBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ job: { id: 'j-shutdown', status: 'failed', error: 'synthetic failure' } }), { status: 200 });
      }
      if (url.includes('/complete') && method === 'POST') {
        return new Response('should-not-complete', { status: 500 });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const runner: InterruptibleJobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run(_spec, _onProgress, signal) {
          // Runs until interrupted — shutdown abort must reach it.
          await new Promise<never>((_res, rej) => {
            signal?.addEventListener('abort', () => rej(new DOMException('interrupted', 'AbortError')), { once: true });
            setTimeout(() => shutdown.abort(), 10);
          });
          throw new Error('unreachable');
        },
      };
      const status = await runGuardedClaimLoopOnce(host, 'agent-sd', [runner], {
        shutdownSignal: shutdown.signal,
      });
      assert.equal(status, 'failed');
      assert.ok(failBody);
      assert.match(String(failBody.error), /shutting down/);
      assert.equal(failBody.retryable, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('runClaimLoop residual: once+failed cycle returns (no throw; host.fail called)', async () => {
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let failBody: unknown;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'job-loop-fail',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'unregistered-test-kind',
                parameters: {},
                run: { maxSteps: 1 },
                outputs: {},
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/fail') && method === 'POST') {
        failBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ job: { id: 'job-loop-fail', status: 'failed', error: 'synthetic failure' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        return new Response(
          JSON.stringify({
            job: { id: 'job-loop-fail', leaseExpiresAt: '2099-01-01T00:01:00.000Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      // Default multi-kind registry has no unregistered-test-kind → failed status, once returns.
      await runClaimLoop({ client, agentId: 'agent-once-fail', once: true, pollMs: 1 });
      assert.ok(failBody);
      assert.match(String((failBody as { error: string }).error), /no runner/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('runClaimLoop residual: once+custom 2-arg runners complete via guarded', async () => {
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let completed = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'job-loop-ok',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 2 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        return new Response(
          JSON.stringify({
            job: { id: 'job-loop-ok', leaseExpiresAt: '2099-01-01T00:01:00.000Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/complete') && method === 'POST') {
        completed = true;
        return new Response(JSON.stringify({ job: { id: 'job-loop-ok', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      const runner: JobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run(spec, onProgress) {
          await onProgress?.({ step: 1, total: spec.run.maxSteps });
          return {
            schemaVersion: 1,
            summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 1 },
            backend: { id: 'cpu', agentId: 'agent-once-ok' },
          };
        },
      };
      await runClaimLoop({
        client,
        agentId: 'agent-once-ok',
        once: true,
        pollMs: 1,
        runners: [runner],
      });
      assert.equal(completed, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('TaskApi residual: register x-api-key override + getJob 404 + me no Content-Type', async () => {
    const originalFetch = globalThis.fetch;
    const headersSeen: Array<Record<string, string>> = [];
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      const h = (init?.headers ?? {}) as Record<string, string>;
      headersSeen.push({ ...h });
      if (url.includes('/agents/register')) {
        return new Response(
          JSON.stringify({
            agent: { id: 'a1', name: 'n', capabilities: {} },
            token: 't1',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/agents/me') && (init?.method ?? 'GET').toUpperCase() === 'GET') {
        return new Response(JSON.stringify({ agent: { id: 'a1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/v1/jobs/missing')) {
        return new Response('gone', { status: 404 });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'bearer-tok', 'default-key');
      const reg = await client.register('agent-x', { backends: ['cpu'] } as never, 'override-key');
      assert.equal(reg.token, 't1');
      // registrationKey overrides constructor apiKey on register only.
      assert.equal(headersSeen[0]!['x-api-key'], 'override-key');
      assert.equal(headersSeen[0]!.Authorization, 'Bearer bearer-tok');

      await client.me();
      const meHeaders = headersSeen[1]!;
      assert.equal(meHeaders['Content-Type'], undefined);
      assert.equal(meHeaders.Authorization, 'Bearer bearer-tok');

      await assert.rejects(() => client.getJob('missing'), /getJob failed: 404/);
      assert.ok(urls.some((u) => u.endsWith('/api/v1/jobs/missing')));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP residual: progress + renewLease both throw on network reject', async () => {
    // host.progress awaits heartbeat; network throw propagates. renewLease
    // matches it now — a transport failure is transient, never lease loss.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed: EPIPE');
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      await assert.rejects(
        () => host.progress('j1', { step: 1, total: 2 }),
        /EPIPE|fetch failed/,
      );
      // Peer matrix cell: renew also throws (transient classification).
      await assert.rejects(() => host.renewLease!('j1', 'a1'), /EPIPE|fetch failed/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Residual unit matrix after e63a87c (more unit only; not #7 close) ─────

  it('HTTP residual post-e63: renewLease soft deadline when heartbeat omits leaseExpiresAt', async () => {
    // Adapter: accepted heartbeat without expiry → synthetic ~30s deadline (not null).
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ job: { id: 'j-soft' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const before = Date.now();
      const lease = await host.renewLease!('j-soft', 'a1');
      assert.ok(lease);
      const exp = Date.parse(lease!);
      assert.ok(Number.isFinite(exp));
      // Soft window is Date.now()+30_000; allow clock skew.
      assert.ok(exp >= before + 20_000 && exp <= before + 45_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('guarded claim settlement boundary: bad schemaVersion fails, never completes', async () => {
    // Settlement boundary check (post-e63 residual closed): runGuardedClaimLoopOnce
    // now asserts the result envelope before complete, so a custom runner that
    // skips its own assertCompleteResult gets fail(schemaVersion) — parity with
    // processJob. Host validateJobResult remains the authoritative backstop.
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let completed = false;
    let failBody: { error?: string; retryable?: boolean } | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'job-bad-schema',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 1 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        return new Response(
          JSON.stringify({
            job: { id: 'job-bad-schema', leaseExpiresAt: '2099-01-01T00:01:00.000Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/complete') && method === 'POST') {
        completed = true;
        return new Response(JSON.stringify({ job: { id: 'job-bad-schema', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/fail') && method === 'POST') {
        failBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(JSON.stringify({ job: { id: 'job-bad-schema', status: 'queued' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const c = new TaskApiClient('http://host.test', 'tok');
      const badRunner: JobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run() {
          return {
            schemaVersion: 2,
            summary: { steps: 1, wallTimeMs: 1 },
            backend: { id: 'cpu' },
          } as never;
        },
      };
      await runClaimLoop({
        client: c,
        agentId: 'agent-bad-schema',
        once: true,
        pollMs: 1,
        runners: [badRunner],
      });
      assert.equal(completed, false);
      assert.match(String(failBody?.error), /schemaVersion/);
      assert.equal(failBody?.retryable, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('runClaimLoop residual post-e63: once+lease_lost cycle returns without throw', async () => {
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let failBody: unknown;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'job-loop-ll',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 2 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        // Terminal / mid renew soft-null via hard fail → renewLease null.
        return new Response('gone', { status: 409 });
      }
      if (url.includes('/fail') && method === 'POST') {
        failBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ job: { id: 'job-loop-ll', status: 'failed', error: 'synthetic failure' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      const runner: JobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run(spec) {
          return {
            schemaVersion: 1,
            summary: { steps: spec.run.maxSteps, wallTimeMs: 1, cd: 1 },
            backend: { id: 'cpu', agentId: 'agent-once-ll' },
          };
        },
      };
      await runClaimLoop({
        client,
        agentId: 'agent-once-ll',
        once: true,
        pollMs: 1,
        runners: [runner],
      });
      assert.equal(failBody, undefined, 'confirmed lease loss must not send a stale terminal write');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('runClaimLoop residual post-e63: once+cancelled AbortError returns without throw', async () => {
    const originalFetch = globalThis.fetch;
    let claimDone = false;
    let failBody: unknown;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        if (claimDone) return new Response(null, { status: 204 });
        claimDone = true;
        return new Response(
          JSON.stringify({
            job: {
              id: 'job-loop-cancel',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'lbm-d3q19',
                parameters: {},
                run: { maxSteps: 2 },
                outputs: { forces: true },
              },
              leaseExpiresAt: '2099-01-01T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        return new Response(
          JSON.stringify({
            job: { id: 'job-loop-cancel', leaseExpiresAt: '2099-01-01T00:01:00.000Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/fail') && method === 'POST') {
        failBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ job: { id: 'job-loop-cancel', status: 'failed', error: 'synthetic failure' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      const runner: InterruptibleJobRunner = {
        canRun: (s) => s.kind === 'lbm-d3q19',
        async run() {
          const err = new Error('job cancelled by host');
          err.name = 'AbortError';
          throw err;
        },
      };
      await runClaimLoop({
        client,
        agentId: 'agent-once-cancel',
        once: true,
        pollMs: 1,
        runners: [runner],
      });
      assert.ok(failBody);
      assert.match(String((failBody as { error: string }).error), /cancel/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('TaskApi residual post-e63: getJob ok + heartbeat 500 message + complete 500', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/j-ok') && method === 'GET') {
        return new Response(JSON.stringify({ job: { id: 'j-ok', status: 'queued' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/heartbeat') && method === 'POST') {
        return new Response('lease dead', { status: 500 });
      }
      if (url.includes('/complete') && method === 'POST') {
        return new Response('boom', { status: 500 });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      const got = await client.getJob('j-ok');
      assert.equal(got.job.id, 'j-ok');
      await assert.rejects(() => client.heartbeat('j1'), /heartbeat failed: 500/);
      await assert.rejects(
        () =>
          client.complete('j1', {
            schemaVersion: 1,
            summary: { steps: 1, wallTimeMs: 1 },
            backend: { id: 'cpu' },
          }, 0),
        /complete outcome unresolved/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('processJob residual post-e63: path-experiment loading heartbeat step 0', async () => {
    const heartbeats: Array<{ step?: number; message?: string }> = [];
    let completed = false;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async (_id: string, progress?: { step?: number; message?: string }) => {
        if (progress) heartbeats.push({ step: progress.step, message: progress.message });
        return { job: { id: 'job-load', leaseExpiresAt: '2099-01-01T00:00:00.000Z' } };
      },
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { job: { id: 'job-load', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } };
      },
      fail: async (_id: string, error = 'synthetic failure') => ({ jobId: _id, status: 'failed', error }),
    } as unknown as TaskApiClient;
    const smoke = buildSmokeJobSpec({ maxSteps: 2 });
    await processJob(
      client,
      {
        id: 'job-load',
        name: 'load-hb',
        status: 'leased',
              attempt: 0,
        spec: smoke,
      } as unknown as JobRecord,
      'agent-load',
    );
    assert.equal(completed, true);
    assert.ok(
      heartbeats.some((h) => h.step === 0 && /loading path experiment/i.test(h.message ?? '')),
      `expected loading heartbeat, got ${JSON.stringify(heartbeats)}`,
    );
  });

  /**
   * #7 residual after processJob unknown-kind: runner/validation throw must
   * terminal-fail the leased job (retryable=true) before rethrow — not leave
   * it stuck without complete/fail. Does not close #7 product AC.
   */
  it('processJob residual: runner throw → client.fail retryable true then throw (not complete)', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-runner-err', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    // Product path model with invalid params: dual-path local runner throws (no LBM/GPU).
    const job = {
      id: 'job-runner-err',
      name: 'path-bad-params',
      status: 'leased',
              attempt: 0,
      spec: {
        schemaVersion: 1,
        kind: 'path-experiment',
        parameters: {
          k_exc: 0.35,
          k_f: 2,
          k_isc: 3,
          k_T: 0.2,
          k_q: 1.5,
          k_d: 5,
          k_I: 0.3,
          O2: 1,
          substrate: 1,
          cTot: 1,
          dt: -1,
        },
        run: { maxSteps: 10, forceSampleEvery: 5 },
        experiment: {
          experimentId: 'bad-params',
          title: 'invalid dt',
          model: { id: 'photosensitization-rk4', version: '1.0.0' },
          materials: [],
          steps: [],
          parameters: {},
          provenance: {
            createdAt: '2026-08-02T00:00:00.000Z',
            software: { name: 'WaveWorld', version: '1' },
          },
        },
      },
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-runner-err'),
      /dt|positive|cannot be negative/i,
    );
    assert.equal(completed, false);
    assert.ok(failArgs, 'runner error must call client.fail');
    assert.match(failArgs!.error, /dt|positive|cannot be negative/i);
    assert.equal(failArgs!.retryable, true);
  });

  it('fail retryable classification residual: lease-lost false; other true', () => {
    assert.equal(isLeaseLostFailMessage(LEASE_LOST_MESSAGE), true);
    assert.equal(isLeaseLostFailMessage('lease lost: mid-run'), true);
    assert.equal(isLeaseLostFailMessage('solver crash'), false);
    assert.equal(failRetryableForMessage(LEASE_LOST_MESSAGE), false);
    assert.equal(failRetryableForMessage('no runner for kind'), true);
    assert.equal(retryableForHostFail(LEASE_LOST_MESSAGE), false);
    assert.equal(retryableForHostFail('operator cancel'), true);
    // Host adapter + processJob share one taxonomy (failRetryableForMessage).
    assert.equal(
      retryableForHostFail('lease lost: mid-run'),
      failRetryableForMessage('lease lost: mid-run'),
    );
    assert.equal(
      retryableForHostFail('implementation mismatch'),
      failRetryableForMessage('implementation mismatch'),
    );
  });

  /**
   * #7 residual after 060ff07 processJob/lease: terminal fail is best-effort —
   * fail-endpoint errors must not mask original product reason (unknown kind /
   * lease lost). Host adapter owns retryable taxonomy. Does not close #7 AC.
   */
  it('processJob residual: unknown-kind fail endpoint throw still surfaces no-runner', async () => {
    let completed = false;
    let failCalls = 0;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({ job: { id: 'job-unk-failthrow' } }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async () => {
        failCalls += 1;
        throw new Error('fail failed: 503 unavailable');
      },
    } as unknown as TaskApiClient;
    const job = {
      id: 'job-unk-failthrow',
      name: 'unknown-kind-failthrow',
      status: 'leased',
              attempt: 0,
      spec: {
        schemaVersion: 1,
        kind: 'unregistered-test-kind',
        parameters: {},
        run: { maxSteps: 1 },
        outputs: {},
      },
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-unk-ft'),
      /no runner/i,
    );
    assert.equal(completed, false);
    assert.equal(failCalls, 1, 'best-effort host.fail attempted once');
  });

  it('processJob residual: post-run lease null + fail throw still surfaces LEASE_LOST', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    let hb = 0;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async (_id: string, progress?: unknown) => {
        hb += 1;
        // Loading + progress heartbeats ok; the terminal renew (bare call,
        // no progress) rejects → lease lost after the runner completes.
        if (progress === undefined) throw new Error('heartbeat failed: 409 lease lost');
        return {
          job: { id: 'job-lease-failthrow', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
        };
      },
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        throw new Error('fail failed: 500 boom');
      },
    } as unknown as TaskApiClient;
    const smoke = buildSmokeJobSpec({ maxSteps: 2 });
    const job = {
      id: 'job-lease-failthrow',
      name: 'lease-failthrow',
      status: 'leased',
              attempt: 0,
      spec: smoke,
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-lease-ft'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, LEASE_LOST_MESSAGE);
        return true;
      },
    );
    assert.equal(completed, false);
    assert.equal(failArgs, undefined, 'confirmed lease loss must not issue a stale fail write');
  });

  it('processJob residual: runner throw lease-lost shaped → fail retryable false', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-runner-lease', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        throw new Error('lease lost: mid-run ownership revoked');
      },
    };
    const job = {
      id: 'job-runner-lease',
      name: 'runner-lease',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 2 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-rl', undefined, undefined, [runner]),
      /lease lost/i,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /lease lost/i);
    assert.equal(failArgs!.retryable, false);
  });

  it('processJob residual: assertCompleteResult fail → terminal fail retryable true (not complete)', async () => {
    // processJob (unlike bare guarded claim) rejects invalid complete payloads and
    // must terminal-fail so the lease is not stuck without complete/fail.
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-bad-result', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        // schemaVersion≠1 → assertCompleteResult throws AgentResultValidationError.
        return {
          schemaVersion: 99,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: 'fake', agentId: 'agent-bad' },
        } as never;
      },
    };
    const job = {
      id: 'job-bad-result',
      name: 'bad-result',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-bad', undefined, undefined, [runner]),
      /schemaVersion/i,
    );
    assert.equal(completed, false);
    assert.ok(failArgs, 'invalid result must client.fail via host adapter');
    assert.match(failArgs!.error, /schemaVersion/i);
    assert.equal(failArgs!.retryable, true);
  });

  // ── Residual unit matrix after 471a140 wave24 (wave25; not #7 close) ─────

  it('assertCompleteResult residual wave25: edge matrix (summary/history/backend)', () => {
    // Happy minimal + path-only history (step without Cd/Cl).
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 2, wallTimeMs: 3 },
      backend: { id: 'cpu' },
    });
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 1, wallTimeMs: 1, cd: 0.1, cl: -0.2 },
      history: { step: [0, 1], cd: [0.1, 0.2], cl: [0, -0.1] },
      backend: { id: 'cpu-lbm', agentId: 'a1' },
    });
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 2, wallTimeMs: 1 },
      history: { step: [0, 1] } as { step: number[]; cd: number[]; cl: number[] },
      backend: { id: 'cpu-path' },
    });

    const bad = (result: unknown, re: RegExp) => {
      assert.throws(
        () => assertCompleteResult(result as never),
        (err: unknown) => {
          assert.ok(err instanceof AgentResultValidationError);
          assert.match(err.message, re);
          return true;
        },
      );
    };
    bad({ schemaVersion: 0, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'x' } }, /schemaVersion/);
    bad({ schemaVersion: 1, backend: { id: 'x' } }, /summary required/);
    // Envelope error cannot settle as success (host validateJobResult parity).
    bad(
      { schemaVersion: 1, error: 'solver diverged', summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'x' } },
      /error message/,
    );
    bad(
      { schemaVersion: 1, summary: { steps: Number.NaN, wallTimeMs: 1 }, backend: { id: 'x' } },
      /summary\.steps/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: Number.POSITIVE_INFINITY },
        backend: { id: 'x' },
      },
      /wallTimeMs/,
    );
    bad(
      { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1, cd: Number.NaN }, backend: { id: 'x' } },
      /summary\.cd/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1 },
        history: { step: 'nope' },
        backend: { id: 'x' },
      },
      /history\.step array/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1 },
        history: { step: [0, Number.NaN] },
        backend: { id: 'x' },
      },
      /history\.step\[1\]/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1 },
        history: { step: [0], cd: [1, 2], cl: [0] },
        backend: { id: 'x' },
      },
      /length mismatch/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1 },
        history: { step: [0], cd: [1], cl: undefined },
        backend: { id: 'x' },
      },
      /history arrays required/,
    );
    bad(
      { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: {} },
      /backend\.id required/,
    );
    bad(
      { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: '' } },
      /backend\.id required/,
    );
    bad(
      { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 } },
      /backend\.id required/,
    );
  });

  it('processJob residual wave25: loading heartbeat fail → terminal fail (not stuck lease)', async () => {
    // wave25: path-experiment loading heartbeat is inside the runner/validation try so
    // 409/network on load best-effort fails the job (retryable taxonomy via host adapter).
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => {
        throw new Error('heartbeat failed: 409 lease lost');
      },
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const smoke = buildSmokeJobSpec({ maxSteps: 2 });
    const job = {
      id: 'job-load-fail',
      name: 'load-fail',
      status: 'leased',
              attempt: 0,
      spec: smoke,
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-load-fail'),
      /heartbeat failed: 409|lease lost/i,
    );
    assert.equal(completed, false);
    assert.ok(failArgs, 'loading heartbeat error must host.fail');
    assert.match(failArgs!.error, /lease lost/i);
    assert.equal(failArgs!.retryable, false, 'lease-lost shaped load fail is non-retryable');
  });

  it('processJob residual wave25: assertCompleteResult missing backend.id → fail retryable true', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-no-backend', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: '' },
        } as never;
      },
    };
    const job = {
      id: 'job-no-backend',
      name: 'no-backend',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-nb', undefined, undefined, [runner]),
      /not a member of requirements\.backends|backend\.id required/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    // Settlement boundary enforces requirements.backends ANY-OF first —
    // an empty backend.id under a cpu-required spec fails membership.
    assert.match(failArgs!.error, /not a member of requirements\.backends|backend\.id required/);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual wave25: history length mismatch → fail not complete', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-hist', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 2, wallTimeMs: 1, cd: 1, cl: 0 },
          history: { step: [0, 1], cd: [1], cl: [0, 0] },
          backend: { id: 'cpu' },
        } as never;
      },
    };
    const job = {
      id: 'job-hist',
      name: 'hist-mismatch',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 2 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-hist', undefined, undefined, [runner]),
      /length mismatch/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /length mismatch/);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual wave25: non-Error throw still terminal-fails then Error-wraps', async () => {
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-str-throw', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, result: unknown) => ({ jobId: _id, status: 'succeeded', result }),
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- residual matrix
        throw 'solver panic code 7';
      },
    };
    const job = {
      id: 'job-str-throw',
      name: 'str-throw',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-str', undefined, undefined, [runner]),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /solver panic code 7/);
        return true;
      },
    );
    assert.ok(failArgs);
    assert.match(failArgs!.error, /solver panic code 7/);
    assert.equal(failArgs!.retryable, true);
  });

  it('host-client residual wave25: renewLease null/empty leaseExpiresAt → soft deadline not null', async () => {
    const originalFetch = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async () => {
      n += 1;
      if (n === 1) {
        // Explicit null expiry — still held (soft deadline).
        return new Response(JSON.stringify({ job: { id: 'j1', leaseExpiresAt: null } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Empty string expiry — same soft path (not lease loss).
      return new Response(JSON.stringify({ job: { id: 'j1', leaseExpiresAt: '' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const before = Date.now();
      for (let i = 0; i < 2; i++) {
        const lease = await host.renewLease!('j1', 'a1');
        assert.ok(lease, `renew #${i + 1} must soft-hold, not null`);
        const exp = Date.parse(lease!);
        assert.ok(Number.isFinite(exp));
        assert.ok(exp >= before + 20_000 && exp <= before + 45_000);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lease taxonomy residual wave25: case/substring matrix shared host+processJob', () => {
    // Single taxonomy: isLeaseLostFailMessage ↔ failRetryableForMessage ↔ retryableForHostFail.
    // /lease lost/i is intentionally loose (substring); exact LEASE_LOST_MESSAGE is preferred.
    const cases: Array<{ msg: string; leaseLost: boolean }> = [
      { msg: LEASE_LOST_MESSAGE, leaseLost: true },
      { msg: 'lease lost: mid-run', leaseLost: true },
      { msg: 'LEASE LOST ownership revoked', leaseLost: true },
      { msg: 'heartbeat failed: 409 lease lost', leaseLost: true },
      { msg: 'operator cancel', leaseLost: false },
      { msg: 'connection lost', leaseLost: false },
      { msg: 'leaselost', leaseLost: false }, // no space between words
      { msg: 'lost lease reclaim', leaseLost: false }, // word order inverted
      { msg: 'implementation mismatch', leaseLost: false },
      { msg: '', leaseLost: false },
    ];
    for (const { msg, leaseLost } of cases) {
      assert.equal(isLeaseLostFailMessage(msg), leaseLost, `isLeaseLost(${JSON.stringify(msg)})`);
      assert.equal(failRetryableForMessage(msg), !leaseLost, `failRetryable(${JSON.stringify(msg)})`);
      assert.equal(retryableForHostFail(msg), !leaseLost, `retryableForHostFail(${JSON.stringify(msg)})`);
      assert.equal(
        retryableForHostFail(msg),
        failRetryableForMessage(msg),
        'host adapter must share failRetryableForMessage',
      );
    }
  });

  // ── Residual unit matrix after 620a0cc wave25 (wave26; not #7 close) ─────

  it('assertCompleteResult residual wave26: host-parity matrix (steps/id trim/agentId/history)', () => {
    // Zero steps is valid (host allows steps >= 0); non-empty id + optional agentId ok.
    // wave31: padded ids are rejected (trim-stable identity); success cells use bare tokens.
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 0, wallTimeMs: 0 },
      backend: { id: 'cpu' },
    });
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 1, wallTimeMs: 1, cl: 0 },
      history: { step: [0], cd: [0.1], cl: [0] },
      backend: { id: 'cpu-lbm', agentId: 'agent-1' },
    });

    const bad = (result: unknown, re: RegExp) => {
      assert.throws(
        () => assertCompleteResult(result as never),
        (err: unknown) => {
          assert.ok(err instanceof AgentResultValidationError);
          assert.match(err.message, re);
          return true;
        },
      );
    };
    bad(
      { schemaVersion: 1, summary: { steps: -1, wallTimeMs: 1 }, backend: { id: 'x' } },
      /steps must be >= 0/,
    );
    bad(
      { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: '   ' } },
      /backend\.id required/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1 },
        backend: { id: 'cpu', agentId: '' },
      },
      /backend\.agentId must be a non-empty string/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1 },
        backend: { id: 'cpu', agentId: '  \t' },
      },
      /backend\.agentId must be a non-empty string/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1, cl: Number.POSITIVE_INFINITY },
        backend: { id: 'x' },
      },
      /summary\.cl/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1 },
        history: { step: [0], cd: [Number.NaN], cl: [0] },
        backend: { id: 'x' },
      },
      /history\.cd\[0\]/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1 },
        history: { step: [Number.NEGATIVE_INFINITY], cd: [1], cl: [0] },
        backend: { id: 'x' },
      },
      /history\.step\[0\]/,
    );
  });

  it('host-client residual wave26: renewLease whitespace-only leaseExpiresAt → soft deadline', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ job: { id: 'j1', leaseExpiresAt: '   \t  ' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const before = Date.now();
      const lease = await host.renewLease!('j1', 'a1');
      assert.ok(lease, 'whitespace expiry must soft-hold, not null/lease-loss');
      const exp = Date.parse(lease!);
      assert.ok(Number.isFinite(exp));
      assert.ok(exp >= before + 20_000 && exp <= before + 45_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('processJob residual wave26: whitespace backend.id → fail retryable true (not complete)', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-ws-backend', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: '  \n' },
        } as never;
      },
    };
    const job = {
      id: 'job-ws-backend',
      name: 'ws-backend',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-ws', undefined, undefined, [runner]),
      /not a member of requirements\.backends|backend\.id required/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /not a member of requirements\.backends|backend\.id required/);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual wave26: negative summary.steps → fail not complete', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-neg-steps', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: -3, wallTimeMs: 1 },
          backend: { id: 'cpu' },
        } as never;
      },
    };
    const job = {
      id: 'job-neg-steps',
      name: 'neg-steps',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-neg', undefined, undefined, [runner]),
      /steps must be >= 0/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /steps must be >= 0/);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual wave26: validation fail + fail-endpoint throw still surfaces validation', async () => {
    // Best-effort host.fail must not mask assertCompleteResult reason (parity with
    // unknown-kind / lease-loss fail-throw cells).
    let completed = false;
    let failCalls = 0;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-val-ft', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async () => {
        failCalls += 1;
        throw new Error('fail failed: 503 unavailable');
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          history: { step: [0, 1], cd: [1], cl: [0, 0] },
          backend: { id: 'cpu' },
        } as never;
      },
    };
    const job = {
      id: 'job-val-ft',
      name: 'val-failthrow',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 2 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-val-ft', undefined, undefined, [runner]),
      /length mismatch/,
    );
    assert.equal(completed, false);
    assert.equal(failCalls, 1, 'best-effort host.fail attempted once');
  });

  it('processJob residual wave26: loading non-lease heartbeat fail → fail retryable true', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => {
        throw new Error('heartbeat failed: 503 service unavailable');
      },
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const job = {
      id: 'job-load-503',
      name: 'load-503',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 2 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-load-503'),
      /heartbeat failed: 503/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /503/);
    assert.equal(failArgs!.retryable, true, 'non-lease load fail stays retryable for peer reclaim');
  });

  it('processJob residual wave26: terminal renew soft (null expiry) still completes', async () => {
    // renewLease soft-hold path must not block complete when host accepts heartbeat
    // without a usable leaseExpiresAt (contrast: throw/null renew → lease_lost).
    let completed = false;
    let completeResult: unknown;
    let failCalled = false;
    let hb = 0;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => {
        hb += 1;
        // Loading heartbeat may carry expiry; terminal renew returns null expiry → soft.
        if (hb === 1) {
          return {
            job: { id: 'job-soft-term', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
          };
        }
        return { job: { id: 'job-soft-term', leaseExpiresAt: null } };
      },
      complete: async (_id: string, result: unknown) => {
        completed = true;
        completeResult = result;
        return { job: { id: 'job-soft-term', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } };
      },
      fail: async (_id: string, error = 'synthetic failure') => {
        failCalled = true;
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 2, wallTimeMs: 5 },
          backend: { id: 'cpu-path' },
        };
      },
    };
    const job = {
      id: 'job-soft-term',
      name: 'soft-term',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 2 }),
    } as unknown as JobRecord;
    await processJob(client, job, 'agent-soft', undefined, undefined, [runner]);
    assert.equal(completed, true);
    assert.equal(failCalled, false);
    assert.ok(completeResult);
    assert.equal((completeResult as { backend: { id: string } }).backend.id, 'cpu-path');
  });

  it('processJob residual wave26: empty backend.agentId → fail retryable true', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-empty-aid', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: 'cpu', agentId: '' },
        } as never;
      },
    };
    const job = {
      id: 'job-empty-aid',
      name: 'empty-aid',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-aid', undefined, undefined, [runner]),
      /backend\.agentId must be a non-empty string/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /backend\.agentId/);
    assert.equal(failArgs!.retryable, true);
  });

  // ── Residual unit matrix after wave26 tip 1b520ff (not #7 close) ──────────

  it('assertCompleteResult residual after-wave26: wallTimeMs>=0 + optional KPI finite', () => {
    assertCompleteResult({
      schemaVersion: 1,
      summary: {
        steps: 0,
        wallTimeMs: 0,
        dragN: 0,
        liftN: -0.1,
        reynoldsPhysical: 100,
        reynoldsLattice: 0.05,
        solidCells: 12,
      },
      backend: { id: 'cpu-lbm' },
    });

    const bad = (result: unknown, re: RegExp) => {
      assert.throws(
        () => assertCompleteResult(result as never),
        (err: unknown) => {
          assert.ok(err instanceof AgentResultValidationError);
          assert.match(err.message, re);
          return true;
        },
      );
    };
    bad(
      { schemaVersion: 1, summary: { steps: 1, wallTimeMs: -1 }, backend: { id: 'x' } },
      /wallTimeMs must be >= 0/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1, dragN: Number.NaN },
        backend: { id: 'x' },
      },
      /summary\.dragN/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1, liftN: Number.POSITIVE_INFINITY },
        backend: { id: 'x' },
      },
      /summary\.liftN/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1, reynoldsPhysical: Number.NaN },
        backend: { id: 'x' },
      },
      /summary\.reynoldsPhysical/,
    );
    bad(
      {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1, solidCells: Number.NEGATIVE_INFINITY },
        backend: { id: 'x' },
      },
      /summary\.solidCells/,
    );
  });

  it('host-client residual after-wave26: unparseable leaseExpiresAt → soft deadline (not trust garbage)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ job: { id: 'j-garbage', leaseExpiresAt: 'not-a-date' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const before = Date.now();
      const lease = await host.renewLease!('j-garbage', 'a1');
      assert.ok(lease, 'unparseable expiry must soft-hold, not null/lease-loss');
      assert.notEqual(lease, 'not-a-date');
      const exp = Date.parse(lease!);
      assert.ok(Number.isFinite(exp));
      assert.ok(exp >= before + 20_000 && exp <= before + 45_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host-client residual after-wave26: parseable trimmed leaseExpiresAt returned as-is', async () => {
    const originalFetch = globalThis.fetch;
    const iso = '2099-06-01T12:00:00.000Z';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ job: { id: 'j-iso', leaseExpiresAt: `  ${iso}  ` } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const lease = await host.renewLease!('j-iso', 'a1');
      assert.equal(lease, iso);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('processJob residual after-wave26: negative wallTimeMs → fail retryable true (not complete)', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-neg-wall', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: -5 },
          backend: { id: 'cpu' },
        } as never;
      },
    };
    const job = {
      id: 'job-neg-wall',
      name: 'neg-wall',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-neg-wall', undefined, undefined, [runner]),
      /wallTimeMs must be >= 0/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /wallTimeMs must be >= 0/);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual after-wave26: non-finite dragN → fail not complete', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-nan-drag', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 2, wallTimeMs: 3, dragN: Number.NaN, cd: 1 },
          backend: { id: 'cpu-lbm' },
        } as never;
      },
    };
    const job = {
      id: 'job-nan-drag',
      name: 'nan-drag',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 2 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-nan-drag', undefined, undefined, [runner]),
      /summary\.dragN/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /dragN/);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual after-wave26: terminal renew unparseable expiry still completes', async () => {
    // Soft-hold on garbage leaseExpiresAt must not block complete (contrast: throw → lease_lost).
    let completed = false;
    let failCalled = false;
    let hb = 0;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => {
        hb += 1;
        if (hb === 1) {
          return {
            job: { id: 'job-garbage-term', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
          };
        }
        return { job: { id: 'job-garbage-term', leaseExpiresAt: 'not-a-date' } };
      },
      complete: async () => {
        completed = true;
        return { job: { id: 'job-garbage-term', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } };
      },
      fail: async (_id: string, error = 'synthetic failure') => {
        failCalled = true;
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2, solidCells: 0 },
          backend: { id: 'cpu' },
        };
      },
    };
    const job = {
      id: 'job-garbage-term',
      name: 'garbage-term',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await processJob(client, job, 'agent-garbage', undefined, undefined, [runner]);
    assert.equal(completed, true);
    assert.equal(failCalled, false);
  });

  it('processJob residual after-wave26: loading heartbeat lease-lost → fail retryable false', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => {
        throw new Error('heartbeat failed: 409 lease lost');
      },
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const job = {
      id: 'job-load-lease',
      name: 'load-lease',
      status: 'leased',
              attempt: 0,
      // path-experiment triggers awaited loading heartbeat before runner.
      spec: {
        schemaVersion: 1,
        kind: 'path-experiment',
        parameters: {},
        run: { maxSteps: 2 },
        outputs: {},
        experiment: {
          experimentId: 'load-lease',
          title: 'load-lease',
          model: { id: 'path-replay', version: '1.0.0' },
          materials: [],
          steps: [],
          parameters: {},
          provenance: {
            createdAt: '2026-08-02T00:00:00.000Z',
            software: { name: 'WaveWorld', version: '1' },
          },
        },
      },
    } as unknown as JobRecord;
    // Use a no-op runner so loading heartbeat is the only failure mode.
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: 'cpu' },
        };
      },
    };
    await assert.rejects(
      () => processJob(client, job, 'agent-load-lease', undefined, undefined, [runner]),
      /lease lost/i,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /lease lost/i);
    assert.equal(failArgs!.retryable, false, 'lease-loss-shaped load fail is non-retryable');
  });

  // ── Residual unit matrix after wave26 tip bf96427 (wave27; not #7 close) ──

  it('lease taxonomy residual wave27: isAuthoritativeLeaseExpiresAt calendar-ISO matrix', () => {
    // Bare years / numbers parse in V8 but must not be authoritative host deadlines.
    const cases: Array<{ value: unknown; ok: boolean }> = [
      { value: '2099-01-01T00:00:00.000Z', ok: true },
      { value: '  2099-06-01T12:00:00.000Z  ', ok: true },
      { value: '2099-01-01', ok: true },
      { value: 'not-a-date', ok: false },
      { value: '2099', ok: false },
      { value: '1', ok: false },
      { value: '-1', ok: false },
      { value: 'Infinity', ok: false },
      { value: 'NaN', ok: false },
      { value: '', ok: false },
      { value: '   ', ok: false },
      { value: null, ok: false },
      { value: undefined, ok: false },
      { value: 1_735_689_600_000, ok: false }, // numeric epoch is not string ISO
      { value: true, ok: false },
    ];
    for (const { value, ok } of cases) {
      assert.equal(
        isAuthoritativeLeaseExpiresAt(value),
        ok,
        `isAuthoritativeLeaseExpiresAt(${JSON.stringify(value)})`,
      );
    }
  });

  it('host-client residual wave27: bare-year leaseExpiresAt → soft deadline (not trust V8 Date.parse)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ job: { id: 'j-year', leaseExpiresAt: '2099' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const before = Date.now();
      const lease = await host.renewLease!('j-year', 'a1');
      assert.ok(lease, 'bare year must soft-hold, not null/lease-loss');
      assert.notEqual(lease, '2099');
      const exp = Date.parse(lease!);
      assert.ok(Number.isFinite(exp));
      assert.ok(exp >= before + 20_000 && exp <= before + 45_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host-client residual wave27: numeric leaseExpiresAt type → soft deadline', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ job: { id: 'j-num', leaseExpiresAt: 1_735_689_600_000 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const before = Date.now();
      const lease = await host.renewLease!('j-num', 'a1');
      assert.ok(lease);
      assert.ok(typeof lease === 'string');
      const exp = Date.parse(lease!);
      assert.ok(exp >= before + 20_000 && exp <= before + 45_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('assertCompleteResult residual wave27: solidCells>=0 when present', () => {
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 1, wallTimeMs: 2, solidCells: 0 },
      backend: { id: 'cpu-lbm' },
    });
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2, solidCells: -1 },
          backend: { id: 'cpu-lbm' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /solidCells must be >= 0/);
        return true;
      },
    );
  });

  it('processJob residual wave27: negative solidCells → fail retryable true (not complete)', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-neg-cells', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 3, solidCells: -4 },
          backend: { id: 'cpu-lbm' },
        } as never;
      },
    };
    const job = {
      id: 'job-neg-cells',
      name: 'neg-cells',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-neg-cells', undefined, undefined, [runner]),
      /solidCells must be >= 0/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /solidCells must be >= 0/);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual wave27: terminal renew bare-year expiry still completes (soft-hold)', async () => {
    let completed = false;
    let failCalled = false;
    let hb = 0;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => {
        hb += 1;
        if (hb === 1) {
          return {
            job: { id: 'job-year-term', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
          };
        }
        // Terminal renew: V8-parseable bare year must soft-hold, not block complete.
        return { job: { id: 'job-year-term', leaseExpiresAt: '2099' } };
      },
      complete: async () => {
        completed = true;
        return { job: { id: 'job-year-term', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } };
      },
      fail: async (_id: string, error = 'synthetic failure') => {
        failCalled = true;
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2, solidCells: 0 },
          backend: { id: 'cpu' },
        };
      },
    };
    const job = {
      id: 'job-year-term',
      name: 'year-term',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await processJob(client, job, 'agent-year', undefined, undefined, [runner]);
    assert.equal(completed, true);
    assert.equal(failCalled, false);
  });

  it('lease taxonomy residual wave27: claim-loop failRetryable shared with host adapter', () => {
    // Pin wave27 matrix edges not covered by wave25 substring cases.
    const cases: Array<{ msg: string; leaseLost: boolean }> = [
      { msg: LEASE_LOST_MESSAGE, leaseLost: true },
      { msg: 'error: lease lost (stale)', leaseLost: true },
      { msg: 'Lease Lost', leaseLost: true },
      { msg: 'unable to interrupt: runner does not honor cancellation signal', leaseLost: false },
      { msg: 'result.summary.solidCells must be >= 0', leaseLost: false },
      { msg: 'lease  lost', leaseLost: false }, // double-space does not match /lease lost/i
      { msg: 'lease\tlost', leaseLost: false },
    ];
    for (const { msg, leaseLost } of cases) {
      assert.equal(isLeaseLostFailMessage(msg), leaseLost, `isLeaseLost(${JSON.stringify(msg)})`);
      assert.equal(failRetryableForMessage(msg), !leaseLost, `failRetryable(${JSON.stringify(msg)})`);
      assert.equal(retryableForHostFail(msg), !leaseLost, `retryableForHostFail(${JSON.stringify(msg)})`);
      assert.equal(
        retryableForHostFail(msg),
        failRetryableForMessage(msg),
        'host adapter must share failRetryableForMessage',
      );
    }
  });

  // ── Residual unit matrix after wave27 tip f761ae9 (wave28; not #7/#50 close) ──

  it('lease taxonomy residual wave28: isUsableLeaseDeadline clock-skew matrix', () => {
    const now = Date.parse('2026-08-07T12:00:00.000Z');
    // Far future calendar ISO is usable.
    assert.equal(
      isUsableLeaseDeadline('2099-01-01T00:00:00.000Z', now),
      true,
    );
    // Bare year is authoritative=false → unusable.
    assert.equal(isUsableLeaseDeadline('2099', now), false);
    // Past beyond skew → unusable even though calendar-ISO authoritative.
    const pastFar = new Date(now - LEASE_CLOCK_SKEW_MS - 60_000).toISOString();
    assert.equal(isAuthoritativeLeaseExpiresAt(pastFar), true);
    assert.equal(isUsableLeaseDeadline(pastFar, now), false);
    // Within skew window (agent slightly ahead of host) still usable.
    const pastWithinSkew = new Date(now - Math.floor(LEASE_CLOCK_SKEW_MS / 2)).toISOString();
    assert.equal(isUsableLeaseDeadline(pastWithinSkew, now), true);
    // Exactly at skew boundary is usable (exp >= now - skew).
    const atSkew = new Date(now - LEASE_CLOCK_SKEW_MS).toISOString();
    assert.equal(isUsableLeaseDeadline(atSkew, now), true);
    // Non-string / garbage remain unusable.
    assert.equal(isUsableLeaseDeadline(null, now), false);
    assert.equal(isUsableLeaseDeadline('not-a-date', now), false);
  });

  it('host-client residual wave28: past leaseExpiresAt → soft deadline (clock skew)', async () => {
    const originalFetch = globalThis.fetch;
    const pastIso = new Date(Date.now() - 120_000).toISOString();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ job: { id: 'j-past', leaseExpiresAt: pastIso } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const before = Date.now();
      const lease = await host.renewLease!('j-past', 'a1');
      assert.ok(lease, 'past calendar ISO must soft-hold, not null/lease-loss');
      assert.notEqual(lease, pastIso, 'must not advertise expired deadline as hold');
      const exp = Date.parse(lease!);
      assert.ok(Number.isFinite(exp));
      // Soft window = SOFT_LEASE_RENEW_MS with small slack for test runtime.
      assert.ok(exp >= before + SOFT_LEASE_RENEW_MS - 5_000);
      assert.ok(exp <= before + SOFT_LEASE_RENEW_MS + 5_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host-client residual wave28: future leaseExpiresAt still returned as-is', async () => {
    const originalFetch = globalThis.fetch;
    const futureIso = '2099-08-01T00:00:00.000Z';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ job: { id: 'j-future', leaseExpiresAt: `  ${futureIso}  ` } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const lease = await host.renewLease!('j-future', 'a1');
      assert.equal(lease, futureIso);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('assertCompleteResult residual wave28: history.step[i]>=0 + solidCells integer', () => {
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 2, wallTimeMs: 3, solidCells: 4 },
      history: { step: [0, 1], cd: [0.1, 0.2], cl: [0, 0.01] },
      backend: { id: 'cpu-lbm' },
    });
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          history: { step: [-1], cd: [0], cl: [0] },
          backend: { id: 'cpu' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /history\.step\[0\] must be >= 0/);
        return true;
      },
    );
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1, solidCells: 1.5 },
          backend: { id: 'cpu-lbm' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /solidCells must be an integer/);
        return true;
      },
    );
  });

  it('processJob residual wave28: negative history.step → fail retryable true (not complete)', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-neg-hist', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2 },
          history: { step: [-3], cd: [0.1], cl: [0] },
          backend: { id: 'cpu' },
        } as never;
      },
    };
    const job = {
      id: 'job-neg-hist',
      name: 'neg-hist',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-neg-hist', undefined, undefined, [runner]),
      /history\.step\[0\] must be >= 0/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /history\.step\[0\] must be >= 0/);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual wave28: terminal renew past expiry still completes (clock-skew soft-hold)', async () => {
    let completed = false;
    let failCalled = false;
    let hb = 0;
    const pastIso = new Date(Date.now() - 180_000).toISOString();
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => {
        hb += 1;
        if (hb === 1) {
          return {
            job: { id: 'job-past-term', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
          };
        }
        // Terminal renew: past calendar ISO must soft-hold, not block complete.
        return { job: { id: 'job-past-term', leaseExpiresAt: pastIso } };
      },
      complete: async () => {
        completed = true;
        return { job: { id: 'job-past-term', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } };
      },
      fail: async (_id: string, error = 'synthetic failure') => {
        failCalled = true;
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2, solidCells: 0 },
          backend: { id: 'cpu' },
        };
      },
    };
    const job = {
      id: 'job-past-term',
      name: 'past-term',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await processJob(client, job, 'agent-past', undefined, undefined, [runner]);
    assert.equal(completed, true);
    assert.equal(failCalled, false);
  });

  it('lease taxonomy residual wave28: failRetryable expand edges (still shared adapter)', () => {
    // Wave28 pins extra claim-loop fail taxonomy edges; lease-loss remains non-retryable only.
    const cases: Array<{ msg: string; leaseLost: boolean }> = [
      { msg: LEASE_LOST_MESSAGE, leaseLost: true },
      { msg: 'LEASE LOST mid heartbeat', leaseLost: true },
      { msg: 'result.history.step[0] must be >= 0', leaseLost: false },
      { msg: 'result.summary.solidCells must be an integer', leaseLost: false },
      { msg: 'complete failed: 409', leaseLost: false },
      { msg: 'heartbeat failed: 503', leaseLost: false },
      { msg: 'lease-lost-token', leaseLost: false }, // hyphenated, no space — not /lease lost/
    ];
    for (const { msg, leaseLost } of cases) {
      assert.equal(isLeaseLostFailMessage(msg), leaseLost, `isLeaseLost(${JSON.stringify(msg)})`);
      assert.equal(failRetryableForMessage(msg), !leaseLost, `failRetryable(${JSON.stringify(msg)})`);
      assert.equal(retryableForHostFail(msg), !leaseLost, `retryableForHostFail(${JSON.stringify(msg)})`);
      assert.equal(
        retryableForHostFail(msg),
        failRetryableForMessage(msg),
        'host adapter must share failRetryableForMessage',
      );
    }
  });

  // ── Residual unit matrix after wave28 tip c53b29e (wave29; not #7/#50 close) ──

  it('lease taxonomy residual wave29: invalid calendar date not authoritative (rollover garbage)', () => {
    // Date.parse("2026-02-30…") rolls to Mar 2 — must soft-hold, not advertise as host deadline.
    assert.equal(isRealCalendarDatePrefix('2026-02-30T00:00:00.000Z'), false);
    assert.equal(isAuthoritativeLeaseExpiresAt('2026-02-30T00:00:00.000Z'), false);
    assert.equal(isUsableLeaseDeadline('2026-02-30T00:00:00.000Z'), false);
    assert.equal(isRealCalendarDatePrefix('2026-04-31T12:00:00.000Z'), false);
    assert.equal(isAuthoritativeLeaseExpiresAt('2026-04-31T12:00:00.000Z'), false);
    // Non-leap Feb 29.
    assert.equal(isRealCalendarDatePrefix('2025-02-29T00:00:00.000Z'), false);
    assert.equal(isAuthoritativeLeaseExpiresAt('2025-02-29T00:00:00.000Z'), false);
    // Valid calendar days still authoritative when parseable.
    assert.equal(isRealCalendarDatePrefix('2024-02-29T00:00:00.000Z'), true);
    assert.equal(isAuthoritativeLeaseExpiresAt('2099-01-01T00:00:00.000Z'), true);
    assert.equal(isAuthoritativeLeaseExpiresAt('2026-08-07'), true);
    // Bare year / garbage remain non-authoritative.
    assert.equal(isAuthoritativeLeaseExpiresAt('2099'), false);
    assert.equal(isAuthoritativeLeaseExpiresAt('not-a-date'), false);
  });

  it('host-client residual wave29: invalid calendar leaseExpiresAt → soft deadline', async () => {
    const originalFetch = globalThis.fetch;
    const garbageIso = '2026-02-30T00:00:00.000Z'; // Date.parse-able but not a real day
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ job: { id: 'j-feb30', leaseExpiresAt: garbageIso } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const before = Date.now();
      const lease = await host.renewLease!('j-feb30', 'a1');
      assert.ok(lease, 'invalid calendar ISO must soft-hold, not null/lease-loss');
      assert.notEqual(lease, garbageIso, 'must not advertise rollover garbage as hold');
      const exp = Date.parse(lease!);
      assert.ok(Number.isFinite(exp));
      assert.ok(exp >= before + SOFT_LEASE_RENEW_MS - 5_000);
      assert.ok(exp <= before + SOFT_LEASE_RENEW_MS + 5_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('assertCompleteResult residual wave29: steps integer + history.step integer/non-decreasing', () => {
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 3, wallTimeMs: 4, solidCells: 2 },
      history: { step: [0, 1, 1, 3], cd: [0.1, 0.2, 0.2, 0.15], cl: [0, 0, 0.01, 0] },
      backend: { id: 'cpu-lbm' },
    });
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1.5, wallTimeMs: 1 },
          backend: { id: 'cpu' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /summary\.steps must be an integer/);
        return true;
      },
    );
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          history: { step: [0.5], cd: [0], cl: [0] },
          backend: { id: 'cpu' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /history\.step\[0\] must be an integer/);
        return true;
      },
    );
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 2, wallTimeMs: 1 },
          history: { step: [2, 1], cd: [0.1, 0.2], cl: [0, 0] },
          backend: { id: 'cpu' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /history\.step must be non-decreasing/);
        return true;
      },
    );
  });

  it('processJob residual wave29: non-decreasing history.step fail → retryable true', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-hist-mono', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          // steps high enough that only non-decreasing fails (wave30 bound residual
          // would otherwise catch step[0]=5 > summary.steps=2 first).
          summary: { steps: 5, wallTimeMs: 2 },
          history: { step: [5, 3], cd: [0.1, 0.2], cl: [0, 0] },
          backend: { id: 'cpu' },
        } as never;
      },
    };
    const job = {
      id: 'job-hist-mono',
      name: 'hist-mono',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 2 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-hist-mono', undefined, undefined, [runner]),
      /history\.step must be non-decreasing/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /history\.step must be non-decreasing/);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual wave29: terminal renew invalid calendar still completes (soft-hold)', async () => {
    let completed = false;
    let failCalled = false;
    let hb = 0;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => {
        hb += 1;
        if (hb === 1) {
          return {
            job: { id: 'job-cal-term', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
          };
        }
        // Terminal renew: Date.parse rollover garbage must soft-hold, not block complete.
        return { job: { id: 'job-cal-term', leaseExpiresAt: '2026-02-30T00:00:00.000Z' } };
      },
      complete: async () => {
        completed = true;
        return { job: { id: 'job-cal-term', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } };
      },
      fail: async (_id: string, error = 'synthetic failure') => {
        failCalled = true;
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2, solidCells: 0 },
          backend: { id: 'cpu' },
        };
      },
    };
    const job = {
      id: 'job-cal-term',
      name: 'cal-term',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await processJob(client, job, 'agent-cal', undefined, undefined, [runner]);
    assert.equal(completed, true);
    assert.equal(failCalled, false);
  });

  it('lease taxonomy residual wave29: failRetryable expand edges (still shared adapter)', () => {
    const cases: Array<{ msg: string; leaseLost: boolean }> = [
      { msg: LEASE_LOST_MESSAGE, leaseLost: true },
      { msg: 'result.summary.steps must be an integer', leaseLost: false },
      { msg: 'result.history.step[0] must be an integer', leaseLost: false },
      { msg: 'result.history.step must be non-decreasing (step[1] < step[0])', leaseLost: false },
      { msg: 'lease lost: refusing stale terminal publish', leaseLost: true },
    ];
    for (const { msg, leaseLost } of cases) {
      assert.equal(isLeaseLostFailMessage(msg), leaseLost, `isLeaseLost(${JSON.stringify(msg)})`);
      assert.equal(failRetryableForMessage(msg), !leaseLost, `failRetryable(${JSON.stringify(msg)})`);
      assert.equal(retryableForHostFail(msg), !leaseLost, `retryableForHostFail(${JSON.stringify(msg)})`);
      assert.equal(
        retryableForHostFail(msg),
        failRetryableForMessage(msg),
        'host adapter must share failRetryableForMessage',
      );
    }
  });

  // ── Residual unit matrix after wave29 tip 314ddb2 (wave30; not #7/#50 close) ──

  it('lease taxonomy residual wave30: space/SQL datetime not authoritative (ISO shape)', () => {
    // Date.parse accepts "YYYY-MM-DD HH:MM:SS" — must soft-hold, not host ISO authority.
    assert.equal(hasIsoDateTimeShape('2026-01-01T12:00:00.000Z'), true);
    assert.equal(hasIsoDateTimeShape('2026-01-01'), true);
    assert.equal(hasIsoDateTimeShape('2026-01-01 12:00:00'), false);
    assert.equal(hasIsoDateTimeShape('2026-01-01t12:00:00.000z'), true);
    assert.equal(isAuthoritativeLeaseExpiresAt('2026-01-01 12:00:00'), false);
    assert.equal(isUsableLeaseDeadline('2026-01-01 12:00:00'), false);
    // Real ISO still authoritative when parseable.
    assert.equal(isAuthoritativeLeaseExpiresAt('2099-01-01T00:00:00.000Z'), true);
    assert.equal(isAuthoritativeLeaseExpiresAt('2026-08-07'), true);
    // Calendar garbage + space form both non-authoritative.
    assert.equal(isAuthoritativeLeaseExpiresAt('2026-02-30 00:00:00'), false);
    assert.equal(isAuthoritativeLeaseExpiresAt('2099'), false);
  });

  it('host-client residual wave30: space datetime leaseExpiresAt → soft deadline', async () => {
    const originalFetch = globalThis.fetch;
    const spaceIso = '2099-01-01 00:00:00';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ job: { id: 'j-space', leaseExpiresAt: spaceIso } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const before = Date.now();
      const lease = await host.renewLease!('j-space', 'a1');
      assert.ok(lease, 'space/SQL datetime must soft-hold, not null/lease-loss');
      assert.notEqual(lease, spaceIso, 'must not advertise non-ISO separator as hold');
      const exp = Date.parse(lease!);
      assert.ok(Number.isFinite(exp));
      assert.ok(exp >= before + SOFT_LEASE_RENEW_MS - 5_000);
      assert.ok(exp <= before + SOFT_LEASE_RENEW_MS + 5_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host-client residual wave30: claim omits unusable leaseExpiresAt (garbage/past/space)', async () => {
    const originalFetch = globalThis.fetch;
    const payloads = [
      { id: 'j-claim-feb30', leaseExpiresAt: '2026-02-30T00:00:00.000Z' },
      { id: 'j-claim-space', leaseExpiresAt: '2099-06-01 12:00:00' },
      { id: 'j-claim-past', leaseExpiresAt: '2000-01-01T00:00:00.000Z' },
      { id: 'j-claim-empty', leaseExpiresAt: '   ' },
      { id: 'j-claim-ok', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const p = payloads[i++]!;
      return new Response(
        JSON.stringify({
          job: {
            id: p.id,
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
            leaseExpiresAt: p.leaseExpiresAt,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      for (const p of payloads.slice(0, 4)) {
        const claimed = await host.claim('agent-wave30');
        assert.ok(claimed);
        assert.equal(claimed!.jobId, p.id);
        assert.equal(
          claimed!.leaseExpiresAt,
          undefined,
          `${p.id} unusable expiry must not be advertised`,
        );
      }
      const ok = await host.claim('agent-wave30');
      assert.ok(ok);
      assert.equal(ok!.jobId, 'j-claim-ok');
      assert.equal(ok!.leaseExpiresAt, '2099-01-01T00:00:00.000Z');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('assertCompleteResult residual wave30: history.step[i] <= summary.steps', () => {
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 3, wallTimeMs: 4 },
      history: { step: [0, 1, 3], cd: [0.1, 0.2, 0.15], cl: [0, 0, 0] },
      backend: { id: 'cpu-lbm' },
    });
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 2, wallTimeMs: 1 },
          history: { step: [0, 1, 5], cd: [0.1, 0.2, 0.3], cl: [0, 0, 0] },
          backend: { id: 'cpu' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /history\.step\[2\] must be <= summary\.steps/);
        return true;
      },
    );
  });

  it('processJob residual wave30: history.step > summary.steps → fail retryable true', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-hist-bound', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 2, wallTimeMs: 2 },
          history: { step: [0, 9], cd: [0.1, 0.2], cl: [0, 0] },
          backend: { id: 'cpu' },
        } as never;
      },
    };
    const job = {
      id: 'job-hist-bound',
      name: 'hist-bound',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 2 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-hist-bound', undefined, undefined, [runner]),
      /history\.step\[1\] must be <= summary\.steps/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /history\.step\[1\] must be <= summary\.steps/);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual wave30: terminal renew space datetime still completes (soft-hold)', async () => {
    let completed = false;
    let failCalled = false;
    let hb = 0;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => {
        hb += 1;
        if (hb === 1) {
          return {
            job: { id: 'job-space-term', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
          };
        }
        // Terminal renew: Date.parse-accepted space form must soft-hold, not block complete.
        return { job: { id: 'job-space-term', leaseExpiresAt: '2099-01-01 00:00:00' } };
      },
      complete: async () => {
        completed = true;
        return { job: { id: 'job-space-term', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } };
      },
      fail: async (_id: string, error = 'synthetic failure') => {
        failCalled = true;
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2, solidCells: 0 },
          backend: { id: 'cpu' },
        };
      },
    };
    const job = {
      id: 'job-space-term',
      name: 'space-term',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await processJob(client, job, 'agent-space', undefined, undefined, [runner]);
    assert.equal(completed, true);
    assert.equal(failCalled, false);
  });

  it('lease taxonomy residual wave30: failRetryable expand edges (still shared adapter)', () => {
    const cases: Array<{ msg: string; leaseLost: boolean }> = [
      { msg: LEASE_LOST_MESSAGE, leaseLost: true },
      { msg: 'result.history.step[2] must be <= summary.steps', leaseLost: false },
      { msg: 'result.summary.steps must be an integer', leaseLost: false },
      { msg: 'lease lost: refusing stale terminal publish', leaseLost: true },
      { msg: 'heartbeat failed: 503', leaseLost: false },
    ];
    for (const { msg, leaseLost } of cases) {
      assert.equal(isLeaseLostFailMessage(msg), leaseLost, `isLeaseLost(${JSON.stringify(msg)})`);
      assert.equal(failRetryableForMessage(msg), !leaseLost, `failRetryable(${JSON.stringify(msg)})`);
      assert.equal(retryableForHostFail(msg), !leaseLost, `retryableForHostFail(${JSON.stringify(msg)})`);
      assert.equal(
        retryableForHostFail(msg),
        failRetryableForMessage(msg),
        'host adapter must share failRetryableForMessage',
      );
    }
  });

  // ── Residual unit matrix after wave30 tip a050db8 (wave31; not #7/#50 close) ──

  it('lease taxonomy residual wave31: zone-naive + T24 not authoritative (portable ISO)', () => {
    // Date.parse accepts timezone-naive local datetimes — not portable host authority.
    assert.equal(hasIsoDateTimeShape('2099-01-01T00:00:00'), false);
    assert.equal(hasIsoDateTimeShape('2099-01-01T00:00:00.000'), false);
    assert.equal(isAuthoritativeLeaseExpiresAt('2099-01-01T00:00:00'), false);
    assert.equal(isUsableLeaseDeadline('2099-01-01T00:00:00.000'), false);
    // T24:00:00 Date.parse rolls to next day — reject as clock garbage.
    assert.equal(hasIsoDateTimeShape('2026-01-01T24:00:00.000Z'), false);
    assert.equal(isAuthoritativeLeaseExpiresAt('2026-01-01T24:00:00.000Z'), false);
    // Explicit zone + real clock still authoritative.
    assert.equal(hasIsoDateTimeShape('2099-01-01T00:00:00.000Z'), true);
    assert.equal(hasIsoDateTimeShape('2099-01-01T00:00:00+00:00'), true);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00.000+0000'), true);
    assert.equal(hasIsoDateTimeShape('2026-01-01t12:00:00.000z'), true);
    assert.equal(isAuthoritativeLeaseExpiresAt('2099-01-01T00:00:00.000Z'), true);
    assert.equal(isAuthoritativeLeaseExpiresAt('2099-01-01T00:00:00+00:00'), true);
    // Date-only remains authoritative (ES UTC midnight).
    assert.equal(hasIsoDateTimeShape('2026-08-07'), true);
    assert.equal(isAuthoritativeLeaseExpiresAt('2026-08-07'), true);
    // Space/SQL + calendar garbage stay non-authoritative (wave29/30).
    assert.equal(isAuthoritativeLeaseExpiresAt('2099-01-01 00:00:00'), false);
    assert.equal(isAuthoritativeLeaseExpiresAt('2026-02-30T00:00:00.000Z'), false);
  });

  it('host-client residual wave31: zone-naive leaseExpiresAt → soft deadline', async () => {
    const originalFetch = globalThis.fetch;
    const naiveIso = '2099-01-01T00:00:00.000';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ job: { id: 'j-naive', leaseExpiresAt: naiveIso } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const before = Date.now();
      const lease = await host.renewLease!('j-naive', 'a1');
      assert.ok(lease, 'zone-naive datetime must soft-hold, not null/lease-loss');
      assert.notEqual(lease, naiveIso, 'must not advertise zone-naive local as hold');
      const exp = Date.parse(lease!);
      assert.ok(Number.isFinite(exp));
      assert.ok(exp >= before + SOFT_LEASE_RENEW_MS - 5_000);
      assert.ok(exp <= before + SOFT_LEASE_RENEW_MS + 5_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host-client residual wave31: T24 clock rollover leaseExpiresAt → soft deadline', async () => {
    const originalFetch = globalThis.fetch;
    const t24 = '2099-01-01T24:00:00.000Z';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ job: { id: 'j-t24', leaseExpiresAt: t24 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const before = Date.now();
      const lease = await host.renewLease!('j-t24', 'a1');
      assert.ok(lease, 'T24 rollover must soft-hold, not null/lease-loss');
      assert.notEqual(lease, t24, 'must not advertise T24 clock garbage as hold');
      const exp = Date.parse(lease!);
      assert.ok(Number.isFinite(exp));
      assert.ok(exp >= before + SOFT_LEASE_RENEW_MS - 5_000);
      assert.ok(exp <= before + SOFT_LEASE_RENEW_MS + 5_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host-client residual wave31: claim omits zone-naive / T24 leaseExpiresAt', async () => {
    const originalFetch = globalThis.fetch;
    const payloads = [
      { id: 'j-claim-naive', leaseExpiresAt: '2099-06-01T12:00:00' },
      { id: 'j-claim-t24', leaseExpiresAt: '2099-06-01T24:00:00.000Z' },
      { id: 'j-claim-offset-ok', leaseExpiresAt: '2099-06-01T12:00:00+00:00' },
      { id: 'j-claim-z-ok', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const p = payloads[i++]!;
      return new Response(
        JSON.stringify({
          job: {
            id: p.id,
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
            leaseExpiresAt: p.leaseExpiresAt,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const naive = await host.claim('agent-wave31');
      assert.ok(naive);
      assert.equal(naive!.jobId, 'j-claim-naive');
      assert.equal(naive!.leaseExpiresAt, undefined, 'zone-naive must not be advertised');
      const t24 = await host.claim('agent-wave31');
      assert.ok(t24);
      assert.equal(t24!.jobId, 'j-claim-t24');
      assert.equal(t24!.leaseExpiresAt, undefined, 'T24 must not be advertised');
      const offsetOk = await host.claim('agent-wave31');
      assert.ok(offsetOk);
      assert.equal(offsetOk!.jobId, 'j-claim-offset-ok');
      assert.equal(offsetOk!.leaseExpiresAt, '2099-06-01T12:00:00+00:00');
      const zOk = await host.claim('agent-wave31');
      assert.ok(zOk);
      assert.equal(zOk!.jobId, 'j-claim-z-ok');
      assert.equal(zOk!.leaseExpiresAt, '2099-01-01T00:00:00.000Z');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('assertCompleteResult residual wave31: backend.id/agentId trim-stable (no padding)', () => {
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 1, wallTimeMs: 1 },
      backend: { id: 'cpu', agentId: 'agent-1' },
    });
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: '  cpu  ' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /backend\.id must not have leading\/trailing whitespace/);
        return true;
      },
    );
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: 'cpu', agentId: ' agent-1 ' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /backend\.agentId must not have leading\/trailing whitespace/);
        return true;
      },
    );
  });

  it('processJob residual wave31: padded backend.id → fail retryable true', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-pad-id', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2 },
          backend: { id: ' cpu ' },
        } as never;
      },
    };
    const job = {
      id: 'job-pad-id',
      name: 'pad-id',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-pad-id', undefined, undefined, [runner]),
      /not a member of requirements\.backends|backend\.id must not have leading\/trailing whitespace/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /not a member of requirements\.backends|backend\.id must not have leading\/trailing whitespace/);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual wave31: terminal renew zone-naive still completes (soft-hold)', async () => {
    let completed = false;
    let failCalled = false;
    let hb = 0;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => {
        hb += 1;
        if (hb === 1) {
          return {
            job: { id: 'job-naive-term', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
          };
        }
        // Terminal renew: zone-naive Date.parse form must soft-hold, not block complete.
        return { job: { id: 'job-naive-term', leaseExpiresAt: '2099-01-01T00:00:00.000' } };
      },
      complete: async () => {
        completed = true;
        return { job: { id: 'job-naive-term', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } };
      },
      fail: async (_id: string, error = 'synthetic failure') => {
        failCalled = true;
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2, solidCells: 0 },
          backend: { id: 'cpu' },
        };
      },
    };
    const job = {
      id: 'job-naive-term',
      name: 'naive-term',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await processJob(client, job, 'agent-naive', undefined, undefined, [runner]);
    assert.equal(completed, true);
    assert.equal(failCalled, false);
  });

  it('lease taxonomy residual wave31: failRetryable expand edges (still shared adapter)', () => {
    const cases: Array<{ msg: string; leaseLost: boolean }> = [
      { msg: LEASE_LOST_MESSAGE, leaseLost: true },
      { msg: 'result.backend.id must not have leading/trailing whitespace', leaseLost: false },
      { msg: 'result.backend.agentId must not have leading/trailing whitespace', leaseLost: false },
      { msg: 'result.history.step[2] must be <= summary.steps', leaseLost: false },
      { msg: 'lease lost: refusing stale terminal publish', leaseLost: true },
      { msg: 'heartbeat failed: 503', leaseLost: false },
    ];
    for (const { msg, leaseLost } of cases) {
      assert.equal(isLeaseLostFailMessage(msg), leaseLost, `isLeaseLost(${JSON.stringify(msg)})`);
      assert.equal(failRetryableForMessage(msg), !leaseLost, `failRetryable(${JSON.stringify(msg)})`);
      assert.equal(retryableForHostFail(msg), !leaseLost, `retryableForHostFail(${JSON.stringify(msg)})`);
      assert.equal(
        retryableForHostFail(msg),
        failRetryableForMessage(msg),
        'host adapter must share failRetryableForMessage',
      );
    }
  });

  // ── Residual unit matrix after wave31 tip 05ff814 (wave32; not #7/#50 close) ──

  it('lease taxonomy residual wave32: leap-second + bad/fractional zone offsets soft-hold', () => {
    // Leap-second :60 is not a portable host deadline (wave32).
    assert.equal(hasIsoDateTimeShape('2026-12-31T23:59:60.000Z'), false);
    assert.equal(isAuthoritativeLeaseExpiresAt('2026-12-31T23:59:60.000Z'), false);
    assert.equal(isUsableLeaseDeadline('2026-12-31T23:59:60.000Z'), false);

    // Impossible zone offsets must soft-hold without relying on Date.parse alone.
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+25:00'), false);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+00:60'), false);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+99:99'), false);
    assert.equal(isUsableLeaseDeadline('2099-01-01T12:00:00+25:00'), false);
    assert.equal(isUsableLeaseDeadline('2099-01-01T12:00:00+00:60'), false);

    // Fractional-second / second-resolution zone suffixes are non-portable.
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+00:00.5'), false);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+00:00:00'), false);
    assert.equal(isUsableLeaseDeadline('2099-01-01T12:00:00+00:00.5'), false);

    // Whole-minute portable offsets still authoritative.
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+05:30'), true);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00-14:00'), true);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+0530'), true);
    assert.equal(isAuthoritativeLeaseExpiresAt('2099-01-01T12:00:00+05:30'), true);
  });

  it('lease taxonomy residual wave32: dual clock-skew × zone-naive matrix completeness', () => {
    const now = Date.now();
    const futureZ = new Date(now + 60_000).toISOString();
    const pastWithinSkewZ = new Date(now - (LEASE_CLOCK_SKEW_MS - 500)).toISOString();
    const pastBeyondSkewZ = new Date(now - (LEASE_CLOCK_SKEW_MS + 5_000)).toISOString();
    // Strip zone → timezone-naive local form Date.parse still often accepts.
    const stripZone = (iso: string) => iso.replace(/[Zz]|[+-]\d{2}:?\d{2}$/, '');

    // Authoritative Z / offset futures remain usable; past-beyond-skew soft-holds.
    assert.equal(isUsableLeaseDeadline(futureZ, now), true);
    assert.equal(isUsableLeaseDeadline(pastWithinSkewZ, now), true);
    assert.equal(isUsableLeaseDeadline(pastBeyondSkewZ, now), false);

    // Zone-naive counterparts are never usable, independent of skew window.
    assert.equal(isAuthoritativeLeaseExpiresAt(stripZone(futureZ)), false);
    assert.equal(isUsableLeaseDeadline(stripZone(futureZ), now), false);
    assert.equal(isUsableLeaseDeadline(stripZone(pastWithinSkewZ), now), false);
    assert.equal(isUsableLeaseDeadline(stripZone(pastBeyondSkewZ), now), false);

    // Empty/whitespace + leap-second + bad offset remain non-usable under any now.
    assert.equal(isUsableLeaseDeadline('', now), false);
    assert.equal(isUsableLeaseDeadline('   ', now), false);
    assert.equal(isUsableLeaseDeadline(null, now), false);
    assert.equal(isUsableLeaseDeadline('2026-12-31T23:59:60.000Z', now), false);
    assert.equal(isUsableLeaseDeadline('2099-01-01T12:00:00+25:00', now), false);
  });

  it('host-client residual wave32: leap-second / bad-offset leaseExpiresAt → soft deadline', async () => {
    const originalFetch = globalThis.fetch;
    const payloads = [
      '2026-12-31T23:59:60.000Z',
      '2099-01-01T12:00:00+25:00',
      '2099-01-01T12:00:00+00:00.5',
    ];
    let i = 0;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ job: { id: `j-w32-${i}`, leaseExpiresAt: payloads[i++]! } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      for (const raw of payloads) {
        const before = Date.now();
        const lease = await host.renewLease!('j-w32', 'a1');
        assert.ok(lease, `${raw} must soft-hold, not null/lease-loss`);
        assert.notEqual(lease, raw, `must not advertise ${raw} as hold`);
        const exp = Date.parse(lease!);
        assert.ok(Number.isFinite(exp));
        assert.ok(exp >= before + SOFT_LEASE_RENEW_MS - 5_000);
        assert.ok(exp <= before + SOFT_LEASE_RENEW_MS + 5_000);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host-client residual wave32: claim omits leap/bad-offset lease + trims jobId', async () => {
    const originalFetch = globalThis.fetch;
    const payloads = [
      { id: '  j-claim-leap  ', leaseExpiresAt: '2026-12-31T23:59:60.000Z' },
      { id: 'j-claim-bad-off', leaseExpiresAt: '2099-01-01T12:00:00+25:00' },
      { id: '  j-claim-ok  ', leaseExpiresAt: '2099-06-01T12:00:00+05:30' },
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const p = payloads[i++]!;
      return new Response(
        JSON.stringify({
          job: {
            id: p.id,
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
            leaseExpiresAt: p.leaseExpiresAt,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const leap = await host.claim('agent-wave32');
      assert.ok(leap);
      assert.equal(leap!.jobId, 'j-claim-leap', 'jobId must be trim-stable');
      assert.equal(leap!.leaseExpiresAt, undefined, 'leap-second must not be advertised');
      const badOff = await host.claim('agent-wave32');
      assert.ok(badOff);
      assert.equal(badOff!.jobId, 'j-claim-bad-off');
      assert.equal(badOff!.leaseExpiresAt, undefined, 'impossible offset must not be advertised');
      const ok = await host.claim('agent-wave32');
      assert.ok(ok);
      assert.equal(ok!.jobId, 'j-claim-ok', 'padded job id trimmed');
      assert.equal(ok!.leaseExpiresAt, '2099-06-01T12:00:00+05:30');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('assertCompleteResult residual wave32: backend.id/agentId length clamp', () => {
    const long = 'a'.repeat(MAX_BACKEND_IDENTITY_LEN + 1);
    const atMax = 'b'.repeat(MAX_BACKEND_IDENTITY_LEN);
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 1, wallTimeMs: 1 },
      backend: { id: atMax, agentId: atMax },
    });
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: long },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /backend\.id must be <= 128 characters/);
        return true;
      },
    );
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: 'cpu', agentId: long },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /backend\.agentId must be <= 128 characters/);
        return true;
      },
    );
  });

  it('processJob residual wave32: overlong agentId → fail retryable true', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-long-agent', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2 },
          backend: { id: 'cpu', agentId: 'x'.repeat(MAX_BACKEND_IDENTITY_LEN + 1) },
        } as never;
      },
    };
    const job = {
      id: 'job-long-agent',
      name: 'long-agent',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-long', undefined, undefined, [runner]),
      /backend\.agentId must be <= 128 characters/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /backend\.agentId must be <= 128 characters/);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual wave32: terminal renew leap-second still completes (soft-hold)', async () => {
    let completed = false;
    let failCalled = false;
    let hb = 0;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => {
        hb += 1;
        if (hb === 1) {
          return {
            job: { id: 'job-leap-term', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
          };
        }
        // Terminal renew: leap-second form must soft-hold, not block complete.
        return { job: { id: 'job-leap-term', leaseExpiresAt: '2026-12-31T23:59:60.000Z' } };
      },
      complete: async () => {
        completed = true;
        return { job: { id: 'job-leap-term', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } };
      },
      fail: async (_id: string, error = 'synthetic failure') => {
        failCalled = true;
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2, solidCells: 0 },
          backend: { id: 'cpu' },
        };
      },
    };
    const job = {
      id: 'job-leap-term',
      name: 'leap-term',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await processJob(client, job, 'agent-leap', undefined, undefined, [runner]);
    assert.equal(completed, true);
    assert.equal(failCalled, false);
  });

  // ── Residual unit matrix after wave32 tip c0542b3 (wave33; not #7/#50 close) ──

  it('lease taxonomy residual wave33: non-civil zone offsets beyond ±14:00 soft-hold', () => {
    // Date.parse often accepts +15..+23; civil ISO 8601 max is ±14:00 (wave33).
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+15:00'), false);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+23:59'), false);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00-15:00'), false);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+14:30'), false);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+1430'), false);
    assert.equal(isAuthoritativeLeaseExpiresAt('2099-01-01T12:00:00+15:00'), false);
    assert.equal(isUsableLeaseDeadline('2099-01-01T12:00:00+15:00'), false);
    assert.equal(isUsableLeaseDeadline('2099-01-01T12:00:00+14:30'), false);

    // Exact ±14:00 and sub-14 remain portable.
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+14:00'), true);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00-14:00'), true);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+05:30'), true);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+1400'), true);
    assert.equal(isAuthoritativeLeaseExpiresAt('2099-01-01T12:00:00+14:00'), true);
    assert.equal(isAuthoritativeLeaseExpiresAt('2099-01-01T12:00:00-14:00'), true);

    // wave32 cells still soft-hold (regression guard).
    assert.equal(hasIsoDateTimeShape('2026-12-31T23:59:60.000Z'), false);
    assert.equal(hasIsoDateTimeShape('2099-01-01T12:00:00+25:00'), false);
  });

  it('lease taxonomy residual wave33: dual clock-skew × non-civil offset matrix', () => {
    const now = Date.now();
    const futureCivil = new Date(now + 60_000).toISOString();
    const pastBeyondSkew = new Date(now - (LEASE_CLOCK_SKEW_MS + 5_000)).toISOString();

    assert.equal(isUsableLeaseDeadline(futureCivil, now), true);
    assert.equal(isUsableLeaseDeadline(pastBeyondSkew, now), false);

    // Non-civil offsets never usable regardless of clock window.
    assert.equal(isUsableLeaseDeadline('2099-01-01T12:00:00+15:00', now), false);
    assert.equal(isUsableLeaseDeadline('2099-01-01T12:00:00+14:01', now), false);
    assert.equal(isUsableLeaseDeadline('2099-01-01T12:00:00-15:00', now), false);
    assert.equal(isUsableLeaseDeadline('2099-01-01T12:00:00+14:00', now), true);
  });

  it('host-client residual wave33: non-civil offset leaseExpiresAt → soft deadline', async () => {
    const originalFetch = globalThis.fetch;
    const payloads = [
      '2099-01-01T12:00:00+15:00',
      '2099-01-01T12:00:00+14:30',
      '2099-01-01T12:00:00+23:59',
    ];
    let i = 0;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ job: { id: `j-w33-${i}`, leaseExpiresAt: payloads[i++]! } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      for (const raw of payloads) {
        const before = Date.now();
        const lease = await host.renewLease!('j-w33', 'a1');
        assert.ok(lease, `${raw} must soft-hold, not null/lease-loss`);
        assert.notEqual(lease, raw, `must not advertise ${raw} as hold`);
        const exp = Date.parse(lease!);
        assert.ok(Number.isFinite(exp));
        assert.ok(exp >= before + SOFT_LEASE_RENEW_MS - 5_000);
        assert.ok(exp <= before + SOFT_LEASE_RENEW_MS + 5_000);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host-client residual wave33: claim omits non-civil lease; empty/overlong jobId → null', async () => {
    const originalFetch = globalThis.fetch;
    const payloads: Array<{ id: string; leaseExpiresAt: string }> = [
      { id: 'j-claim-noncivil', leaseExpiresAt: '2099-01-01T12:00:00+15:00' },
      { id: '   ', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: '', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: 'x'.repeat(MAX_JOB_ID_LEN + 1), leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      {
        id: '  j-claim-ok-w33  ',
        leaseExpiresAt: '2099-06-01T12:00:00+14:00',
      },
      {
        id: 'y'.repeat(MAX_JOB_ID_LEN),
        leaseExpiresAt: '2099-06-01T12:00:00-14:00',
      },
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const p = payloads[i++]!;
      return new Response(
        JSON.stringify({
          job: {
            id: p.id,
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
            leaseExpiresAt: p.leaseExpiresAt,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const nonCivil = await host.claim('agent-wave33');
      assert.ok(nonCivil);
      assert.equal(nonCivil!.jobId, 'j-claim-noncivil');
      assert.equal(nonCivil!.leaseExpiresAt, undefined, 'non-civil offset must not be advertised');

      assert.equal(await host.claim('agent-wave33'), null, 'whitespace-only jobId → null');
      assert.equal(await host.claim('agent-wave33'), null, 'empty jobId → null');
      assert.equal(await host.claim('agent-wave33'), null, 'overlong jobId → null');

      const ok = await host.claim('agent-wave33');
      assert.ok(ok);
      assert.equal(ok!.jobId, 'j-claim-ok-w33', 'jobId trimmed');
      assert.equal(ok!.leaseExpiresAt, '2099-06-01T12:00:00+14:00');

      const atMax = await host.claim('agent-wave33');
      assert.ok(atMax);
      assert.equal(atMax!.jobId.length, MAX_JOB_ID_LEN);
      assert.equal(atMax!.leaseExpiresAt, '2099-06-01T12:00:00-14:00');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('assertCompleteResult residual wave33: backend.id/agentId reject control characters', () => {
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 1, wallTimeMs: 1 },
      backend: { id: 'cpu-path', agentId: 'agent-1' },
    });
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: 'cpu\npath' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /backend\.id must not contain control characters/);
        return true;
      },
    );
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: 'cpu', agentId: 'agent\u0000-1' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /backend\.agentId must not contain control characters/);
        return true;
      },
    );
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: 'cpu\u007F' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /backend\.id must not contain control characters/);
        return true;
      },
    );
  });

  it('processJob residual wave33: control-char backend.id → fail retryable true', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-ctrl-id', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2 },
          backend: { id: 'cpu\tbad' },
        } as never;
      },
    };
    const job = {
      id: 'job-ctrl-id',
      name: 'ctrl-id',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-ctrl', undefined, undefined, [runner]),
      /not a member of requirements\.backends|backend\.id must not contain control characters/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /not a member of requirements\.backends|backend\.id must not contain control characters/);
    assert.equal(failArgs!.retryable, true);
  });

  it('processJob residual wave33: terminal renew non-civil offset still completes (soft-hold)', async () => {
    let completed = false;
    let failCalled = false;
    let hb = 0;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => {
        hb += 1;
        if (hb === 1) {
          return {
            job: { id: 'job-noncivil-term', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
          };
        }
        // Terminal renew: non-civil +15 must soft-hold, not block complete.
        return {
          job: { id: 'job-noncivil-term', leaseExpiresAt: '2099-01-01T12:00:00+15:00' },
        };
      },
      complete: async () => {
        completed = true;
        return { job: { id: 'job-noncivil-term', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } } };
      },
      fail: async (_id: string, error = 'synthetic failure') => {
        failCalled = true;
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2, solidCells: 0 },
          backend: { id: 'cpu' },
        };
      },
    };
    const job = {
      id: 'job-noncivil-term',
      name: 'noncivil-term',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await processJob(client, job, 'agent-noncivil', undefined, undefined, [runner]);
    assert.equal(completed, true);
    assert.equal(failCalled, false);
  });

  // ── Residual unit matrix after wave33 tip fe48119 (wave34; not #7/#50 close) ──

  it('claim jobId residual wave34: isUsableClaimJobId control/whitespace matrix', () => {
    assert.equal(isUsableClaimJobId('job-ok'), true);
    assert.equal(isUsableClaimJobId('  job-ok  '), true, 'trim then accept');
    assert.equal(isUsableClaimJobId('y'.repeat(MAX_JOB_ID_LEN)), true);
    assert.equal(isUsableClaimJobId(''), false);
    assert.equal(isUsableClaimJobId('   '), false);
    assert.equal(isUsableClaimJobId('x'.repeat(MAX_JOB_ID_LEN + 1)), false);
    assert.equal(isUsableClaimJobId(null), false);
    assert.equal(isUsableClaimJobId(42), false);
    // Control chars (not stripped by trim when embedded / NUL).
    assert.equal(isUsableClaimJobId('job\nid'), false);
    assert.equal(isUsableClaimJobId('job\tid'), false);
    assert.equal(isUsableClaimJobId('job\u0000id'), false);
    assert.equal(isUsableClaimJobId('job\u007F'), false);
    assert.equal(isUsableClaimJobId('\u0001'), false);
    // Internal whitespace after trim.
    assert.equal(isUsableClaimJobId('job id'), false);
    assert.equal(isUsableClaimJobId('job\u00A0id'), false);
  });

  it('host-client residual wave34: claim nulls control-char / internal-space jobId', async () => {
    const originalFetch = globalThis.fetch;
    const payloads: Array<{ id: string; leaseExpiresAt: string }> = [
      { id: 'job\nbad', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: 'job\tbad', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: 'job\u0000bad', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: 'job space', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      {
        id: '  j-claim-ok-w34  ',
        leaseExpiresAt: '2099-06-01T12:00:00+14:00',
      },
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const p = payloads[i++]!;
      return new Response(
        JSON.stringify({
          job: {
            id: p.id,
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
            leaseExpiresAt: p.leaseExpiresAt,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      assert.equal(await host.claim('agent-wave34'), null, 'LF jobId → null');
      assert.equal(await host.claim('agent-wave34'), null, 'TAB jobId → null');
      assert.equal(await host.claim('agent-wave34'), null, 'NUL jobId → null');
      assert.equal(await host.claim('agent-wave34'), null, 'space jobId → null');
      const ok = await host.claim('agent-wave34');
      assert.ok(ok);
      assert.equal(ok!.jobId, 'j-claim-ok-w34');
      assert.equal(ok!.leaseExpiresAt, '2099-06-01T12:00:00+14:00');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('assertCompleteResult residual wave34: backend.id/agentId reject internal whitespace', () => {
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 1, wallTimeMs: 1 },
      backend: { id: 'cpu-path', agentId: 'agent-1' },
    });
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: 'cpu path' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /backend\.id must not contain whitespace/);
        return true;
      },
    );
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: 'cpu', agentId: 'agent 1' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /backend\.agentId must not contain whitespace/);
        return true;
      },
    );
    // Control still preferred message when both could apply (tab is control).
    assert.throws(
      () =>
        assertCompleteResult({
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: 'cpu\tpath' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentResultValidationError);
        assert.match(err.message, /backend\.id must not contain control characters/);
        return true;
      },
    );
  });

  it('processJob residual wave34: internal-space backend.id → fail retryable true', async () => {
    let completed = false;
    let failArgs: { error: string; retryable?: boolean } | undefined;
    const client = {
      baseUrl: 'http://host.test',
      heartbeat: async () => ({
        job: { id: 'job-space-id', leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
      }),
      complete: async (_id: string, _result: unknown) => {
        completed = true;
        return { jobId: _id, status: 'succeeded', result: _result };
      },
      fail: async (_id: string, error: string, _attempt: number, retryable?: boolean) => {
        failArgs = { error, retryable };
        return { jobId: _id, status: 'failed', error };
      },
    } as unknown as TaskApiClient;
    const runner: JobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run() {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 2 },
          backend: { id: 'cpu path' },
        } as never;
      },
    };
    const job = {
      id: 'job-space-id',
      name: 'space-id',
      status: 'leased',
              attempt: 0,
      spec: buildSmokeJobSpec({ maxSteps: 1 }),
    } as unknown as JobRecord;
    await assert.rejects(
      () => processJob(client, job, 'agent-space', undefined, undefined, [runner]),
      /not a member of requirements\.backends|backend\.id must not contain whitespace/,
    );
    assert.equal(completed, false);
    assert.ok(failArgs);
    assert.match(failArgs!.error, /not a member of requirements\.backends|backend\.id must not contain whitespace/);
    assert.equal(failArgs!.retryable, true);
  });

  it('guarded residual wave34: post-run lease_lost preferred over unable-to-interrupt', async () => {
    // Silent 3-arg runner + always-cancel + terminal renew null → lease_lost
    // (ownership) rather than unable-to-interrupt (retryable cancel diagnostic).
    let renewN = 0;
    let failMsgs: string[] = [];
    let completed = false;
    const host = {
      async registerAgent() {},
      async claim() {
        return {
          jobId: 'j-race-w34',
          attempt: 0,
          spec: buildSmokeJobSpec({ maxSteps: 1 }),
          leaseExpiresAt: '2099-01-01T00:00:00.000Z',
        };
      },
      async progress() {},
      async complete() {
        completed = true;
        return { jobId: 'j-race-w34', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } };
      },
      async fail(_id: string, error: string) {
        failMsgs.push(error);
        return { jobId: 'j-race-w34', status: 'failed', error };
      },
      async renewLease() {
        renewN += 1;
        // Terminal ensureLease only (silent runner never calls onProgress renew).
        return null;
      },
    };
    const runner: InterruptibleJobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run(_spec, _onProgress, _signal) {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: 'cpu' },
        };
      },
    };
    // Force 3-arg arity so signal is accepted but ignored (silent complete).
    assert.ok(runner.run.length >= 3);
    const status = await runGuardedClaimLoopOnce(host as never, 'agent-race', [runner], {
      isCancelRequested: () => true,
    });
    assert.equal(status, 'lease_lost');
    assert.equal(completed, false);
    assert.ok(renewN >= 1, 'terminal renew must run before cancel diagnostic');
    assert.equal(failMsgs.length, 0, 'confirmed lease loss must not issue a stale fail');
    assert.equal(
      failMsgs.some((m) => m === UNABLE_TO_INTERRUPT_MESSAGE),
      false,
      'must not prefer unable-to-interrupt when lease already lost',
    );
  });

  it('guarded residual wave34: post-run cancel still unable-to-interrupt when lease ok', async () => {
    let failMsgs: string[] = [];
    let completed = false;
    const host = {
      async registerAgent() {},
      async claim() {
        return {
          jobId: 'j-cancel-w34',
          attempt: 0,
          spec: buildSmokeJobSpec({ maxSteps: 1 }),
          leaseExpiresAt: '2099-01-01T00:00:00.000Z',
        };
      },
      async progress() {},
      async complete() {
        completed = true;
        return { jobId: 'j-cancel-w34', status: 'succeeded', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu' } } };
      },
      async fail(_id: string, error: string) {
        failMsgs.push(error);
        return { jobId: 'j-cancel-w34', status: 'failed', error };
      },
      async renewLease() {
        return '2099-01-01T00:00:00.000Z';
      },
    };
    const runner: InterruptibleJobRunner = {
      canRun: (s) => s.kind === 'path-experiment' || (s.kind as string) === 'path',
      async run(_spec, _onProgress, _signal) {
        return {
          schemaVersion: 1,
          summary: { steps: 1, wallTimeMs: 1 },
          backend: { id: 'cpu' },
        };
      },
    };
    const status = await runGuardedClaimLoopOnce(host as never, 'agent-cancel', [runner], {
      isCancelRequested: () => true,
    });
    assert.equal(status, 'failed');
    assert.equal(completed, false);
    assert.ok(failMsgs.includes(UNABLE_TO_INTERRUPT_MESSAGE));
  });

  // ── Residual unit matrix after wave34 tip 0d89aac (wave35; not #7/#50 close) ──

  it('claim jobId residual wave35: isUsableClaimJobId zero-width / soft-hyphen matrix', () => {
    // Still accepted: plain + ASCII-padded (trim) + max length.
    assert.equal(isUsableClaimJobId('job-ok-w35'), true);
    assert.equal(isUsableClaimJobId('  job-ok-w35  '), true);
    assert.equal(isUsableClaimJobId('z'.repeat(MAX_JOB_ID_LEN)), true);
    // Leading/trailing/embedded ZWSP (U+200B) — not stripped by trim, not \s.
    assert.equal(isUsableClaimJobId('\u200Bjob'), false, 'leading ZWSP');
    assert.equal(isUsableClaimJobId('job\u200B'), false, 'trailing ZWSP');
    assert.equal(isUsableClaimJobId('job\u200Bid'), false, 'embedded ZWSP');
    assert.equal(isUsableClaimJobId('\u200B'), false, 'ZWSP-only');
    assert.equal(isUsableClaimJobId('  \u200B  '), false, 'ZWSP after trim of spaces');
    // ZWNJ / ZWJ / word joiner / soft hyphen.
    assert.equal(isUsableClaimJobId('job\u200Cid'), false, 'ZWNJ');
    assert.equal(isUsableClaimJobId('job\u200Did'), false, 'ZWJ');
    assert.equal(isUsableClaimJobId('\u2060x'), false, 'word joiner');
    assert.equal(isUsableClaimJobId('\u00ADjob'), false, 'leading soft hyphen');
    assert.equal(isUsableClaimJobId('job\u00AD'), false, 'trailing soft hyphen');
    // Embedded BOM (leading/trailing BOM is stripped by trim → usable).
    assert.equal(isUsableClaimJobId('job\uFEFFid'), false, 'embedded BOM');
    assert.equal(isUsableClaimJobId('\uFEFFjob-ok'), true, 'leading BOM trimmed');
    assert.equal(isUsableClaimJobId('job-ok\uFEFF'), true, 'trailing BOM trimmed');
    // Wave34 cells still hold (regression guard).
    assert.equal(isUsableClaimJobId('job id'), false);
    assert.equal(isUsableClaimJobId('job\nid'), false);
  });

  it('host-client residual wave35: claim nulls zero-width / soft-hyphen jobId', async () => {
    const originalFetch = globalThis.fetch;
    const payloads: Array<{ id: string; leaseExpiresAt: string }> = [
      { id: '\u200Bjob-zwsp-lead', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: 'job-zwsp-trail\u200B', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: 'job\u200Bmid', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: 'job\u200Cmid', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: '\u00ADjob-shy', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: 'job\uFEFFmid', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      {
        id: '\uFEFF  j-claim-ok-w35  \uFEFF',
        leaseExpiresAt: '2099-06-01T12:00:00+14:00',
      },
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const p = payloads[i++]!;
      return new Response(
        JSON.stringify({
          job: {
            id: p.id,
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
            leaseExpiresAt: p.leaseExpiresAt,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      assert.equal(await host.claim('agent-wave35'), null, 'leading ZWSP → null');
      assert.equal(await host.claim('agent-wave35'), null, 'trailing ZWSP → null');
      assert.equal(await host.claim('agent-wave35'), null, 'embedded ZWSP → null');
      assert.equal(await host.claim('agent-wave35'), null, 'ZWNJ → null');
      assert.equal(await host.claim('agent-wave35'), null, 'soft hyphen → null');
      assert.equal(await host.claim('agent-wave35'), null, 'embedded BOM → null');
      const ok = await host.claim('agent-wave35');
      assert.ok(ok);
      assert.equal(ok!.jobId, 'j-claim-ok-w35');
      assert.equal(ok!.leaseExpiresAt, '2099-06-01T12:00:00+14:00');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Residual unit matrix after wave35 tip ed9a6d3 (wave36; not #7/#50 close) ──

  it('claim jobId residual wave36: isUsableClaimJobId bidi / NFC matrix', () => {
    // Still accepted: plain + ASCII-padded (trim) + NFC precomposed + max length.
    assert.equal(isUsableClaimJobId('job-ok-w36'), true);
    assert.equal(isUsableClaimJobId('  job-ok-w36  '), true);
    assert.equal(isUsableClaimJobId('job-\u00E9'), true, 'NFC precomposed e-acute');
    assert.equal(isUsableClaimJobId('z'.repeat(MAX_JOB_ID_LEN)), true);
    // Bidi marks / embeddings / overrides / isolates — survive trim, not \s.
    assert.equal(isUsableClaimJobId('\u200Ejob'), false, 'leading LRM');
    assert.equal(isUsableClaimJobId('job\u200F'), false, 'trailing RLM');
    assert.equal(isUsableClaimJobId('job\u200Eid'), false, 'embedded LRM');
    assert.equal(isUsableClaimJobId('job\u202Aid'), false, 'LRE embedding');
    assert.equal(isUsableClaimJobId('job\u202Eid'), false, 'RLO override');
    assert.equal(isUsableClaimJobId('job\u202Cid'), false, 'PDF');
    assert.equal(isUsableClaimJobId('\u2066x'), false, 'LRI isolate');
    assert.equal(isUsableClaimJobId('x\u2069'), false, 'PDI');
    assert.equal(isUsableClaimJobId('\u200E'), false, 'LRM-only');
    // Other Cf glue residual adjacent to wave35 set.
    assert.equal(isUsableClaimJobId('job\u034Fid'), false, 'combining grapheme joiner');
    assert.equal(isUsableClaimJobId('job\u061Cid'), false, 'Arabic letter mark');
    assert.equal(isUsableClaimJobId('job\u2062id'), false, 'invisible times');
    // NFC honesty: NFD dual-handle of the same visual identity is rejected.
    assert.equal(isUsableClaimJobId('job-e\u0301'), false, 'NFD e + combining acute');
    assert.equal(isUsableClaimJobId('a\u0308'), false, 'NFD a-diaeresis only');
    // Wave35 cells still hold (regression guard).
    assert.equal(isUsableClaimJobId('job\u200Bid'), false, 'ZWSP still rejected');
    assert.equal(isUsableClaimJobId('job\u00ADid'), false, 'soft hyphen still rejected');
  });

  it('host-client residual wave36: claim nulls bidi / non-NFC jobId', async () => {
    const originalFetch = globalThis.fetch;
    const payloads: Array<{ id: string; leaseExpiresAt: string }> = [
      { id: '\u200Ejob-lrm-lead', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: 'job-rlm-trail\u200F', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: 'job\u202Emid', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: 'job\u2066mid', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: 'job\u034Fmid', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      { id: 'job-e\u0301-nfd', leaseExpiresAt: '2099-06-01T12:00:00.000Z' },
      {
        id: '  j-claim-ok-w36-\u00E9  ',
        leaseExpiresAt: '2099-06-01T12:00:00+14:00',
      },
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const p = payloads[i++]!;
      return new Response(
        JSON.stringify({
          job: {
            id: p.id,
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
            leaseExpiresAt: p.leaseExpiresAt,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      assert.equal(await host.claim('agent-wave36'), null, 'leading LRM → null');
      assert.equal(await host.claim('agent-wave36'), null, 'trailing RLM → null');
      assert.equal(await host.claim('agent-wave36'), null, 'RLO → null');
      assert.equal(await host.claim('agent-wave36'), null, 'LRI → null');
      assert.equal(await host.claim('agent-wave36'), null, 'CGJ → null');
      assert.equal(await host.claim('agent-wave36'), null, 'NFD dual-handle → null');
      const ok = await host.claim('agent-wave36');
      assert.ok(ok);
      assert.equal(ok!.jobId, 'j-claim-ok-w36-\u00E9');
      assert.equal(ok!.leaseExpiresAt, '2099-06-01T12:00:00+14:00');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Residual unit matrix after wave36 tip 433d976 (wave37; not #7/#50 close) ──

  it('claim jobId residual wave37: isUsableClaimJobId NFKC / VS / deprecated-Cf matrix', () => {
    // Still accepted: plain + ASCII-padded (trim) + NFC precomposed + max length.
    assert.equal(isUsableClaimJobId('job-ok-w37'), true);
    assert.equal(isUsableClaimJobId('  job-ok-w37  '), true);
    assert.equal(isUsableClaimJobId('job-\u00E9'), true, 'NFKC/NFC precomposed e-acute');
    assert.equal(isUsableClaimJobId('z'.repeat(MAX_JOB_ID_LEN)), true);
    // Wave37 NFKC dual-handle residual (NFC-stable but not NFKC-stable).
    assert.equal(isUsableClaimJobId('job-\uFF21'), false, 'fullwidth A dual of job-A');
    assert.equal(isUsableClaimJobId('\uFF2A\uFF2F\uFF22'), false, 'fullwidth JOB');
    assert.equal(isUsableClaimJobId('job\uFB01'), false, 'ﬁ ligature dual of fi');
    assert.equal(isUsableClaimJobId('a\u0308'), false, 'NFD still rejected via NFKC');
    assert.equal(isUsableClaimJobId('job-e\u0301'), false, 'NFD e+acute still rejected');
    // Variation selectors survive NFC/NFKC — explicit reject (wave37).
    assert.equal(isUsableClaimJobId('job\uFE00'), false, 'VS1 after base');
    assert.equal(isUsableClaimJobId('\uFE0Fjob'), false, 'emoji VS leading');
    assert.equal(isUsableClaimJobId('x\uFE0Ex'), false, 'embedded text VS');
    // Deprecated format controls U+206A–U+206F + interlinear annotation.
    assert.equal(isUsableClaimJobId('job\u206Aid'), false, 'inhibit symmetric swapping');
    assert.equal(isUsableClaimJobId('job\u206Fid'), false, 'nominal digit shapes');
    assert.equal(isUsableClaimJobId('\uFFF9x'), false, 'interlinear anchor');
    assert.equal(isUsableClaimJobId('x\uFFFB'), false, 'interlinear terminator');
    // Wave35–wave36 regression guards.
    assert.equal(isUsableClaimJobId('job\u200Bid'), false, 'ZWSP still rejected');
    assert.equal(isUsableClaimJobId('job\u200Eid'), false, 'LRM still rejected');
    assert.equal(isUsableClaimJobId('job\u2066id'), false, 'LRI still rejected');
  });

  it('host-client residual wave37: claim nulls NFKC dual-handle / VS / deprecated-Cf jobId', async () => {
    const originalFetch = globalThis.fetch;
    const payloads: Array<{ id: string; leaseExpiresAt: string }> = [
      { id: 'job-\uFF21-fullwidth', leaseExpiresAt: '2099-07-01T12:00:00.000Z' },
      { id: 'job\uFB01-lig', leaseExpiresAt: '2099-07-01T12:00:00.000Z' },
      { id: 'job\uFE00vs', leaseExpiresAt: '2099-07-01T12:00:00.000Z' },
      { id: 'job\u206Amid', leaseExpiresAt: '2099-07-01T12:00:00.000Z' },
      { id: 'job\uFFF9mid', leaseExpiresAt: '2099-07-01T12:00:00.000Z' },
      { id: 'job-e\u0301-nfd', leaseExpiresAt: '2099-07-01T12:00:00.000Z' },
      {
        id: '  j-claim-ok-w37-\u00E9  ',
        leaseExpiresAt: '2099-07-01T12:00:00+14:00',
      },
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const p = payloads[i++]!;
      return new Response(
        JSON.stringify({
          job: {
            id: p.id,
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
            leaseExpiresAt: p.leaseExpiresAt,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      assert.equal(await host.claim('agent-wave37'), null, 'fullwidth A → null');
      assert.equal(await host.claim('agent-wave37'), null, 'ﬁ ligature → null');
      assert.equal(await host.claim('agent-wave37'), null, 'VS1 → null');
      assert.equal(await host.claim('agent-wave37'), null, 'deprecated Cf → null');
      assert.equal(await host.claim('agent-wave37'), null, 'interlinear → null');
      assert.equal(await host.claim('agent-wave37'), null, 'NFD dual-handle → null');
      const ok = await host.claim('agent-wave37');
      assert.ok(ok);
      assert.equal(ok!.jobId, 'j-claim-ok-w37-\u00E9');
      assert.equal(ok!.leaseExpiresAt, '2099-07-01T12:00:00+14:00');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host-client residual wave37: renew soft-hold still holds on unusable lease (clock edge)', async () => {
    // Renew window honesty: host may return past-skew / garbage / NFKC-irrelevant
    // lease text after accepted heartbeat — adapter must soft-hold (~SOFT_LEASE_RENEW_MS),
    // not advertise a dead deadline or throw (wave28–wave37 claim-loop/lease).
    const originalFetch = globalThis.fetch;
    const leaseBodies = [
      { leaseExpiresAt: '1999-01-01T00:00:00.000Z' }, // far past beyond skew
      { leaseExpiresAt: '2099-02-30T00:00:00.000Z' }, // calendar garbage
      { leaseExpiresAt: '2099-01-01 12:00:00Z' }, // space/SQL non-portable
      { leaseExpiresAt: null },
      {},
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const body = leaseBodies[i++] ?? {};
      return new Response(JSON.stringify({ job: { id: 'j-soft-w37', ...body } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      for (let n = 0; n < leaseBodies.length; n++) {
        const before = Date.now();
        const lease = await host.renewLease!('j-soft-w37', 'a1');
        assert.ok(lease, `soft-hold iteration ${n}`);
        const exp = Date.parse(lease!);
        assert.ok(Number.isFinite(exp));
        assert.ok(
          exp >= before + SOFT_LEASE_RENEW_MS - 2_000 &&
            exp <= before + SOFT_LEASE_RENEW_MS + 5_000,
          `soft window ~${SOFT_LEASE_RENEW_MS}ms (got ${exp - before}ms)`,
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Residual unit matrix after wave37 tip 4880399 (wave38; not #7/#50 close) ──

  it('claim jobId residual wave38: isUsableClaimJobId C1 / Mongolian-FVS / VS-Supplement matrix', () => {
    // Still accepted: plain + ASCII-padded (trim) + NFC precomposed + max length.
    assert.equal(isUsableClaimJobId('job-ok-w38'), true);
    assert.equal(isUsableClaimJobId('  job-ok-w38  '), true);
    assert.equal(isUsableClaimJobId('job-\u00E9'), true, 'NFKC/NFC precomposed e-acute');
    assert.equal(isUsableClaimJobId('z'.repeat(MAX_JOB_ID_LEN)), true);
    // Wave38 C1 control residual (not matched by wave34 C0/DEL-only class).
    assert.equal(isUsableClaimJobId('job\u0080id'), false, 'C1 PAD U+0080');
    assert.equal(isUsableClaimJobId('job\u0085id'), false, 'C1 NEL U+0085 (not JS \\s)');
    assert.equal(isUsableClaimJobId('job\u009Fid'), false, 'C1 APC U+009F');
    assert.equal(isUsableClaimJobId('\u0085'), false, 'NEL-only');
    // Wave34 C0/DEL regression guards.
    assert.equal(isUsableClaimJobId('job\u0000id'), false, 'NUL still rejected');
    assert.equal(isUsableClaimJobId('job\u007Fid'), false, 'DEL still rejected');
    // Mongolian free variation selectors (dual-handle; survive NFC/NFKC) — wave38.
    assert.equal(isUsableClaimJobId('job\u180Bid'), false, 'Mongolian FVS1');
    assert.equal(isUsableClaimJobId('job\u180Cid'), false, 'Mongolian FVS2');
    assert.equal(isUsableClaimJobId('job\u180Did'), false, 'Mongolian FVS3');
    assert.equal(isUsableClaimJobId('\u180Bjob'), false, 'leading FVS1');
    // Object replacement + plane-14 VS Supplement (wave38 dual-handle glue).
    assert.equal(isUsableClaimJobId('job\uFFFCid'), false, 'object replacement U+FFFC');
    assert.equal(isUsableClaimJobId('job\u{E0100}id'), false, 'VS Supplement U+E0100');
    assert.equal(isUsableClaimJobId('x\u{E01EF}x'), false, 'VS Supplement U+E01EF');
    // Wave37 regression guards (NFKC / BMP VS / deprecated Cf).
    assert.equal(isUsableClaimJobId('job-\uFF21'), false, 'fullwidth A still rejected');
    assert.equal(isUsableClaimJobId('job\uFE00'), false, 'BMP VS1 still rejected');
    assert.equal(isUsableClaimJobId('job\u206Aid'), false, 'deprecated Cf still rejected');
    assert.equal(isUsableClaimJobId('job\u180Eid'), false, 'Mongolian vowel sep still rejected');
  });

  it('host-client residual wave38: claim nulls C1 / Mongolian-FVS / VS-Supplement jobId', async () => {
    const originalFetch = globalThis.fetch;
    const payloads: Array<{ id: string; leaseExpiresAt: string }> = [
      { id: 'job\u0080c1', leaseExpiresAt: '2099-08-01T12:00:00.000Z' },
      { id: 'job\u0085nel', leaseExpiresAt: '2099-08-01T12:00:00.000Z' },
      { id: 'job\u180Bfvs', leaseExpiresAt: '2099-08-01T12:00:00.000Z' },
      { id: 'job\uFFFCobj', leaseExpiresAt: '2099-08-01T12:00:00.000Z' },
      { id: 'job\u{E0100}vss', leaseExpiresAt: '2099-08-01T12:00:00.000Z' },
      { id: 'job\u009Fend', leaseExpiresAt: '2099-08-01T12:00:00.000Z' },
      {
        id: '  j-claim-ok-w38-\u00E9  ',
        leaseExpiresAt: '2099-08-01T12:00:00+14:00',
      },
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const p = payloads[i++]!;
      return new Response(
        JSON.stringify({
          job: {
            id: p.id,
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
            leaseExpiresAt: p.leaseExpiresAt,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      assert.equal(await host.claim('agent-wave38'), null, 'C1 PAD → null');
      assert.equal(await host.claim('agent-wave38'), null, 'C1 NEL → null');
      assert.equal(await host.claim('agent-wave38'), null, 'Mongolian FVS1 → null');
      assert.equal(await host.claim('agent-wave38'), null, 'object replacement → null');
      assert.equal(await host.claim('agent-wave38'), null, 'VS Supplement → null');
      assert.equal(await host.claim('agent-wave38'), null, 'C1 APC → null');
      const ok = await host.claim('agent-wave38');
      assert.ok(ok);
      assert.equal(ok!.jobId, 'j-claim-ok-w38-\u00E9');
      assert.equal(ok!.leaseExpiresAt, '2099-08-01T12:00:00+14:00');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host-client residual wave38: claim soft-hold past-skew deadline + renew soft-hold noise lease', async () => {
    // Claim honesty: past-beyond-skew calendar ISO is not advertised as a live
    // hold (leaseExpiresAt stripped) while jobId remains usable (wave28/wave38).
    // Renew honesty: heartbeat may return non-ISO noise after accept — soft-hold
    // window, not null/lease-loss (wave27–wave38 claim-loop/lease).
    const originalFetch = globalThis.fetch;
    const pastBeyondSkew = new Date(Date.now() - LEASE_CLOCK_SKEW_MS - 60_000).toISOString();
    const futureOk = '2099-08-01T12:00:00.000Z';
    let claimI = 0;
    let renewI = 0;
    const renewBodies = [
      { leaseExpiresAt: 'not-a-deadline' },
      { leaseExpiresAt: '' },
      { leaseExpiresAt: null },
      { leaseExpiresAt: pastBeyondSkew },
    ];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        claimI += 1;
        const first = claimI === 1;
        return new Response(
          JSON.stringify({
            job: {
              id: first ? 'j-claim-skew-w38' : 'j-claim-ok-skew-w38',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'path-experiment',
                parameters: {},
                run: { maxSteps: 1 },
                outputs: {},
              },
              leaseExpiresAt: first ? pastBeyondSkew : futureOk,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const body = renewBodies[renewI++] ?? {};
      return new Response(JSON.stringify({ job: { id: 'j-renew-soft-w38', ...body } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const pastClaim = await host.claim('agent-wave38');
      assert.ok(pastClaim, 'usable jobId must still claim');
      assert.equal(pastClaim!.jobId, 'j-claim-skew-w38');
      assert.equal(
        pastClaim!.leaseExpiresAt,
        undefined,
        'past-beyond-skew must soft-strip on claim (not advertise dead hold)',
      );
      const okClaim = await host.claim('agent-wave38');
      assert.ok(okClaim);
      assert.equal(okClaim!.jobId, 'j-claim-ok-skew-w38');
      assert.equal(okClaim!.leaseExpiresAt, futureOk);

      for (let i = 0; i < renewBodies.length; i++) {
        const before = Date.now();
        const lease = await host.renewLease!('j-renew-soft-w38', 'a1');
        assert.ok(lease, `renew soft-hold #${i + 1}`);
        const exp = Date.parse(lease!);
        assert.ok(Number.isFinite(exp));
        assert.ok(
          exp >= before + SOFT_LEASE_RENEW_MS - 2_000 &&
            exp <= before + SOFT_LEASE_RENEW_MS + 5_000,
          `soft window ~${SOFT_LEASE_RENEW_MS}ms (got ${exp - before}ms)`,
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lease taxonomy residual wave38: isUsableLeaseDeadline skew boundary still holds', () => {
    const now = Date.now();
    // Exactly at skew floor remains usable (exp >= now - skew); 1ms beyond soft-holds.
    const atFloor = new Date(now - LEASE_CLOCK_SKEW_MS).toISOString();
    const beyond = new Date(now - LEASE_CLOCK_SKEW_MS - 1).toISOString();
    const within = new Date(now - LEASE_CLOCK_SKEW_MS + 1).toISOString();
    const future = new Date(now + 60_000).toISOString();
    assert.equal(isUsableLeaseDeadline(atFloor, now), true, 'exactly at skew floor');
    assert.equal(isUsableLeaseDeadline(beyond, now), false, '1ms past skew → soft-hold');
    assert.equal(isUsableLeaseDeadline(within, now), true, 'within skew window');
    assert.equal(isUsableLeaseDeadline(future, now), true, 'future absolute');
    // Non-authoritative forms remain unusable independent of skew (wave30–wave33).
    assert.equal(isUsableLeaseDeadline('2099-01-01 12:00:00Z', now), false);
    assert.equal(isUsableLeaseDeadline('2099-01-01T12:00:00', now), false);
  });

  // ── Residual unit matrix after wave38 tip 026d7a1 (wave39; not #7/#50 close) ──

  it('claim jobId residual wave39: isUsableClaimJobId FVS4 / Language-Tag / FFFD matrix', () => {
    // Still accepted: plain + ASCII-padded (trim) + NFC precomposed + max length.
    assert.equal(isUsableClaimJobId('job-ok-w39'), true);
    assert.equal(isUsableClaimJobId('  job-ok-w39  '), true);
    assert.equal(isUsableClaimJobId('job-\u00E9'), true, 'NFKC/NFC precomposed e-acute');
    assert.equal(isUsableClaimJobId('z'.repeat(MAX_JOB_ID_LEN)), true);
    // Wave39 Mongolian FVS4 residual (wave38 covered FVS1–3 + MVS only).
    assert.equal(isUsableClaimJobId('job\u180Fid'), false, 'Mongolian FVS4 U+180F');
    assert.equal(isUsableClaimJobId('\u180Fjob'), false, 'leading FVS4');
    assert.equal(isUsableClaimJobId('\u180F'), false, 'FVS4-only');
    // Plane-14 Language Tags (invisible dual-handle; survive NFC/NFKC) — wave39.
    assert.equal(isUsableClaimJobId('job\u{E0001}id'), false, 'Language Tag U+E0001');
    assert.equal(isUsableClaimJobId('job\u{E0020}id'), false, 'TAG SPACE U+E0020');
    assert.equal(isUsableClaimJobId('job\u{E0041}id'), false, 'TAG LATIN CAPITAL A');
    assert.equal(isUsableClaimJobId('x\u{E007F}x'), false, 'CANCEL TAG U+E007F');
    assert.equal(isUsableClaimJobId('\u{E0001}'), false, 'Language Tag-only');
    // Replacement character (corruption dual-handle; adjacent to FFFC wave38).
    assert.equal(isUsableClaimJobId('job\uFFFDid'), false, 'replacement U+FFFD');
    assert.equal(isUsableClaimJobId('\uFFFD'), false, 'FFFD-only');
    // Wave38 regression guards (C1 / FVS1–3 / VS Supplement / FFFC).
    assert.equal(isUsableClaimJobId('job\u0085id'), false, 'C1 NEL still rejected');
    assert.equal(isUsableClaimJobId('job\u180Bid'), false, 'FVS1 still rejected');
    assert.equal(isUsableClaimJobId('job\u180Did'), false, 'FVS3 still rejected');
    assert.equal(isUsableClaimJobId('job\u180Eid'), false, 'Mongolian vowel sep still rejected');
    assert.equal(isUsableClaimJobId('job\uFFFCid'), false, 'object replacement still rejected');
    assert.equal(isUsableClaimJobId('job\u{E0100}id'), false, 'VS Supplement still rejected');
    assert.equal(isUsableClaimJobId('job-\uFF21'), false, 'fullwidth A still rejected');
  });

  it('host-client residual wave39: claim nulls FVS4 / Language-Tag / FFFD jobId', async () => {
    const originalFetch = globalThis.fetch;
    const payloads: Array<{ id: string; leaseExpiresAt: string }> = [
      { id: 'job\u180Ffvs4', leaseExpiresAt: '2099-08-01T12:00:00.000Z' },
      { id: 'job\u{E0001}tag', leaseExpiresAt: '2099-08-01T12:00:00.000Z' },
      { id: 'job\u{E0020}sp', leaseExpiresAt: '2099-08-01T12:00:00.000Z' },
      { id: 'job\u{E007F}can', leaseExpiresAt: '2099-08-01T12:00:00.000Z' },
      { id: 'job\uFFFDrep', leaseExpiresAt: '2099-08-01T12:00:00.000Z' },
      {
        id: '  j-claim-ok-w39-\u00E9  ',
        leaseExpiresAt: '2099-08-01T12:00:00+14:00',
      },
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const p = payloads[i++]!;
      return new Response(
        JSON.stringify({
          job: {
            id: p.id,
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
            leaseExpiresAt: p.leaseExpiresAt,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      assert.equal(await host.claim('agent-wave39'), null, 'Mongolian FVS4 → null');
      assert.equal(await host.claim('agent-wave39'), null, 'Language Tag → null');
      assert.equal(await host.claim('agent-wave39'), null, 'TAG SPACE → null');
      assert.equal(await host.claim('agent-wave39'), null, 'CANCEL TAG → null');
      assert.equal(await host.claim('agent-wave39'), null, 'FFFD replacement → null');
      const ok = await host.claim('agent-wave39');
      assert.ok(ok);
      assert.equal(ok!.jobId, 'j-claim-ok-w39-\u00E9');
      assert.equal(ok!.leaseExpiresAt, '2099-08-01T12:00:00+14:00');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host-client residual wave39: claim soft-hold past-skew + renew soft-hold garbage lease', async () => {
    // Claim: past-beyond-skew ISO is stripped (not advertised as live hold).
    // Renew: non-authoritative heartbeat lease text soft-holds (not lease-loss).
    // Wave39 regression of wave28/wave38 lease soft-hold honesty (not #7 close).
    const originalFetch = globalThis.fetch;
    const pastBeyondSkew = new Date(Date.now() - LEASE_CLOCK_SKEW_MS - 60_000).toISOString();
    const futureOk = '2099-08-01T12:00:00.000Z';
    let claimI = 0;
    let renewI = 0;
    const renewBodies = [
      { leaseExpiresAt: 'garbage-not-iso' },
      { leaseExpiresAt: '   ' },
      { leaseExpiresAt: pastBeyondSkew },
      { leaseExpiresAt: '2099-01-01T12:00:00' }, // zone-naive → soft-hold
    ];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/api/v1/jobs/claim') && method === 'POST') {
        claimI += 1;
        const first = claimI === 1;
        return new Response(
          JSON.stringify({
            job: {
              id: first ? 'j-claim-skew-w39' : 'j-claim-ok-skew-w39',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'path-experiment',
                parameters: {},
                run: { maxSteps: 1 },
                outputs: {},
              },
              leaseExpiresAt: first ? pastBeyondSkew : futureOk,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const body = renewBodies[renewI++] ?? {};
      return new Response(JSON.stringify({ job: { id: 'j-renew-soft-w39', ...body } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const pastClaim = await host.claim('agent-wave39');
      assert.ok(pastClaim, 'usable jobId must still claim');
      assert.equal(pastClaim!.jobId, 'j-claim-skew-w39');
      assert.equal(
        pastClaim!.leaseExpiresAt,
        undefined,
        'past-beyond-skew must soft-strip on claim',
      );
      const okClaim = await host.claim('agent-wave39');
      assert.ok(okClaim);
      assert.equal(okClaim!.jobId, 'j-claim-ok-skew-w39');
      assert.equal(okClaim!.leaseExpiresAt, futureOk);

      for (let i = 0; i < renewBodies.length; i++) {
        const before = Date.now();
        const lease = await host.renewLease!('j-renew-soft-w39', 'a1');
        assert.ok(lease, `renew soft-hold #${i + 1}`);
        const exp = Date.parse(lease!);
        assert.ok(Number.isFinite(exp));
        assert.ok(
          exp >= before + SOFT_LEASE_RENEW_MS - 2_000 &&
            exp <= before + SOFT_LEASE_RENEW_MS + 5_000,
          `soft window ~${SOFT_LEASE_RENEW_MS}ms (got ${exp - before}ms)`,
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Residual unit matrix after wave39 tip 79a96c3 (wave40; not #7/#50 close) ──

  it('claim jobId residual wave40: isUsableClaimJobId Arabic-Syriac-Cf / multi-null / unpaired-surrogate matrix', () => {
    // Still accepted: plain + ASCII-padded (trim) + NFC precomposed + max length.
    assert.equal(isUsableClaimJobId('job-ok-w40'), true);
    assert.equal(isUsableClaimJobId('  job-ok-w40  '), true);
    assert.equal(isUsableClaimJobId('job-\u00E9'), true, 'NFKC/NFC precomposed e-acute');
    assert.equal(isUsableClaimJobId('z'.repeat(MAX_JOB_ID_LEN)), true);
    // Wave40 Arabic / Syriac format Cf soft-characters (dual-handle; survive NFC/NFKC).
    assert.equal(isUsableClaimJobId('job\u0600id'), false, 'Arabic number sign U+0600');
    assert.equal(isUsableClaimJobId('job\u0605id'), false, 'Arabic number sign above U+0605');
    assert.equal(isUsableClaimJobId('\u0600'), false, 'Arabic number sign-only');
    assert.equal(isUsableClaimJobId('job\u06DDid'), false, 'Arabic end of ayah U+06DD');
    assert.equal(isUsableClaimJobId('job\u070Fid'), false, 'Syriac abbreviation mark U+070F');
    assert.equal(isUsableClaimJobId('\u070Fjob'), false, 'leading Syriac abbrev');
    assert.equal(isUsableClaimJobId('job\u08E2id'), false, 'Arabic disputed end of ayah U+08E2');
    // Multi-null / multi-control bytes (wave34 control residual; explicit multi-byte).
    assert.equal(isUsableClaimJobId('\u0000\u0000'), false, 'multi-null only');
    assert.equal(isUsableClaimJobId('job\u0000\u0000id'), false, 'embedded multi-null');
    assert.equal(isUsableClaimJobId('\u0000job\u0000'), false, 'leading+trailing NUL');
    assert.equal(isUsableClaimJobId('\u0001\u0002\u0003'), false, 'multi C0 only');
    // Empty-after-strip: trim / format-only leaves no usable handle.
    assert.equal(isUsableClaimJobId('\uFEFF\uFEFF'), false, 'BOM-only → empty after trim');
    assert.equal(isUsableClaimJobId('  \u200B\u00AD  '), false, 'space+ZWSP+SHY → empty usable');
    assert.equal(isUsableClaimJobId('\u200B\u200C\u200D'), false, 'ZW-only cluster');
    assert.equal(isUsableClaimJobId('\uFFF9\uFFFA\uFFFB'), false, 'interlinear-only cluster');
    // Unpaired UTF-16 surrogates (ill-formed; corruption dual-handle) — wave40.
    assert.equal(isUsableClaimJobId('\uD800'), false, 'lone high surrogate');
    assert.equal(isUsableClaimJobId('\uDFFF'), false, 'lone low surrogate');
    assert.equal(isUsableClaimJobId('job\uD800id'), false, 'embedded lone high surrogate');
    assert.equal(isUsableClaimJobId('job\uDC00'), false, 'trailing lone low surrogate');
    // Well-formed astral (emoji) still accepted — only unpaired fail isWellFormed.
    assert.equal(isUsableClaimJobId('job-\u{1F600}'), true, 'well-formed emoji scalar ok');
    // Wave39 regression guards (FVS4 / Language Tags / FFFD).
    assert.equal(isUsableClaimJobId('job\u180Fid'), false, 'FVS4 still rejected');
    assert.equal(isUsableClaimJobId('job\u{E0001}id'), false, 'Language Tag still rejected');
    assert.equal(isUsableClaimJobId('job\uFFFDid'), false, 'FFFD still rejected');
    assert.equal(isUsableClaimJobId('job\u061Cid'), false, 'ALM still rejected');
  });

  it('host-client residual wave40: claim nulls Arabic-Syriac-Cf / multi-null / unpaired-surrogate jobId', async () => {
    const originalFetch = globalThis.fetch;
    const payloads: Array<{ id: string; leaseExpiresAt: string }> = [
      { id: 'job\u0600arab', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'job\u070Fsyr', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'job\u06DDeoa', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'job\u08E2dis', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'job\u0000\u0000nul', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: '\u0000\u0000', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'job\uD800surr', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: '  \u200B\u00AD  ', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      {
        id: '  j-claim-ok-w40-\u00E9  ',
        leaseExpiresAt: '2099-09-01T12:00:00+14:00',
      },
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const p = payloads[i++]!;
      return new Response(
        JSON.stringify({
          job: {
            id: p.id,
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
            leaseExpiresAt: p.leaseExpiresAt,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      assert.equal(await host.claim('agent-wave40'), null, 'Arabic number sign → null');
      assert.equal(await host.claim('agent-wave40'), null, 'Syriac abbrev → null');
      assert.equal(await host.claim('agent-wave40'), null, 'Arabic end of ayah → null');
      assert.equal(await host.claim('agent-wave40'), null, 'Arabic disputed EOA → null');
      assert.equal(await host.claim('agent-wave40'), null, 'embedded multi-null → null');
      assert.equal(await host.claim('agent-wave40'), null, 'multi-null-only → null');
      assert.equal(await host.claim('agent-wave40'), null, 'unpaired surrogate → null');
      assert.equal(await host.claim('agent-wave40'), null, 'empty-after-strip → null');
      const ok = await host.claim('agent-wave40');
      assert.ok(ok);
      assert.equal(ok!.jobId, 'j-claim-ok-w40-\u00E9');
      assert.equal(ok!.leaseExpiresAt, '2099-09-01T12:00:00+14:00');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host-client residual wave40: lease renew clock-skew extremes soft-hold', async () => {
    // Renew honesty: extreme past / far-beyond-skew / non-civil-adjacent forms
    // soft-hold (not null/lease-loss); exact skew floor still returns host lease.
    // Wave40 residual after wave28/wave38/wave39 soft-hold (not #7 close).
    const originalFetch = globalThis.fetch;
    const now = Date.now();
    const epochPast = '1970-01-01T00:00:00.000Z';
    const farPast = new Date(now - LEASE_CLOCK_SKEW_MS - 86_400_000).toISOString();
    const justBeyondSkew = new Date(now - LEASE_CLOCK_SKEW_MS - 1).toISOString();
    const atSkewFloor = new Date(now - LEASE_CLOCK_SKEW_MS + 500).toISOString(); // within floor
    const farFuture = '9999-12-31T23:59:59.000Z';
    let renewI = 0;
    // Soft-hold cases first, then one usable extreme-future, then skew-floor usable.
    const renewBodies = [
      { leaseExpiresAt: epochPast },
      { leaseExpiresAt: farPast },
      { leaseExpiresAt: justBeyondSkew },
      { leaseExpiresAt: '   ' },
      { leaseExpiresAt: null as unknown as string },
      { leaseExpiresAt: farFuture }, // authoritative far-future → return host lease
      { leaseExpiresAt: atSkewFloor }, // within skew → return host lease
    ];
    globalThis.fetch = (async () => {
      const body = renewBodies[renewI++] ?? {};
      return new Response(JSON.stringify({ job: { id: 'j-renew-skew-w40', ...body } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      // Soft-hold extremes (epoch / far-past / just-beyond-skew / whitespace / null).
      for (let i = 0; i < 5; i++) {
        const before = Date.now();
        const lease = await host.renewLease!('j-renew-skew-w40', 'a1');
        assert.ok(lease, `renew soft-hold extreme #${i + 1}`);
        const exp = Date.parse(lease!);
        assert.ok(Number.isFinite(exp));
        assert.ok(
          exp >= before + SOFT_LEASE_RENEW_MS - 2_000 &&
            exp <= before + SOFT_LEASE_RENEW_MS + 5_000,
          `soft window ~${SOFT_LEASE_RENEW_MS}ms (got ${exp - before}ms) for #${i + 1}`,
        );
      }
      // Far-future civil ISO remains an authoritative usable hold.
      const farLease = await host.renewLease!('j-renew-skew-w40', 'a1');
      assert.equal(farLease, farFuture, 'far-future absolute still usable');
      // Within skew floor: host deadline returned (not soft-rewritten).
      const floorLease = await host.renewLease!('j-renew-skew-w40', 'a1');
      assert.equal(floorLease, atSkewFloor, 'within-skew floor returns host lease');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lease taxonomy residual wave40: isUsableLeaseDeadline clock-skew extremes matrix', () => {
    const now = Date.now();
    const epoch = '1970-01-01T00:00:00.000Z';
    const farPast = new Date(now - LEASE_CLOCK_SKEW_MS - 3_600_000).toISOString();
    const beyond = new Date(now - LEASE_CLOCK_SKEW_MS - 1).toISOString();
    const atFloor = new Date(now - LEASE_CLOCK_SKEW_MS).toISOString();
    const farFuture = '9999-12-31T23:59:59.000Z';
    assert.equal(isUsableLeaseDeadline(epoch, now), false, 'epoch past → soft-hold');
    assert.equal(isUsableLeaseDeadline(farPast, now), false, '1h past skew → soft-hold');
    assert.equal(isUsableLeaseDeadline(beyond, now), false, '1ms past skew → soft-hold');
    assert.equal(isUsableLeaseDeadline(atFloor, now), true, 'exactly at skew floor');
    assert.equal(isUsableLeaseDeadline(farFuture, now), true, 'year-9999 absolute usable');
    // Non-authoritative forms still soft-hold independent of extreme clocks.
    assert.equal(isUsableLeaseDeadline('1970-01-01 00:00:00Z', now), false, 'space epoch');
    assert.equal(isUsableLeaseDeadline('9999-12-31T23:59:59', now), false, 'zone-naive 9999');
  });

  // ── Residual unit matrix after wave40 tip 456940c (wave41; not #7/#50 close) ──

  it('claim jobId residual wave41: isUsableClaimJobId Khmer / musical-Cf / noncharacter matrix', () => {
    // Still accepted: plain + ASCII-padded (trim) + NFC precomposed + max length.
    assert.equal(isUsableClaimJobId('job-ok-w41'), true);
    assert.equal(isUsableClaimJobId('  job-ok-w41  '), true);
    assert.equal(isUsableClaimJobId('job-\u00E9'), true, 'NFKC/NFC precomposed e-acute');
    assert.equal(isUsableClaimJobId('z'.repeat(MAX_JOB_ID_LEN)), true);
    // Wave41 Khmer inherent vowels (Cf dual-handle; survive NFC/NFKC).
    assert.equal(isUsableClaimJobId('job\u17B4id'), false, 'Khmer inherent AQ U+17B4');
    assert.equal(isUsableClaimJobId('job\u17B5id'), false, 'Khmer inherent AA U+17B5');
    assert.equal(isUsableClaimJobId('\u17B4'), false, 'Khmer AQ-only');
    assert.equal(isUsableClaimJobId('\u17B5job'), false, 'leading Khmer AA');
    // Wave41 musical-symbol format controls (plane-1 Cf dual-handle).
    assert.equal(isUsableClaimJobId('job\u{1D173}id'), false, 'musical begin beam U+1D173');
    assert.equal(isUsableClaimJobId('job\u{1D17A}id'), false, 'musical end phrase U+1D17A');
    assert.equal(isUsableClaimJobId('\u{1D173}'), false, 'musical begin-beam-only');
    assert.equal(isUsableClaimJobId('job\u{1D176}'), false, 'trailing musical end-slur');
    // Wave41 BMP noncharacters (not portable identity scalars).
    assert.equal(isUsableClaimJobId('job\uFFFEid'), false, 'noncharacter U+FFFE');
    assert.equal(isUsableClaimJobId('job\uFFFFid'), false, 'noncharacter U+FFFF');
    assert.equal(isUsableClaimJobId('\uFFFE'), false, 'FFFE-only');
    assert.equal(isUsableClaimJobId('\uFFFF\uFFFE'), false, 'FFFF+FFFE cluster');
    // Well-formed astral (emoji) still accepted — musical Cf rejected separately.
    assert.equal(isUsableClaimJobId('job-\u{1F600}'), true, 'well-formed emoji scalar ok');
    // Wave40 regression guards (Arabic/Syriac Cf / unpaired surrogate / multi-null).
    assert.equal(isUsableClaimJobId('job\u0600id'), false, 'Arabic number sign still rejected');
    assert.equal(isUsableClaimJobId('job\u070Fid'), false, 'Syriac abbrev still rejected');
    assert.equal(isUsableClaimJobId('job\uD800id'), false, 'unpaired surrogate still rejected');
    assert.equal(isUsableClaimJobId('job\uFFFDid'), false, 'FFFD still rejected');
    assert.equal(isUsableClaimJobId('job\u{E0001}id'), false, 'Language Tag still rejected');
  });

  it('host-client residual wave41: claim nulls Khmer / musical-Cf / noncharacter jobId', async () => {
    const originalFetch = globalThis.fetch;
    const payloads: Array<{ id: string; leaseExpiresAt: string }> = [
      { id: 'job\u17B4khm', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'job\u17B5khm', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'job\u{1D173}mus', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'job\u{1D17A}phr', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'job\uFFFEnc', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'job\uFFFFnc', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: '\uFFFE\uFFFF', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: '\u17B4\u17B5', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      {
        id: '  j-claim-ok-w41-\u00E9  ',
        leaseExpiresAt: '2099-09-01T12:00:00+14:00',
      },
    ];
    let i = 0;
    globalThis.fetch = (async () => {
      const p = payloads[i++]!;
      return new Response(
        JSON.stringify({
          job: {
            id: p.id,
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
            leaseExpiresAt: p.leaseExpiresAt,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      assert.equal(await host.claim('agent-wave41'), null, 'Khmer AQ → null');
      assert.equal(await host.claim('agent-wave41'), null, 'Khmer AA → null');
      assert.equal(await host.claim('agent-wave41'), null, 'musical begin beam → null');
      assert.equal(await host.claim('agent-wave41'), null, 'musical end phrase → null');
      assert.equal(await host.claim('agent-wave41'), null, 'noncharacter FFFE → null');
      assert.equal(await host.claim('agent-wave41'), null, 'noncharacter FFFF → null');
      assert.equal(await host.claim('agent-wave41'), null, 'noncharacter-only cluster → null');
      assert.equal(await host.claim('agent-wave41'), null, 'Khmer-only cluster → null');
      const ok = await host.claim('agent-wave41');
      assert.ok(ok);
      assert.equal(ok!.jobId, 'j-claim-ok-w41-\u00E9');
      assert.equal(ok!.leaseExpiresAt, '2099-09-01T12:00:00+14:00');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('host-client residual wave41: claim soft-strips past-skew; renew compact-zone + lowercase-z', async () => {
    // Claim: usable jobId with past-skew lease → still claims but leaseExpiresAt
    // undefined (soft-strip). Renew: compact ±HHMM zone and lowercase z remain
    // authoritative when civil (wave41 residual after wave40 skew extremes).
    const originalFetch = globalThis.fetch;
    const now = Date.now();
    const pastSkew = new Date(now - LEASE_CLOCK_SKEW_MS - 60_000).toISOString();
    const futureCompact = '2099-06-15T12:00:00+0000';
    const futureLowerZ = '2099-06-15t12:00:00.000z';
    let phase = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/claim') && method === 'POST') {
        return new Response(
          JSON.stringify({
            job: {
              id: '  j-claim-strip-w41  ',
              status: 'leased',
              attempt: 0,
              spec: {
                schemaVersion: 1,
                kind: 'path-experiment',
                parameters: {},
                run: { maxSteps: 1 },
                outputs: {},
              },
              leaseExpiresAt: pastSkew,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // heartbeat / renew
      const bodies = [
        { leaseExpiresAt: futureCompact },
        { leaseExpiresAt: futureLowerZ },
        { leaseExpiresAt: pastSkew },
        { leaseExpiresAt: '2099-06-15T12:00:00' }, // zone-naive → soft-hold
      ];
      const body = bodies[phase++] ?? {};
      return new Response(JSON.stringify({ job: { id: 'j-claim-strip-w41', ...body } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      const claimed = await host.claim('agent-wave41');
      assert.ok(claimed, 'usable jobId still claims under past-skew lease');
      assert.equal(claimed!.jobId, 'j-claim-strip-w41');
      assert.equal(
        claimed!.leaseExpiresAt,
        undefined,
        'past-skew lease soft-stripped on claim',
      );
      const compact = await host.renewLease!('j-claim-strip-w41', 'a1');
      assert.equal(compact, futureCompact, 'compact +0000 zone still usable');
      const lowerZ = await host.renewLease!('j-claim-strip-w41', 'a1');
      assert.equal(lowerZ, futureLowerZ, 'lowercase t/z civil ISO still usable');
      const before = Date.now();
      const softPast = await host.renewLease!('j-claim-strip-w41', 'a1');
      assert.ok(softPast, 'past-skew renew soft-holds');
      const expPast = Date.parse(softPast!);
      assert.ok(
        expPast >= before + SOFT_LEASE_RENEW_MS - 2_000 &&
          expPast <= before + SOFT_LEASE_RENEW_MS + 5_000,
        `past-skew soft window (got ${expPast - before}ms)`,
      );
      const beforeNaive = Date.now();
      const softNaive = await host.renewLease!('j-claim-strip-w41', 'a1');
      assert.ok(softNaive, 'zone-naive renew soft-holds');
      const expNaive = Date.parse(softNaive!);
      assert.ok(
        expNaive >= beforeNaive + SOFT_LEASE_RENEW_MS - 2_000 &&
          expNaive <= beforeNaive + SOFT_LEASE_RENEW_MS + 5_000,
        `zone-naive soft window (got ${expNaive - beforeNaive}ms)`,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lease taxonomy residual wave41: compact-zone / lowercase-z / past-skew claim strip matrix', () => {
    const now = Date.now();
    // Compact ±HHMM and lowercase designators remain authoritative when civil.
    assert.equal(
      isAuthoritativeLeaseExpiresAt('2099-06-15T12:00:00+0000'),
      true,
      'compact +0000',
    );
    assert.equal(
      isAuthoritativeLeaseExpiresAt('2099-06-15t12:00:00.000z'),
      true,
      'lowercase t/z',
    );
    assert.equal(
      isUsableLeaseDeadline('2099-06-15T12:00:00+0000', now),
      true,
      'compact usable under now',
    );
    assert.equal(
      isUsableLeaseDeadline('2099-06-15t12:00:00.000z', now),
      true,
      'lowercase-z usable under now',
    );
    // Past-skew absolute still authoritative calendar ISO but not a usable hold.
    const past = new Date(now - LEASE_CLOCK_SKEW_MS - 1).toISOString();
    assert.equal(isAuthoritativeLeaseExpiresAt(past), true, 'past still authoritative shape');
    assert.equal(isUsableLeaseDeadline(past, now), false, 'past-skew not usable hold');
    // Wave40 regressions: zone-naive / space-SQL still soft-hold.
    assert.equal(isAuthoritativeLeaseExpiresAt('2099-06-15T12:00:00'), false, 'zone-naive');
    assert.equal(isAuthoritativeLeaseExpiresAt('2099-06-15 12:00:00Z'), false, 'space-SQL');
    // hasIsoDateTimeShape accepts compact zone + lowercase z.
    assert.equal(hasIsoDateTimeShape('2099-06-15T12:00:00+0000'), true);
    assert.equal(hasIsoDateTimeShape('2099-06-15t12:00:00z'), true);
  });

  /**
   * #7 residual after registry-error-paths: submit payload validation rejects
   * obviously invalid specs before fetch (no silent host round-trip).
   */
  it('submit residual post-registry-error: assertSubmitableJobSpec + submitJob reject bad specs without fetch', async () => {
    assert.throws(() => assertSubmitableJobSpec(null), /submit validation: spec required/);
    assert.throws(
      () => assertSubmitableJobSpec({ schemaVersion: 2, kind: 'path-experiment', run: { maxSteps: 1 } }),
      /schemaVersion must be 1/,
    );
    assert.throws(
      () => assertSubmitableJobSpec({ schemaVersion: 1, kind: '', run: { maxSteps: 1 } }),
      /kind required/,
    );
    assert.throws(
      () => assertSubmitableJobSpec({ schemaVersion: 1, kind: 'path-experiment' }),
      /run required/,
    );
    assert.throws(
      () =>
        assertSubmitableJobSpec({
          schemaVersion: 1,
          kind: 'path-experiment',
          run: { maxSteps: 0 },
        }),
      /maxSteps must be a positive safe integer/,
    );
    for (const maxSteps of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => assertSubmitableJobSpec({ schemaVersion: 1, kind: 'path-experiment', run: { maxSteps } }),
        /maxSteps must be a positive safe integer/,
      );
    }
    // Valid minimal shape passes assert (does not throw).
    assertSubmitableJobSpec({
      schemaVersion: 1,
      kind: 'path-experiment',
      parameters: {},
      run: { maxSteps: 1 },
      outputs: {},
    });

    let fetchCalled = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalled += 1;
      return new Response('should-not-reach', { status: 500 });
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      await assert.rejects(
        () =>
          client.submitJob({
            schemaVersion: 1,
            kind: 'path-experiment',
            parameters: {},
            run: { maxSteps: 0 },
            outputs: {},
          } as never),
        /submit validation: run\.maxSteps/,
      );
      await assert.rejects(
        () =>
          client.submitJob({
            schemaVersion: 1,
            kind: '',
            parameters: {},
            run: { maxSteps: 2 },
            outputs: {},
          } as never),
        /submit validation: kind required/,
      );
      assert.equal(fetchCalled, 0, 'invalid submit must not hit network');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('every control-plane call passes a bounded AbortSignal to fetch (wave residual)', async () => {
    const originalFetch = globalThis.fetch;
    const seen: Array<{ url: string; signal: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, signal: init?.signal });
      if (url.endsWith('/api/v1/jobs/claim')) {
        return new Response(null, { status: 204 });
      }
      if (url.includes('/register')) {
        return new Response(
          JSON.stringify({ agent: { id: 'a1', name: 'n', capabilities: {} }, token: 't' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/agents/me')) {
        return new Response(JSON.stringify({ agent: { id: 'a1', name: 'n' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ job: { id: 'j1', status: 'queued' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const client = new TaskApiClient('http://host.test', 'tok');
      await client.register('n');
      await client.me();
      await client.updateCapabilities({} as never);
      await client.submitJob({
        schemaVersion: 1,
        kind: 'path-experiment',
        parameters: {},
        run: { maxSteps: 1 },
        outputs: {},
      } as never);
      assert.equal(await client.claim(), null);
      await client.heartbeat('j1');
      await client.complete('j1', {
        schemaVersion: 1,
        summary: { steps: 1, wallTimeMs: 1 },
        backend: { id: 'cpu' },
      }, 0);
      await client.fail('j1', 'x', 0);
      await client.getJob('j1');
      assert.equal(seen.length, 9);
      for (const call of seen) {
        assert.ok(call.signal instanceof AbortSignal, `no AbortSignal for ${call.url}`);
      }
      // Caller abort composes with the timeout instead of dropping it.
      seen.length = 0;
      const ac = new AbortController();
      await client.heartbeat('j1', undefined, ac.signal);
      assert.equal(seen.length, 1);
      assert.ok(seen[0]!.signal instanceof AbortSignal);
      assert.notEqual(seen[0]!.signal, ac.signal);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Residual unit matrix after wave66 pollMs gate ────────────────────────

  it('claim jobId residual wave66: isUsableClaimJobId URL-path-separator / dot-segment matrix', () => {
    // Path-hostile identity escapes /api/v1/jobs/<id>/* under WHATWG URL
    // resolution (`\` → `/` on http(s), `.`/`..` segments normalize, `?`/`#`
    // truncate, `%` can decode to a separator server-side).
    assert.equal(isUsableClaimJobId('a/b'), false, 'forward slash segment');
    assert.equal(isUsableClaimJobId('a\\b'), false, 'backslash (special-scheme slash)');
    assert.equal(isUsableClaimJobId('a?b'), false, 'query separator');
    assert.equal(isUsableClaimJobId('a#b'), false, 'fragment separator');
    assert.equal(isUsableClaimJobId('a%2Fb'), false, 'percent-encoded slash');
    assert.equal(isUsableClaimJobId('%2e%2e%2f'), false, 'percent-encoded dot-segment');
    assert.equal(isUsableClaimJobId('..'), false, 'dot-dot segment');
    assert.equal(isUsableClaimJobId('.'), false, 'dot segment');
    assert.equal(isUsableClaimJobId('../../agents/me'), false, 'traversal chain');
    // Benign punctuation that cannot form a path segment stays usable.
    assert.equal(isUsableClaimJobId('job-ok-w66'), true);
    assert.equal(isUsableClaimJobId('0a3f2c1e-9b7d-4c5a-8e6f-1d2c3b4a5967'), true, 'uuid');
    assert.equal(isUsableClaimJobId('a.b'), true, 'embedded single dot');
    assert.equal(isUsableClaimJobId('a..b'), true, 'embedded dots, no segment');
    assert.equal(isUsableClaimJobId('...'), true, 'dots but not a dot-segment');
  });

  it('host-client residual wave66: claim nulls URL-path-escape jobId', async () => {
    const originalFetch = globalThis.fetch;
    const payloads: Array<{ id: string; leaseExpiresAt: string }> = [
      { id: '../../agents/me', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'a\\b', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'a?b', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'a%2Fb', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: '..', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
      { id: 'j-claim-ok-w66', leaseExpiresAt: '2099-09-01T12:00:00.000Z' },
    ];
    let i = 0;
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      const p = payloads[i++]!;
      return new Response(
        JSON.stringify({
          job: {
            id: p.id,
            status: 'leased',
              attempt: 0,
            spec: {
              schemaVersion: 1,
              kind: 'path-experiment',
              parameters: {},
              run: { maxSteps: 1 },
              outputs: {},
            },
            leaseExpiresAt: p.leaseExpiresAt,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient('http://host.test', 'tok'));
      assert.equal(await host.claim('agent-wave66'), null, 'dot-dot traversal → null');
      assert.equal(await host.claim('agent-wave66'), null, 'backslash → null');
      assert.equal(await host.claim('agent-wave66'), null, 'query separator → null');
      assert.equal(await host.claim('agent-wave66'), null, 'percent-encoded slash → null');
      assert.equal(await host.claim('agent-wave66'), null, 'bare dot-dot → null');
      const ok = await host.claim('agent-wave66');
      assert.ok(ok);
      assert.equal(ok!.jobId, 'j-claim-ok-w66');
      // Every claim hit only the claim route — no escaped control-plane path.
      assert.ok(
        seen.every((url) => url.endsWith('/api/v1/jobs/claim')),
        'hostile jobId never reached a non-claim route',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

const live =
  process.env.HOST_HTTP_E2E === '1' || process.env.HOST_HTTP_E2E === 'true';

describe('host-http live claim+lease (optional)', { skip: !live }, () => {
  it('registers agent, submits path job, claims, renews lease, completes', async () => {
    const base = (process.env.TASK_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
    const regKey = process.env.AGENT_REGISTRATION_KEY ?? process.env.TASK_API_KEY ?? '';
    // apiKey: production POST /jobs requires TASK_API_KEY (or AGENT_REGISTRATION_KEY if aliased)
    const client = new TaskApiClient(base, undefined, regKey || undefined);
    const reg = await client.register(
      `e2e-agent-${Date.now()}`,
      {
        backends: ['cpu'],
        kinds: ['path-experiment'],
        pathModels: [{ id: 'path-replay', version: '1.0.0', backends: ['cpu'] }],
      },
      regKey || undefined,
    );
    client.token = reg.token;
    const { job } = await client.submitJob({
      schemaVersion: 1,
      kind: 'path-experiment',
      name: 'e2e-path-lease',
      parameters: {},
      experiment: {
        experimentId: `e2e-${Date.now()}`,
        title: 'e2e',
        materials: [
          {
            id: 'e2e-mat',
            name: 'e2e material',
            role: 'substrate',
            source: { kind: 'assumption' },
          },
        ],
        steps: [
          {
            id: 's1',
            label: 'noop',
            mechanism: 'e2e',
            inputs: ['in'],
            outputs: ['out'],
            hypothesis: {
              status: 'candidate',
              description: 'e2e',
              sources: [{ kind: 'assumption' }],
            },
          },
        ],
        parameters: {},
        model: { id: 'path-replay', version: '1.0.0' },
        provenance: {
          createdAt: '1970-01-01T00:00:00.000Z',
          software: { name: 'e2e', version: '0' },
        },
      },
      run: { maxSteps: 2, forceSampleEvery: 1, warmupSteps: 0 },
      outputs: { forces: false, history: false, kpis: [] },
      requirements: { backends: ['cpu'] },
    } as never);
    const host = createJobHostFromTaskApi(client);
    const claimed = await host.claim(reg.agent.id);
    assert.ok(claimed);
    assert.equal(claimed!.jobId, job.id);
    const lease = await host.renewLease!(claimed!.jobId, reg.agent.id);
    assert.ok(lease);
    await host.complete(claimed!.jobId, {
      schemaVersion: 1,
      summary: {
        steps: 2,
        wallTimeMs: 5,
        pathScore: 1,
        solverPackage: '@w-sim/solvers-path-experiment',
      },
      backend: { id: 'cpu-path-experiment', agentId: reg.agent.id },
    });
  });
});
