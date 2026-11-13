import { type JobRunnerSource } from '@w-sim/runtime';
import { TaskApiClient, createBufferedFlowUpload } from './client.ts';
import { createJobHostFromTaskApi } from './host-client.ts';
import { createAgentSolverRegistry, type AgentRunnerOptions } from './runners.ts';
import {
  agentJobTimeoutMs,
  runClaimedJobGuarded,
  runGuardedClaimLoopOnce,
} from './guarded-claim.ts';
import type { PathModelRegistry } from './path-experiment-runner.ts';
import type { JobRecord } from '../../src/types/task.ts';
import type { AgentBuildProvenance } from './build-provenance.ts';

/**
 * Best-effort terminal fail via host adapter (retryable taxonomy lives in
 * createJobHostFromTaskApi / failRetryableForMessage). Fail-endpoint errors
 * must not mask the original product reason (unknown kind, runner, lease lost).
 */
async function processJobHostFail(
  host: ReturnType<typeof createJobHostFromTaskApi>,
  jobId: string,
  attempt: number,
  error: string,
  context: string,
): Promise<void> {
  try {
    await host.fail(jobId, error, attempt);
  } catch (failErr) {
    console.warn(`[processJob] host.fail after ${context}`, failErr);
  }
}

/**
 * Run an already-claimed job through the shared guarded run/settle core
 * (runClaimedJobGuarded) — same lease/cancel/validation/telemetry semantics as
 * the claim loop, with the legacy settlement policy kept explicit:
 * complete() rejections surface raw (Host owns settlement; the lease expiry
 * requeues), and host.fail is best-effort so a fail-transport error never
 * masks the original product reason.
 *
 * @param runners Optional override (tests / claim-loop parity). Default: createAgentSolverRegistry.
 */
