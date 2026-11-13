/**
 * Product-side claim cycle guards on top of @w-sim/runtime ports.
 *
 * - Lease loss: refuse authoritative terminal publish when renewLease returns null.
 * - Cancel: interrupt via AbortSignal when the runner supports it, otherwise
 *   surface an explicit "unable to interrupt" diagnostic.
 *
 * Settlement remains Host-owned; this only gates complete/fail.
 */

import type { JobProgress, JobResultV1, JobSpecV1 } from '@w-sim/contracts';
import {
  resolveJobRunner,
  claimOutcomeStatus,
  readJobHostOutcome,
  type JobHostClient,
  type JobHostOutcome,
  type JobRunner,
  type JobRunnerSource,
} from '@w-sim/runtime';
import type { JobHostClientWithProgressLease } from './host-client.ts';
import {
  HostJobCancelledError,
  isUsableLeaseDeadline,
  LEASE_CLOCK_SKEW_MS,
  SOFT_LEASE_RENEW_MS,
} from './lease-deadline.ts';
import { assertCompleteResult } from './validate-result.ts';
import { finishAgentPhase, startAgentPhase, withAgentTrace } from './radar-telemetry.ts';
import {
  agentGitSha,
  beginRunTelemetry,
  cudaBackendUsed,
  drainFallbackReason,
  emitRunTelemetry,
  endRunTelemetry,
} from './run-telemetry.ts';

export const LEASE_LOST_MESSAGE = 'lease lost: refusing stale terminal publish';
export const UNABLE_TO_INTERRUPT_MESSAGE =
  'unable to interrupt: runner does not honor cancellation signal';
/**
 * Past the last-known lease deadline, a still-failing renewal means ownership
 * is no longer provable — abort and settle as a *retryable* failure. Unlike
 * LEASE_LOST this is not a definitive host rejection, so it must not classify
 * as non-retryable (a clock-skew false positive would permanently fail a job
 * the agent still leases).
 */
export const LEASE_RENEWAL_UNREACHABLE_MESSAGE =
  'lease renewal unreachable past last known deadline';

/** Terminal message when the agent process itself is shutting down — retryable, never lease_lost/cancelled. */
export const AGENT_SHUTDOWN_MESSAGE = 'agent shutting down';

/**
 * Job wall-clock bound hit before the runner finished — retryable failure.
 * Deliberately free of "abort"/"cancel"/"lease" wording so settlement
 * classifies as a plain retryable fail, never cancelled/lease_lost.
 */
export const JOB_WALL_TIMEOUT_MESSAGE = 'job wall-clock timeout exceeded';

/**
 * Hard wall-clock bound per claimed run/settle cycle across ALL backends.
 * W_SIM_NATIVE_TIMEOUT_MS bounds each native subcommand spawn, but an
 * in-process (wasm/dawn) runner that hangs while still heartbeating would
 * otherwise renew its lease forever — the keepalive only stops on lease
 * loss, host cancel, or shutdown. This bound is the backstop: on expiry the
 * run is aborted and settles as a retryable failure with
 * JOB_WALL_TIMEOUT_MESSAGE.
 *
 * W_SIM_JOB_TIMEOUT_MS (default 3600000 = 1h, clamp [1s, 24h]) — aligned
 * with the platform W_COMPUTE_MAX_WALL_TIME_MS ceiling. Fleets running
 * longer jobs must also raise W_SIM_NATIVE_TIMEOUT_MS (per-spawn bound
 * still applies inside the job bound).
 */
export function agentJobTimeoutMs(env: string | undefined = process.env.W_SIM_JOB_TIMEOUT_MS): number {
  const parsed = env === undefined ? 3_600_000 : Number(env);
  if (!Number.isFinite(parsed) || parsed < 1_000 || parsed > 86_400_000) {
    throw new Error(`W_SIM_JOB_TIMEOUT_MS must be a finite ms in [1000, 86400000] (got ${JSON.stringify(env)})`);
  }
  return Math.floor(parsed);
}

/**
 * True when a fail/error message is lease-loss (exact constant or /lease lost/i).
 * Used so HTTP fail(retryable) and processJob classify lease loss consistently.
 */
export function isLeaseLostFailMessage(message: string): boolean {
  return message === LEASE_LOST_MESSAGE || /lease lost/i.test(message);
}

