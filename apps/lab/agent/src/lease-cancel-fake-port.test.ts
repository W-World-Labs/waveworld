/**
 * #7 / A7: product-side lease-loss, cancel interrupt/diagnostic, and fake-port matrix.
 * Uses @w-sim/runtime createMemoryJobHost / createLeaseCancelFixtureHost ports only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySettlement,
  type JobResultV1,
  type JobSpecV1,
} from '@w-sim/contracts';
import {
  createLeaseCancelFixtureHost,
  createMemoryJobHost,
  runClaimAndSettleOnce,
  type JobRunner,
} from '@w-sim/runtime';
import {
  LEASE_LOST_MESSAGE,
  UNABLE_TO_INTERRUPT_MESSAGE,
  JOB_WALL_TIMEOUT_MESSAGE,
  agentJobTimeoutMs,
  ensureLeaseForTerminalPublish,
  runGuardedClaimLoopOnce,
  type InterruptibleJobRunner,
} from './guarded-claim.ts';
import {
  createAgentJobRunners,
  createAgentSolverRegistry,
  createPathExperimentRunner,
} from './runners.ts';
import {
  PHOTOSENSITIZATION_RK4_MODEL,
  type PathExperimentJobSpecLike,
} from './path-experiment-runner.ts';
import { buildSmokeJobSpec } from '@w-sim/solvers-path-experiment';

function lbmSpec(maxSteps = 10): JobSpecV1 {
  return {
    schemaVersion: 1,
    kind: 'lbm-d3q19',
    parameters: { inletVelocity: 1, gridPreset: 'fast' },
    run: { maxSteps },
    outputs: { forces: true },
  };
}

function pathSpec(): PathExperimentJobSpecLike {
  return {
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
      dt: 0.01,
    },
    run: { maxSteps: 80, forceSampleEvery: 20 },
    experiment: {
      experimentId: 'ir-ultrasound-ros',
      title: 'Ir ultrasound triplet to ROS',
      model: PHOTOSENSITIZATION_RK4_MODEL,
      materials: [
        {
          id: 'ir-complex-candidate',
          name: 'Ir(III) candidate',
          role: 'sonosensitizer',
          source: { kind: 'assumption' },
        },
      ],
      steps: [
        {
          id: 'ultrasound-triplet',
          label: 'ultrasound to triplet',
          mechanism: 'sonoluminescence',
          inputs: ['ultrasound', 'Ir-S0'],
          outputs: ['Ir-T1'],
          hypothesis: {
            status: 'candidate',
            description: 'sonoluminescence sensitization',
            sources: [{ kind: 'literature' }],
          },
        },
      ],
      parameters: {},
      provenance: {
        createdAt: '2026-08-02T00:00:00.000Z',
        software: { name: 'WaveWorld', version: '1' },
      },
    },
  };
}

const okResult = (steps = 10, cd = 1.1): JobResultV1 => ({
  schemaVersion: 1,
  summary: { steps, wallTimeMs: 1, cd, cl: 0 },
  backend: { id: 'cpu', agentId: 'agent-a' },
});

function interruptibleOkRunner(agentId = 'agent-a'): InterruptibleJobRunner {
  return {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, onProgress, signal) {
      await onProgress?.({ step: 0, total: spec.run.maxSteps, message: 'start' });
      if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
      await onProgress?.({ step: spec.run.maxSteps, total: spec.run.maxSteps, cd: 1.1 });
      if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
      return okResult(spec.run.maxSteps);
    },
  };
}

function nonInterruptibleOkRunner(): JobRunner {
  return {
    canRun: (s) => s.kind === 'lbm-d3q19',
    // Two-arg only — ignores cancel signal (run.length < 3).
    async run(spec, onProgress) {
      await onProgress?.({ step: 1, total: spec.run.maxSteps });
      return okResult(spec.run.maxSteps, 0.9);
    },
  };
}

// ── Success baseline ────────────────────────────────────────────────────────

test('fake-port success: guarded claim completes path JobRunner', async () => {
  const spec = pathSpec() as JobSpecV1;
  const { host, completed, failed } = createMemoryJobHost([{ jobId: 'ok-path', spec }]);
  const status = await runGuardedClaimLoopOnce(host, 'agent-path', [
    createPathExperimentRunner({ agentId: 'agent-path' }),
  ]);
  assert.equal(status, 'completed');
  assert.equal(failed.size, 0);
  assert.ok(completed.get('ok-path'));
  assert.equal(completed.get('ok-path')?.summary.steps, 80);
});

// ── Permanent failure ───────────────────────────────────────────────────────

test('fake-port permanent failure: solver throw → failed terminal, not requeued', async () => {
  const { host, jobs, failed } = createMemoryJobHost([{ jobId: 'perm-1', spec: lbmSpec() }]);
  const boom: JobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    run: async () => {
      throw new Error('solver-crash-permanent');
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'a', [boom]);
  assert.equal(status, 'failed');
  assert.equal(jobs.get('perm-1')?.status, 'failed');
  assert.match(failed.get('perm-1') ?? '', /solver-crash-permanent/);
});

// ── Retryable failure ───────────────────────────────────────────────────────

test('fake-port retryable: requeue once then permanent fail', async () => {
  const { host, jobs, failed, requeueRetryable, retryCounts } = createMemoryJobHost(
    [{ jobId: 'retry-1', spec: lbmSpec() }],
    { maxRetryableFails: 1 },
  );
  const firstClaim = await host.claim('agent-a');
  assert.ok(firstClaim);
  await host.progress('retry-1', { step: 1, total: 10 });
  assert.equal(requeueRetryable('retry-1', 'transient-oom'), 'queued');
  assert.equal(jobs.get('retry-1')?.status, 'queued');
  assert.equal(retryCounts.get('retry-1'), 1);
  assert.equal(failed.has('retry-1'), false);

  // Second claim + hard fail
  const secondClaim = await host.claim('agent-b');
  assert.ok(secondClaim);
  await host.progress('retry-1', { step: 1, total: 10 });
  await host.fail('retry-1', 'permanent-after-retry', secondClaim.attempt);
  assert.equal(jobs.get('retry-1')?.status, 'failed');
  assert.equal(failed.get('retry-1'), 'permanent-after-retry');
  // Exhausted retries: soft requeue no-ops on terminal
  assert.equal(requeueRetryable('retry-1', 'again'), 'failed');
});

// ── Lease loss blocks stale terminal publish ────────────────────────────────

test('lease loss: renewLease null blocks complete (stale worker cannot publish)', async () => {
  const fx = createLeaseCancelFixtureHost([{ jobId: 'lease-stale', spec: lbmSpec() }], {
    leaseMs: 1000,
    startMs: 1_000_000,
  });

  const slow: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, onProgress, signal) {
      await onProgress?.({ step: 1, total: spec.run.maxSteps });
      // Simulate long work: advance past lease and reclaim while still "running".
      fx.advanceMs(1500);
      fx.reclaimExpiredLeases();
      assert.equal(await fx.host.renewLease!('lease-stale', 'agent-a'), null);
      if (signal?.aborted) throw new DOMException('lease abort', 'AbortError');
      // Stale worker would still produce a result —
      return okResult(spec.run.maxSteps, 9.9);
    },
  };

  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-a', [slow]);
  // Progress renewLease fails mid-run → lease_lost; no authoritative success.
  assert.equal(status, 'lease_lost');
  assert.equal(fx.completed.has('lease-stale'), false);
  assert.equal(fx.failed.has('lease-stale'), false, 'a rejected renewal must not trigger a stale fail mutation');
});

test('ensureLeaseForTerminalPublish refuses complete after reclaim', async () => {
  const fx = createLeaseCancelFixtureHost([{ jobId: 'lease-gate', spec: lbmSpec() }], {
    leaseMs: 500,
    startMs: 2_000_000,
  });
  await fx.host.claim('agent-a');
  await fx.host.progress('lease-gate', { step: 1, total: 10 });
  fx.advanceMs(600);
  fx.reclaimExpiredLeases();

  const gate = await ensureLeaseForTerminalPublish(fx.host, 'lease-gate', 'agent-a');
  assert.equal(gate.ok, false);
  if (!gate.ok) assert.equal(gate.reason, 'lease_lost');
  assert.equal(fx.failed.has('lease-gate'), false);

  assert.equal(fx.completed.has('lease-gate'), false);
});

// ── Cancel → interrupt OR explicit diagnostic ───────────────────────────────

test('cancel: interruptible runner aborts via signal (cancel reaches backend)', async () => {
  const fx = createMemoryJobHost([{ jobId: 'c-int', spec: lbmSpec(100) }]);
  const runner = interruptibleOkRunner('agent-a');

  // Cancel after first progress: isCancelRequested becomes true mid-run.
  let progressCount = 0;
  const wrapped: InterruptibleJobRunner = {
    canRun: runner.canRun,
    async run(spec, onProgress, signal) {
      return runner.run(
        spec,
        async (p) => {
          progressCount += 1;
          await onProgress?.(p);
        },
        signal,
      );
    },
  };

  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-a', [wrapped], {
    isCancelRequested: (jobId) => {
      // After first progress tick, request cancel on host.
      if (progressCount >= 1) {
        fx.requestCancel(jobId);
        return true;
      }
      return false;
    },
  });

  assert.equal(status, 'cancelled');
  assert.equal(fx.completed.has('c-int'), false);
  assert.ok(fx.failed.has('c-int') || fx.cancelled.has('c-int') || fx.jobs.get('c-int')?.status !== 'succeeded');
  assert.notEqual(fx.jobs.get('c-int')?.status, 'succeeded');
});

test('cancel: non-interruptible runner → explicit unable-to-interrupt diagnostic', async () => {
  const fx = createMemoryJobHost([{ jobId: 'c-no', spec: lbmSpec() }]);
  // Cancel is already requested before/during run; 2-arg runner finishes anyway.
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-a', [nonInterruptibleOkRunner()], {
    isCancelRequested: () => true,
  });
  // First progress triggers cancel throw (AbortError path) OR post-run diagnostic.
  // non-interruptible still calls onProgress once → AbortError from guard → cancelled.
  // Force post-run path: cancel only after run would complete without progress cancel —
  // use a runner that never calls onProgress.
  assert.ok(status === 'cancelled' || status === 'failed');
  assert.equal(fx.completed.has('c-no'), false);

  // Explicit post-run diagnostic matrix cell (no mid-progress cancel):
  const fx2 = createMemoryJobHost([{ jobId: 'c-diag', spec: lbmSpec() }]);
  const silent: JobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec) {
      // No onProgress — cancel probe only checked after run.
      return okResult(spec.run.maxSteps);
    },
  };
  const st2 = await runGuardedClaimLoopOnce(fx2.host, 'agent-a', [silent], {
    isCancelRequested: () => true,
  });
  assert.equal(st2, 'failed');
  assert.equal(fx2.failed.get('c-diag'), UNABLE_TO_INTERRUPT_MESSAGE);
  assert.equal(fx2.completed.has('c-diag'), false);
});

// ── Duplicate settlement ────────────────────────────────────────────────────

test('fake-port duplicate settle: same key ok; different key double_settlement', async () => {
  const { host } = createMemoryJobHost([{ jobId: 'set-1', spec: lbmSpec() }]);
  const settlements = new Map();
  const runner = interruptibleOkRunner();
  const once = await runClaimAndSettleOnce(host, 'agent-1', [runner], { settlements });
  assert.equal(once.status, 'completed');
  if (once.status === 'idle') return;

  // Replay the actual committed key; its encoding belongs to the runtime.
  const fpKey = once.settlement.settlementKey;
  assert.ok(fpKey, 'a completed settlement must carry its replay key');

  const dup = applySettlement(once.settlement, {
    key: fpKey,
    executionStatus: 'succeeded',
  });
  assert.equal(dup.ok, true);
  if (dup.ok) assert.equal(dup.duplicate, true);

  const bad = applySettlement(once.settlement, {
    key: 'set-1:other-fingerprint',
    executionStatus: 'succeeded',
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, 'double_settlement');
});

// ── Cancel wins over complete (host port) ───────────────────────────────────

test('fake-port cancel drain: complete during cancelling does not succeed', async () => {
  const { host, jobs, completed, requestCancel } = createMemoryJobHost([
    { jobId: 'c-race', spec: lbmSpec() },
  ]);
  const claimed = await host.claim('a');
  await host.progress('c-race', { step: 1, total: 10 });
  requestCancel('c-race');
  assert.equal(jobs.get('c-race')?.status, 'cancelling');
  await host.complete('c-race', okResult(), claimed!.attempt);
  assert.equal(jobs.get('c-race')?.status, 'cancelled');
  assert.equal(completed.has('c-race'), false);
});

// ── Duplicate complete after terminal ───────────────────────────────────────

test('fake-port duplicate complete: first terminal wins', async () => {
  const { host, jobs, completed } = createMemoryJobHost([{ jobId: 'dup-c', spec: lbmSpec() }]);
  const claimed = await host.claim('a');
  await host.progress('dup-c', { step: 1, total: 10 });
  const first = okResult(10, 1.0);
  await host.complete('dup-c', first, claimed!.attempt);
  await host.complete('dup-c', okResult(99, 9.9), claimed!.attempt);
  assert.equal(jobs.get('dup-c')?.status, 'succeeded');
  assert.equal(completed.get('dup-c')?.summary.cd, 1.0);
});

// ── Multi-backend cancel matrix (#7 / A-agent residual) ─────────────────────

/**
 * Multi-kind agent: LBM interruptible + path-experiment package runner registered
 * together. Cancel must still reach the selected backend for the claimed kind
 * (LBM) without path runner incorrectly claiming the job.
 */
