/**
 * Backend-membership + claim-keepalive guards.
 *
 * - result backend ids must satisfy requirements.backends (ANY-OF): honest cpu
 *   results must never satisfy cuda-only specs and cuda results must never leak
 *   into cpu-only specs.
 * - the claim keepalive renews the lease and probes cancellation for silent
 *   runners independently of progress events; confirmed lease loss / cancel wins
 *   over subprocess exit noise; transient heartbeat failures retry next tick.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobProgress, JobResultV1, JobSpecV1 } from '@w-sim/contracts';
import type { JobHostClient, JobRunner } from '@w-sim/runtime';
import {
  findNativeCudaBinary,
  invalidateNativeCudaProbeCache,
  isCudaResultBackendId,
  isHostResultBackendId,
  nativeCudaBinaryDiag,
  nativeCudaEligible,
  nativeCudaTimeoutMs,
  probeNativeCuda,
  probeNativeCudaSync,
  resultBackendAllowed,
  runNativeCudaSubcommand,
} from './backends/native-cuda.ts';
import {
  failRetryableForMessage,
  LEASE_LOST_MESSAGE,
  runGuardedClaimLoopOnce,
  type InterruptibleJobRunner,
} from './guarded-claim.ts';
import { HostJobCancelledError } from './lease-deadline.ts';
import { beginRunTelemetry, drainFallbackReason, endRunTelemetry, recordFallback } from './run-telemetry.ts';
import { createAgentSolverRegistry, createLbmJobRunner } from './runners.ts';
import { buildAnalyticalSlabJobSpec } from '@w-sim/solvers-thermal';

test('nativeCudaEligible upgrades on cuda tokens and unconstrained/any-gpu specs', () => {
  assert.equal(nativeCudaEligible(['cuda']), true);
  assert.equal(nativeCudaEligible(['native-cuda']), true);
  assert.equal(nativeCudaEligible(['cpu', 'cuda']), true);
  // 'webgpu' means "any GPU" — a native cuda result satisfies it
  assert.equal(nativeCudaEligible(['webgpu']), true);
  // no constraint → the claim may be upgraded to cuda
  assert.equal(nativeCudaEligible([]), true);
  // host-only and dawn-specific requirements must not be upgraded
  assert.equal(nativeCudaEligible(['cpu']), false);
  assert.equal(nativeCudaEligible(['webgpu-dawn']), false);
});

test('isHostResultBackendId covers cpu family ids, never cuda ids', () => {
  for (const id of ['cpu', 'cpu-thermal-steady', 'cpu-lbm', 'w-sim-cuda-host', 'host-f64']) {
    assert.equal(isHostResultBackendId(id), true, id);
  }
  for (const id of ['cuda', 'w-sim-cuda', 'native-cuda-sw-x', 'dawn-lbm']) {
    assert.equal(isHostResultBackendId(id), false, id);
  }
});

test('isCudaResultBackendId covers cuda family ids only', () => {
  for (const id of ['cuda', 'w-sim-cuda', 'native-cuda', 'native-cuda-sw-x']) {
    assert.equal(isCudaResultBackendId(id), true, id);
  }
  for (const id of ['cpu', 'cpu-x', 'w-sim-cuda-host', 'host-f64']) {
    assert.equal(isCudaResultBackendId(id), false, id);
  }
});

test('resultBackendAllowed enforces requirements.backends as ANY-OF membership', () => {
  assert.equal(resultBackendAllowed('cpu', []), true);
  // a missing backend id never satisfies a constrained spec
  assert.equal(resultBackendAllowed(undefined, ['cuda']), false);
  assert.equal(resultBackendAllowed(undefined, ['cpu']), false);
  // cuda requirement accepts cuda-family results, rejects host results
  assert.equal(resultBackendAllowed('native-cuda-sw-x', ['cuda']), true);
  assert.equal(resultBackendAllowed('cpu', ['cuda']), false);
  assert.equal(resultBackendAllowed('cpu-x', ['cuda']), false);
  // cpu requirement accepts cpu-family results, rejects cuda results
  assert.equal(resultBackendAllowed('cpu', ['cpu']), true);
  assert.equal(resultBackendAllowed('cpu-thermal-steady', ['cpu']), true);
  assert.equal(resultBackendAllowed('native-cuda-sw-x', ['cpu']), false);
  // mixed requirements accept either family member
  assert.equal(resultBackendAllowed('native-cuda-sw-x', ['cpu', 'cuda']), true);
  assert.equal(resultBackendAllowed('cpu-x', ['cpu', 'cuda']), true);
  // native-cuda token requirement accepts native-cuda ids
  assert.equal(resultBackendAllowed('native-cuda-sw-x', ['native-cuda']), true);
  // 'webgpu' means any GPU: cuda-family results satisfy it, host results do not
  assert.equal(resultBackendAllowed('native-cuda-sw-x', ['webgpu']), true);
  assert.equal(resultBackendAllowed('webgpu-dawn', ['webgpu']), true);
  assert.equal(resultBackendAllowed('cpu', ['webgpu']), false);
});

const SPEC: JobSpecV1 = {
  schemaVersion: 1,
  kind: 'test-kind',
  parameters: {},
  requirements: { backends: ['cpu'], precision: 'float64' },
  run: { maxSteps: 1 },
} as JobSpecV1;

const RESULT: JobResultV1 = {
  schemaVersion: 1,
  kind: 'test-kind',
  summary: { steps: 1, wallTimeMs: 1 },
  backend: { id: 'cpu' },
} as JobResultV1;

function fakeHost(renewLease: (jobId: string, agentId: string) => Promise<string | null>) {
  const completed = new Map<string, JobResultV1>();
  const failed = new Map<string, string>();
  let claims = 0;
  const host: JobHostClient = {
    async registerAgent() {},
    async claim() {
      return claims++ === 0
        ? { jobId: 'j1', attempt: 0, spec: SPEC, leaseExpiresAt: new Date(Date.now() + 60000).toISOString() }
        : null;
    },
    async progress() {},
    async complete(jobId, result) {
      completed.set(jobId, result);
      return { jobId, status: 'succeeded', result };
    },
    async fail(jobId, error) {
      failed.set(jobId, error);
      return { jobId, status: 'failed', error };
    },
    renewLease,
  };
  return { host, completed, failed };
}

/**
 * Silent runner: emits no progress and settles only when its abort signal fires.
 * A backstop timer keeps the event loop alive (the keepalive interval is
 * deliberately unref'd so it cannot pin a wedged process) and fails the test if
 * the keepalive never aborts.
 */
