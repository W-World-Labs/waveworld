#!/usr/bin/env bun
/**
 * tuanliu-agent — 领取并执行风洞批算任务（可编译为二进制）
 *
 *   ./bin/tuanliu-agent register --name my-gpu
 *   ./bin/tuanliu-agent run
 *   ./bin/tuanliu-agent once
 *   ./bin/tuanliu-agent submit --preset cylinder --steps 500
 */

import fs from 'node:fs';
import { defaultJobSpec, MAC_3D_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_FIELD_HISTORY_FEATURE, LBM_GROUND_FEATURE, LBM_THERMAL_FEATURES } from '@w-sim/contracts';
import path from 'node:path';
import { TaskApiClient } from './client.ts';
import { runClaimLoop } from './claim-loop.ts';
import { probeDawn } from './backends/webgpu-dawn.ts';
import { nativeCudaBinaryDiag, probeNativeCuda, resolveLbmBackendPreference } from './backends/native-cuda.ts';
import { createAgentPathModelRegistry, pathModelCapabilities } from './path-plugin-loader.ts';
import { resolveDataDir, resolveProjectRoot } from './paths.ts';
import { resolveAgentBuildProvenance } from './build-provenance.ts';
import { agentGitSha } from './run-telemetry.ts';
import { listAgentSolverKinds } from './runners.ts';

const ROOT = resolveProjectRoot();
const TOKEN_FILE = path.join(resolveDataDir(), 'agent-token.json');

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else pos.push(a);
  }
  return { cmd: pos[0] ?? 'help', args, pos };
}

function loadSavedToken(): { token: string; agentId: string; baseUrl: string } | null {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveToken(data: { token: string; agentId: string; baseUrl: string; name: string }) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
  console.log(`saved credentials → ${TOKEN_FILE}`);
}