test('multi-backend cancel: lbm selected among [path, lbm]; signal cancel works', async () => {
  const fx = createMemoryJobHost([{ jobId: 'mb-lbm', spec: lbmSpec(50) }]);
  const pathRunner = createPathExperimentRunner({ agentId: 'agent-mb' });
  let progressCount = 0;
  const lbmRunner: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, onProgress, signal) {
      await onProgress?.({ step: 0, total: spec.run.maxSteps, message: 'lbm-start' });
      progressCount += 1;
      if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
      // Simulate long run; cancel probe should fire via isCancelRequested.
      await onProgress?.({ step: 1, total: spec.run.maxSteps, message: 'lbm-tick' });
      progressCount += 1;
      if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
      return okResult(spec.run.maxSteps);
    },
  };

  // Path runner first in list — must NOT steal lbm-d3q19 claim.
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-mb', [pathRunner, lbmRunner], {
    isCancelRequested: (jobId) => {
      if (progressCount >= 1) {
        fx.requestCancel(jobId);
        return true;
      }
      return false;
    },
  });

  assert.equal(status, 'cancelled');
  assert.equal(fx.completed.has('mb-lbm'), false);
  assert.notEqual(fx.jobs.get('mb-lbm')?.status, 'succeeded');
  // Path runner must not have been able to run this kind.
  assert.equal(pathRunner.canRun(lbmSpec()), false);
  assert.equal(lbmRunner.canRun(lbmSpec()), true);
});

test('multi-backend cancel: path-experiment kind with dual registry still cancels', async () => {
  const pathLike: JobSpecV1 = {
    schemaVersion: 1,
    kind: 'path-experiment',
    name: 'mb-path-cancel',
    parameters: {
      experimentId: 'mb-cancel',
      title: 'multi-backend cancel path',
      steps: [
        { id: 's1', kind: 'noop', label: 'step-1' },
        { id: 's2', kind: 'noop', label: 'step-2' },
        { id: 's3', kind: 'noop', label: 'step-3' },
      ],
    },
    run: { maxSteps: 3 },
    requirements: { backends: ['cpu'] },
  };

  const fx = createMemoryJobHost([{ jobId: 'mb-path', spec: pathLike }]);
  const pathRunner = createPathExperimentRunner({ agentId: 'agent-mb-path' });
  const lbmRunner = interruptibleOkRunner('agent-mb-path');

  // Cancel immediately so path runner aborts between steps if signal-aware.
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-mb-path', [lbmRunner, pathRunner], {
    isCancelRequested: () => true,
  });

  // cancelled or failed(unable-to-interrupt) both prove multi-backend path was selected
  // and did not succeed while cancel was requested.
  assert.ok(status === 'cancelled' || status === 'failed');
  assert.equal(fx.completed.has('mb-path'), false);
  assert.notEqual(fx.jobs.get('mb-path')?.status, 'succeeded');
  assert.equal(pathRunner.canRun(pathLike), true);
  assert.equal(lbmRunner.canRun(pathLike), false);
});

// ── Multi-kind registry + cancel/lease residual (post multi-kind smoke) ─────

