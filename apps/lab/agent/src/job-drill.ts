/**
 * Phase 2 measured drill: job cancel + job wall-clock timeout over the REAL
 * HTTP control path (TaskApiClient → loopback node:http host implementing
 * the production claim/heartbeat/cancel/fail protocol verbatim).
 *
 *   npx tsx src/job-drill.ts
 *
 * Emits one `JOB_DRILL {...}` JSON line consumed by scripts/ci/loop_round.sh:
 *   job_cancel_latency_ms   — host cancel accepted → fail settle recorded,
 *                             silent runner, shipped keepalive cadence (15 s).
 *   job_timeout_settle_ms   — run start → fail settle for a job that exceeds
 *                             its wall bound (configured 400 ms in-drill).
 *   claim_storm_p95_ms      — p95 of 32 concurrent claims on one job.
 *   lease_recovery_ms       — lease expiry → reclaimed job completed by a
 *                             second claimant (lazy-requeue contract).
 *   agent_job_wall_timeout_secs — shipped default with env scrubbed.
 *
 * Fail-closed: any missed assertion exits 1; a 90 s watchdog kills a hang.
 * Judge≠Actor: this script only measures; the loop metric thresholds decide.
 */

import http from 'node:http';
import type { JobProgress, JobResultV1, JobSpecV1 } from '@w-sim/contracts';
import { TaskApiClient } from './client.ts';
import { createJobHostFromTaskApi } from './host-client.ts';
import {
  agentJobTimeoutMs,
  JOB_WALL_TIMEOUT_MESSAGE,
  runGuardedClaimLoopOnce,
  type InterruptibleJobRunner,
} from './guarded-claim.ts';

const WATCHDOG_MS = 90_000;

type DrillJob = {
  id: string;
  spec: JobSpecV1;
  status: 'leased' | 'cancelled' | 'failed' | 'succeeded';
  leaseExpiresAt: string;
  claimed?: boolean;
  /** Bearer token of the agent holding the lease (real host resolves token→agentId). */
  agentId?: string;
  /** Lazy requeue count — mirrors requeueExpiredLeases() inside claimJob. */
  requeues?: number;
};

type SettleRecord = { at: number; error?: string; retryable?: boolean };

type DrillHostStats = { claims: number };

/** Minimal but protocol-faithful host: same status codes/bodies as apps/host tasks service. */
function startDrillHost(job: DrillJob, settle: { fail?: SettleRecord; completeAt?: number }, stats?: DrillHostStats) {
  const bearer = (req: http.IncomingMessage) =>
    /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (code: number, body?: unknown, text = false) => {
      res.writeHead(code, { 'content-type': text ? 'text/plain' : 'application/json' });
      res.end(text ? String(body) : JSON.stringify(body));
    };
    const m = req.method ?? 'GET';
    if (m === 'POST' && url.pathname === '/api/v1/jobs/claim') {
      if (stats) stats.claims += 1;
      // Lazy reclaim — mirrors requeueExpiredLeases() swept inside claimJob:
      // an expired lease on a non-terminal job is requeued, then claimable.
      if (job.claimed && job.status === 'leased' && Date.parse(job.leaseExpiresAt) < Date.now()) {
        job.claimed = false;
        job.agentId = undefined;
        job.requeues = (job.requeues ?? 0) + 1;
      }
      if (job.status === 'leased' && !job.claimed) {
        job.claimed = true;
        job.agentId = bearer(req);
        return send(200, { job: { id: job.id, status: 'leased', spec: job.spec, leaseExpiresAt: job.leaseExpiresAt } });
      }
      return send(204);
    }
    const jobMatch = /^\/api\/v1\/jobs\/([^/]+)\/(heartbeat|fail|complete|cancel)$/.exec(url.pathname);
    if (m === 'POST' && jobMatch && jobMatch[1] === job.id) {
      const action = jobMatch[2];
      if (action === 'cancel') {
        job.status = 'cancelled';
        return send(200, { job: { id: job.id, status: 'cancelled' } });
      }
      if (action === 'heartbeat') {
        if (job.status === 'cancelled') {
          // Same wire shape as host heartbeatJob: HttpError(409, 'Job was cancelled; cannot heartbeat').
          return send(409, 'Job was cancelled; cannot heartbeat', true);
        }
        // heartbeatJob does NOT sweep expiry — it only rejects wrong-owner /
        // terminal status. A reclaimed job is owned by the new claimant now.
        if (job.agentId !== undefined && job.agentId !== bearer(req)) {
          return send(409, 'Job is leased by another agent', true);
        }
        job.leaseExpiresAt = new Date(Date.now() + 120_000).toISOString();
        return send(200, { job: { id: job.id, leaseExpiresAt: job.leaseExpiresAt } });
      }
      if (action === 'fail' || action === 'complete') {
        // completeJob/failJob reject a non-owner settle (null → 409 route):
        // a stale agent's settle must never clobber the new owner's result.
        if (job.agentId !== undefined && job.agentId !== bearer(req)) {
          return send(409, 'Job is no longer leased to this agent', true);
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (action === 'fail') {
            const parsed = JSON.parse(body || '{}') as { error?: string; retryable?: boolean };
            settle.fail = { at: Date.now(), error: parsed.error, retryable: parsed.retryable };
            job.status = 'failed';
            send(200, { job: { id: job.id, status: 'failed' } });
          } else {
            settle.completeAt = Date.now();
            job.status = 'succeeded';
            send(200, { job: { id: job.id, status: 'succeeded' } });
          }
        });
        return;
      }
    }
    send(404, { error: 'not found' });
  });
  return new Promise<{ server: http.Server; baseUrl: string }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function spec(): JobSpecV1 {
  return {
    schemaVersion: 1,
    kind: 'lbm-d3q19',
    parameters: { inletVelocity: 1, gridPreset: 'fast' },
    run: { maxSteps: 1000 },
    outputs: { forces: true },
  };
}

