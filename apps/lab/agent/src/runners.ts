/**
 * JobRunner adapters for tuanliu agent backends.
 * Physics stays in backends / path-experiment-runner; this file only plugs
 * them into the @w-sim/runtime JobRunner + SolverRunnerRegistry seam.
 *
 * Path-experiment: dual-path adapter with @w-sim/solvers-path-experiment
 * preferred; product photosensitization models stay on the local runner.
 *
 * export-report is intentionally NOT registered here: Host admits the builtin
 * kind (validate-spec) but the runner lives in the W-Sim engine-plane package
 * @w-sim/solvers-export-report and is claimed by external executors — Host
 * settles. Guard: solver-registry-dispatch.test.ts "no runner" assertions.
 */

import type { JobRunner, SolverRunnerDescriptor, SolverRunnerRegistry } from '@w-sim/runtime';
import {
  createSolverRunnerRegistry,
  DEFAULT_SOLVER_CONTRACT_VERSIONS,
  JOB_SPEC_SCHEMA_VERSION,
} from '@w-sim/runtime';
import type { JobProgress, JobResultV1, JobResultArtifact, JobSpecV1, SolverBackendId } from '@w-sim/contracts';
import { MAC_3D_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_FIELD_HISTORY_FEATURE, LBM_GROUND_FEATURE, LBM_THERMAL_FEATURES } from '@w-sim/contracts';
import type { MacFieldSnapshot } from '@w-sim/solvers-lbm/mac3d';
import type { LbmDisplaySnapshot } from '@w-sim/solvers-lbm/d3q19';
import {
  createPathExperimentRunner as createPackagePathExperimentRunner,
  PATH_EXPERIMENT_KIND,
  SOLVER_PACKAGE_META,
} from '@w-sim/solvers-path-experiment';
import {
  createLbmJobRunner as createWsimLbmJobRunner,
  LBM_D3Q19_KIND,
  SOLVER_PACKAGE_META as LBM_SOLVER_PACKAGE_META,
} from '@w-sim/solvers-lbm';
import { assertCompleteResult } from './validate-result.ts';
import type { ThermalArtifactUploader } from './native-thermal-artifacts.ts';

/** deviceName 补充规则：仅当结果自报 CUDA 系 backend.id（或未自报 id）时
 * 才补探针 GPU 名——host 执行自报（w-sim-cuda-host/host-f64/cpu/webgpu-*）
 * 绝不贴 GPU 标签，否则 host 数学会被谎报为 GPU 执行。 */
function probedDeviceName(backend: { id?: string; deviceName?: string } | undefined, deviceName: string | undefined): { deviceName: string } | Record<string, never> {
  if (backend?.deviceName !== undefined || !deviceName) return {};
  const id = backend?.id;
  if (id !== undefined && !isCudaResultBackendId(id)) return {};
  return { deviceName };
}

import {
  createDefaultPathModelRegistry,
  runPathExperiment,
  type PathModelRegistry,
} from './path-experiment-runner.ts';
import type { AgentBuildProvenance } from './build-provenance.ts';
import { THERMAL_LAB_KIT, THERMAL_IGBT_SPATIAL_FEATURE, SOLVER_PACKAGE_META as THERMAL_META } from '@w-sim/solvers-thermal';
import { EM_FDTD_LAB_KIT, SOLVER_PACKAGE_META as EM_META } from '@w-sim/solvers-em-fdtd';
import { ACOUSTICS_LAB_KIT, SOLVER_PACKAGE_META as ACOUSTICS_META } from '@w-sim/solvers-acoustics';
import { MD_LAB_KIT, SOLVER_PACKAGE_META as MD_META } from '@w-sim/solvers-md';
import { STRUCTURAL_LAB_KIT, SOLVER_PACKAGE_META as STRUCTURAL_META } from '@w-sim/solvers-structural';
import { MODULE_JOB_KIND, computeModule, moduleComputeSteps, moduleComputePrecision, isNativeModule, readModuleResult, readModuleJobInput, validateModuleJobParameters, type ModuleJobResult } from '../../../../src/lib/sim/module-compute.ts';
import { isNativeLbmJob, isGpuLbmJob, prepareLbmInput, runLbmWasm } from '../../../../src/lib/sim/lbm-compute.ts';
import {
  CUDA_KIND_ROUTES,
  NATIVE_CUDA_BACKEND_ID,
  NATIVE_CUDA_SPEC_BACKENDS,
  isCudaResultBackendId,
  cudaRouteForKind,
  probeNativeCuda,
  probeNativeCudaSync,
  nativeCudaEligible,
  resolveLbmBackendPreference,
  runNativeCudaLbm,
  runNativeCudaSubcommand,
  resultBackendAllowed,
  type NativeCudaProbe,
} from './backends/native-cuda.ts';
import { recordFallback } from './run-telemetry.ts';

/** Existing CPU implementations; each mode keeps its own parameters and outputs. */
const CPU_FAMILIES = [
  [THERMAL_LAB_KIT, THERMAL_META],
  [EM_FDTD_LAB_KIT, EM_META],
  [ACOUSTICS_LAB_KIT, ACOUSTICS_META],
  [MD_LAB_KIT, MD_META],
  [STRUCTURAL_LAB_KIT, STRUCTURAL_META],
] as const;

// LBM backends pull tuanliu CFD (`@/` path aliases). Load them lazily so
// path-experiment registry/tests do not require the full CFD module graph.