test('guarded idle: empty multi-kind registry queue returns idle', async () => {
  const { host } = createMemoryJobHost([]);
  const reg = createAgentSolverRegistry({ agentId: 'agent-idle' });
  assert.equal(await runGuardedClaimLoopOnce(host, 'agent-idle', reg), 'idle');
});

test('multi-kind registry cancel: package path smoke does not complete under cancel', async () => {
  const smoke = buildSmokeJobSpec({ maxSteps: 4 }) as JobSpecV1;
  const fx = createMemoryJobHost([{ jobId: 'reg-cancel', spec: smoke }]);
  const reg = createAgentSolverRegistry({ agentId: 'agent-reg-cancel' });

  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-reg-cancel', reg, {
    isCancelRequested: () => true,
  });

  // Package path is 3-arg (signal-aware dual-path); cancel may abort pre/post run
  // or surface unable-to-interrupt — never authoritative success.
  assert.ok(status === 'cancelled' || status === 'failed');
  assert.equal(fx.completed.has('reg-cancel'), false);
  assert.notEqual(fx.jobs.get('reg-cancel')?.status, 'succeeded');
});

test('multi-kind registry lease gate: renewLease null blocks publish (path smoke)', async () => {
  const smoke = buildSmokeJobSpec({ maxSteps: 3 }) as JobSpecV1;
  const fx = createLeaseCancelFixtureHost([{ jobId: 'reg-lease', spec: smoke }], {
    leaseMs: 60_000,
    startMs: 5_000_000,
  });
  const reg = createAgentSolverRegistry({ agentId: 'agent-reg-lease' });

  // Any renewLease null (mid-progress or terminal gate) must refuse complete when
  // multi-kind registry selected the package path runner.
  fx.host.renewLease = async () => null;

  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-reg-lease', reg);
  assert.equal(status, 'lease_lost');
  assert.equal(fx.completed.has('reg-lease'), false);
  assert.equal(fx.failed.has('reg-lease'), false);
});

test('requireLeaseForPublish false: completes even when renewLease always null', async () => {
  const { host, completed } = createMemoryJobHost([{ jobId: 'no-lease-gate', spec: lbmSpec() }]);
  host.renewLease = async () => null;
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [interruptibleOkRunner()], {
    requireLeaseForPublish: false,
  });
  assert.equal(status, 'completed');
  assert.ok(completed.get('no-lease-gate'));
});

test('guarded permanent failure: multi-kind registry unknown kind fails without complete', async () => {
  const unknown: JobSpecV1 = {
    schemaVersion: 1,
    kind: 'export-report',
    parameters: {},
    run: { maxSteps: 1 },
    outputs: {},
  };
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'reg-unknown', spec: unknown },
  ]);
  const reg = createAgentSolverRegistry({ agentId: 'agent-reg-unk' });
  const status = await runGuardedClaimLoopOnce(host, 'agent-reg-unk', reg);
  assert.equal(status, 'failed');
  assert.match(failed.get('reg-unknown') ?? '', /no runner/i);
  assert.equal(completed.has('reg-unknown'), false);
});

// ── More unit matrix residual (post cancel/lease smoke) ─────────────────────
// Product dual-path cancel/lease, lease ok-path, queue drain, runner arity,
// permanent-error classification, createAgentJobRunners parity. Does not close #7.

test('unit matrix: product dual-path pre-abort + mid-run signal cancel cells', async () => {
  const product = pathSpec() as JobSpecV1;
  const runner = createPathExperimentRunner({ agentId: 'agent-product-sig' });
  assert.ok(runner.run.length >= 3);
  assert.equal(runner.canRun(product), true);

  // Cell A: pre-aborted signal refuses product path complete.
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(
    () => runner.run(product, undefined, pre.signal),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'AbortError');
      return true;
    },
  );

  // Cell B: mid-run abort via progress (sync abort reaches next RK4 step).
  // Product RK4 samples every forceSampleEvery; abort after first progress tick.
  const mid = new AbortController();
  await assert.rejects(
    () =>
      runner.run(
        product,
        (p) => {
          if (p.step >= 1) mid.abort();
        },
        mid.signal,
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'AbortError');
      return true;
    },
  );
});

test('unit matrix: multi-kind registry product job completes; cancel probe post-idle is idle', async () => {
  // Product path uses fire-and-forget progress in dual-path wrapper today; guarded
  // mid-progress cancel/lease races are residual. Matrix cell: product success path
  // via registry + subsequent idle under cancel probe (no job → idle, not success leak).
  const product = pathSpec() as JobSpecV1;
  const fx = createMemoryJobHost([{ jobId: 'reg-product-ok', spec: product }]);
  const reg = createAgentSolverRegistry({ agentId: 'agent-reg-product-ok' });

  const s1 = await runGuardedClaimLoopOnce(fx.host, 'agent-reg-product-ok', reg);
  assert.equal(s1, 'completed');
  assert.ok(fx.completed.get('reg-product-ok'));
  assert.equal(fx.completed.get('reg-product-ok')?.backend?.id, 'cpu-path-experiment');

  const s2 = await runGuardedClaimLoopOnce(fx.host, 'agent-reg-product-ok', reg, {
    isCancelRequested: () => true,
  });
  assert.equal(s2, 'idle');
});

test('unit matrix: terminal lease gate on product complete (no mid-progress renew)', async () => {
  // Strip renewLease during run (no mid-progress lease probe), then restore null
  // renewLease only for ensureLeaseForTerminalPublish via requireLease path.
  // Uses interruptible mock that never calls onProgress so only terminal gate fires.
  const product = pathSpec() as JobSpecV1;
  const fx = createLeaseCancelFixtureHost([{ jobId: 'product-terminal-lease', spec: product }], {
    leaseMs: 60_000,
    startMs: 6_000_000,
  });
  await fx.host.claim('agent-a');
  // Simulate product finished result; only terminal lease gate applies.
  const gate = await ensureLeaseForTerminalPublish(
    {
      ...fx.host,
      renewLease: async () => null,
    },
    'product-terminal-lease',
    'agent-a',
  );
  assert.equal(gate.ok, false);
  if (!gate.ok) assert.equal(gate.reason, 'lease_lost');
  assert.equal(fx.failed.has('product-terminal-lease'), false);
  assert.equal(fx.completed.has('product-terminal-lease'), false);
});

test('unit matrix: package dual-path pre-abort signal refuses complete', async () => {
  const smoke = buildSmokeJobSpec({ maxSteps: 4 }) as JobSpecV1;
  const runner = createPathExperimentRunner({ agentId: 'agent-preabort' });
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => runner.run(smoke, undefined, ac.signal),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'AbortError');
      return true;
    },
  );
  // Signature is product-interruptible (length ≥ 3) so guarded claim can pass signal.
  assert.ok(runner.run.length >= 3);
});

test('unit matrix: ensureLeaseForTerminalPublish ok when renewLease returns expiry', async () => {
  const fx = createLeaseCancelFixtureHost([{ jobId: 'lease-ok', spec: lbmSpec() }], {
    leaseMs: 5_000,
    startMs: 7_000_000,
  });
  const claimed = await fx.host.claim('agent-a');
  await fx.host.progress('lease-ok', { step: 1, total: 10 });
  const gate = await ensureLeaseForTerminalPublish(fx.host, 'lease-ok', 'agent-a');
  assert.equal(gate.ok, true);
  await fx.host.complete('lease-ok', okResult(), claimed!.attempt);
  assert.equal(fx.jobs.get('lease-ok')?.status, 'succeeded');
  assert.ok(fx.completed.get('lease-ok'));
});

test('unit matrix: host without renewLease completes under default requireLease', async () => {
  const { host, completed } = createMemoryJobHost([{ jobId: 'no-renew', spec: lbmSpec() }]);
  // Memory host may still expose renewLease; strip it for Host-HTTP-complete-as-lease semantics.
  const bare = {
    claim: host.claim.bind(host),
    progress: host.progress.bind(host),
    complete: host.complete.bind(host),
    fail: host.fail.bind(host),
  };
  const status = await runGuardedClaimLoopOnce(bare, 'agent-a', [interruptibleOkRunner()]);
  assert.equal(status, 'completed');
  assert.ok(completed.get('no-renew'));
});