function silentRunner(resolveOnAbort: 'reject' | 'resolve'): JobRunner {
  const runner: InterruptibleJobRunner = {
    canRun: () => true,
    run: (_spec: JobSpecV1, _onProgress?: (p: JobProgress) => void, signal?: AbortSignal) =>
      new Promise((resolve, reject) => {
        const backstop = setTimeout(
          () => reject(new Error('keepalive never aborted the silent runner')),
          10_000,
        );
        signal?.addEventListener('abort', () => {
          clearTimeout(backstop);
          if (resolveOnAbort === 'reject') {
            reject(new DOMException('interrupted by signal', 'AbortError'));
          } else {
            resolve(RESULT);
          }
        });
      }),
  };
  return runner;
}

test('keepalive detects lease loss for a silent runner and refuses stale publish', async () => {
  let renews = 0;
  const { host, completed, failed } = fakeHost(async () => (++renews === 1 ? 'lease-ok' : null));
  const status = await runGuardedClaimLoopOnce(host, 'a1', [silentRunner('reject')], {
    keepaliveIntervalMs: 100,
  });
  assert.equal(status, 'lease_lost');
  assert.equal(completed.size, 0);
  assert.equal(failed.has('j1'), false, 'confirmed lease loss must not send a stale fail write');
});

test('keepalive detects host cancellation for a silent runner without progress', async () => {
  const { host, completed, failed } = fakeHost(async () => 'lease-ok');
  host.fail = async (jobId, error) => {
    failed.set(jobId, error);
    return { jobId, status: 'cancelled' };
  };
  const status = await runGuardedClaimLoopOnce(host, 'a1', [silentRunner('reject')], {
    keepaliveIntervalMs: 100,
    isCancelRequested: () => true,
  });
  assert.equal(status, 'cancelled');
  assert.equal(completed.size, 0);
  assert.match(failed.get('j1') ?? '', /cancel/i);
});