async function main() {
  const { cmd, args } = parseArgs(process.argv.slice(2));

  if (cmd === 'help' || args.help) {
    console.log(`tuanliu-agent (binary-ready)
  register --name <name> [--url http://127.0.0.1:3001]
  run [--token <t>] [--url ...]
  once [--token <t>] [--url ...]
  submit --preset cylinder [--steps 2000] [--grid fast] [--url ...]
  probe               human-readable backend probe (dawn + native-cuda)
  health              one agent_health JSON line: ready = can accept work
                      under current W_SIM_BACKEND (exit 1 when unsatisfied)
  models              list integrity-verified runtime path plugins
  version

Env:
  TASK_API_URL             API base (required in production; local dev defaults to http://127.0.0.1:3001)
  AGENT_TOKEN              Bearer token
  TUANLIU_ROOT             project root (public/models)
  TUANLIU_DATA             data dir for agent-token.json
  W_SIM_BACKEND            GPU backend preference: auto|cuda|dawn|wasm (default auto).
                           Preference only — never overrides spec.requirements.backends;
                           explicit cuda-only specs still fail closed. On probe/exec
                           failure the agent degrades to the next permitted backend and
                           reports fallback_reason in the [agent:telemetry] line.
                           Rollback to non-cuda: set W_SIM_BACKEND=dawn|wasm|cpu-side
                           spec — no rebuild needed.
  W_SIM_CUDA_PATH          explicit path to the w-sim-cuda binary
  W_SIM_NATIVE_TIMEOUT_MS  hard wall-clock timeout per native subcommand run
                           (default 120000, min 1000, max 86400000)
  W_SIM_JOB_TIMEOUT_MS     hard wall-clock bound per claimed job across all
                           backends incl. in-process wasm/dawn (default
                           3600000, min 1000, max 86400000). On expiry the
                           job aborts and settles retryable-failed.
`);
    return;
  }

  if (cmd === 'version') {
    console.log('tuanliu-agent 0.1.0');
    console.log('root', ROOT);
    console.log('data', resolveDataDir());
    return;
  }

  if (cmd === 'probe') {
    const r = await probeDawn();
    const c = await probeNativeCuda();
    console.log(r);
    console.log('native-cuda', c);
    process.exit(r.ok || c.ok ? 0 : 1);
  }

  if (cmd === 'health') {
    // Readiness, not liveness: can this agent accept work under the configured
    // W_SIM_BACKEND? One grep-able JSON line; exit 1 when the configured
    // preference cannot be served (e.g. W_SIM_BACKEND=cuda with a dead probe).
    const dawn = await probeDawn();
    const cuda = await probeNativeCuda();
    const preference = process.env.W_SIM_BACKEND ?? 'auto';
    const preferenceSatisfied =
      preference === 'cuda' ? cuda.ok :
      preference === 'dawn' ? dawn.ok :
      // auto/wasm: cpu+wasm always works — ready stays true, gpu_ready carries the signal.
      true;
    const health = {
      ready: preferenceSatisfied,
      preference,
      preference_satisfied: preferenceSatisfied,
      gpu_ready: dawn.ok || cuda.ok,
      backends: {
        cuda: { ok: cuda.ok, device: cuda.deviceName ?? null, reason: cuda.ok ? null : (cuda.reason ?? 'unavailable'), binary: cuda.binary ?? null },
        dawn: { ok: dawn.ok, device: dawn.deviceName ?? null, reason: dawn.ok ? null : (dawn.reason ?? 'unavailable') },
        cpu: { ok: true },
      },
      git_sha: agentGitSha(),
    };
    console.log(`agent_health ${JSON.stringify(health)}`);
    process.exit(health.ready ? 0 : 1);
  }

  if (cmd === 'models') {
    const registry = await createAgentPathModelRegistry(resolveAgentBuildProvenance());
    console.log(JSON.stringify({ pathModels: pathModelCapabilities(registry) }, null, 2));
    return;
  }

  const configuredBase = args.url ?? process.env.TASK_API_URL;
  if (!configuredBase && process.env.NODE_ENV === 'production') {
    throw new Error('Set TASK_API_URL or pass --url in production');
  }
  const baseUrl = String(configuredBase ?? 'http://127.0.0.1:3001');

  if (cmd === 'register') {
    const name = String(args.name ?? `agent-${process.platform}`);
    const probe = await probeDawn();
    const cudaProbe = await probeNativeCuda();
    console.log('[probe]', probe);
    if (cudaProbe.ok) console.log('[probe] native-cuda ok', cudaProbe.deviceName ?? cudaProbe.version ?? cudaProbe.binary);
    else if (cudaProbe.binary) console.warn('[probe] native-cuda present but probe failed:', cudaProbe.reason);
    const client = new TaskApiClient(baseUrl);
    const registrationKey = String(args['registration-key'] ?? process.env.AGENT_REGISTRATION_KEY ?? '');
    const buildProvenance = resolveAgentBuildProvenance();
    const pathModelRegistry = await createAgentPathModelRegistry(buildProvenance);
    const pathModels = pathModelCapabilities(pathModelRegistry);
    const { agent, token } = await client.register(name, {
      // CPU product LBM uses the shared Rust/WASM kernel, including fan forcing.
      // Capability advertisement must reflect the physical node. A CPU-only VPS
      // must never attract jobs that require a real Dawn/Vulkan adapter.
      // 'cuda'（SolverBackendId）仅在 w-sim-cuda 探测成功时声明；result.backend.id
      // 仍用内部标识 'native-cuda'。v1 原生路径不含热通道，故不新增 feature。
      backends: [...(probe.ok ? (['webgpu-dawn'] as const) : []), ...((probe.ok || cudaProbe.ok) ? (['webgpu'] as const) : []), ...(cudaProbe.ok ? (['cuda'] as const) : []), 'cpu'],
      maxGrid: 'fine',
      thermal: true,
      fan: true,
      features: [MAC_3D_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_FIELD_HISTORY_FEATURE, LBM_GROUND_FEATURE, ...LBM_THERMAL_FEATURES, ...(probe.ok ? ['webgpu', 'voxelization'] : ['voxelization'])],
      kinds: [...listAgentSolverKinds({ agentId: 'registration', pathModelRegistry })],
      pathModels,
      agentBuildId: buildProvenance.agentBuildId,
      dependencyLockSha256: buildProvenance.dependencyLockSha256,
    }, registrationKey || undefined);
    saveToken({ token, agentId: agent.id, baseUrl, name: agent.name });
    console.log('agentId:', agent.id);
    console.log('token:  ', token);
    console.log('\nRun: tuanliu-agent run');
    return;
  }

  if (cmd === 'submit') {
    const preset = String(args.preset ?? 'cylinder');
    const steps = Number(args.steps ?? 2000);
    const grid = String(args.grid ?? 'fast') as 'fast' | 'standard' | 'fine';
    const client = new TaskApiClient(baseUrl);
    const spec = defaultJobSpec({
      name: String(args.name ?? `${preset}-batch`),
      model: { source: 'preset', presetId: preset },
      parameters: {
        inletVelocity: Number(args.velocity ?? 1),
        gridPreset: grid,
        modelResolution: 'standard',
        wallCondition: 'no-slip',
        turbulenceIntensity: 1,
        smagorinskyCs: 0.12,
        fluidDensity: 1.225,
      },
      run: { maxSteps: steps, forceSampleEvery: 20, warmupSteps: Math.min(200, Math.floor(steps / 4)) },
    });
    const { job } = await client.submitJob(spec);
    console.log('submitted', job.id, job.status, job.name);
    return;
  }

  if (cmd === 'run' || cmd === 'once') {
    const saved = loadSavedToken();
    const token = String(args.token ?? process.env.AGENT_TOKEN ?? saved?.token ?? '');
    if (!token) {
      console.error('No token. Run: tuanliu-agent register --name my-gpu');
      process.exit(1);
    }
    const url = String(args.url ?? saved?.baseUrl ?? baseUrl);
    const client = new TaskApiClient(url, token);
    const me = await client.me();
    const agentId = me.agent.id as string;
    console.log(`[agent] ${me.agent.name} (${agentId}) @ ${url}`);

    const probe = await probeDawn();
    if (probe.ok) {
      console.log('[probe] WebGPU ok', probe.deviceName);
    } else {
      console.warn('[probe] WebGPU unavailable:', probe.reason, '— CPU jobs use admitted numerical kernels');
    }
    // 启动期校验 W_SIM_BACKEND——非法值在 runner.run 内抛出会把每个认领的
    // job 毒化到 maxAttempts；配置错误应当启动即崩。
    resolveLbmBackendPreference();
    const cudaProbe = await probeNativeCuda();
    if (cudaProbe.ok) {
      console.log('[probe] native-cuda ok', cudaProbe.deviceName ?? cudaProbe.version ?? cudaProbe.binary);
    } else if (cudaProbe.binary) {
      console.warn('[probe] native-cuda present but probe failed:', cudaProbe.reason);
    } else if (process.env.W_SIM_CUDA_PATH) {
      console.warn('[probe] native-cuda binary unusable:', nativeCudaBinaryDiag());
    }

    const buildProvenance = resolveAgentBuildProvenance();
    const pathModelRegistry = await createAgentPathModelRegistry(buildProvenance);
    const pathModels = pathModelCapabilities(pathModelRegistry);
    await client.updateCapabilities({
      backends: [...(probe.ok ? (['webgpu-dawn'] as const) : []), ...((probe.ok || cudaProbe.ok) ? (['webgpu'] as const) : []), ...(cudaProbe.ok ? (['cuda'] as const) : []), 'cpu'],
      maxGrid: probe.ok || cudaProbe.ok ? 'fine' : 'fast',
      thermal: true,
      fan: true,
      features: [MAC_3D_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_FIELD_HISTORY_FEATURE, LBM_GROUND_FEATURE, ...LBM_THERMAL_FEATURES, ...(probe.ok ? ['webgpu', 'voxelization'] : ['voxelization'])],
      kinds: [...listAgentSolverKinds({ agentId, pathModelRegistry })],
      pathModels,
      agentBuildId: buildProvenance.agentBuildId,
      dependencyLockSha256: buildProvenance.dependencyLockSha256,
    });

    // Graceful shutdown: SIGTERM/SIGINT (systemd stop/restart, deploy) aborts
    // the in-flight job for a retryable settle — releases it for immediate
    // reclaim instead of stranding it leased until expiry.
    const shutdown = new AbortController();
    const onShutdownSignal = (sig: string) => {
      if (shutdown.signal.aborted) return;
      console.error(`[agent] ${sig} received — settling in-flight job then exiting`);
      shutdown.abort();
    };
    process.once('SIGTERM', () => onShutdownSignal('SIGTERM'));
    process.once('SIGINT', () => onShutdownSignal('SIGINT'));

    await runClaimLoop({
      client,
      agentId,
      once: cmd === 'once',
      pollMs: Number(args.poll ?? 2000),
      buildProvenance,
      pathModelRegistry,
      shutdownSignal: shutdown.signal,
    });
    return;
  }

  console.error('Unknown command:', cmd);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