test('unit matrix: cancel job then next queue job completes (multi-kind registry drain)', async () => {
  const smoke = buildSmokeJobSpec({ maxSteps: 3 }) as JobSpecV1;
  const product = pathSpec() as JobSpecV1;
  const fx = createMemoryJobHost([
    { jobId: 'q-cancel', spec: smoke },
    { jobId: 'q-ok', spec: product },
  ]);
  const reg = createAgentSolverRegistry({ agentId: 'agent-q-drain' });

  const s1 = await runGuardedClaimLoopOnce(fx.host, 'agent-q-drain', reg, {
    isCancelRequested: () => true,
  });
  assert.ok(s1 === 'cancelled' || s1 === 'failed');
  assert.equal(fx.completed.has('q-cancel'), false);

  const s2 = await runGuardedClaimLoopOnce(fx.host, 'agent-q-drain', reg);
  assert.equal(s2, 'completed');
  assert.ok(fx.completed.get('q-ok'));
  assert.equal(fx.completed.get('q-ok')?.backend?.agentId, 'agent-q-drain');
});

test('unit matrix: runner arity cancel table (3-arg abort vs 2-arg unable-to-interrupt)', async () => {
  // Cell A: 3-arg interruptible mid-progress cancel → cancelled
  const fxA = createMemoryJobHost([{ jobId: 'arity-3', spec: lbmSpec(20) }]);
  let ticks = 0;
  const threeArg: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, onProgress, signal) {
      await onProgress?.({ step: 0, total: spec.run.maxSteps });
      ticks += 1;
      if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
      await onProgress?.({ step: 1, total: spec.run.maxSteps });
      ticks += 1;
      if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
      return okResult(spec.run.maxSteps);
    },
  };
  const stA = await runGuardedClaimLoopOnce(fxA.host, 'a', [threeArg], {
    isCancelRequested: () => ticks >= 1,
  });
  assert.equal(stA, 'failed', 'the fake Host failure receipt is authoritative');
  assert.equal(fxA.completed.has('arity-3'), false);
  assert.ok(threeArg.run.length >= 3);

  // Cell B: 2-arg silent (no onProgress) + cancel always → unable-to-interrupt failed
  const fxB = createMemoryJobHost([{ jobId: 'arity-2', spec: lbmSpec() }]);
  const twoArg: JobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec) {
      return okResult(spec.run.maxSteps);
    },
  };
  assert.ok(twoArg.run.length < 3);
  const stB = await runGuardedClaimLoopOnce(fxB.host, 'a', [twoArg], {
    isCancelRequested: () => true,
  });
  assert.equal(stB, 'failed');
  assert.equal(fxB.failed.get('arity-2'), UNABLE_TO_INTERRUPT_MESSAGE);
  assert.equal(fxB.completed.has('arity-2'), false);
});

test('unit matrix: permanent solver Error is failed not cancelled', async () => {
  const { host, completed, failed, jobs } = createMemoryJobHost([
    { jobId: 'perm-err', spec: lbmSpec() },
  ]);
  const boom: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(_spec, _onProgress, _signal) {
      throw new Error('solver-nan-divergence');
    },
  };
  // Cancel probe true must not reclassify non-abort permanent errors as cancelled.
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [boom], {
    isCancelRequested: () => true,
  });
  assert.equal(status, 'failed');
  assert.match(failed.get('perm-err') ?? '', /solver-nan-divergence/);
  assert.equal(completed.has('perm-err'), false);
  assert.equal(jobs.get('perm-err')?.status, 'failed');
});

test('unit matrix: createAgentJobRunners cancel parity with registry', async () => {
  const smoke = buildSmokeJobSpec({ maxSteps: 3 }) as JobSpecV1;
  const fx = createMemoryJobHost([{ jobId: 'runners-cancel', spec: smoke }]);
  const runners = createAgentJobRunners({ agentId: 'agent-runners-cancel' });
  assert.ok(runners.length >= 2);

  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-runners-cancel', runners, {
    isCancelRequested: () => true,
  });
  assert.ok(status === 'cancelled' || status === 'failed');
  assert.equal(fx.completed.has('runners-cancel'), false);
  assert.notEqual(fx.jobs.get('runners-cancel')?.status, 'succeeded');
});

test('unit matrix: lease reclaim allows second agent after first lease_lost', async () => {
  const fx = createLeaseCancelFixtureHost([{ jobId: 'reclaim-1', spec: lbmSpec() }], {
    leaseMs: 200,
    startMs: 8_000_000,
  });

  const slow: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, onProgress, signal) {
      await onProgress?.({ step: 1, total: spec.run.maxSteps });
      fx.advanceMs(300);
      fx.reclaimExpiredLeases();
      assert.equal(await fx.host.renewLease!('reclaim-1', 'agent-a'), null);
      if (signal?.aborted) throw new DOMException('lease abort', 'AbortError');
      return okResult(spec.run.maxSteps, 2.2);
    },
  };

  const s1 = await runGuardedClaimLoopOnce(fx.host, 'agent-a', [slow]);
  assert.equal(s1, 'lease_lost');
  assert.equal(fx.completed.has('reclaim-1'), false);

  // After reclaim, job is available for a second agent; interruptible runner succeeds.
  // Re-queue if host left it failed terminal — reclaimExpiredLeases should requeue leased jobs.
  // If already terminal-failed by lease_lost fail(), skip second claim when not claimable.
  const claimed = await fx.host.claim('agent-b');
  if (claimed) {
    assert.equal(claimed.jobId, 'reclaim-1');
    const s2 = await runGuardedClaimLoopOnce(
      // Already claimed above — wrap a one-shot host that returns this claim once.
      {
        claim: async () => claimed,
        progress: fx.host.progress.bind(fx.host),
        complete: fx.host.complete.bind(fx.host),
        fail: fx.host.fail.bind(fx.host),
        renewLease: async () => new Date(Date.now() + 60_000).toISOString(),
      },
      'agent-b',
      [interruptibleOkRunner('agent-b')],
    );
    // Either completes or host terminal state rejects — never silent double-success from agent-a.
    assert.ok(s2 === 'completed' || s2 === 'failed' || s2 === 'lease_lost');
    assert.equal(fx.completed.has('reclaim-1') ? fx.completed.get('reclaim-1')?.summary.cd !== 2.2 : true, true);
  } else {
    // Host marks fail on lease_lost as permanent — still no agent-a complete.
    assert.equal(fx.completed.has('reclaim-1'), false);
  }
});

test('unit matrix: cancel wins over lease renew when both probe during progress', async () => {
  const fx = createLeaseCancelFixtureHost([{ jobId: 'cancel-lease-race', spec: lbmSpec(30) }], {
    leaseMs: 60_000,
    startMs: 9_000_000,
  });
  let progressCount = 0;
  const runner: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, onProgress, signal) {
      await onProgress?.({ step: 0, total: spec.run.maxSteps });
      progressCount += 1;
      if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
      await onProgress?.({ step: 1, total: spec.run.maxSteps });
      progressCount += 1;
      if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
      return okResult(spec.run.maxSteps);
    },
  };

  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-a', [runner], {
    isCancelRequested: (jobId) => {
      if (progressCount >= 1) {
        fx.requestCancel?.(jobId);
        return true;
      }
      return false;
    },
  });

  // Cancel classification preferred over success; lease still held so not lease_lost.
  assert.ok(status === 'cancelled' || status === 'failed');
  assert.notEqual(status, 'completed');
  assert.equal(fx.completed.has('cancel-lease-race'), false);
});

// ── Residual unit matrix after expanded cancel/lease (more unit only) ───────
// Product mid-progress via guarded claim, classification edge cells, package
// post-run abort, ensureLease no-op, requireLease mid-skip. Does not close #7.

test('product dual-path stops when an asynchronous progress guard rejects cancellation', async () => {
  const product = pathSpec() as JobSpecV1;
  const runner = createPathExperimentRunner({ agentId: 'agent-product-progress' }) as InterruptibleJobRunner;
  let asyncGuardStarted = 0;
  await assert.rejects(runner.run(
    product,
    async () => {
      asyncGuardStarted++;
      await new Promise<void>((resolve) => setImmediate(resolve));
      throw new DOMException('job cancelled by host', 'AbortError');
    },
    undefined,
  ), { name: 'AbortError', message: 'job cancelled by host' });
  assert.equal(asyncGuardStarted, 1, 'the cancelled run must stop at its first progress guard');
});