test('keepalive tolerates a transient renewLease failure and settles normally', async () => {
  let renews = 0;
  const { host, completed, failed } = fakeHost(async () => {
    if (++renews === 1) throw new Error('transient network');
    return 'lease-ok';
  });
  const runner: InterruptibleJobRunner = {
    canRun: () => true,
    run: () => new Promise((resolve) => setTimeout(() => resolve(RESULT), 300)),
  };
  const status = await runGuardedClaimLoopOnce(host, 'a1', [runner], {
    keepaliveIntervalMs: 100,
  });
  assert.equal(status, 'completed');
  assert.equal(completed.get('j1'), RESULT);
  assert.equal(failed.size, 0);
});

test('keepalive keeps a silent runner leased through a long no-progress run', async () => {
  let renews = 0;
  const { host, completed } = fakeHost(async () => (++renews, 'lease-ok'));
  const runner: InterruptibleJobRunner = {
    canRun: () => true,
    run: () => new Promise((resolve) => setTimeout(() => resolve(RESULT), 350)),
  };
  const status = await runGuardedClaimLoopOnce(host, 'a1', [runner], {
    keepaliveIntervalMs: 100,
  });
  assert.equal(status, 'completed');
  assert.ok(renews >= 1, 'expected at least one keepalive renewal');
  assert.equal(completed.get('j1'), RESULT);
});

test('keepalive: persistent renewal outage past last deadline aborts as retryable failure', async () => {
  // A transport failure is not proof of lease loss — the run retries inside the
  // last-known lease window, then aborts as *retryable* (never lease_lost /
  // non-retryable: ownership was merely unverifiable, not refused by host).
  const { host, completed, failed } = fakeHost(async () => {
    throw new Error('host unreachable');
  });
  host.claim = async () => ({
    jobId: 'j1',
    attempt: 0,
    spec: SPEC,
    leaseExpiresAt: new Date(Date.now() + 300).toISOString(),
  });
  const status = await runGuardedClaimLoopOnce(host, 'a1', [silentRunner('reject')], {
    keepaliveIntervalMs: 100,
    leaseSkewMs: 100,
  });
  assert.equal(status, 'failed');
  assert.equal(completed.size, 0);
  assert.match(failed.get('j1') ?? '', /lease renewal unreachable/);
  assert.equal(failRetryableForMessage(failed.get('j1') ?? ''), true);
});

test('keepalive: host-cancel renewal failure settles cancelled, not lease_lost', async () => {
  const { host, completed, failed } = fakeHost(async () => {
    throw new HostJobCancelledError();
  });
  const status = await runGuardedClaimLoopOnce(host, 'a1', [silentRunner('reject')], {
    keepaliveIntervalMs: 100,
  });
  assert.equal(status, 'cancelled');
  assert.equal(completed.size, 0);
  assert.equal(failed.size, 0, 'Host-confirmed cancellation must not send a redundant fail');
});

test('keepalive: foreign AbortError (timeout-shaped) renewal failure is transient', async () => {
  // Only HostJobCancelledError classifies as host cancel — a timeout-shaped
  // transport abort retries inside the last-known lease window.
  let renews = 0;
  const { host, completed, failed } = fakeHost(async () => {
    if (++renews === 1) throw new DOMException('The operation timed out', 'AbortError');
    return 'lease-ok';
  });
  const runner: InterruptibleJobRunner = {
    canRun: () => true,
    run: () => new Promise((resolve) => setTimeout(() => resolve(RESULT), 300)),
  };
  const status = await runGuardedClaimLoopOnce(host, 'a1', [runner], {
    keepaliveIntervalMs: 100,
  });
  assert.equal(status, 'completed');
  assert.equal(completed.get('j1'), RESULT);
  assert.equal(failed.size, 0);
});

test('W_SIM_BACKEND=cuda never overrides an explicit cpu-only spec', async () => {
  const saved = process.env.W_SIM_BACKEND;
  process.env.W_SIM_BACKEND = 'cuda';
  try {
    const registry = createAgentSolverRegistry({ agentId: 'pref-agent' });
    const spec = buildAnalyticalSlabJobSpec({ nx: 9 });
    assert.deepEqual(spec.requirements.backends, ['cpu']);
    const resolved = registry.resolve(spec);
    assert.ok(resolved.ok, !resolved.ok ? resolved.message : '');
    const result = await resolved.runner.run(spec);
    assert.match(result.backend?.id ?? '', /^cpu(?:-|$)/, 'cpu spec must run cpu even with cuda preference');
  } finally {
    if (saved === undefined) delete process.env.W_SIM_BACKEND;
    else process.env.W_SIM_BACKEND = saved;
  }
});