/** Silent runner that only finishes when aborted — exercises the keepalive cancel path (worst case). */
function hangUntilAbort(observed: { signalAt?: number }): InterruptibleJobRunner {
  return {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(_spec: JobSpecV1, _onProgress?: (p: JobProgress) => void | Promise<void>, signal?: AbortSignal): Promise<JobResultV1> {
      await new Promise<never>((_resolve, reject) => {
        const t = setTimeout(() => reject(new Error('drill runner exceeded 120s without abort')), 120_000);
        signal?.addEventListener('abort', () => {
          observed.signalAt = Date.now();
          clearTimeout(t);
          reject(new DOMException('interrupted', 'AbortError'));
        }, { once: true });
        if (signal?.aborted) {
          observed.signalAt = Date.now();
          clearTimeout(t);
          reject(new DOMException('interrupted', 'AbortError'));
        }
      });
      return { schemaVersion: 1, summary: { steps: 0, wallTimeMs: 0 }, backend: { id: 'cpu', agentId: 'drill' } };
    },
  };
}

/** Runner that completes immediately — used to prove a reclaimed job runs to a clean terminal. */
function instantRunner(): InterruptibleJobRunner {
  return {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(): Promise<JobResultV1> {
      return { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu', agentId: 'drill' } };
    },
  };
}

async function postCancel(baseUrl: string, jobId: string): Promise<number> {
  const res = await fetch(`${baseUrl}/api/v1/jobs/${jobId}/cancel`, { method: 'POST' });
  if (!res.ok) throw new Error(`drill cancel failed: ${res.status}`);
  return Date.now();
}

async function main() {
  const results: Record<string, number> = {};
  const failures: string[] = [];
  const watchdog = setTimeout(() => {
    console.error('JOB_DRILL_WATCHDOG: exceeded 90s — abort drill (fail closed)');
    process.exit(2);
  }, WATCHDOG_MS);
  watchdog.unref();

  // ── Drill 1: host cancel mid-run, silent runner, shipped keepalive cadence ──
  {
    const job: DrillJob = {
      id: 'drill-cancel-1',
      spec: spec(),
      status: 'leased',
      leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
    const settle: { fail?: SettleRecord; completeAt?: number } = {};
    const { server, baseUrl } = await startDrillHost(job, settle);
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient(baseUrl, 'drill-token'));
      const observed: { signalAt?: number } = {};
      const claimAt = Date.now();
      // Full claim→run→settle over real HTTP: POST /jobs/claim claims the
      // job, heartbeats renew the lease, cancel flips the host to 409.
      const cycle = runGuardedClaimLoopOnce(
        host,
        'agent-drill',
        [hangUntilAbort(observed)],
        // No keepaliveIntervalMs override: the shipped 15 s cadence is what is measured.
        { jobTimeoutMs: 60_000 },
      );
      // Cancel once the cycle is in-flight (runner awaiting signal).
      await new Promise((r) => setTimeout(r, 500));
      const cancelAt = await postCancel(baseUrl, job.id);
      const status = await cycle;
      const signalMs = observed.signalAt ? observed.signalAt - cancelAt : -1;
      const settleMs = settle.fail ? settle.fail.at - cancelAt : -1;
      console.log(`[drill:cancel] claim→cancel gap=${cancelAt - claimAt}ms signal=${signalMs}ms settle=${settleMs}ms status=${status}`);
      if (status !== 'cancelled') failures.push(`cancel drill status=${status} (want cancelled)`);
      if (settle.completeAt !== undefined) failures.push('cancel drill: host.complete was called');
      if (signalMs < 0) failures.push('cancel drill: runner never observed abort signal');
      if (settleMs < 0) failures.push('cancel drill: host never recorded fail settle');
      if (settle.fail && !/cancel/i.test(settle.fail.error ?? '')) {
        failures.push(`cancel drill: fail error ${JSON.stringify(settle.fail.error)} lacks 'cancel'`);
      }
      results.job_cancel_latency_ms = settleMs;
      results.job_cancel_signal_ms = signalMs;
    } finally {
      server.close();
    }
  }

  // ── Drill 2: job wall-clock timeout on a heartbeating in-process runner ──
  {
    const job: DrillJob = {
      id: 'drill-timeout-1',
      spec: spec(),
      status: 'leased',
      leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
    const settle: { fail?: SettleRecord; completeAt?: number } = {};
    const { server, baseUrl } = await startDrillHost(job, settle);
    try {
      const host = createJobHostFromTaskApi(new TaskApiClient(baseUrl, 'drill-token'));
      const observed: { signalAt?: number } = {};
      const TIMEOUT_MS = 400;
      const runStart = Date.now();
      const status = await runGuardedClaimLoopOnce(
        host,
        'agent-drill',
        [hangUntilAbort(observed)],
        { jobTimeoutMs: TIMEOUT_MS, keepaliveIntervalMs: 60_000 },
      );
      const settleMs = settle.fail ? settle.fail.at - runStart : -1;
      console.log(`[drill:timeout] configured=${TIMEOUT_MS}ms settle=${settleMs}ms signal=${observed.signalAt ? observed.signalAt - runStart : -1}ms status=${status}`);
      if (status !== 'failed') failures.push(`timeout drill status=${status} (want failed)`);
      if (settle.completeAt !== undefined) failures.push('timeout drill: host.complete was called');
      if (settleMs < 0) failures.push('timeout drill: host never recorded fail settle');
      if (settle.fail && !(settle.fail.error ?? '').startsWith(JOB_WALL_TIMEOUT_MESSAGE)) {
        failures.push(`timeout drill: fail error ${JSON.stringify(settle.fail.error)} != ${JOB_WALL_TIMEOUT_MESSAGE}`);
      }
      if (settle.fail && settle.fail.retryable !== true) {
        failures.push(`timeout drill: retryable=${settle.fail.retryable} (want true — wall timeout requeues)`);
      }
      if (observed.signalAt === undefined) failures.push('timeout drill: runner never observed abort signal');
      results.job_timeout_settle_ms = settleMs;
      results.job_timeout_configured_ms = TIMEOUT_MS;
    } finally {
      server.close();
    }
  }

  // ── Drill 3: claim storm — N concurrent claims on one queued job ──
  // Bounded-concurrency pillar: exactly one claim wins, losers get an
  // honest 204 (never an error), p95 recorded. The winner uniqueness is
  // the host's atomic claim contract; the client stack must not retry-
  // storm on 204.
  {
    const job: DrillJob = {
      id: 'drill-storm-1',
      spec: spec(),
      status: 'leased',
      leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
    const settle: { fail?: SettleRecord; completeAt?: number } = {};
    const stats: DrillHostStats = { claims: 0 };
    const { server, baseUrl } = await startDrillHost(job, settle, stats);
    try {
      const N = 32;
      const latencies: number[] = [];
      let winners = 0;
      let errors = 0;
      await Promise.all(
        Array.from({ length: N }, async (_, i) => {
          const client = new TaskApiClient(baseUrl, `drill-${i}`);
          const t0 = Date.now();
          try {
            const claimed = await client.claim();
            latencies.push(Date.now() - t0);
            if (claimed) winners += 1;
          } catch {
            errors += 1;
            latencies.push(Date.now() - t0);
          }
        }),
      );
      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
      console.log(`[drill:storm] N=${N} winners=${winners} errors=${errors} p95=${p95}ms claims_seen=${stats.claims}`);
      if (winners !== 1) failures.push(`claim storm: winners=${winners} (want exactly 1)`);
      if (errors !== 0) failures.push(`claim storm: errors=${errors} (want 0 — 204 is not an error)`);
      if (stats.claims !== N) failures.push(`claim storm: host saw ${stats.claims} claims (want ${N} — no retries on 204)`);
      results.claim_storm_p95_ms = p95;
      results.claim_storm_winners = winners;
      results.claim_storm_errors = errors;
    } finally {
      server.close();
    }
  }

  // ── Drill 4: lease expiry — abandoned job reclaimed, hung runner aborted ──
  // No-stranded-lease pillar: agent A claims with a 700 ms lease, its runner
  // hangs and never heartbeats (keepalive 60 s > drill window — models a
  // wedged/dead agent mid-run). After the deadline a second claimant's POST
  // /jobs/claim sweeps the expired lease (requeueExpiredLeases contract) and
  // runs the job to completion. A's wall-clock backstop aborts its runner;
  // its late settle is rejected 409 — it must never clobber B's result.
  {
    const job: DrillJob = {
      id: 'drill-lease-1',
      spec: spec(),
      status: 'leased',
      leaseExpiresAt: new Date(Date.now() + 700).toISOString(),
    };
    const settle: { fail?: SettleRecord; completeAt?: number } = {};
    const { server, baseUrl } = await startDrillHost(job, settle);
    try {
      const hostA = createJobHostFromTaskApi(new TaskApiClient(baseUrl, 'drill-token-a'));
      const observedA: { signalAt?: number } = {};
      // A's settle after reclaim races owner enforcement → expected 409. The
      // production claim loop catches it via claimErrorBackoffMs; the drill
      // records it the same way instead of crashing.
      const cycleA = runGuardedClaimLoopOnce(
        hostA,
        'agent-A',
        [hangUntilAbort(observedA)],
        { jobTimeoutMs: 4_000, keepaliveIntervalMs: 60_000 },
      ).then(
        (s) => ({ status: s, threw: '' }),
        (err) => ({ status: 'threw', threw: err instanceof Error ? err.message.slice(0, 100) : String(err) }),
      );
      await new Promise((r) => setTimeout(r, 100)); // claim landed before we measure
      const expiryAt = Date.parse(job.leaseExpiresAt);
      await new Promise((r) => setTimeout(r, Math.max(0, expiryAt + 30 - Date.now())));
      const hostB = createJobHostFromTaskApi(new TaskApiClient(baseUrl, 'drill-token-b'));
      const statusB = await runGuardedClaimLoopOnce(
        hostB,
        'agent-B',
        [instantRunner()],
        { jobTimeoutMs: 10_000, keepaliveIntervalMs: 60_000 },
      );
      const recoveryMs = settle.completeAt !== undefined ? settle.completeAt - expiryAt : -1;
      const outcomeA = await cycleA; // wall bound aborts A's hung runner at ~4s
      const settleRejectedClobber = job.status === 'succeeded';
      console.log(
        `[drill:lease] expiry→complete=${recoveryMs}ms requeues=${job.requeues} ` +
          `A_status=${outcomeA.status}${outcomeA.threw ? `(${outcomeA.threw})` : ''} ` +
          `A_aborted=${observedA.signalAt !== undefined} B_status=${statusB} final=${job.status}`,
      );
      if (statusB !== 'completed') failures.push(`lease drill: B status=${statusB} (want completed)`);
      if (job.requeues !== 1) failures.push(`lease drill: requeues=${job.requeues} (want exactly 1)`);
      if (observedA.signalAt === undefined) failures.push('lease drill: A runner never aborted — zombie');
      if (!settleRejectedClobber) {
        failures.push(`lease drill: A's stale settle clobbered B's result (final=${job.status})`);
      }
      if (recoveryMs < 0) failures.push('lease drill: job never completed after reclaim');
      results.lease_recovery_ms = recoveryMs;
      results.lease_requeues = job.requeues ?? -1;
    } finally {
      server.close();
    }
  }

  // ── Shipped default (env scrubbed — measures the code default, not tuning) ──
  results.agent_job_wall_timeout_secs = agentJobTimeoutMs(undefined) / 1000;

  results.ok = failures.length === 0 ? 1 : 0;
  console.log(`JOB_DRILL ${JSON.stringify(results)}`);
  for (const f of failures) console.error(`JOB_DRILL_FAIL ${f}`);
  clearTimeout(watchdog);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('JOB_DRILL_ERROR', err);
  process.exit(1);
});