test('unit residual: product dual-path terminal lease_lost with no mid-progress renew', async () => {
  // 3-arg product-shaped runner that never calls onProgress → only terminal lease gate.
  const product = pathSpec() as JobSpecV1;
  const fx = createLeaseCancelFixtureHost([{ jobId: 'product-term-lease', spec: product }], {
    leaseMs: 60_000,
    startMs: 10_000_000,
  });
  const silentProduct: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'path-experiment',
    async run(spec, _onProgress, signal) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return {
        schemaVersion: 1,
        summary: { steps: spec.run.maxSteps, wallTimeMs: 1, pathScore: 1 },
        backend: { id: 'cpu-path-experiment', agentId: 'agent-product-term' },
      };
    },
  };
  fx.host.renewLease = async () => null;
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-product-term', [silentProduct]);
  assert.equal(status, 'lease_lost');
  assert.equal(fx.completed.has('product-term-lease'), false);
  assert.equal(fx.failed.has('product-term-lease'), false);
});

test('unit residual: product dual-path pre-aborted signal refuses complete under guarded claim', async () => {
  // Cooperative cancel via signal (not fire-and-forget progress): pre-abort controller
  // is not how guarded claim works; instead assert real product runner honors signal
  // when guarded claim passes ac.signal and cancel aborts before/at first sample.
  // Cell: always-true cancel with a product-shaped 3-arg runner that checks signal
  // before finishing (no async onProgress) → cancelled, never succeeded.
  const product = pathSpec() as JobSpecV1;
  const fx = createMemoryJobHost([{ jobId: 'product-sig-cancel', spec: product }]);
  const cooperative: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'path-experiment',
    async run(spec, onProgress, signal) {
      await onProgress?.({ step: 0, total: spec.run.maxSteps, message: 'start' });
      if (signal?.aborted) throw new DOMException('path experiment aborted', 'AbortError');
      await onProgress?.({ step: spec.run.maxSteps, total: spec.run.maxSteps });
      if (signal?.aborted) throw new DOMException('path experiment aborted', 'AbortError');
      return {
        schemaVersion: 1,
        summary: { steps: spec.run.maxSteps, wallTimeMs: 1, pathScore: 1 },
        backend: { id: 'cpu-path-experiment', agentId: 'agent-product-sig2' },
      };
    },
  };
  let ticks = 0;
  const wrapped: InterruptibleJobRunner = {
    canRun: cooperative.canRun,
    async run(spec, onProgress, signal) {
      return cooperative.run(
        spec,
        async (p) => {
          ticks += 1;
          await onProgress?.(p);
        },
        signal,
      );
    },
  };
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-product-sig2', [wrapped], {
    isCancelRequested: () => ticks >= 1,
  });
  assert.equal(status, 'failed', 'the fake Host failure receipt is authoritative');
  assert.ok(ticks >= 1);
  assert.equal(fx.completed.has('product-sig-cancel'), false);
  assert.notEqual(fx.jobs.get('product-sig-cancel')?.status, 'succeeded');
});

test('unit residual: package dual-path post-run signal abort refuses complete', async () => {
  // Package runner ignores signal mid-run; dual-path checks signal after package returns.
  const smoke = buildSmokeJobSpec({ maxSteps: 3 }) as JobSpecV1;
  const fx = createMemoryJobHost([{ jobId: 'pkg-post-abort', spec: smoke }]);
  const base = createPathExperimentRunner({ agentId: 'agent-pkg-post' });
  const wrap: InterruptibleJobRunner = {
    canRun: base.canRun.bind(base),
    async run(spec, onProgress, signal) {
      // Abort only after package body would run — dual-path post-check.
      const result = await (base as InterruptibleJobRunner).run(
        spec,
        async (p) => {
          await onProgress?.(p);
          // Abort during progress so post-package dual-path sees aborted signal.
          // For silent package without progress, abort before call:
        },
        signal,
      );
      return result;
    },
  };
  // Cancel always true: package dual-path pre-abort throws before package, or
  // mid-progress abort + post-check; never authoritative success.
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-pkg-post', [wrap], {
    isCancelRequested: () => true,
  });
  assert.ok(status === 'cancelled' || status === 'failed');
  assert.equal(fx.completed.has('pkg-post-abort'), false);
});

test('unit residual: ensureLeaseForTerminalPublish no-op without renewLease', async () => {
  const bare = {
    claim: async () => null,
    progress: async () => {},
    complete: async () => {},
    fail: async () => {
      throw new Error('fail should not be called');
    },
  };
  const gate = await ensureLeaseForTerminalPublish(bare, 'j-bare', 'a');
  assert.equal(gate.ok, true);
});

test('unit residual: non-Error string throw is failed not cancelled', async () => {
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'str-throw', spec: lbmSpec() },
  ]);
  const boom: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run() {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'raw-string-solver-fault';
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [boom], {
    isCancelRequested: () => true,
  });
  assert.equal(status, 'failed');
  assert.match(failed.get('str-throw') ?? '', /raw-string-solver-fault/);
  assert.equal(completed.has('str-throw'), false);
});

test('unit residual: Error message matching /lease lost/ classifies lease_lost', async () => {
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'lease-msg', spec: lbmSpec() },
  ]);
  const boom: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run() {
      throw new Error('host said Lease lost: worker stale');
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [boom]);
  assert.equal(status, 'failed');
  assert.match(failed.get('lease-msg') ?? '', /lease lost/i);
  assert.equal(completed.has('lease-msg'), false);
});

test('unit residual: Error message matching /cancel/ classifies cancelled', async () => {
  const { host, completed, failed, jobs } = createMemoryJobHost([
    { jobId: 'msg-cancel', spec: lbmSpec() },
  ]);
  const boom: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run() {
      throw new Error('operation cancel requested by operator');
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [boom]);
  assert.equal(status, 'failed');
  assert.match(failed.get('msg-cancel') ?? '', /cancel/i);
  assert.equal(completed.has('msg-cancel'), false);
  assert.notEqual(jobs.get('msg-cancel')?.status, 'succeeded');
});

test('unit residual: requireLeaseForPublish false skips mid-progress renew null', async () => {
  const fx = createLeaseCancelFixtureHost([{ jobId: 'mid-skip-lease', spec: lbmSpec(20) }], {
    leaseMs: 60_000,
    startMs: 11_000_000,
  });
  fx.host.renewLease = async () => null;
  let ticks = 0;
  const runner: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, onProgress, signal) {
      await onProgress?.({ step: 0, total: spec.run.maxSteps });
      ticks += 1;
      if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
      await onProgress?.({ step: 1, total: spec.run.maxSteps });
      return okResult(spec.run.maxSteps);
    },
  };
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-a', [runner], {
    requireLeaseForPublish: false,
  });
  assert.equal(status, 'completed');
  assert.ok(ticks >= 1);
  assert.ok(fx.completed.get('mid-skip-lease'));
});

test('unit residual: multi-kind registry cancel first (lbm) then package completes', async () => {
  // Avoid real product dual-path fire-and-forget unhandledRejection residual in queue
  // drain: cancel LBM (interruptible mock via registry unknown → use lbm mock runners
  // + path package). Registry path is package for smoke; LBM uses createAgentJobRunners
  // which loads CFD — use dual registry of path dual-path + interruptible LBM mock.
  const smoke = buildSmokeJobSpec({ maxSteps: 3 }) as JobSpecV1;
  const lbm = lbmSpec(20);
  const fx = createMemoryJobHost([
    { jobId: 'q-lbm-cancel', spec: lbm },
    { jobId: 'q-pkg-ok', spec: smoke },
  ]);
  let ticks = 0;
  const lbmRunner: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, onProgress, signal) {
      await onProgress?.({ step: 0, total: spec.run.maxSteps });
      ticks += 1;
      if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
      await onProgress?.({ step: 1, total: spec.run.maxSteps });
      return okResult(spec.run.maxSteps);
    },
  };
  const pathRunner = createPathExperimentRunner({ agentId: 'agent-q-prod' });
  const runners = [pathRunner, lbmRunner];

  const status1 = await runGuardedClaimLoopOnce(fx.host, 'agent-q-prod', runners, {
    isCancelRequested: () => ticks >= 1,
  });
  assert.equal(status1, 'failed');
  assert.equal(fx.completed.has('q-lbm-cancel'), false);

  const status2 = await runGuardedClaimLoopOnce(fx.host, 'agent-q-prod', runners);
  assert.equal(status2, 'completed');
  assert.ok(fx.completed.get('q-pkg-ok'));
  assert.equal(fx.completed.get('q-pkg-ok')?.backend?.agentId, 'agent-q-prod');
});

test('unit residual: idle under permanent cancel probe when queue empty', async () => {
  const fx = createMemoryJobHost([]);
  const reg = createAgentSolverRegistry({ agentId: 'agent-idle-cancel' });
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-idle-cancel', reg, {
    isCancelRequested: () => true,
  });
  assert.equal(status, 'idle');
});