test('nativeCudaTimeoutMs bounds and validates the hard wall clock', () => {
  assert.equal(nativeCudaTimeoutMs(undefined), 120_000);
  assert.equal(nativeCudaTimeoutMs('5000'), 5000);
  assert.equal(nativeCudaTimeoutMs('1000'), 1000);
  for (const bad of ['0', '999', '-1', 'abc', '86400001', 'Infinity', '']) {
    assert.throws(() => nativeCudaTimeoutMs(bad), /W_SIM_NATIVE_TIMEOUT_MS/);
  }
});

function fakeCudaBinary(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fake-w-sim-cuda-'));
  const file = join(dir, 'w-sim-cuda');
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  return file;
}

async function withCudaEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('native subcommand hard timeout kills a hung child instead of waiting forever', async () => {
  const binary = fakeCudaBinary('#!/bin/sh\nsleep 30\n');
  await withCudaEnv(
    { W_SIM_CUDA_PATH: binary, W_SIM_NATIVE_TIMEOUT_MS: '1000' },
    async () => {
      await assert.rejects(
        () => runNativeCudaSubcommand('md', SPEC),
        /timed out after 1000ms/,
      );
    },
  );
});

test('native subcommand rejects an oversized result.json instead of parsing it', async () => {
  const binary = fakeCudaBinary(
    '#!/bin/sh\nwhile [ $# -gt 0 ]; do\n  case "$1" in --result) shift; R="$1";; esac\n  shift\ndone\nhead -c 34000000 /dev/zero | tr "\\000" "0" > "$R"\n',
  );
  await withCudaEnv({ W_SIM_CUDA_PATH: binary }, async () => {
    await assert.rejects(
      () => runNativeCudaSubcommand('md', SPEC),
      /result\.json exceeds the 32 MiB bound/,
    );
  });
});

/** Capture console.log/warn lines for [agent:telemetry] / [agent:fallback] assertions. */
function captureConsole() {
  const lines: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  return {
    lines,
    telemetry(): Record<string, unknown> | null {
      const line = lines.find((l) => l.startsWith('[agent:telemetry] '));
      return line ? (JSON.parse(line.slice('[agent:telemetry] '.length)) as Record<string, unknown>) : null;
    },
    restore() {
      console.log = origLog;
      console.warn = origWarn;
    },
  };
}

test('claim emits one grep-able telemetry line with request_id/backend/latency/git_sha', async () => {
  const { host, completed } = fakeHost(async () => 'lease-ok');
  const result: JobResultV1 = {
    ...RESULT,
    backend: { id: 'cpu-test', deviceName: 'test-device' },
  } as JobResultV1;
  const runner: JobRunner = { canRun: () => true, run: async () => result };
  const cap = captureConsole();
  try {
    const status = await runGuardedClaimLoopOnce(host, 'a1', [runner], { keepaliveIntervalMs: 100 });
    assert.equal(status, 'completed');
    assert.equal(completed.get('j1'), result);
    const t = cap.telemetry();
    assert.ok(t, 'expected one [agent:telemetry] line');
    assert.equal(t.event, 'agent.run');
    assert.equal(t.request_id, 'j1');
    assert.equal(t.kind, 'test-kind');
    assert.equal(t.status, 'completed');
    assert.equal(t.backend_used, 'cpu-test');
    assert.equal(t.cuda_used, false);
    assert.equal(t.device, 'test-device');
    assert.equal(t.fallback_reason, null);
    assert.deepEqual(t.backend_requested, ['cpu']);
    assert.equal(typeof t.latency_ms, 'number');
    assert.ok(typeof t.git_sha === 'string' && (t.git_sha as string).length > 0);
  } finally {
    cap.restore();
  }
});