export type AgentRunnerOptions = {
  agentId: string;
  saveArtifact?: ThermalArtifactUploader;
  buildProvenance?: AgentBuildProvenance;
  pathModelRegistry?: PathModelRegistry;
  loadArtifact?: (id: string, signal?: AbortSignal) => Promise<ArrayBuffer>;
  /** Buffers/uploads a frame; returns an artifact only when a batch flushed. */
  saveFlowSnapshot?: (snapshot: LbmDisplaySnapshot | MacFieldSnapshot, signal?: AbortSignal) => Promise<JobResultArtifact | null>;
  /** Uploads remaining buffered frames once the run ends. */
  flushFlowSnapshots?: (signal?: AbortSignal) => Promise<JobResultArtifact[]>;
};

/** Built-in product path models that must stay on the local RK4/steady runner. */
const PRODUCT_PATH_MODEL_IDS = new Set([
  'photosensitization-rk4',
  'photosensitization-steady-state',
]);

/**
 * True when the job should use the product (local) path runner rather than
 * the preferred @w-sim/solvers-path-experiment package runner.
 */
export function prefersProductPathRunner(
  spec: JobSpecV1,
  pathModelRegistry?: PathModelRegistry,
): boolean {
  if (spec.kind !== PATH_EXPERIMENT_KIND && spec.kind !== 'path-experiment') {
    return false;
  }
  const model = spec.experiment?.model;
  if (!model?.id || !model?.version) return false;
  if (PRODUCT_PATH_MODEL_IDS.has(model.id)) return true;
  const registry = pathModelRegistry ?? createDefaultPathModelRegistry();
  try {
    registry.resolve(model.id, model.version);
    return true;
  } catch {
    return false;
  }
}

function canRegisterModeForSpec(
  spec: JobSpecV1,
  capabilityFeatures: readonly string[] | undefined,
  nativeFeatures: ReadonlySet<string>,
): boolean {
  if (spec.kind !== 'electro-thermal-igbt' || (spec.parameters as Record<string, unknown>).mode !== 'spatial-chip') return true
  return capabilityFeatures?.includes(THERMAL_IGBT_SPATIAL_FEATURE) === true && nativeFeatures.has(THERMAL_IGBT_SPATIAL_FEATURE)
}

/**
 * Dual-path path-experiment JobRunner: package preferred, product fallback.
 * Registered under the solvers-path-experiment id for multi-kind dispatch.
 */
export function createDualPathPathExperimentRunner(opts: AgentRunnerOptions): JobRunner {
  const packageRunner = createPackagePathExperimentRunner();
  const productCanRun = (spec: JobSpecV1) => prefersProductPathRunner(spec, opts.pathModelRegistry);

  return {
    canRun(spec: JobSpecV1): boolean {
      return spec.kind === PATH_EXPERIMENT_KIND || spec.kind === 'path-experiment';
    },
    async run(
      spec: JobSpecV1,
      onProgress?: (p: JobProgress) => void | Promise<void>,
      /** Optional product cancel signal (guarded claim loop / JobRunner extension). */
      signal?: AbortSignal,
    ): Promise<JobResultV1> {
      if (productCanRun(spec)) {
        const result = await runPathExperiment({
          spec,
          agentId: opts.agentId,
          buildProvenance: opts.buildProvenance,
          registry: opts.pathModelRegistry,
          signal,
          onProgress,
        });
        assertCompleteResult(result, spec.requirements?.backends);
        return result as JobResultV1;
      }

      // Package preferred for smoke / fixture / non-product path graphs.
      // Package runner has no signal; guarded claim still enforces cancel diagnostic.
      if (signal?.aborted) {
        throw new DOMException('path experiment aborted', 'AbortError');
      }
      const result = await packageRunner.run(spec, onProgress);
      if (signal?.aborted) {
        throw new DOMException('path experiment aborted', 'AbortError');
      }
      const withAgent: JobResultV1 = {
        ...result,
        backend: {
          ...result.backend,
          id: result.backend?.id ?? 'cpu',
          agentId: opts.agentId,
        },
      };
      assertCompleteResult(withAgent, spec.requirements?.backends);
      return withAgent;
    },
  };
}

/** path-experiment → dual-path (package preferred, product models local). */
export function createPathExperimentRunner(opts: AgentRunnerOptions): JobRunner {
  return createDualPathPathExperimentRunner(opts);
}

const LBM_CPU_SMOKE_MODES = new Set([
  'd3q19-periodic',
  'periodic',
  'd3q19-bgk-periodic',
  'd3q19-bounceback',
  'd3q19-bb',
  'bounceback',
  'd3q19-bgk-bounceback',
  'd3q19-lid-cavity',
  'd3q19-lid',
  'lid-cavity-d3q19',
  'd3q19-bgk-lid-cavity',
  'd3q19-force-channel',
  'd3q19-force-poiseuille',
  'd3q19-channel',
  'd3q19-bgk-force-channel',
  'd2q9-lid-cavity',
  'lid-cavity',
  'd2q9-cavity',
  'd2q9-force-poiseuille',
  'force-poiseuille',
  'd2q9-poiseuille',
  'd2q9-mrt-lid-cavity',
  'mrt-lid-cavity',
  'd2q9-mrt-lid',
  'd2q9-mrt-periodic',
  'mrt-periodic',
  'd2q9-mrt',
]);

function lbmModeOf(spec: JobSpecV1): string {
  const p = (spec.parameters ?? {}) as { mode?: unknown; solverMode?: unknown };
  return String(p.mode ?? p.solverMode ?? '').toLowerCase();
}

/**
 * lbm-d3q19 → shared Rust/WASM CPU product path, explicit W-Sim CPU modes,
 * or the requested Dawn WebGPU solver.
 */