/**
 * retryable flag for TaskApiClient.fail / host adapter:
 * lease loss → false (do not requeue for another agent under stale ownership);
 * all other product fails → true (peer reclaim / retry).
 */
export function failRetryableForMessage(message: string): boolean {
  return !isLeaseLostFailMessage(message);
}

/** Backward-compatible name; the shared runner contract now includes optional cancellation. */
export type InterruptibleJobRunner = JobRunner;

export type GuardedClaimStatus =
  | 'idle'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'lease_lost'
  | 'requeued';

export type GuardedClaimOptions = {
  /**
   * Optional cancel probe (e.g. memory host cancelRequested / host.requestCancel state).
   * Called around progress and before terminal publish.
   */
  isCancelRequested?: (jobId: string) => boolean | Promise<boolean>;
  /**
   * When true (default), require renewLease success before complete when host supports it.
   * If host has no renewLease, lease guard is a no-op (Host HTTP may encode lease in complete).
   */
  requireLeaseForPublish?: boolean;
  /**
   * Keepalive interval for silent runners (lease renew + cancel probe independent of
   * progress events). Default 15000 ms; clamped to >= 100 ms. Tune down for short
   * leases, up to reduce heartbeat load — never longer than the host lease window.
   */
  keepaliveIntervalMs?: number;
  /**
   * Clock-skew margin applied to the last-known lease deadline: a still-failing
   * renewal only aborts the run once `now > deadline + skew`. Default
   * LEASE_CLOCK_SKEW_MS (5000). Tests may shrink it to exercise the bound.
   */
  leaseSkewMs?: number;
  /** @deprecated Completion attempts are irreversible; errors surface for Host reconciliation. */
  failOnCompleteError?: boolean;
  /** @deprecated Fail acknowledgements are validated; ambiguous writes surface for reconciliation. */
  bestEffortFail?: boolean;
  /**
   * Process shutdown signal (SIGTERM/SIGINT). On abort the in-flight run is
   * interrupted and settled as a retryable failure with
   * AGENT_SHUTDOWN_MESSAGE — the job is released for immediate reclaim
   * instead of idling out the lease window on every deploy/restart.
   */
  shutdownSignal?: AbortSignal;
  /**
   * Hard wall-clock bound for the whole run/settle cycle (ms). Default:
   * agentJobTimeoutMs() (W_SIM_JOB_TIMEOUT_MS or 1h). On expiry the run is
   * aborted and settles as a retryable failure with JOB_WALL_TIMEOUT_MESSAGE.
   * Values are used as-is — env validation/clamping lives in
   * agentJobTimeoutMs(); pass Infinity to disable (tests).
   */
  jobTimeoutMs?: number;
};

/** A claimed job handed to the shared run/settle core. */
export type GuardedClaimedJob = {
  jobId: string;
  spec: JobSpecV1;
  attempt: number;
  leaseExpiresAt?: string;
};

/** Terminal outcome of a run/settle cycle ('idle' never occurs post-claim). */
export type GuardedRunOutcome = {
  status: Exclude<GuardedClaimStatus, 'idle'>;
  /** Terminal product error text for failed/cancelled/lease_lost. */
  message?: string;
  /** Settled result on completed (and where already produced on failure). */
  result?: JobResultV1;
};

/**
 * Before publishing a success result, confirm the agent still holds the lease.
 * Returns true when publish is allowed. A rejected lease probe is already a
 * definitive host-side ownership decision, so do not issue a second terminal
 * mutation under a lease the host has denied.
 */
export async function ensureLeaseForTerminalPublish(
  host: JobHostClient,
  jobId: string,
  agentId: string,
): Promise<{ ok: true } | { ok: false; reason: 'lease_lost' }> {
  if (!host.renewLease) return { ok: true };
  const renewed = await host.renewLease(jobId, agentId);
  if (renewed == null) {
    return { ok: false, reason: 'lease_lost' };
  }
  return { ok: true };
}

/**
 * One claim-run-complete cycle with product lease + cancel guards.
 * Prefer this over bare runClaimLoopOnce for long-running backend agents.
 */