test('telemetry records status=failed with the run error', async () => {
  const { host, failed } = fakeHost(async () => 'lease-ok');
  const runner: JobRunner = {
    canRun: () => true,
    run: async () => { throw new Error('solver exploded'); },
  };
  const cap = captureConsole();
  try {
    const status = await runGuardedClaimLoopOnce(host, 'a1', [runner], { keepaliveIntervalMs: 100 });
    assert.equal(status, 'failed');
    assert.match(failed.get('j1') ?? '', /solver exploded/);
    const t = cap.telemetry();
    assert.ok(t);
    assert.equal(t.status, 'failed');
    assert.equal(t.backend_used, null);
    assert.match(String(t.error ?? ''), /solver exploded/);
  } finally {
    cap.restore();
  }
});

test('recordFallback/drainFallbackReason capture degradation reasons per run', () => {
  assert.equal(drainFallbackReason(), null, 'no context → no residue');
  beginRunTelemetry();
  recordFallback('native-cuda probe failed:   binary missing\nstack junk');
  recordFallback('second reason');
  assert.equal(drainFallbackReason(), 'native-cuda probe failed: binary missing stack junk; second reason');
  endRunTelemetry();
  assert.equal(drainFallbackReason(), null);
  recordFallback('outside context — ignored');
  assert.equal(drainFallbackReason(), null);
});

test('W_SIM_BACKEND=cuda probe failure degrades to host and reports fallback_reason', async () => {
  // A binary whose --version always fails → probe deterministically fails on any host.
  const binary = fakeCudaBinary('#!/bin/sh\nexit 1\n');
  await withCudaEnv({ W_SIM_BACKEND: 'cuda', W_SIM_CUDA_PATH: binary }, async () => {
    invalidateNativeCudaProbeCache();
    const spec = buildAnalyticalSlabJobSpec({ nx: 9 });
    (spec.requirements as { backends: string[] }).backends = ['cpu', 'cuda'];
    const { host, completed, failed } = fakeHost(async () => 'lease-ok');
    // Patch claim to hand back our spec instead of the default cpu-only one.
    const origClaim = host.claim!.bind(host);
    host.claim = async () => {
      const c = await origClaim();
      return c ? { ...c, spec } : null;
    };
    const registry = createAgentSolverRegistry({ agentId: 'a1' });
    const cap = captureConsole();
    try {
      const status = await runGuardedClaimLoopOnce(host, 'a1', registry.asJobRunners(), { keepaliveIntervalMs: 100 });
      assert.equal(status, 'completed');
      const result = completed.get('j1');
      assert.ok(result, 'host path should still settle the job');
      assert.match(result!.backend?.id ?? '', /^cpu/, 'degraded run must produce an honest cpu result');
      assert.ok(
        cap.lines.some((l) => l.startsWith('[agent:fallback] ') && l.includes('native-cuda')),
        'expected an immediate [agent:fallback] warning',
      );
      const t = cap.telemetry();
      assert.ok(t);
      assert.equal(t.status, 'completed');
      assert.equal(t.cuda_used, false);
      assert.match(String(t.fallback_reason ?? ''), /native-cuda.*(probe failed|unavailable)/);
    } finally {
      cap.restore();
    }
    assert.equal(failed.size, 0);
  });
});

test('cuda-only spec is rejected before dispatch when the probe cannot advertise CUDA', async () => {
  const binary = fakeCudaBinary('#!/bin/sh\nexit 1\n');
  await withCudaEnv({ W_SIM_BACKEND: 'auto', W_SIM_CUDA_PATH: binary }, async () => {
    invalidateNativeCudaProbeCache();
    const spec = buildAnalyticalSlabJobSpec({ nx: 9 });
    (spec.requirements as { backends: string[] }).backends = ['cuda'];
    const { host, completed, failed } = fakeHost(async () => 'lease-ok');
    const origClaim = host.claim!.bind(host);
    host.claim = async () => {
      const c = await origClaim();
      return c ? { ...c, spec } : null;
    };
    const registry = createAgentSolverRegistry({ agentId: 'a1' });
    const thermal = registry.list().find((descriptor) => descriptor.kinds.includes('thermal-3d-steady'));
    assert.ok(thermal);
    assert.ok(!thermal.backends.includes('cuda') && !thermal.backends.includes('native-cuda'));
    const cap = captureConsole();
    try {
      const status = await runGuardedClaimLoopOnce(host, 'a1', registry.asJobRunners(), { keepaliveIntervalMs: 100 });
      assert.equal(status, 'failed');
      assert.equal(completed.size, 0, 'cuda-only job must not settle on a weaker backend');
      assert.match(
        failed.get('j1') ?? '',
        /^(?:no runner for kind=thermal-3d-steady|native-cuda backend lacks thermal-3d-steady support \(probe: --version exited 1\))$/,
        'a missing capability or failed CUDA probe must reject the CUDA-only job',
      );
      const t = cap.telemetry();
      assert.ok(t);
      assert.equal(t.status, 'failed');
      assert.equal(t.fallback_reason, null, 'fail-closed is not a fallback');
    } finally {
      cap.restore();
    }
  });
});