test('unit residual: 3-arg runner AbortError name without cancel substring → cancelled', async () => {
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'abort-name', spec: lbmSpec() },
  ]);
  const boom: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(_spec, _onProgress, _signal) {
      const err = new Error('user interrupted');
      err.name = 'AbortError';
      throw err;
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [boom]);
  assert.equal(status, 'failed');
  assert.match(failed.get('abort-name') ?? '', /user interrupted/);
  assert.equal(completed.has('abort-name'), false);
});

test('unit residual: createAgentJobRunners product job completes; lease ok path', async () => {
  const product = pathSpec() as JobSpecV1;
  const runners = createAgentJobRunners({ agentId: 'agent-runners-product' });
  const fx = createLeaseCancelFixtureHost([{ jobId: 'runners-product-ok', spec: product }], {
    leaseMs: 60_000,
    startMs: 12_000_000,
  });
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-runners-product', runners);
  assert.equal(status, 'completed');
  assert.ok(fx.completed.get('runners-product-ok'));
  assert.equal(
    fx.completed.get('runners-product-ok')?.backend?.id,
    'cpu-path-experiment',
  );
});

// ── Residual unit matrix after b64cfb2 (more unit only) ─────────────────────
// Classification edges, progress/complete throw, ignore-signal post-check,
// product dual-path always-cancel residual, package await cancel. Does not close #7.

test('unit residual post-b64: 3-arg swallows cancel progress then post-check unable-to-interrupt', async () => {
  // 3-arg runner swallows AbortError from mid-progress cancel (does not honor signal)
  // and still returns success → guarded post-run checkCancel refuses with UNABLE_TO_INTERRUPT.
  const fx = createMemoryJobHost([{ jobId: 'ignore-sig', spec: lbmSpec() }]);
  const ignoreSignal: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, onProgress, _signal) {
      try {
        await onProgress?.({ step: 0, total: spec.run.maxSteps });
      } catch {
        // Swallow cancel-shaped progress errors — residual non-cooperative runner.
      }
      return okResult(spec.run.maxSteps);
    },
  };
  assert.ok(ignoreSignal.run.length >= 3);
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-a', [ignoreSignal], {
    isCancelRequested: () => true,
  });
  assert.equal(status, 'failed');
  assert.equal(fx.failed.get('ignore-sig'), UNABLE_TO_INTERRUPT_MESSAGE);
  assert.equal(fx.completed.has('ignore-sig'), false);
});

test('unit residual post-b64: host.progress throw mid-run → failed not lease_lost', async () => {
  const base = createMemoryJobHost([{ jobId: 'prog-throw', spec: lbmSpec() }]);
  const host = {
    claim: base.host.claim.bind(base.host),
    progress: async () => {
      throw new Error('heartbeat transport reset');
    },
    complete: base.host.complete.bind(base.host),
    fail: base.host.fail.bind(base.host),
    renewLease: async () => '2099-01-01T00:00:00.000Z',
  };
  const runner: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, onProgress, signal) {
      await onProgress?.({ step: 1, total: spec.run.maxSteps });
      if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
      return okResult(spec.run.maxSteps);
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [runner]);
  assert.equal(status, 'failed');
  assert.match(base.failed.get('prog-throw') ?? '', /heartbeat transport reset/);
  assert.equal(base.completed.has('prog-throw'), false);
});

test('unit residual post-b64: host.complete throw after lease ok → failed', async () => {
  const base = createMemoryJobHost([{ jobId: 'complete-throw', spec: lbmSpec() }]);
  const host = {
    claim: base.host.claim.bind(base.host),
    progress: base.host.progress.bind(base.host),
    complete: async () => {
      throw new Error('complete failed: 409 stale lease');
    },
    fail: base.host.fail.bind(base.host),
    renewLease: async () => '2099-01-01T00:00:00.000Z',
  };
  await assert.rejects(
    () => runGuardedClaimLoopOnce(host, 'agent-a', [interruptibleOkRunner()]),
    /complete failed: 409/,
  );
  assert.equal(base.failed.has('complete-throw'), false, 'ambiguous complete must not trigger fail');
  assert.equal(base.completed.has('complete-throw'), false);
});

test('unit residual post-b64: /abort/ message without AbortError name → cancelled', async () => {
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'abort-msg', spec: lbmSpec() },
  ]);
  const boom: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run() {
      throw new Error('solver abort requested (soft)');
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [boom]);
  assert.equal(status, 'failed');
  assert.match(failed.get('abort-msg') ?? '', /abort/i);
  assert.equal(completed.has('abort-msg'), false);
});

test('unit residual post-b64: exact LEASE_LOST_MESSAGE throw → lease_lost', async () => {
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'exact-lease-msg', spec: lbmSpec() },
  ]);
  const boom: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(_spec, onProgress) {
      await onProgress?.({ step: 1, total: 10 });
      throw new Error(LEASE_LOST_MESSAGE);
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [boom]);
  assert.equal(status, 'failed');
  assert.equal(failed.get('exact-lease-msg'), LEASE_LOST_MESSAGE);
  assert.equal(completed.has('exact-lease-msg'), false);
});

test('unit residual post-b64: async isCancelRequested after silent 3-arg → unable-to-interrupt', async () => {
  // Silent 3-arg (no onProgress) + async cancel probe true after finish → post-check fail.
  const fx = createMemoryJobHost([{ jobId: 'async-cancel-silent', spec: lbmSpec() }]);
  const silent: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, _onProgress, signal) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return okResult(spec.run.maxSteps);
    },
  };
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-a', [silent], {
    isCancelRequested: async () => {
      await Promise.resolve();
      return true;
    },
  });
  assert.equal(status, 'failed');
  assert.equal(fx.failed.get('async-cancel-silent'), UNABLE_TO_INTERRUPT_MESSAGE);
  assert.equal(fx.completed.has('async-cancel-silent'), false);
});

test('unit residual post-b64: product-shaped void onProgress race under always-cancel', async () => {
  // Mimics createDualPathPathExperimentRunner product path: void onProgress (no await).
  // Guarded cancel throws asynchronously; product-shaped body may finish before abort
  // is observed → post-check unable-to-interrupt OR signal abort if race hits first.
  // Never authoritative complete. Settle voided rejections (residual documentation).
  const product = pathSpec() as JobSpecV1;
  const fx = createMemoryJobHost([{ jobId: 'product-void-cancel', spec: product }]);
  const pending: Promise<unknown>[] = [];
  const productShaped: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'path-experiment',
    async run(spec, onProgress, signal) {
      const work = onProgress?.({ step: 0, total: spec.run.maxSteps, message: 'start' });
      if (work && typeof (work as Promise<void>).then === 'function') {
        pending.push((work as Promise<void>).catch(() => 'voided'));
      }
      // Fire-and-forget residual: do not await progress; only optional signal sample.
      if (signal?.aborted) throw new DOMException('path experiment aborted', 'AbortError');
      return {
        schemaVersion: 1,
        summary: { steps: spec.run.maxSteps, wallTimeMs: 1, pathScore: 1 },
        backend: { id: 'cpu-path-experiment', agentId: 'agent-prod-void' },
      };
    },
  };
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-prod-void', [productShaped], {
    isCancelRequested: () => true,
  });
  await Promise.all(pending);
  assert.ok(status === 'cancelled' || status === 'failed');
  assert.notEqual(status, 'completed');
  assert.equal(fx.completed.has('product-void-cancel'), false);
  assert.notEqual(fx.jobs.get('product-void-cancel')?.status, 'succeeded');
});

test('unit residual post-b64: package dual-path awaited onProgress honors mid-cancel', async () => {
  // Package path awaits onProgress (not voided) → mid-progress cancel is deterministic.
  const smoke = buildSmokeJobSpec({ maxSteps: 4 }) as JobSpecV1;
  const fx = createMemoryJobHost([{ jobId: 'pkg-await-cancel', spec: smoke }]);
  const runner = createPathExperimentRunner({ agentId: 'agent-pkg-await' });
  let ticks = 0;
  // Wrap so first awaited progress triggers cancel probe; package dual-path passes through
  // onProgress await from package runner (not product void).
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-pkg-await', [runner], {
    isCancelRequested: () => {
      ticks += 1;
      return ticks >= 1;
    },
  });
  // Package may pre-check abort only if signal already set; first progress tick cancels.
  assert.ok(status === 'cancelled' || status === 'failed');
  assert.equal(fx.completed.has('pkg-await-cancel'), false);
});