export function createLbmJobRunner(opts: AgentRunnerOptions): JobRunner {
  return {
    canRun(spec: JobSpecV1): boolean {
      return spec.kind === LBM_D3Q19_KIND || spec.kind === 'lbm-d3q19';
    },
    async run(
      spec: JobSpecV1,
      onProgress?: (p: JobProgress) => void | Promise<void>,
      /** Optional product cancel signal (guarded claim loop / JobRunner extension). */
      signal?: AbortSignal,
    ): Promise<JobResultV1> {
      // Pre-flight cancel: refuse to start expensive model load / GPU probe.
      if (signal?.aborted) {
        throw new DOMException('lbm job aborted', 'AbortError');
      }

      const mode = lbmModeOf(spec);
      if (LBM_CPU_SMOKE_MODES.has(mode)) {
        // 早拒：smoke 模式只产 cpu 结果——需求排除 cpu 的 spec 不应先算再拒。
        const required = spec.requirements?.backends ?? [];
        if (!resultBackendAllowed('cpu', required)) {
          throw new Error(`lbm smoke mode '${mode}' produces cpu results but spec requires [${required.join(',')}]`);
        }
        const result = await createWsimLbmJobRunner({ agentId: opts.agentId }).run(
          spec,
          onProgress,
          signal,
        );
        const withAgent: JobResultV1 = {
          ...result,
          backend: {
            ...result.backend,
            id: result.backend?.id ?? 'cpu',
            agentId: opts.agentId,
          },
        };
        assertCompleteResult(withAgent, spec.requirements?.backends);
        return withAgent;
      }

      const { loadModelGeometry } = await import('./load-model.ts');

      await onProgress?.({
        step: 0,
        total: spec.run.maxSteps,
        message: 'loading model',
      });

      if (signal?.aborted) {
        throw new DOMException('lbm job aborted', 'AbortError');
      }

      let geometry;
      try {
        if (!spec.model) throw new Error(`model is required for ${spec.kind}`);
        geometry = await loadModelGeometry(spec.model, { loadArtifact: opts.loadArtifact, signal });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`model load failed: ${detail}`);
      }

      let lastHb = Date.now();
      const progressBridge = async (p: {
        step: number;
        total: number;
        message?: string;
        cd?: number;
        cl?: number;
      }) => {
        signal?.throwIfAborted();
        const now = Date.now();
        if (now - lastHb > 5000 || p.step === p.total) {
          lastHb = now;
          const cd = p.cd != null && Number.isFinite(p.cd) ? p.cd : undefined;
          const cl = p.cl != null && Number.isFinite(p.cl) ? p.cl : undefined;
          await onProgress?.({
            step: p.step,
            total: p.total,
            message: p.message,
            cd,
            cl,
          });
          signal?.throwIfAborted();
        }
      };

      if (isNativeLbmJob(spec)) {
        if (!geometry) throw new Error('Rust LBM requires the uploaded model geometry');
        // 早拒：wasm 路径只产 cpu 结果——需求排除 cpu 的 spec 不应先算再拒。
        const required = spec.requirements?.backends ?? [];
        if (!resultBackendAllowed('cpu', required)) {
          throw new Error(`native wasm lbm produces cpu results but spec requires [${required.join(',')}]`);
        }
        if (spec.outputs.fields?.length && !opts.saveFlowSnapshot) throw new Error('流场输出需要任务文件存储');
        const flowArtifacts: JobResultArtifact[] = [];
        const { result } = await runLbmWasm(spec, prepareLbmInput(spec, geometry), signal, progressBridge,
          opts.saveFlowSnapshot ? async snapshot => {
            const saved = await opts.saveFlowSnapshot!(snapshot, signal);
            if (saved) flowArtifacts.push({ ...saved, step: saved.step ?? snapshot.step });
          } : undefined);
        if (opts.flushFlowSnapshots) flowArtifacts.push(...await opts.flushFlowSnapshots(signal));
        if (flowArtifacts.length) result.artifacts = flowArtifacts;
        signal?.throwIfAborted();
        result.backend = { ...result.backend, id: 'cpu', agentId: opts.agentId };
        assertCompleteResult(result, spec.requirements?.backends);
        return result;
      }

      const thermalRequested =
        (spec.parameters as Record<string, unknown>).thermalEnabled === true || spec.requirements?.thermal === true;
      if (thermalRequested && !isGpuLbmJob(spec)) {
        throw new Error('Thermal LBM requires explicit CPU/mixed or WebGPU/float32 execution');
      }
      const requiredBackends = spec.requirements?.backends ?? [];
      if (requiredBackends.length > 0 &&
        !requiredBackends.some(backend => ['webgpu', 'webgpu-dawn', ...NATIVE_CUDA_SPEC_BACKENDS].includes(backend))) {
        throw new Error('Unsupported CPU LBM input; use an uploaded stationary model with mixed precision');
      }
      const precision = spec.requirements?.precision;
      if (precision && !(Array.isArray(precision) ? precision : [precision]).includes('float32')) {
        throw new Error('GPU LBM requires float32 precision');
      }

      // 后端选择：W_SIM_BACKEND=auto 时 GPU 任务优先 w-sim-cuda 原生二进制，
      // 缺失/探测失败自动退回 Dawn；cuda/dawn/wasm 为显式强制。
      // auto 升级仅面向无约束或统称 'webgpu' 的任务；点名 webgpu-dawn/browser
      // 的任务按显式要求执行，不静默替换为 cuda。
      const backendPreference = resolveLbmBackendPreference();
      const cudaOnly = requiredBackends.length > 0 &&
        requiredBackends.every(backend => NATIVE_CUDA_SPEC_BACKENDS.includes(backend));
      const cudaEligible = nativeCudaEligible(requiredBackends);
      // 显式 cuda 偏好同样不得覆盖排除 cuda 的 requirements（ANY-OF 成员性）。
      const cudaAcceptable = requiredBackends.length === 0 ||
        requiredBackends.some(backend => backend === 'webgpu' || NATIVE_CUDA_SPEC_BACKENDS.includes(backend));
      if (cudaOnly && (backendPreference === 'dawn' || backendPreference === 'wasm')) {
        throw new Error(`job requires native-cuda but W_SIM_BACKEND=${backendPreference}`);
      }
      if (backendPreference === 'wasm') {
        throw new Error('W_SIM_BACKEND=wasm cannot execute a GPU lbm-d3q19 job; submit a CPU/mixed spec');
      }
      let cuda: NativeCudaProbe | null = null;
      if ((backendPreference === 'cuda' && cudaAcceptable) || cudaOnly || (backendPreference === 'auto' && cudaEligible)) {
        cuda = await probeNativeCuda();
        if (!cuda.ok) {
          // 门禁语义：spec 显式点名 cuda 才 fail-closed；W_SIM_BACKEND=cuda
          // 是环境偏好——失败自动降级并记录 fallback_reason，绝不静默挂起。
          if (cudaOnly) {
            throw new Error(`required native-cuda backend unavailable: ${cuda.reason ?? 'probe failed'}`);
          }
          recordFallback(`native-cuda probe failed: ${cuda.reason ?? 'probe failed'}`);
          cuda = null;
        } else if (thermalRequested && !cuda.features?.includes('lbm-thermal')) {
          // 旧版 native-cuda 无热通道；auto 让位 Dawn，显式 cuda 则明确拒绝。
          if (cudaOnly) {
            throw new Error('native-cuda binary lacks lbm-thermal support; rebuild w-sim-cuda or use W_SIM_BACKEND=dawn');
          }
          recordFallback('native-cuda binary lacks lbm-thermal feature');
          cuda = null;
        }
      }

      if (cuda?.ok) {
        if (spec.outputs.fields?.length && !opts.saveFlowSnapshot) throw new Error('流场输出需要任务文件存储');
        const { prepareProductLbmLattice } = await import('@w-sim/solvers-lbm/d3q19');
        const prepared = prepareProductLbmLattice(spec, geometry);
        try {
          const flowArtifacts: JobResultArtifact[] = [];
          const result = await runNativeCudaLbm(spec, { flags: prepared.flags, binary: cuda.binary }, signal, progressBridge,
            opts.saveFlowSnapshot ? async snapshot => {
              signal?.throwIfAborted();
              const saved = await opts.saveFlowSnapshot!(snapshot, signal);
              if (saved) flowArtifacts.push({ ...saved, step: saved.step ?? snapshot.step });
              signal?.throwIfAborted();
            } : undefined);
          if (opts.flushFlowSnapshots) flowArtifacts.push(...await opts.flushFlowSnapshots(signal));
          if (flowArtifacts.length) result.artifacts = [...(result.artifacts ?? []), ...flowArtifacts];
          result.backend = {
            ...result.backend,
            id: result.backend?.id ?? NATIVE_CUDA_BACKEND_ID,
            agentId: opts.agentId,
            ...probedDeviceName(result.backend, cuda.deviceName),
          };
          assertCompleteResult(result, spec.requirements?.backends);
          return result;
        } catch (err) {
          // cudaOnly spec 不许降级；偏好/auto 的失败落到 Dawn 并留痕。
          if (cudaOnly) throw err;
          recordFallback(`native-cuda exec failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const { runWithDawn, probeDawn } = await import('./backends/webgpu-dawn.ts');
      const dawn = await probeDawn();
      if (!dawn.ok) throw new Error(`required GPU backend unavailable: ${dawn.reason ?? 'no physical adapter'}`);

      if (signal?.aborted) {
        throw new DOMException('lbm job aborted', 'AbortError');
      }

      if (spec.outputs.fields?.length && !opts.saveFlowSnapshot) throw new Error('流场输出需要任务文件存储');
      const flowArtifacts: JobResultArtifact[] = [];
      const result = await runWithDawn({
        spec,
        geometry,
        agentId: opts.agentId,
        onProgress: progressBridge,
        signal,
        onDisplaySnapshot: opts.saveFlowSnapshot ? async (snapshot) => {
          signal?.throwIfAborted();
          const saved = await opts.saveFlowSnapshot!(snapshot, signal);
          if (saved) flowArtifacts.push({ ...saved, step: saved.step ?? snapshot.step });
          signal?.throwIfAborted();
        } : undefined,
      });

      if (signal?.aborted) {
        throw new DOMException('lbm job aborted', 'AbortError');
      }

      if (opts.flushFlowSnapshots) flowArtifacts.push(...await opts.flushFlowSnapshots(signal));
      if (flowArtifacts.length) result.artifacts = [...(result.artifacts ?? []), ...flowArtifacts];
      try {
        assertCompleteResult(result, spec.requirements?.backends);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`invalid complete payload (Cd/Cl must be finite): ${msg}`);
      }
      return result;
    },
  };
}

/** Descriptor for @w-sim/solvers-path-experiment (dual-path createRunner). */
export function pathExperimentSolverDescriptor(
  opts: AgentRunnerOptions,
): SolverRunnerDescriptor {
  return {
    id: SOLVER_PACKAGE_META.id,
    kinds: [PATH_EXPERIMENT_KIND],
    contractVersions: [...DEFAULT_SOLVER_CONTRACT_VERSIONS],
    packageName: SOLVER_PACKAGE_META.packageName,
    packageVersion: SOLVER_PACKAGE_META.version,
    runtimes: ['node'],
    backends: ['cpu'],
    precision: [SOLVER_PACKAGE_META.precision],
    dimensionality: [...SOLVER_PACKAGE_META.dimensionality],
    hostClass: 'backend',
    scaleLimits: {
      maxSteps: 256,
    },
    createRunner: () => createDualPathPathExperimentRunner(opts),
  };
}

/** @w-sim/solvers-lbm is the LBM compute owner; this descriptor is the host adapter. */
export function lbmSolverDescriptor(opts: AgentRunnerOptions): SolverRunnerDescriptor {
  return {
    id: LBM_SOLVER_PACKAGE_META.id,
    kinds: [LBM_D3Q19_KIND],
    contractVersions: [JOB_SPEC_SCHEMA_VERSION],
    packageName: LBM_SOLVER_PACKAGE_META.packageName,
    packageVersion: LBM_SOLVER_PACKAGE_META.version,
    runtimes: ['node'],
    // 'cuda' 仅在 sync probe 成功时声明：二进制存在但 --version 失败时，
    // 运行时 cuda 路径同样不可用——按 probe 声明让 resolve 阶段就失败
    // （incompatible_capability），而不是认领后 throw 的有界 churn。
    // 'webgpu' 统称（任意 GPU）：dawn 或 cuda 均可服务，故始终声明——
    // capabilities 侧仅在探测成功时才上报该令牌（cli.ts）。
    backends: probeNativeCudaSync().ok ? ['cpu', 'webgpu', 'webgpu-dawn', 'cuda', 'native-cuda'] : ['cpu', 'webgpu', 'webgpu-dawn'],
    precision: ['float32', 'mixed'],
    dimensionality: [...LBM_SOLVER_PACKAGE_META.dimensionality],
    features: ['webgpu', 'voxelization', LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_FIELD_HISTORY_FEATURE, LBM_GROUND_FEATURE, ...LBM_THERMAL_FEATURES],
    accelerators: [...LBM_SOLVER_PACKAGE_META.accelerators],
    hostClass: 'backend',
    thermal: true,
    createRunner: () => createLbmJobRunner(opts),
  };
}

/**
 * Preferred multi-kind registry: registers @w-sim/solvers-path-experiment
 * (and local LBM) for runClaimLoopOnce(host, id, registry) dispatch.
 */
export function createAgentSolverRegistry(opts: AgentRunnerOptions): SolverRunnerRegistry {
  const registry = createSolverRunnerRegistry();
  const pathReg = registry.register(pathExperimentSolverDescriptor(opts));
  if (!pathReg.ok) {
    throw new Error(`path-experiment solver register failed: ${pathReg.code} ${pathReg.message}`);
  }
  const lbmReg = registry.register(lbmSolverDescriptor(opts));
  if (!lbmReg.ok) {
    throw new Error(`lbm solver register failed: ${lbmReg.code} ${lbmReg.message}`);
  }
  // 注册时同步探测一次 w-sim-cuda：有路由且 feature 已嵌入的 kind 才声明
  // 'cuda' backend（认领即承诺可执行；缺失能力绝不上报）。
  const cudaProbe = probeNativeCudaSync();
  const cudaFeatures = new Set(cudaProbe.ok ? (cudaProbe.features ?? []) : []);
  const cudaKinds = new Set(
    Object.entries(CUDA_KIND_ROUTES)
      .filter(([, route]) => cudaFeatures.has(route.feature))
      .map(([kind]) => kind),
  );
  if (cudaFeatures.has(THERMAL_IGBT_SPATIAL_FEATURE)) cudaKinds.add('electro-thermal-igbt');
  const macReg = registry.register({
    id: 'mac-3d', kinds: ['mac-3d'], contractVersions: [JOB_SPEC_SCHEMA_VERSION],
    runtimes: ['node'],
    backends: cudaKinds.has('mac-3d') ? ['cpu', 'webgpu', 'cuda', 'native-cuda'] : ['cpu'],
    precision: ['float64'], dimensionality: ['3d'],
    features: [MAC_3D_FEATURE], hostClass: 'backend', thermal: true,
    createRunner: () => ({
      canRun: spec => spec.kind === 'mac-3d',
      async run(spec, onProgress, signal?: AbortSignal) {
        signal?.throwIfAborted();
        if (spec.model?.source !== 'artifact') throw new Error('MAC Agent requires an owned geometry artifact');
        if (spec.outputs.fields?.length && !opts.saveFlowSnapshot) throw new Error('MAC field storage is unavailable');
        const { loadModelGeometry } = await import('./load-model.ts');
        const { prepareMacInput, runMacWasm } = await import('@w-sim/solvers-lbm/mac3d');
        await onProgress?.({ step: 0, total: spec.run.maxSteps, message: 'loading MAC model' });
        const geometry = await loadModelGeometry(spec.model, { loadArtifact: opts.loadArtifact, signal });
        signal?.throwIfAborted();
        if (!geometry) throw new Error('MAC Agent model artifact did not contain usable geometry');
        const { mac, flags } = prepareMacInput(spec, geometry), artifacts: JobResultArtifact[] = [];
        // native-cuda：点名 cuda/native-cuda 强制，auto 且 feature 已嵌入时升级。
        const requiredBackends = spec.requirements?.backends ?? [];
        const cudaOnly = requiredBackends.length > 0 &&
          requiredBackends.every((b) => NATIVE_CUDA_SPEC_BACKENDS.includes(b));
        const preference = resolveLbmBackendPreference();
        // W_SIM_BACKEND=cuda 是能力偏好而非 spec 覆盖：显式排除 cuda 的
        // requirements 仍按其要求执行（否则产出的 backend.id 不满足 ANY-OF）。
        const cudaAcceptable = requiredBackends.length === 0 ||
          requiredBackends.some((b) => b === 'webgpu' || NATIVE_CUDA_SPEC_BACKENDS.includes(b));
        if (cudaOnly || (preference === 'cuda' && cudaAcceptable) ||
          (preference === 'auto' && cudaFeatures.has('mac-3d') && nativeCudaEligible(requiredBackends))) {
          const probe = await probeNativeCuda();
          if (probe.ok && probe.features?.includes('mac-3d')) {
            try {
              // 局部 artifacts：exec 半途失败降级时，脏帧不得混进 wasm 结果。
              const cudaArtifacts: JobResultArtifact[] = [];
              const { decodeMacFlowSnapshot } = await import('../../src/lib/cfd/mac-flow-snapshot.ts');
              const result = await runNativeCudaSubcommand('mac', spec, { flags, binary: probe.binary }, signal,
                onProgress ? (p) => onProgress({ step: p.step, total: p.total, message: p.message }) : undefined,
                opts.saveFlowSnapshot ? async (frame) => {
                  signal?.throwIfAborted();
                  const saved = await opts.saveFlowSnapshot!(decodeMacFlowSnapshot(frame.buffer), signal);
                  if (saved) cudaArtifacts.push({ ...saved, step: saved.step ?? frame.step });
                  signal?.throwIfAborted();
                } : undefined);
              if (opts.flushFlowSnapshots) cudaArtifacts.push(...await opts.flushFlowSnapshots(signal));
              signal?.throwIfAborted();
              result.backend = {
                ...result.backend,
                id: result.backend?.id ?? NATIVE_CUDA_BACKEND_ID,
                agentId: opts.agentId,
                ...probedDeviceName(result.backend, probe.deviceName),
              };
              if (cudaArtifacts.length) result.artifacts = [...(result.artifacts ?? []), ...cudaArtifacts];
              assertCompleteResult(result, spec.requirements?.backends);
              return result;
            } catch (err) {
              if (cudaOnly) throw err;
              recordFallback(`native-cuda mac exec failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else if (cudaOnly) {
            throw new Error(`native-cuda backend lacks mac-3d support (probe: ${probe.reason ?? 'feature not embedded'})`);
          } else {
            recordFallback(`native-cuda mac-3d unavailable: ${probe.ok ? 'feature not embedded' : (probe.reason ?? 'probe failed')}`);
          }
        }
        const { result } = await runMacWasm({ spec, input: mac, flags, signal, onProgress,
          onFieldSnapshot: opts.saveFlowSnapshot ? async snapshot => {
            signal?.throwIfAborted();
            const saved = await opts.saveFlowSnapshot!(snapshot, signal);
            if (saved) artifacts.push({ ...saved, step: saved.step ?? snapshot.step });
            signal?.throwIfAborted();
          } : undefined });
        if (opts.flushFlowSnapshots) artifacts.push(...await opts.flushFlowSnapshots(signal));
        signal?.throwIfAborted();
        if (typeof result.backend?.id !== 'string' || result.backend.id.length === 0) {
          throw new Error('MAC runner returned a result without a backend id');
        }
        result.backend = { ...result.backend, agentId: opts.agentId };
        if (artifacts.length) result.artifacts = artifacts;
        assertCompleteResult(result, spec.requirements?.backends);
        return result;
      },
    }),
  });
  if (!macReg.ok) throw new Error(`MAC solver register failed: ${macReg.code} ${macReg.message}`);
  const moduleReg = registry.register({
    id: MODULE_JOB_KIND, kinds: [MODULE_JOB_KIND],
    kindValidators: { [MODULE_JOB_KIND]: validateModuleJobParameters },
    contractVersions: DEFAULT_SOLVER_CONTRACT_VERSIONS,
    runtimes: ['node'],
    backends: cudaKinds.has(MODULE_JOB_KIND) ? ['cpu', 'cuda', 'native-cuda'] : ['cpu'],
    precision: ['float64', 'mixed'],
    dimensionality: ['1d', '2d'], hostClass: 'backend', teachingOnly: true,
    scaleLimits: { maxSteps: 2000 },
    createRunner: () => ({
      canRun: (spec) => spec.kind === MODULE_JOB_KIND,
      async run(spec, onProgress, signal?: AbortSignal) {
        signal?.throwIfAborted();
        // native-cuda 分流：spec 点名 cuda 时由 w-sim-cuda module 子命令执行
        // （宿主路径；results 与 computeModule 逐字段同构）。
        const route = cudaRouteForKind(spec.kind);
        const requiredBackends = spec.requirements?.backends ?? [];
        const cudaOnly = requiredBackends.length > 0 &&
          requiredBackends.every((b) => NATIVE_CUDA_SPEC_BACKENDS.includes(b));
        if (route && cudaOnly) {
          const probe = await probeNativeCuda();
          if (probe.ok && probe.features?.includes(route.feature)) {
            const result = await runNativeCudaSubcommand(route.subcommand, spec, { binary: probe.binary }, signal,
              onProgress ? (p) => onProgress({ step: p.step, total: p.total, message: p.message }) : undefined);
            signal?.throwIfAborted();
            const withAgent = {
              ...result,
              backend: {
                ...result.backend,
                id: result.backend?.id ?? NATIVE_CUDA_BACKEND_ID,
                agentId: opts.agentId,
                ...probedDeviceName(result.backend, probe.deviceName),
              },
            };
            assertCompleteResult(withAgent, spec.requirements?.backends);
            return withAgent;
          }
          throw new Error(
            `native-cuda backend lacks ${route.feature} support (probe: ${probe.reason ?? 'feature not embedded'})`,
          );
        }
        const input = readModuleJobInput(spec);
        const started = performance.now();
        let lastProgress: number | undefined;
        const progress = onProgress ? async (p: JobProgress) => {
          const now = performance.now();
          if (lastProgress === undefined || now - lastProgress >= 1000) {
            await onProgress(p);
            lastProgress = performance.now();
          }
        } : undefined;
        const result: ModuleJobResult = {
          schemaVersion: 1,
          moduleResult: await computeModule(input, signal, progress),
          summary: { steps: moduleComputeSteps(input), wallTimeMs: performance.now() - started },
          backend: { id: 'cpu', agentId: opts.agentId },
          derived: { precision: moduleComputePrecision(input), engine: isNativeModule(input.module) ? 'rust-wasm' : 'javascript' },
        };
        signal?.throwIfAborted();
        readModuleResult(result, input);
        assertCompleteResult(result, spec.requirements?.backends);
        await onProgress?.({ step: moduleComputeSteps(input), total: moduleComputeSteps(input) });
        signal?.throwIfAborted();
        return result;
      },
    }),
  });
  if (!moduleReg.ok) throw new Error(`module solver register failed: ${moduleReg.message}`);
  // native-cuda-only kinds：无 TS 宿主实现，仅在 w-sim-cuda 探测到对应
  // feature 时声明（backend 仅 'cuda'），run 固定走子命令分发——缺失即
  // 不声明、运行时 fail-closed，绝不静默落回。
  const NATIVE_CUDA_ONLY: ReadonlyArray<{ kind: string; dims: readonly string[] }> = [
    { kind: 'thermal-3d-transient', dims: ['1d', '2d', '3d'] },
    { kind: 'structural-modal', dims: ['1d', '2d', '3d'] },
    { kind: 'em-fdtd-sparams', dims: ['1d'] },
    { kind: 'nbody-gravity', dims: ['3d'] },
  ]
  const nativeOnlyKinds = new Set<string>()
  for (const { kind, dims } of NATIVE_CUDA_ONLY) {
    const route = CUDA_KIND_ROUTES[kind]
    if (!route || !cudaFeatures.has(route.feature)) continue
    const reg = registry.register({
      id: `native-cuda-${kind}`, kinds: [kind],
      contractVersions: DEFAULT_SOLVER_CONTRACT_VERSIONS,
      runtimes: ['node'],
      backends: ['cuda', 'native-cuda'],
      precision: ['float64'], dimensionality: [...dims],
      hostClass: 'backend', teachingOnly: false,
      createRunner: () => ({
        canRun: (spec: JobSpecV1) => spec.kind === kind,
        async run(spec: JobSpecV1, onProgress: ((p: JobProgress) => void) | undefined, signal: AbortSignal | undefined) {
          signal?.throwIfAborted()
          const probe = await probeNativeCuda()
          if (!(probe.ok && probe.features?.includes(route.feature))) {
            throw new Error(`native-cuda backend lacks ${route.feature} support (probe: ${probe.reason ?? 'feature not embedded'})`)
          }
          const result = await runNativeCudaSubcommand(route.subcommand, spec, { binary: probe.binary, saveArtifact: opts.saveArtifact }, signal,
            onProgress ? (p) => onProgress({ step: p.step, total: p.total, message: p.message }) : undefined)
          signal?.throwIfAborted()
          result.backend = { ...result.backend, id: result.backend?.id ?? NATIVE_CUDA_BACKEND_ID, agentId: opts.agentId,
            ...probedDeviceName(result.backend, probe.deviceName) }
          assertCompleteResult(result, spec.requirements?.backends)
          return result
        },
      }),
    })
    if (!reg.ok) throw new Error(`${kind} native-cuda register failed: ${reg.message}`)
    nativeOnlyKinds.add(kind)
  }
  for (const [family, meta] of CPU_FAMILIES) {
    for (const mode of family.modes) {
      const cap = mode.hostCapability;
      const spatialIgbtMode = cap.kinds.includes('electro-thermal-igbt') && cap.features?.includes(THERMAL_IGBT_SPATIAL_FEATURE) === true;
      // The kit publishes the spatial mode as a second capability for the
      // same kind/version. Merge its feature into the existing kind descriptor
      // only when the native binary actually has it; otherwise that descriptor
      // must not match spatial-chip specs.
      if (spatialIgbtMode) continue;
      const spatialIgbtAvailable = cap.kinds.includes('electro-thermal-igbt') && cudaFeatures.has(THERMAL_IGBT_SPATIAL_FEATURE);
      const capabilityFeatures = spatialIgbtAvailable
        ? [...new Set([...(cap.features ?? []), THERMAL_IGBT_SPATIAL_FEATURE])]
        : cap.features;
      const spatialIgbtModeCapability = spatialIgbtAvailable
        ? family.modes.find(candidate => candidate.hostCapability.features?.includes(THERMAL_IGBT_SPATIAL_FEATURE))?.hostCapability
        : undefined;
      const capabilityOutputs = spatialIgbtModeCapability
        ? [...new Set([...(cap.outputs ?? []), ...(spatialIgbtModeCapability.outputs ?? [])])]
        : cap.outputs;
      // kind@version 已由上面的 native-cuda 描述符注册；kit 中的同名 stub
      // 模式若再注册会触发 duplicate_kind_version 让 agent 启动即崩。
      if (cap.kinds.every(kind => nativeOnlyKinds.has(kind))) continue
      const registered = registry.register({
        id: cap.id,
        kinds: cap.kinds,
        contractVersions: DEFAULT_SOLVER_CONTRACT_VERSIONS,
        packageName: meta.packageName,
        packageVersion: meta.version,
        runtimes: ['node'],
        backends: cap.kinds.some((kind) => cudaKinds.has(kind))
          ? [...new Set<SolverBackendId>([...cap.backends, 'cuda', 'native-cuda'])]
          : cap.backends,
        precision: cap.precision ?? [meta.precision],
        dimensionality: meta.dimensionality,
        features: capabilityFeatures,
        outputs: capabilityOutputs,
        hostClass: cap.hostClass,
        thermal: cap.thermal ?? spatialIgbtModeCapability?.thermal,
        available: cap.available,
        stub: cap.stub,
        teachingOnly: cap.teachingOnly,
        scaleLimits: { maxVramMb: cap.maxVramMb },
        createRunner: () => {
          const runner = family.createRunner();
          return {
            canRun: (spec) => runner.canRun(spec) && canRegisterModeForSpec(spec, capabilityFeatures, cudaFeatures),
            async run(spec, onProgress, signal?: AbortSignal) {
              signal?.throwIfAborted();
              if (spec.kind === 'electro-thermal-igbt' && (spec.parameters as Record<string, unknown>).mode === 'spatial-chip') {
                if (!spatialIgbtAvailable) throw new Error(`native-cuda backend lacks ${THERMAL_IGBT_SPATIAL_FEATURE} support`)
                const probe = await probeNativeCuda()
                if (!probe.ok || !probe.features?.includes(THERMAL_IGBT_SPATIAL_FEATURE)) {
                  throw new Error(`native-cuda backend lacks ${THERMAL_IGBT_SPATIAL_FEATURE} support (probe: ${probe.reason ?? 'feature not embedded'})`)
                }
                const result = await runNativeCudaSubcommand('thermal-ss', spec, { binary: probe.binary, saveArtifact: opts.saveArtifact }, signal,
                  onProgress ? (p) => onProgress({ step: p.step, total: p.total, message: p.message }) : undefined)
                signal?.throwIfAborted()
                const withAgent = { ...result, backend: { ...result.backend, id: result.backend?.id ?? NATIVE_CUDA_BACKEND_ID,
                  agentId: opts.agentId, ...probedDeviceName(result.backend, probe.deviceName) } }
                assertCompleteResult(withAgent, spec.requirements?.backends)
                return withAgent
              }
              // native-cuda 分流：spec 点名 cuda/native-cuda 时强制；无约束
              // 任务（或统称 webgpu）在二进制声明对应 feature 时升级。
              const route = cudaRouteForKind(spec.kind);
              const requiredBackends = spec.requirements?.backends ?? [];
              const cudaOnly = requiredBackends.length > 0 &&
                requiredBackends.every((b) => NATIVE_CUDA_SPEC_BACKENDS.includes(b));
              const preference = resolveLbmBackendPreference();
              const cudaAcceptable = requiredBackends.length === 0 ||
                requiredBackends.some((b) => b === 'webgpu' || NATIVE_CUDA_SPEC_BACKENDS.includes(b));
              if (route && (cudaOnly || (preference === 'cuda' && cudaAcceptable) ||
                (preference === 'auto' && nativeCudaEligible(requiredBackends)))) {
                const probe = await probeNativeCuda();
                if (probe.ok && probe.features?.includes(route.feature)) {
                  try {
                    const result = await runNativeCudaSubcommand(route.subcommand, spec, { binary: probe.binary, saveArtifact: opts.saveArtifact }, signal,
                      onProgress ? (p) => onProgress({ step: p.step, total: p.total, message: p.message }) : undefined);
                    signal?.throwIfAborted();
                    const withAgent = {
                      ...result,
                      backend: {
                        ...result.backend,
                        id: result.backend?.id ?? NATIVE_CUDA_BACKEND_ID,
                        agentId: opts.agentId,
                        ...probedDeviceName(result.backend, probe.deviceName),
                      },
                    };
                    assertCompleteResult(withAgent, spec.requirements?.backends);
                    return withAgent;
                  } catch (err) {
                    // spec 点名 cuda 才 fail-closed；偏好/auto 落到宿主实现并留痕。
                    if (cudaOnly || (spec.kind === 'thermal-3d-steady' && (spec.parameters as Record<string, unknown>).dimension === 3)) throw err;
                    recordFallback(`native-cuda ${route.feature} exec failed: ${err instanceof Error ? err.message : String(err)}`);
                  }
                } else if (cudaOnly) {
                  throw new Error(
                    `native-cuda backend lacks ${route.feature} support (probe: ${probe.reason ?? 'feature not embedded'})`,
                  );
                } else {
                  recordFallback(`native-cuda ${route.feature} unavailable: ${probe.ok ? 'feature not embedded' : (probe.reason ?? 'probe failed')}`);
                }
              }
              const result: JobResultV1 = await runner.run(spec, onProgress, signal);
              signal?.throwIfAborted();
              const withAgent = {
                ...result,
                backend: { ...result.backend, id: result.backend?.id ?? 'cpu', agentId: opts.agentId },
              };
              assertCompleteResult(withAgent, spec.requirements?.backends);
              return withAgent;
            },
          };
        },
      });
      if (!registered.ok) throw new Error(`${family.familyId} register failed: ${registered.message}`);
    }
  }
  return registry;
}

/**
 * Stable, sorted unique job kinds advertised by the agent multi-kind registry.
 * Used for capability honesty / registration without inventing kinds outside
 * createAgentSolverRegistry (issue #7 residual; does not claim full multi-backend AC).
 */
export function listAgentSolverKinds(opts: AgentRunnerOptions): readonly string[] {
  const kinds = new Set<string>();
  for (const d of createAgentSolverRegistry(opts).list()) {
    for (const k of d.kinds) kinds.add(k);
  }
  return Object.freeze([...kinds].sort());
}

/** Default runners as legacy JobRunner[] (path dual-path + LBM). Prefer createAgentSolverRegistry. */
export function createAgentJobRunners(opts: AgentRunnerOptions): JobRunner[] {
  return createAgentSolverRegistry(opts).asJobRunners();
}