test('cuda-only spec fails closed when an advertised backend disappears before execution', async () => {
  const binary = fakeCudaBinary('#!/bin/sh\necho \'{"version":"1.0.0","features":["thermal-3d-steady"]}\'\n');
  await withCudaEnv({ W_SIM_BACKEND: 'auto', W_SIM_CUDA_PATH: binary }, async () => {
    invalidateNativeCudaProbeCache();
    const registry = createAgentSolverRegistry({ agentId: 'a1' });
    const thermal = registry.list().find((descriptor) => descriptor.kinds.includes('thermal-3d-steady'));
    assert.ok(thermal?.backends.includes('cuda'));
    writeFileSync(binary, '#!/bin/sh\nexit 1\n');
    invalidateNativeCudaProbeCache();

    const spec = buildAnalyticalSlabJobSpec({ nx: 9 });
    (spec.requirements as { backends: string[] }).backends = ['cuda'];
    const { host, completed, failed } = fakeHost(async () => 'lease-ok');
    const claim = host.claim!.bind(host);
    host.claim = async () => {
      const job = await claim();
      return job ? { ...job, spec } : null;
    };
    const cap = captureConsole();
    try {
      assert.equal(await runGuardedClaimLoopOnce(host, 'a1', registry.asJobRunners()), 'failed');
      assert.equal(completed.size, 0, 'loss of required CUDA must never settle a CPU result');
      assert.match(failed.get('j1') ?? '', /native-cuda backend lacks thermal-3d-steady support/);
      const telemetry = cap.telemetry();
      assert.ok(telemetry);
      assert.equal(telemetry.status, 'failed');
      assert.equal(telemetry.fallback_reason, null);
    } finally {
      cap.restore();
      invalidateNativeCudaProbeCache();
    }
  });
});

test('spec excluding cuda never attempts it — no fallback recorded', async () => {
  const binary = fakeCudaBinary('#!/bin/sh\nexit 1\n');
  await withCudaEnv({ W_SIM_BACKEND: 'cuda', W_SIM_CUDA_PATH: binary }, async () => {
    invalidateNativeCudaProbeCache();
    const spec = buildAnalyticalSlabJobSpec({ nx: 9 }); // requirements.backends = ['cpu']
    assert.deepEqual(spec.requirements.backends, ['cpu']);
    const { host, completed } = fakeHost(async () => 'lease-ok');
    const origClaim = host.claim!.bind(host);
    host.claim = async () => {
      const c = await origClaim();
      return c ? { ...c, spec } : null;
    };
    const registry = createAgentSolverRegistry({ agentId: 'a1' });
    const cap = captureConsole();
    try {
      const status = await runGuardedClaimLoopOnce(host, 'a1', registry.asJobRunners(), { keepaliveIntervalMs: 100 });
      assert.equal(status, 'completed');
      const t = cap.telemetry();
      assert.ok(t);
      assert.equal(t.fallback_reason, null, 'honoring a cpu-only spec is not a fallback');
      assert.equal(cap.lines.some((l) => l.startsWith('[agent:fallback]')), false);
    } finally {
      cap.restore();
    }
  });
});