export async function runGuardedClaimLoopOnce(
  host: JobHostClient,
  agentId: string,
  runners: JobRunnerSource | ((jobId: string) => JobRunnerSource),
  opts?: GuardedClaimOptions,
): Promise<GuardedClaimStatus> {
  const claimed = await host.claim(agentId);
  if (!claimed) return 'idle';
  const outcome = await runClaimedJobGuarded(host, claimed, agentId, runners, opts);
  return outcome.status;
}

/**
 * Run/settle core for an already-claimed job — shared by the claim loop and
 * processJob's one-off dispatch so lease, cancel, validation, telemetry, and
 * terminal-publish semantics cannot drift apart.
 */
export async function runClaimedJobGuarded(
  host: JobHostClient,
  claimed: GuardedClaimedJob,
  agentId: string,
  runners: JobRunnerSource | ((jobId: string) => JobRunnerSource),
  opts?: GuardedClaimOptions,
): Promise<GuardedRunOutcome> {
  beginRunTelemetry();
  return withAgentTrace(claimed.spec.kind, claimed.jobId, () =>
    runClaimedJobGuardedCore(host, claimed, agentId, runners, opts));
}

async function runClaimedJobGuardedCore(
  host: JobHostClient,
  claimed: GuardedClaimedJob,
  agentId: string,
  runners: JobRunnerSource | ((jobId: string) => JobRunnerSource),
  opts?: GuardedClaimOptions,
): Promise<GuardedRunOutcome> {
  const requireLease = opts?.requireLeaseForPublish !== false;
  const failJob = async (message: string): Promise<JobHostOutcome> => {
    if (!Number.isSafeInteger(claimed.attempt) || claimed.attempt < 0) {
      throw new Error(`invalid claimed attempt for job ${claimed.jobId}`);
    }
    return readJobHostOutcome(await host.fail(claimed.jobId, message, claimed.attempt), claimed.jobId);
  };
  const settlement = { phase: 'run' as 'run' | 'complete' | 'fail' };

  // Per-attempt telemetry: one [agent:telemetry] JSON line per claimed job —
  // grep-able backend/latency/fallback accounting for the CUDA gate.
  const runStartedAt = Date.now();
  let telemetryEmitted = false;
  const emitTelemetry = (
    status: 'completed' | 'failed' | 'cancelled' | 'lease_lost' | 'requeued',
    result?: JobResultV1,
    error?: unknown,
  ) => {
    if (telemetryEmitted) return;
    telemetryEmitted = true;
    emitRunTelemetry({
      event: 'agent.run',
      request_id: claimed.jobId,
      kind: claimed.spec.kind,
      backend_requested: claimed.spec.requirements?.backends ?? [],
      backend_preference: process.env.W_SIM_BACKEND ?? 'auto',
      backend_used: result?.backend?.id ?? null,
      cuda_used: cudaBackendUsed(result?.backend?.id),
      device: result?.backend?.deviceName ?? null,
      latency_ms: Date.now() - runStartedAt,
      fallback_reason: drainFallbackReason(),
      git_sha: agentGitSha(),
      status,
      ...(error !== undefined
        ? { error: (error instanceof Error ? error.message : String(error)).slice(0, 300) }
        : {}),
    });
  };

  const publishFailure = async (message: string, producedResult?: JobResultV1): Promise<GuardedRunOutcome> => {
    settlement.phase = 'fail';
    let ack: JobHostOutcome;
    try {
      ack = await failJob(message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}; Host fail outcome unresolved: ${detail}`, { cause: error });
    }
    if (ack.status === 'succeeded') {
      const status = claimOutcomeStatus(ack);
      emitTelemetry('completed', ack.result);
      return { status, result: ack.result };
    }
    if (ack.status === 'failed') {
      const status = claimOutcomeStatus(ack);
      emitTelemetry('failed', producedResult, ack.error);
      return { status, message: ack.error, ...(producedResult ? { result: producedResult } : {}) };
    }
    const status = claimOutcomeStatus(ack);
    emitTelemetry(status, producedResult, message);
    return { status, message, ...(producedResult ? { result: producedResult } : {}) };
  };

  // runner 工厂本身可能抛（registry 构造、重复 kind@version、路径模型加载…）——
  // 不捕获会把异常带出本函数，host.fail 永远到不了，job 挂着租约直到过期重排。
  // 工厂异常按不可服务失败结算，与 resolve 失败同径。
  const resolveSpan = startAgentPhase('runner.resolve');
  let source: JobRunnerSource;
  try {
    source = typeof runners === 'function' ? runners(claimed.jobId) : runners;
  } catch (err) {
    finishAgentPhase(resolveSpan, 'error');
    const message = `runner factory failed: ${err instanceof Error ? err.message : String(err)}`;
    try {
      return await publishFailure(message);
    } finally {
      endRunTelemetry();
    }
  }
  const resolved = resolveJobRunner(source, claimed.spec);
  if (!resolved.ok) {
    finishAgentPhase(resolveSpan, 'error');
    try {
      return await publishFailure(resolved.message);
    } finally {
      endRunTelemetry();
    }
  }
  finishAgentPhase(resolveSpan);

  const ac = new AbortController();
  const checkCancel = async (): Promise<boolean> => {
    if (opts?.isCancelRequested) {
      return Boolean(await opts.isCancelRequested(claimed.jobId));
    }
    return ac.signal.aborted;
  };

  // Keepalive：进度静默的子进程（w-sim-cuda 长段不吐 JSONL）既不能丢租约，
  // 也不能错过取消/租约丢失——定期续租 + 探测取消，独立于进度事件。
  // 网络类瞬时失败在已知租约期限内下一轮重试；过了最后期限仍续不上说明
  // 持有已不可证明（host 侧租约此刻必然已过期），中止并按可重试失败结算。
  const keepaliveIntervalMs = Math.max(100, Math.floor(opts?.keepaliveIntervalMs ?? 15000));
  const leaseSkewMs = Math.max(0, Math.floor(opts?.leaseSkewMs ?? LEASE_CLOCK_SKEW_MS));
  // 最后已知租约期限：claim 给出的可用截止（缺失时按软续期窗口起算），
  // 每次成功续租/进度心跳都会刷新。
  let leaseDeadlineMs = isUsableLeaseDeadline(claimed.leaseExpiresAt)
    ? Date.parse(claimed.leaseExpiresAt.trim())
    : Date.now() + SOFT_LEASE_RENEW_MS;
  const noteLeaseDeadline = (renewed: string) => {
    const parsed = Date.parse(renewed);
    if (Number.isFinite(parsed)) leaseDeadlineMs = parsed;
  };
  let keepaliveError: unknown = null;
  let hostLeaseLostConfirmed = false;
  let keepaliveBusy = false;
  // Process shutdown (SIGTERM/SIGINT via runClaimLoop): abort the run and
  // settle retryable — a real lease-loss/cancel already recorded wins (??=).
  const onShutdown = () => {
    keepaliveError ??= new Error(AGENT_SHUTDOWN_MESSAGE);
    ac.abort();
  };
  // An already-aborted signal never dispatches 'abort' to a new listener —
  // fire it directly so a shutdown racing the claim→run boundary still wins.
  if (opts?.shutdownSignal?.aborted) onShutdown();
  else opts?.shutdownSignal?.addEventListener('abort', onShutdown, { once: true });
  const keepalive = setInterval(() => {
    if (keepaliveBusy || keepaliveError != null) return;
    keepaliveBusy = true;
    void (async () => {
      try {
        if (requireLease && host.renewLease) {
          const renewed = await host.renewLease(claimed.jobId, agentId);
          if (renewed == null) {
            hostLeaseLostConfirmed = true;
            keepaliveError = new Error(LEASE_LOST_MESSAGE);
            ac.abort();
            return;
          }
          noteLeaseDeadline(renewed);
        }
        if (await checkCancel()) {
          keepaliveError = new DOMException('job cancelled by host', 'AbortError');
          ac.abort();
        }
      } catch (err) {
        // HostJobCancelledError（host 明确取消）是确定终止而非瞬时故障——记录并
        // abort。其余异常（含超时形 AbortError/TimeoutError 等传输故障）按瞬时
        // 处理：期限内下一轮重试；过了最后已知期限仍续不上才中止（可重试失败，
        // 非 lease_lost——无法确认租约真的已失）。
        if (err instanceof HostJobCancelledError) {
          keepaliveError ??= err;
          ac.abort();
        } else if (Date.now() > leaseDeadlineMs + leaseSkewMs) {
          keepaliveError = new Error(LEASE_RENEWAL_UNREACHABLE_MESSAGE);
          ac.abort();
        }
      } finally {
        keepaliveBusy = false;
      }
    })();
  }, keepaliveIntervalMs);
  (keepalive as { unref?: () => void }).unref?.();

  // Job wall-clock bound (W_SIM_JOB_TIMEOUT_MS): aborts a cycle that runs
  // past the bound even while heartbeats keep the lease fresh — the
  // keepalive alone cannot catch a live-but-hung in-process runner.
  // Settles retryable-failed via keepaliveError (same path as lease loss /
  // cancel precedence: an earlier recorded reason wins).
  const jobTimeoutMs = opts?.jobTimeoutMs ?? agentJobTimeoutMs();
  const jobDeadline = Number.isFinite(jobTimeoutMs)
    ? setTimeout(() => {
        keepaliveError ??= new Error(`${JOB_WALL_TIMEOUT_MESSAGE} (${Math.floor(jobTimeoutMs)}ms)`);
        ac.abort();
      }, Math.floor(jobTimeoutMs))
    : null;
  (jobDeadline as { unref?: () => void } | null)?.unref?.();

  // Once a terminal Host write starts, ambiguous acknowledgements must surface
  // for reconciliation instead of triggering a contradictory second write.
  try {
    const onProgress = async (p: JobProgress) => {
      try {
        // One POST per progress event when the client reports the lease deadline
        // the heartbeat response already carries (progressWithLease); otherwise
        // the legacy progress + renewLease pair.
        const progressWithLease = (host as JobHostClientWithProgressLease).progressWithLease;
        const renewedFromProgress =
          typeof progressWithLease === 'function'
            ? await progressWithLease.call(host, claimed.jobId, p)
            : (await host.progress(claimed.jobId, p), undefined);

        if (requireLease && host.renewLease) {
          const renewed =
            renewedFromProgress ?? (await host.renewLease(claimed.jobId, agentId));
          if (renewed == null) {
            hostLeaseLostConfirmed = true;
            throw new Error(LEASE_LOST_MESSAGE);
          }
          noteLeaseDeadline(renewed);
        } else if (renewedFromProgress !== undefined) {
          // progressWithLease 的心跳已续租——即使无独立 renewLease 端口也刷新期限。
          noteLeaseDeadline(renewedFromProgress);
        }

        // Prefer cooperative cancel; runners that ignore signal surface unable-to-interrupt later.
        if (await checkCancel()) {
          throw new DOMException('job cancelled by host', 'AbortError');
        }
      } catch (err) {
        // Lease-shaped termination (404/409 / "lease lost") is delivered via the
        // abort signal so runners that fire-and-forget onProgress still
        // interrupt; keepaliveError records the reason so post-run
        // classification stays lease_lost rather than runner exit noise.
        // A 409 whose body says the job was cancelled classifies as cancelled
        // (AbortError) — host cancel is not lease loss.
        const m = err instanceof Error ? err.message : String(err);
        if (err instanceof HostJobCancelledError || (/\b409\b/.test(m) && /cancelled/i.test(m))) {
          keepaliveError ??= err instanceof HostJobCancelledError ? err : new HostJobCancelledError();
          ac.abort();
          return;
        }
        if (isLeaseLostFailMessage(m) || /\b(404|409)\b/.test(m)) {
          // Only an explicit host HTTP rejection proves the lease is gone;
          // a runner's lease-shaped message remains an ordinary reportable error.
          if (/\b(404|409)\b/.test(m)) hostLeaseLostConfirmed = true;
          keepaliveError ??= new Error(LEASE_LOST_MESSAGE);
          ac.abort();
          return;
        }
        // Cancel/AbortError and non-terminal errors still propagate to
        // awaiting runners — aborting too, so fire-and-forget callers get the
        // signal; a runner that swallows the cancel must still surface
        // unable-to-interrupt at the post-run check.
        ac.abort();
        throw err;
      }
    };

    // Always forward cancellation. Function.length is not a capability signal:
    // default parameters reduce it, and registry adapters must forward it too.
    const executionSpan = startAgentPhase('model.execute');
    let result: JobResultV1;
    try {
      result = await resolved.runner.run(claimed.spec, onProgress, ac.signal);
      finishAgentPhase(executionSpan);
    } catch (error) {
      finishAgentPhase(executionSpan, 'error');
      throw error;
    }
    // keepalive 在 run 正常返回前已判定 lease-lost/cancel：按其语义结算，
    // 不把子进程的 exit-signal 噪音当成真实失败原因。
    if (keepaliveError != null) throw keepaliveError;

    // Settlement-boundary validation (parity with processJob / runners.ts):
    // a custom runner that skips its own assertCompleteResult must not push a
    // malformed payload into an authoritative complete. Validation precedes
    // the lease gate so a bad result reports its own reason, not lease noise.
    assertCompleteResult(result, claimed.spec.requirements?.backends);

    // Post-run ownership first: when cancel and lease loss both apply, prefer
    // lease_lost (non-retryable) over unable-to-interrupt (wave34 race honesty).
    // Mid-progress onProgress already checks renew before cancel.
    if (requireLease) {
      const lease = await ensureLeaseForTerminalPublish(host, claimed.jobId, agentId);
      if (!lease.ok) {
        emitTelemetry('lease_lost', result, LEASE_LOST_MESSAGE);
        return { status: 'lease_lost', message: LEASE_LOST_MESSAGE, result };
      }
    }

    if (await checkCancel()) {
      ac.abort();
      // Runner finished without honoring cancel → explicit diagnostic (not silent success).
      return await publishFailure(UNABLE_TO_INTERRUPT_MESSAGE, result);
    }

    settlement.phase = 'complete';
    const publishSpan = startAgentPhase('job.publish');
    let ack: JobHostOutcome;
    try {
      if (!Number.isSafeInteger(claimed.attempt) || claimed.attempt < 0) {
        throw new Error(`invalid claimed attempt for job ${claimed.jobId}`);
      }
      ack = readJobHostOutcome(await host.complete(claimed.jobId, result, claimed.attempt), claimed.jobId);
      finishAgentPhase(publishSpan);
    } catch (error) {
      finishAgentPhase(publishSpan, 'error');
      throw error;
    }
    if (ack.status === 'succeeded') {
      const status = claimOutcomeStatus(ack);
      emitTelemetry('completed', ack.result);
      return { status, result: ack.result };
    }
    if (ack.status === 'failed') {
      const status = claimOutcomeStatus(ack);
      emitTelemetry('failed', undefined, ack.error);
      return { status, message: ack.error };
    }
    const status = claimOutcomeStatus(ack);
    emitTelemetry(status, undefined, status === 'cancelled' ? 'cancelled by Host' : 'Host requeued job');
    return { status, message: status === 'cancelled' ? 'cancelled by Host' : 'Host requeued job' };
  } catch (e) {
    // keepalive 检出的 lease-lost/cancel 优先于子进程被 SIGKILL 后的退出噪音。
    const err = keepaliveError ?? e;
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : '';

    // A host-confirmed terminal race is already settled or no longer owned.
    // Do not send a second fail request that can turn the intended outcome
    // into an outer claim-loop error (or race another owner's job).
    if (hostLeaseLostConfirmed) {
      emitTelemetry('lease_lost', undefined, LEASE_LOST_MESSAGE);
      return { status: 'lease_lost', message: LEASE_LOST_MESSAGE };
    }
    if (err instanceof HostJobCancelledError) {
      emitTelemetry('cancelled', undefined, err.message);
      return { status: 'cancelled', message: err.message };
    }

    // A complete write may have committed even when its acknowledgement was
    // lost or malformed. Never issue a contradictory fail; surface for reconcile.
    if (settlement.phase === 'complete' || settlement.phase === 'fail') {
      emitTelemetry('failed', undefined, err);
      throw err;
    }

    const isAbort =
      name === 'AbortError' ||
      msg === LEASE_LOST_MESSAGE ||
      /abort|cancel/i.test(msg);

    if (msg === LEASE_LOST_MESSAGE || /lease lost/i.test(msg)) {
      return await publishFailure(LEASE_LOST_MESSAGE);
    }

    if (isAbort) {
      return await publishFailure(msg || 'cancelled');
    }

    return await publishFailure(msg);
  } finally {
    clearInterval(keepalive);
    if (jobDeadline != null) clearTimeout(jobDeadline);
    // The shutdown signal is process-level — a per-job listener must be
    // dropped each cycle or repeated claims accumulate listeners.
    opts?.shutdownSignal?.removeEventListener('abort', onShutdown);
    endRunTelemetry();
  }
}