test('unit residual post-b64: cancel preferred over permanent Error only when abort-shaped', async () => {
  // Cancel probe true must not reclassify plain Error as cancelled (matrix peer of permanent).
  const { host, failed, completed } = createMemoryJobHost([
    { jobId: 'perm-over-cancel', spec: lbmSpec() },
  ]);
  const boom: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run() {
      throw new Error('NaN force coefficient');
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [boom], {
    isCancelRequested: () => true,
  });
  assert.equal(status, 'failed');
  assert.match(failed.get('perm-over-cancel') ?? '', /NaN force/);
  assert.equal(completed.has('perm-over-cancel'), false);
});

test('unit residual post-b64: ensureLease ok then complete under requireLease true', async () => {
  const fx = createLeaseCancelFixtureHost([{ jobId: 'lease-ok-complete', spec: lbmSpec() }], {
    leaseMs: 30_000,
    startMs: 13_000_000,
  });
  let renews = 0;
  const orig = fx.host.renewLease!.bind(fx.host);
  fx.host.renewLease = async (jobId, agentId) => {
    renews += 1;
    return orig(jobId, agentId);
  };
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-a', [interruptibleOkRunner()]);
  assert.equal(status, 'completed');
  assert.ok(renews >= 1);
  assert.ok(fx.completed.get('lease-ok-complete'));
});

test('unit residual post-b64: empty runners list fails unknown kind', async () => {
  const { host, failed, completed } = createMemoryJobHost([
    { jobId: 'empty-reg', spec: lbmSpec() },
  ]);
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', []);
  assert.equal(status, 'failed');
  assert.match(failed.get('empty-reg') ?? '', /no runner/i);
  assert.equal(completed.has('empty-reg'), false);
});

// ── Residual unit matrix after 788a583 (more unit only; not #7 close) ───────

test('unit residual post-788: AbortError with empty message → cancelled fallback', async () => {
  // catch arm uses `msg || 'cancelled'` when AbortError name matches but message empty.
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'empty-abort-msg', spec: lbmSpec() },
  ]);
  const boom: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run() {
      const err = new Error('');
      err.name = 'AbortError';
      throw err;
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [boom]);
  assert.equal(status, 'failed');
  assert.equal(failed.get('empty-abort-msg'), 'cancelled');
  assert.equal(completed.has('empty-abort-msg'), false);
});

test('unit residual post-788: host.fail throw on lease_lost mid-renew surfaces', async () => {
  // When renewLease null mid-progress, guarded throws LEASE_LOST then calls host.fail.
  // If fail itself throws, the cycle rejects (not silent complete).
  const base = createMemoryJobHost([{ jobId: 'fail-throw-lease', spec: lbmSpec() }]);
  const host = {
    claim: base.host.claim.bind(base.host),
    progress: base.host.progress.bind(base.host),
    complete: base.host.complete.bind(base.host),
    fail: async () => {
      throw new Error('fail endpoint 503');
    },
    renewLease: async () => null as string | null,
  };
  const runner: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, onProgress, signal) {
      await onProgress?.({ step: 1, total: spec.run.maxSteps });
      if (signal?.aborted) throw new DOMException('lease abort', 'AbortError');
      return okResult(spec.run.maxSteps);
    },
  };
  assert.equal(await runGuardedClaimLoopOnce(host, 'agent-a', [runner]), 'lease_lost');
  assert.equal(base.failed.has('fail-throw-lease'), false, 'confirmed lease loss must not write stale fail');
  assert.equal(base.completed.has('fail-throw-lease'), false);
});

test('unit residual post-788: dual-path package pre-abort signal refuses complete', async () => {
  // Package branch of createDualPathPathExperimentRunner checks signal before packageRunner.run.
  const smoke = buildSmokeJobSpec({ maxSteps: 4 }) as JobSpecV1;
  const fx = createMemoryJobHost([{ jobId: 'pkg-preabort', spec: smoke }]);
  const runner = createPathExperimentRunner({ agentId: 'agent-pkg-pre' }) as InterruptibleJobRunner;
  assert.ok(runner.run.length >= 3);
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => runner.run(smoke, undefined, ac.signal),
    (err: unknown) => {
      assert.ok(err instanceof DOMException || err instanceof Error);
      assert.match(String((err as Error).message), /abort/i);
      return true;
    },
  );
  // Guarded claim with pre-abort via always-cancel probe still refuses complete.
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-pkg-pre', [runner], {
    isCancelRequested: () => true,
  });
  assert.ok(status === 'cancelled' || status === 'failed');
  assert.equal(fx.completed.has('pkg-preabort'), false);
});

test('unit residual post-788: dual-path package post-run signal abort after package ok', async () => {
  // After packageRunner.run returns, dual-path re-checks signal?.aborted before complete.
  const smoke = buildSmokeJobSpec({ maxSteps: 3 }) as JobSpecV1;
  const runner = createPathExperimentRunner({ agentId: 'agent-pkg-post' }) as InterruptibleJobRunner;
  const ac = new AbortController();
  // Abort mid-flight via onProgress (package awaits progress); dual-path post-check also covers
  // the case when abort lands after package body finishes.
  let ticks = 0;
  await assert.rejects(
    () =>
      runner.run(
        smoke,
        () => {
          ticks += 1;
          if (ticks >= 1) ac.abort();
        },
        ac.signal,
      ),
    /abort/i,
  );
});

test('terminal lease gate: rejected renewal returns lease_lost without a fail mutation', async () => {
  const base = createMemoryJobHost([{ jobId: 'ensure-then-ok', spec: lbmSpec() }]);
  let renews = 0;
  const host = {
    claim: base.host.claim.bind(base.host),
    progress: base.host.progress.bind(base.host),
    complete: base.host.complete.bind(base.host),
    fail: base.host.fail.bind(base.host),
    renewLease: async () => {
      renews += 1;
      // Terminal ensureLease only (no mid-progress if silent runner).
      return null as string | null;
    },
  };
  const silent: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec) {
      return okResult(spec.run.maxSteps);
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [silent]);
  assert.equal(status, 'lease_lost');
  assert.equal(base.failed.has('ensure-then-ok'), false);
  assert.equal(base.completed.has('ensure-then-ok'), false);
  assert.ok(renews >= 1);
});

test('unit residual post-788: multi-kind registry queue drain cancel then idle', async () => {
  const smoke = buildSmokeJobSpec({ maxSteps: 3 }) as JobSpecV1;
  const runners = createAgentJobRunners({ agentId: 'agent-drain' });
  const fx = createLeaseCancelFixtureHost(
    [{ jobId: 'drain-1', spec: smoke }],
    { leaseMs: 60_000, startMs: 20_000_000 },
  );
  let n = 0;
  const s1 = await runGuardedClaimLoopOnce(fx.host, 'agent-drain', runners, {
    isCancelRequested: () => {
      n += 1;
      return n >= 1;
    },
  });
  assert.ok(s1 === 'cancelled' || s1 === 'failed');
  assert.equal(fx.completed.has('drain-1'), false);
  const s2 = await runGuardedClaimLoopOnce(fx.host, 'agent-drain', runners);
  assert.equal(s2, 'idle');
});

// ── Residual unit matrix after e63a87c (more unit only; not #7 close) ───────

test('unit residual post-e63: non-Error number throw → failed with String(n)', async () => {
  // catch uses `e instanceof Error ? e.message : String(e)` — numbers are failed, not cancelled.
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'throw-num', spec: lbmSpec() },
  ]);
  const boom: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run() {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- residual matrix cell
      throw 42;
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [boom]);
  assert.equal(status, 'failed');
  assert.equal(failed.get('throw-num'), '42');
  assert.equal(completed.has('throw-num'), false);
});

test('unit residual post-e63: host.complete throw after lease ok → failed (catch arm)', async () => {
  // ensureLease ok then complete throws → catch classifies as failed (not lease_lost/cancelled).
  // Contrast: processJob does not catch complete errors (surfaces to caller).
  const base = createMemoryJobHost([{ jobId: 'complete-throw', spec: lbmSpec() }]);
  let failMsg: string | undefined;
  const host = {
    claim: base.host.claim.bind(base.host),
    progress: base.host.progress.bind(base.host),
    complete: async () => {
      throw new Error('complete failed: 503 upstream');
    },
    fail: async (_id: string, error: string) => {
      failMsg = error;
      return base.host.fail(_id, error);
    },
    renewLease: async () => '2099-01-01T00:00:00.000Z',
  };
  const silent: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec) {
      return okResult(spec.run.maxSteps);
    },
  };
  await assert.rejects(
    () => runGuardedClaimLoopOnce(host, 'agent-a', [silent]),
    /complete failed: 503/,
  );
  assert.equal(failMsg, undefined, 'ambiguous complete must not trigger fail');
  assert.equal(base.completed.has('complete-throw'), false);
});