test('repeated native subcommand runs leak neither file descriptors nor temp dirs', async (t) => {
  if (process.platform === 'win32') return t.skip('fd counting is /proc-based');
  const { readdirSync } = await import('node:fs');
  // A binary that exits fast with a minimal valid result.
  const binary = fakeCudaBinary(
    '#!/bin/sh\nwhile [ $# -gt 0 ]; do\n  case "$1" in --result) shift; R="$1";; esac\n  shift\ndone\nprintf \'{"schemaVersion":1,"summary":{"steps":1,"wallTimeMs":1},"backend":{"id":"native-cuda"}}\' > "$R"\n',
  );
  const fdCount = () => readdirSync('/proc/self/fd').length;
  const wsimTmp = () => readdirSync(tmpdir()).filter((d) => d.startsWith('w-sim-cuda-')).length;
  await withCudaEnv({ W_SIM_CUDA_PATH: binary, W_SIM_NATIVE_TIMEOUT_MS: '5000' }, async () => {
    const spec = { ...SPEC, kind: 'md-batch' } as JobSpecV1;
    for (let i = 0; i < 3; i++) await runNativeCudaSubcommand('md', spec); // warm
    const fd0 = fdCount();
    const tmp0 = wsimTmp();
    for (let i = 0; i < 20; i++) await runNativeCudaSubcommand('md', spec);
    assert.equal(wsimTmp(), tmp0, 'temp dirs must be cleaned in finally');
    assert.ok(fdCount() <= fd0 + 1, `fd leak: ${fd0} → ${fdCount()}`);
  });
});

test('W_SIM_CUDA_PATH is authoritative: an unusable override never falls back to discovery', async () => {
  const unusable = join(tmpdir(), `w-sim-cuda-missing-${process.pid}`);
  await withCudaEnv({ W_SIM_CUDA_PATH: unusable }, async () => {
    invalidateNativeCudaProbeCache();
    assert.equal(findNativeCudaBinary(), null, 'explicit path must not silently fall through to candidate search');
    assert.match(nativeCudaBinaryDiag(), /not executable/);
    const probe = await probeNativeCuda();
    assert.equal(probe.ok, false);
    assert.match(probe.reason ?? '', /not executable/);
    invalidateNativeCudaProbeCache();
    const sync = probeNativeCudaSync();
    assert.equal(sync.ok, false);
    assert.match(sync.reason ?? '', /not executable/);
  });
});

test('W_SIM_CUDA_PATH pointing at an executable wins and diagnoses cleanly', async () => {
  const binary = fakeCudaBinary('#!/bin/sh\necho fake\n');
  await withCudaEnv({ W_SIM_CUDA_PATH: binary }, async () => {
    assert.equal(findNativeCudaBinary(), binary);
    assert.ok(nativeCudaBinaryDiag().includes(binary));
  });
});

test('sync probe parses --version JSON on stderr the same as the async probe', async () => {
  const binary = fakeCudaBinary(
    '#!/bin/sh\necho \'{"version":"9.9.9","device":"Fake GPU","features":["lbm","waveworld-module"]}\' >&2\n',
  );
  await withCudaEnv({ W_SIM_CUDA_PATH: binary }, async () => {
    invalidateNativeCudaProbeCache();
    const sync = probeNativeCudaSync();
    assert.equal(sync.ok, true, sync.reason);
    assert.equal(sync.version, '9.9.9');
    assert.equal(sync.deviceName, 'Fake GPU');
    assert.deepEqual(sync.features, ['lbm', 'waveworld-module']);
    invalidateNativeCudaProbeCache();
    const asyncProbe = await probeNativeCuda();
    assert.equal(asyncProbe.ok, true, asyncProbe.reason);
    assert.deepEqual(asyncProbe.features, ['lbm', 'waveworld-module']);
  });
});

test('lbm smoke modes reject non-cpu requirements before computing', async () => {
  const runner = createLbmJobRunner({ agentId: 'smoke-agent' });
  const spec = {
    schemaVersion: 1,
    kind: 'lbm-d3q19',
    parameters: { mode: 'lid-cavity' },
    requirements: { backends: ['cuda'] },
    run: { maxSteps: 4 },
  } as JobSpecV1;
  await assert.rejects(() => runner.run(spec), /produces cpu results/);
});

test('a throwing runner factory settles the job failed instead of stranding the lease', async () => {
  const { host, failed } = fakeHost(async () => 'lease-ok');
  const status = await runGuardedClaimLoopOnce(host, 'a1', () => {
    throw new Error('registry exploded: duplicate kind@version');
  });
  assert.equal(status, 'failed');
  assert.match(failed.get('j1') ?? '', /runner factory failed.*duplicate kind@version/);
});