export async function processJob(
  client: TaskApiClient,
  job: JobRecord,
  agentId: string,
  buildProvenance?: AgentBuildProvenance,
  pathModelRegistry?: PathModelRegistry,
  runners?: JobRunnerSource,
): Promise<void> {
  console.log(`[job ${job.id}] claimed status=${job.status} name=${job.name}`);
  const host = createJobHostFromTaskApi(client);
  const flowUpload = createBufferedFlowUpload(client, job.id);
  const source: JobRunnerSource =
    runners ??
    createAgentSolverRegistry({ agentId, buildProvenance, pathModelRegistry,
      loadArtifact: (id, signal) => client.downloadModel(id, job.id, signal),
      saveArtifact: (kind, contentType, data, signal) => client.uploadArtifact(job.id, kind, contentType, data, signal),
      saveFlowSnapshot: (snapshot, signal) => flowUpload.add(snapshot, signal),
      flushFlowSnapshots: signal => flowUpload.flush(signal),
    });

  // path-experiment 的加载心跳保留在核心之外：loading 心跳失败必须
  // terminal-fail 已租约 job（best-effort fail + 原样抛出），不能悬挂到过期。
  if (job.spec.kind === 'path-experiment') {
    try {
      await client.heartbeat(job.id, {
        step: 0,
        total: job.spec.run.maxSteps,
        message: 'loading path experiment',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await processJobHostFail(host, job.id, job.attempt, msg, 'loading heartbeat');
      throw err instanceof Error ? err : new Error(msg);
    }
  }

  const outcome = await runClaimedJobGuarded(
    host,
    { jobId: job.id, spec: job.spec, attempt: job.attempt },
    agentId,
    source,
    { jobTimeoutMs: agentJobTimeoutMs() },
  );
  if (outcome.status !== 'completed') {
    throw new Error(outcome.message ?? `job ${outcome.status}`);
  }
  const result = outcome.result!;
  if (job.spec.kind === 'path-experiment') {
    console.log(`[job ${job.id}] path experiment succeeded steps=${result.summary.steps}`);
  } else {
    console.log(
      `[job ${job.id}] succeeded steps=${result.summary.steps} ` +
        `Cd=${result.summary.cd?.toFixed(4)} wall=${result.summary.wallTimeMs}ms`,
    );
  }
}

/**
 * Largest delay setTimeout honors (2^31 - 1). Node clamps anything larger to
 * 1ms, which would silently turn the daemon poll into a hot claim loop.
 */
export const MAX_CLAIM_POLL_MS = 2_147_483_647;

/**
 * pollMs must be a usable positive delay. NaN / 0 / negative / Infinity /
 * >MAX all collapse setTimeout to ~0–1ms, making the daemon's idle *and* error
 * sleeps an unbounded hot loop hammering POST /jobs/claim (CLI `--poll`
 * residual after bounding control-plane HTTP calls: the request now times out
 * at 30s, but the retry cadence itself stayed unvalidated). Reject instead of
 * clamping so a bad flag surfaces as an explicit config error.
 */
export function assertUsableClaimPollMs(pollMs: number): void {
  if (!Number.isFinite(pollMs) || pollMs < 1 || pollMs > MAX_CLAIM_POLL_MS) {
    throw new Error(
      `claim loop pollMs must be a finite number in [1, ${MAX_CLAIM_POLL_MS}] ms; got ${pollMs}`,
    );
  }
}

/**
 * Error-path backoff cap: a sustained host outage or revoked token used to
 * retry at flat pollMs forever (≈43k error lines/day/agent at the default
 * 2s). Doubles per consecutive failure, capped — the agent stays alive to
 * self-heal transient outages without log-spamming the host.
 */
export const CLAIM_ERROR_BACKOFF_CAP_MS = 60_000;

export function claimErrorBackoffMs(pollMs: number, consecutiveErrors: number): number {
  const shift = Math.min(Math.max(0, consecutiveErrors - 1), 10);
  return Math.min(pollMs * 2 ** shift, CLAIM_ERROR_BACKOFF_CAP_MS);
}

/**
 * Claim-cycle error class for ops triage. A 401/403 from the host means the
 * AGENT_TOKEN is revoked/invalid — retries keep running (un-revoke or token
 * rotation self-heals) but the condition is *not* transient like an outage,
 * so it must be distinguishable in logs instead of masquerading as one.
 * TaskApiClient error text carries the status (`<verb> failed: <status>`).
 */
export type ClaimErrorClass = 'auth' | 'other';

export function classifyClaimError(err: unknown): ClaimErrorClass {
  const m = err instanceof Error ? err.message : String(err);
  return /\b(401|403)\b/.test(m) ? 'auth' : 'other';
}

export async function runClaimLoop(opts: {
  client: TaskApiClient;
  agentId: string;
  once?: boolean;
  pollMs?: number;
  buildProvenance?: AgentBuildProvenance;
  pathModelRegistry?: PathModelRegistry;
  /**
   * Optional override for tests.
   * Default: createAgentSolverRegistry (path package + LBM).
   * Accepts legacy JobRunner[] or SolverRunnerRegistry.
   */
  runners?: JobRunnerSource;
  /**
   * Process shutdown (SIGTERM/SIGINT from cli.ts). Aborts the in-flight job
   * for a retryable settle, breaks poll/backoff sleeps, and exits the loop.
   */
  shutdownSignal?: AbortSignal;
}) {
  const pollMs = opts.pollMs ?? 2000;
  assertUsableClaimPollMs(pollMs);
  // Fail fast at startup on an invalid W_SIM_JOB_TIMEOUT_MS — a config error
  // must crash the agent boot, not poison every claim cycle with a throw.
  const jobTimeoutMs = agentJobTimeoutMs();
  console.log(`[agent ${opts.agentId}] claim loop started (once=${!!opts.once}, jobTimeoutMs=${jobTimeoutMs})`);

  const host = createJobHostFromTaskApi(opts.client);
  const runners =
    opts.runners ??
    ((jobId: string) => createAgentSolverRegistry({
      agentId: opts.agentId,
      buildProvenance: opts.buildProvenance,
      pathModelRegistry: opts.pathModelRegistry,
      loadArtifact: (id, signal) => opts.client.downloadModel(id, jobId, signal),
      saveArtifact: (kind, contentType, data, signal) => opts.client.uploadArtifact(jobId, kind, contentType, data, signal),
      ...((): Pick<AgentRunnerOptions, 'saveFlowSnapshot' | 'flushFlowSnapshots'> => {
        const buffer = createBufferedFlowUpload(opts.client, jobId);
        return { saveFlowSnapshot: (snapshot, signal) => buffer.add(snapshot, signal), flushFlowSnapshots: signal => buffer.flush(signal) };
      })(),
    }));

  let consecutiveErrors = 0;
  for (;;) {
    if (opts.shutdownSignal?.aborted) {
      console.log(`[agent ${opts.agentId}] shutdown requested — exiting claim loop`);
      return;
    }
    try {
      const status = await runGuardedClaimLoopOnce(host, opts.agentId, runners, {
        shutdownSignal: opts.shutdownSignal,
        jobTimeoutMs,
      });
      consecutiveErrors = 0;
      if (status === 'idle') {
        if (opts.once) {
          console.log('[agent] no job, exit');
          return;
        }
        if (!(await sleep(pollMs, opts.shutdownSignal))) return;
        continue;
      }
      if (status === 'failed' || status === 'lease_lost' || status === 'cancelled') {
        console.error(
          `[agent ${opts.agentId}] claim cycle ${status} (host.fail already called when applicable)`,
        );
      }
      if (status === 'requeued') {
        console.log(`[agent ${opts.agentId}] Host acknowledged requeue`);
      }
      if (opts.once) return;
    } catch (err) {
      consecutiveErrors += 1;
      const backoffMs = claimErrorBackoffMs(pollMs, consecutiveErrors);
      const hint =
        classifyClaimError(err) === 'auth'
          ? ' AUTH — host rejected AGENT_TOKEN (revoked/invalid); fix the token, retries continue'
          : '';
      console.error(`[loop] claim error #${consecutiveErrors}${hint}; retry in ${backoffMs}ms`, err);
      if (opts.once) throw err;
      if (!(await sleep(backoffMs, opts.shutdownSignal))) return;
    }
  }
}

/** Resolves false early when the shutdown signal fires mid-sleep. */
function sleep(ms: number, shutdownSignal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function onAbort() { clearTimeout(t); resolve(false); }
    function done() {
      shutdownSignal?.removeEventListener('abort', onAbort);
      resolve(true);
    }
    if (shutdownSignal?.aborted) { clearTimeout(t); resolve(false); return; }
    shutdownSignal?.addEventListener('abort', onAbort, { once: true });
  });
}