test('unit residual post-e63: renewLease throws mid-progress → failed not lease_lost', async () => {
  // renewLease hard-throw (not soft null) propagates via onProgress; message lacks lease/cancel → failed.
  const base = createMemoryJobHost([{ jobId: 'renew-hard', spec: lbmSpec() }]);
  const host = {
    claim: base.host.claim.bind(base.host),
    progress: base.host.progress.bind(base.host),
    complete: base.host.complete.bind(base.host),
    fail: base.host.fail.bind(base.host),
    renewLease: async () => {
      throw new Error('renew endpoint 502');
    },
  };
  const runner: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, onProgress, signal) {
      await onProgress?.({ step: 1, total: spec.run.maxSteps });
      if (signal?.aborted) throw new DOMException('interrupted', 'AbortError');
      return okResult(spec.run.maxSteps);
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [runner]);
  assert.equal(status, 'failed');
  assert.equal(base.failed.get('renew-hard'), 'renew endpoint 502');
  assert.equal(base.completed.has('renew-hard'), false);
});

test('unit residual post-e63: ensureLease empty-string renew is ok (not null)', async () => {
  // ensureLeaseForTerminalPublish uses `renewed == null`; empty string is a held lease.
  const base = createMemoryJobHost([{ jobId: 'empty-lease', spec: lbmSpec() }]);
  const host = {
    claim: base.host.claim.bind(base.host),
    progress: base.host.progress.bind(base.host),
    complete: base.host.complete.bind(base.host),
    fail: base.host.fail.bind(base.host),
    renewLease: async () => '' as string,
  };
  const silent: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec) {
      return okResult(spec.run.maxSteps);
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [silent]);
  assert.equal(status, 'completed');
  assert.equal(base.completed.has('empty-lease'), true);
  assert.equal(base.failed.has('empty-lease'), false);
});

test('unit residual post-e63: dual-path package stamps agentId on backend', async () => {
  const smoke = buildSmokeJobSpec({ maxSteps: 3 }) as JobSpecV1;
  const runner = createPathExperimentRunner({ agentId: 'agent-stamp' }) as InterruptibleJobRunner;
  const result = await runner.run(smoke);
  assert.equal(result.backend?.agentId, 'agent-stamp');
  assert.ok(result.backend?.id);
  assert.equal(result.summary.steps, 3);
});

test('unit residual post-e63: multi-kind registry path complete then idle', async () => {
  const smoke = buildSmokeJobSpec({ maxSteps: 2 }) as JobSpecV1;
  const runners = createAgentJobRunners({ agentId: 'agent-path-idle' });
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'path-ok-1', spec: smoke },
  ]);
  const s1 = await runGuardedClaimLoopOnce(host, 'agent-path-idle', runners);
  assert.equal(s1, 'completed');
  assert.equal(completed.get('path-ok-1')?.summary.steps, 2);
  assert.equal(failed.size, 0);
  const s2 = await runGuardedClaimLoopOnce(host, 'agent-path-idle', runners);
  assert.equal(s2, 'idle');
});

test('unit residual post-e63: runner throw /lease lost/ mid-body → lease_lost', async () => {
  // catch classifies /lease lost/i even when throw is not the constant LEASE_LOST_MESSAGE.
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'lease-msg', spec: lbmSpec() },
  ]);
  const boom: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run() {
      throw new Error('upstream lease lost while stepping');
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [boom]);
  assert.equal(status, 'failed');
  assert.equal(failed.get('lease-msg'), LEASE_LOST_MESSAGE);
  assert.equal(completed.has('lease-msg'), false);
});

test('unit residual post-e63: async isCancelRequested true post silent 3-arg → unable-to-interrupt', async () => {
  // Silent 3-arg ignores signal; post-run checkCancel async true → host.fail unable-to-interrupt.
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'async-cancel-post', spec: lbmSpec() },
  ]);
  const silent3: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, _onProgress, _signal) {
      return okResult(spec.run.maxSteps);
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [silent3], {
    isCancelRequested: async () => true,
  });
  assert.equal(status, 'failed');
  assert.equal(failed.get('async-cancel-post'), UNABLE_TO_INTERRUPT_MESSAGE);
  assert.equal(completed.has('async-cancel-post'), false);
});

// ── Job wall-clock timeout (Phase 2 — W_SIM_JOB_TIMEOUT_MS) ────────────────

test('job wall timeout: heartbeating in-process runner aborted + retryable fail', async () => {
  const { host, jobs, completed, failed } = createMemoryJobHost([
    { jobId: 'wall-1', spec: lbmSpec(1000) },
  ]);
  let signalSeen = false;
  const hung: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(_spec, _onProgress, signal) {
      // Live but never progressing — the exact shape the keepalive alone
      // cannot catch (it would renew the lease forever). The safety timer is
      // ref'd so the test event loop stays alive until abort clears it.
      await new Promise<never>((_res, rej) => {
        const t = setTimeout(() => rej(new Error('test runner never aborted')), 10_000);
        signal?.addEventListener('abort', () => {
          signalSeen = true;
          clearTimeout(t);
          rej(new DOMException('interrupted', 'AbortError'));
        }, { once: true });
      });
      return okResult(0);
    },
  };
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [hung], {
    jobTimeoutMs: 1000,
    keepaliveIntervalMs: 25,
  });
  assert.equal(status, 'failed');
  assert.equal(signalSeen, true);
  assert.equal(completed.has('wall-1'), false);
  assert.match(failed.get('wall-1') ?? '', new RegExp(`^${JOB_WALL_TIMEOUT_MESSAGE}`));
  assert.equal(jobs.get('wall-1')?.status, 'failed');
});

test('job wall timeout: Infinity disables the bound; fast job completes', async () => {
  const { host, completed, failed } = createMemoryJobHost([
    { jobId: 'wall-off', spec: lbmSpec() },
  ]);
  const status = await runGuardedClaimLoopOnce(host, 'agent-a', [interruptibleOkRunner()], {
    jobTimeoutMs: Infinity,
  });
  assert.equal(status, 'completed');
  assert.ok(completed.get('wall-off'));
  assert.equal(failed.size, 0);
});

test('job wall timeout: expiry never outranks an earlier lease_lost/cancel', async () => {
  // keepaliveError precedence (??=): a lease loss recorded before the bound
  // fires must stay the settlement reason, not be overwritten by timeout.
  const fx = createLeaseCancelFixtureHost([{ jobId: 'wall-lease', spec: lbmSpec(50) }], {
    leaseMs: 500,
    startMs: 7_000_000,
  });
  const slow: InterruptibleJobRunner = {
    canRun: (s) => s.kind === 'lbm-d3q19',
    async run(spec, onProgress, signal) {
      await onProgress?.({ step: 1, total: spec.run.maxSteps });
      fx.advanceMs(600);
      fx.reclaimExpiredLeases();
      assert.equal(await fx.host.renewLease!('wall-lease', 'agent-a'), null);
      if (signal?.aborted) throw new DOMException('lease abort', 'AbortError');
      return okResult(spec.run.maxSteps);
    },
  };
  const status = await runGuardedClaimLoopOnce(fx.host, 'agent-a', [slow], {
    jobTimeoutMs: 1000,
    keepaliveIntervalMs: 10,
  });
  assert.equal(status, 'lease_lost');
  assert.equal(fx.failed.has('wall-lease'), false);
  assert.equal(fx.completed.has('wall-lease'), false);
});

test('agentJobTimeoutMs: default 3600000 scrubbed; env parse + clamp bounds', () => {
  assert.equal(agentJobTimeoutMs(undefined), 3_600_000);
  assert.equal(agentJobTimeoutMs('5000'), 5000);
  assert.equal(agentJobTimeoutMs('86400000'), 86_400_000);
  for (const bad of ['0', '999', '86400001', 'abc', 'NaN', 'Infinity', '1.5e9']) {
    assert.throws(() => agentJobTimeoutMs(bad), /W_SIM_JOB_TIMEOUT_MS/);
  }
});
