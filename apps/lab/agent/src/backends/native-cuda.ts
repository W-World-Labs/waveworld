/**
 * native-cuda 后端：发现并以子进程驱动外部 w-sim-cuda 二进制，
 * 替代 Dawn/WGSL 路径执行 lbm-d3q19 GPU 任务。
 *
 * CLI 契约（w-sim-cuda crate 并行开发中，仅以命令行为准，不依赖其代码）：
 *
 *   w-sim-cuda lbm --spec <spec.json> --flags <flags.u8> \
 *     --frames-dir <dir> --result <result.json> [--progress]
 *
 * - spec.json   完整 job.spec（JobSpecV1 JSON）
 * - flags.u8    原始 u8 固体掩码，nx*ny*nz，x-fastest（同 WASM 路径的 flags）
 * - frames-dir  frame-<step>.wvf（WVF1，由 decodeFlowSnapshot 解码）
 * - result.json JobResultV1 兼容 JSON（summary/history/derived）
 * - --progress  时 stdout 输出 {"step":N,"total":M} JSONL 进度行
 * - exit 0 成功；非 0 失败，stderr 为错误信息
 */
import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { decodeFlowSnapshot, type LbmDisplaySnapshot } from '../../../src/lib/cfd/flow-snapshot.ts';
import type { JobResultV1, JobSpecV1 } from '../../../src/types/task.ts';
import { materializeNativeThermalArtifacts, type ThermalArtifactUploader } from '../native-thermal-artifacts.ts';

/** Result/注册表使用的后端标识；capabilities.backends 走 SolverBackendId 的 'cuda'。 */
export const NATIVE_CUDA_BACKEND_ID = 'native-cuda';

/** spec.requirements.backends 里视为请求本后端的标识（'cuda' 是 SolverBackendId 合法值）。 */
export const NATIVE_CUDA_SPEC_BACKENDS: readonly string[] = ['cuda', 'native-cuda'];
const PROBE_TIMEOUT_MS = 10_000;

function binaryFileNames(): string[] {
  return process.platform === 'win32' ? ['w-sim-cuda.exe', 'w-sim-cuda'] : ['w-sim-cuda'];
}

/** 与 load-dawn.ts 的候选顺序一致：env → 可执行文件旁 → 开发树 → cwd → 打包 __dirname。 */
function candidatePaths(): string[] {
  const names = binaryFileNames();
  const list: string[] = [];
  const pushDir = (dir: string) => {
    for (const name of names) list.push(path.join(dir, name));
  };

  // 1) 环境变量（指向文件本身）
  if (process.env.W_SIM_CUDA_PATH) list.push(process.env.W_SIM_CUDA_PATH);

  // 2) 二进制旁（Node SEA / 安装目录 bin/native/）
  try {
    const exeDir = path.dirname(process.execPath);
    pushDir(path.join(exeDir, 'native'));
    pushDir(exeDir);
  } catch {
    /* ignore */
  }

  // 3) 开发：agent/native、lab bin/
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    pushDir(path.join(here, '../../native'));
    pushDir(path.join(here, '../../../bin/native'));
    pushDir(path.join(here, '../../../bin'));
  } catch {
    /* ignore */
  }

  // 4) cwd
  pushDir(path.join(process.cwd(), 'bin', 'native'));
  pushDir(path.join(process.cwd(), 'bin'));
  pushDir(path.join(process.cwd(), 'native'));

  // 5) 打包后 __dirname（cjs bundle）
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
    pushDir(path.join(dirname, 'native'));
    pushDir(dirname);
  } catch {
    /* ignore */
  }

  return list;
}

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 仅做同步发现（exists/可执行位 + PATH）；二进制能否运行由 probeNativeCuda 确认。
 * 供注册表 descriptor 这类同步路径使用。
 * W_SIM_CUDA_PATH 是权威覆盖：设置了却指向不可执行路径是配置错误——
 * 返回 null 让 probe 响亮失败，胜过静默用另一枚二进制掩盖部署错误。
 */
export function findNativeCudaBinary(): string | null {
  const explicit = process.env.W_SIM_CUDA_PATH;
  if (explicit) return isExecutableFile(explicit) ? explicit : null;
  for (const p of candidatePaths()) {
    if (p && isExecutableFile(p)) return p;
  }
  // PATH 查找
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of binaryFileNames()) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

/** 诊断串：二进制为什么没找到——显式覆盖是否生效/搜索过哪些候选。 */
export function nativeCudaBinaryDiag(): string {
  const explicit = process.env.W_SIM_CUDA_PATH;
  if (explicit) {
    return isExecutableFile(explicit)
      ? `W_SIM_CUDA_PATH=${explicit}`
      : `W_SIM_CUDA_PATH=${explicit} is set but not executable`;
  }
  return 'searched exe-adjacent/dev/cwd/PATH candidates; set W_SIM_CUDA_PATH';
}

export type NativeCudaProbe = {
  ok: boolean;
  binary?: string;
  version?: string;
  deviceName?: string;
  /** --version JSON 的 features 数组；旧二进制无此字段（视为仅 lbm 等温）。 */
  features?: string[];
  reason?: string;
};

const execFileAsync = promisify(execFile);

// 探测短 TTL 缓存：每次 claim/run 都 execFileSync --version 会阻塞事件
// 循环（超时上限 10s）。成功结果缓存 30s、失败 5s——版本/feature 漂移
// 由运行时结果自报的 backend.id 兜底，不在此追求实时性。
const PROBE_CACHE_OK_MS = 30_000;
const PROBE_CACHE_FAIL_MS = 5_000;
let probeCache: { at: number; value: NativeCudaProbe } | null = null;

function cachedProbe(): NativeCudaProbe | null {
  if (!probeCache) return null;
  const ttl = probeCache.value.ok ? PROBE_CACHE_OK_MS : PROBE_CACHE_FAIL_MS;
  return Date.now() - probeCache.at < ttl ? probeCache.value : null;
}

/** 测试/运维用：强制下一次 probe 重新执行 --version。 */
export function invalidateNativeCudaProbeCache(): void {
  probeCache = null;
}

/**
 * 探测 w-sim-cuda：执行 `<bin> --version`，解析 JSON 或文本版本/设备输出。
 * 二进制缺失或探测失败时返回 { ok: false }，绝不抛出。
 */
export async function probeNativeCuda(): Promise<NativeCudaProbe> {
  const cached = cachedProbe();
  if (cached) return cached;
  const binary = findNativeCudaBinary();
  if (!binary) {
    return {
      ok: false,
      reason: `w-sim-cuda binary not found (${nativeCudaBinaryDiag()})`,
    };
  }
  let text: string;
  try {
    const { stdout, stderr } = await execFileAsync(binary, ['--version'], {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    text = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
  } catch (err) {
    const failed: NativeCudaProbe = { ok: false, binary, reason: err instanceof Error ? err.message : String(err) };
    probeCache = { at: Date.now(), value: failed };
    return failed;
  }
  // 先按 JSON（{"version":..,"device":..,"features":[..]}）解析，再退回文本形式。
  let version: string | undefined;
  let deviceName: string | undefined;
  let features: string[] | undefined;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.version === 'string') version = parsed.version;
    const device = parsed.device ?? parsed.deviceName ?? parsed.gpu;
    if (typeof device === 'string') deviceName = device;
    if (Array.isArray(parsed.features) && parsed.features.every((f) => typeof f === 'string')) {
      features = parsed.features as string[];
    }
  } catch {
    /* 非 JSON 输出 */
  }
  if (!version) {
    const m = /(\d+\.\d+(?:\.\d+)?)/.exec(text);
    version = m?.[1];
  }
  if (!deviceName) {
    const m = /device\s*[:=]\s*(.+)/i.exec(text);
    deviceName = m?.[1]?.trim();
  }
  const probed: NativeCudaProbe = { ok: true, binary, version, deviceName, features };
  probeCache = { at: Date.now(), value: probed };
  return probed;
}

export type LbmBackendPreference = 'auto' | 'cuda' | 'dawn' | 'wasm';

/**
 * W_SIM_BACKEND：auto（默认，cuda → dawn → wasm 资格顺序）| cuda | dawn | wasm。
 * 非法取值视为显式配置错误，直接抛出（与 assertUsableClaimPollMs 同款策略）。
 */
export function resolveLbmBackendPreference(env: string | undefined = process.env.W_SIM_BACKEND): LbmBackendPreference {
  const value = (env ?? 'auto').trim().toLowerCase();
  if (value === 'auto' || value === 'cuda' || value === 'dawn' || value === 'wasm') return value;
  throw new Error(`W_SIM_BACKEND must be auto|cuda|dawn|wasm (got ${JSON.stringify(env)})`);
}

/**
 * auto 模式下能否用 native-cuda 满足该 backend 要求：无约束、统称 'webgpu'
 * （任意 GPU）或含 cuda 令牌时可升级。ANY-OF 语义下 'cuda' 出现在要求里
 * 即表示 cuda 是可接受后端——产出 cuda 系结果即合规；点名 webgpu-dawn/
 * browser/cpu 等具体后端且不含 cuda 时按显式要求执行，不静默替换。
 */
export function nativeCudaEligible(requiredBackends: readonly string[]): boolean {
  if (requiredBackends.length === 0) return true;
  if (requiredBackends.some((b) => NATIVE_CUDA_SPEC_BACKENDS.includes(b))) return true;
  return requiredBackends.every(
    (b) => b === 'webgpu' || NATIVE_CUDA_SPEC_BACKENDS.includes(b),
  );
}

/** 结果自报的 CUDA 系 backend.id（真 GPU 执行）。 */
export function isCudaResultBackendId(id: string): boolean {
  return id === 'cuda' || id === 'w-sim-cuda' || id.startsWith('native-cuda');
}

/** 结果自报的 host 执行 backend.id（host/cpu 数学，绝非 GPU）。 */
export function isHostResultBackendId(id: string): boolean {
  return id === 'cpu' || id.startsWith('cpu-') || id === 'w-sim-cuda-host' || id === 'host-f64';
}

/**
 * 结果 backend.id 是否满足 requirements.backends（ANY-OF）：
 * - 'cuda'/'native-cuda' 需求接受 cuda 系结果 id；
 * - 'webgpu' 需求接受任意 GPU 结果 id（webgpu-* 或 cuda 系）；
 * - 'cpu' 需求接受 host 执行 id；
 * - 其余按字面相等匹配。id 缺失视为不满足。
 */
export function resultBackendAllowed(id: string | undefined, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  if (id === undefined) return false;
  if (required.includes(id)) return true;
  if (isCudaResultBackendId(id)) return required.some((b) => b === 'cuda' || b === 'native-cuda' || b === 'webgpu');
  if (isHostResultBackendId(id)) return required.includes('cpu');
  if (id.startsWith('webgpu')) return required.includes('webgpu');
  return false;
}

/**
 * 同步版探测（注册表 descriptor 为同步路径）。仅在二进制存在时执行一次
 * `--version`（毫秒级）；失败/非 JSON 返回 { ok:false }，绝不抛出。
 */
export function probeNativeCudaSync(): NativeCudaProbe {
  const cached = cachedProbe();
  if (cached) return cached;
  const binary = findNativeCudaBinary();
  if (!binary) {
    return { ok: false, reason: `w-sim-cuda binary not found (${nativeCudaBinaryDiag()})` };
  }
  let text: string;
  try {
    // 与异步 probe 对齐：合并 stdout+stderr——版本 JSON 打到 stderr 的二进制
    // 不应在注册期丢 features（声明欠承诺 → claim/resolve churn）。
    const r = spawnSync(binary, ['--version'], {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
    });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`--version exited ${r.status ?? 'signal'}`);
    text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim();
  } catch (err) {
    const failed: NativeCudaProbe = { ok: false, binary, reason: err instanceof Error ? err.message : String(err) };
    probeCache = { at: Date.now(), value: failed };
    return failed;
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const version = typeof parsed.version === 'string' ? parsed.version : undefined;
    const device = parsed.device ?? parsed.deviceName;
    const deviceName = typeof device === 'string' ? device : undefined;
    const features = Array.isArray(parsed.features) && parsed.features.every((f) => typeof f === 'string')
      ? (parsed.features as string[])
      : undefined;
    const probed: NativeCudaProbe = { ok: true, binary, version, deviceName, features };
    probeCache = { at: Date.now(), value: probed };
    return probed;
  } catch {
    return { ok: true, binary };
  }
}

/**
 * JobSpecV1 kind → w-sim-cuda 子命令与 --version feature 名的路由表。
 * 不在表内的 kind 不由本后端执行（如 path-experiment / export-report）。
 * thermal-3d-convection / electro-thermal-igbt 是二进制宿主路径——
 * --version 无条件上报，不依赖 fatbin。
 */
export const CUDA_KIND_ROUTES: Readonly<Record<string, { subcommand: string; feature: string }>> = {
  'md-batch': { subcommand: 'md', feature: 'md-batch' },
  'em-fdtd-3d': { subcommand: 'fdtd', feature: 'em-fdtd-3d' },
  'fdtd-batch': { subcommand: 'fdtd', feature: 'em-fdtd-3d' },
  'acoustics-3d': { subcommand: 'acoustics', feature: 'acoustics-3d' },
  'thermal-3d-steady': { subcommand: 'thermal-ss', feature: 'thermal-3d-steady' },
  'thermal-3d-convection': { subcommand: 'thermal-ss', feature: 'thermal-3d-convection' },
  'thermal-3d-transient': { subcommand: 'thermal-ss', feature: 'thermal-3d-transient' },
  'electro-thermal-igbt': { subcommand: 'thermal-ss', feature: 'electro-thermal-igbt' },
  'waveworld-module': { subcommand: 'module', feature: 'waveworld-module' },
  'structural-static': { subcommand: 'structural', feature: 'structural-static' },
  'structural-modal': { subcommand: 'structural', feature: 'structural-modal' },
  'em-fdtd-sparams': { subcommand: 'fdtd', feature: 'em-fdtd-sparams' },
  'nbody-gravity': { subcommand: 'md', feature: 'nbody-gravity' },
  'mac-3d': { subcommand: 'mac', feature: 'mac-3d' },
};

/** kind 是否有 native-cuda 路由。 */
export function cudaRouteForKind(kind: string): { subcommand: string; feature: string } | null {
  return CUDA_KIND_ROUTES[kind] ?? null;
}

export type NativeCudaLbmInput = {
  /** 原始 u8 固体掩码，nx*ny*nz，x-fastest（prepareProductLbmLattice 的 flags）。 */
  flags: Uint8Array;
  /** 临时文件父目录；默认 os.tmpdir()。 */
  workDir?: string;
  /** probe 已解析的二进制路径；传入则跳过再发现——probe→spawn 之间
   * 二进制被替换时，不会把旧 probe 的 features/deviceName 记到新进程头上。 */
  binary?: string;
};

export type NativeCudaProgress = {
  step: number;
  total: number;
  cd?: number;
  cl?: number;
  message?: string;
};

/**
 * 执行一次 w-sim-cuda lbm：
 * - 写 spec.json / flags.u8 到临时目录，spawn 子进程；
 * - --progress 时把 stdout JSONL 行串行推给 onProgress（回调抛错会杀死子进程）；
 * - 退出码 0 后读 result.json，并按 step 升序解码 frame-*.wvf → onFrame；
 * - signal abort 时 SIGKILL 子进程；临时目录在 finally 中清理。
 */
export async function runNativeCudaLbm(
  spec: JobSpecV1,
  input: NativeCudaLbmInput,
  signal?: AbortSignal,
  onProgress?: (p: NativeCudaProgress) => void | Promise<void>,
  onFrame?: (snapshot: LbmDisplaySnapshot) => void | Promise<void>,
): Promise<JobResultV1> {
  const binary = input.binary ?? findNativeCudaBinary();
  if (!binary) {
    throw new Error(`w-sim-cuda binary not found (${nativeCudaBinaryDiag()})`);
  }
  signal?.throwIfAborted();

  const fields = spec.outputs.fields ?? [];
  // temperature 场需要带 lbm-thermal 的二进制；缺失时二进制准入失败（fail-closed）。
  if (fields.some((field) => !['velocity', 'vorticity', 'pressure', 'temperature'].includes(field))) {
    throw new Error(`native-cuda supports velocity/vorticity/pressure/temperature fields only (got ${fields.join(', ') || 'none'})`);
  }
  if (fields.length > 0 && !onFrame) throw new Error('native-cuda field output requires onFrame');
  if (spec.outputs.fieldFrames !== undefined && fields.length === 0) {
    throw new Error('native-cuda fieldFrames requires output fields');
  }

  const workDir = fs.mkdtempSync(path.join(input.workDir ?? os.tmpdir(), 'w-sim-cuda-'));
  const specPath = path.join(workDir, 'spec.json');
  const flagsPath = path.join(workDir, 'flags.u8');
  const framesDir = path.join(workDir, 'frames');
  const resultPath = path.join(workDir, 'result.json');

  try {
    fs.mkdirSync(framesDir, { recursive: true });
    fs.writeFileSync(specPath, JSON.stringify(spec));
    fs.writeFileSync(flagsPath, Buffer.from(input.flags.buffer, input.flags.byteOffset, input.flags.byteLength));

    const args = ['lbm', '--spec', specPath, '--flags', flagsPath, '--frames-dir', framesDir, '--result', resultPath];
    const result = await spawnAndCollect(binary, args, resultPath, signal, onProgress);

    // 帧按 step 升序解码；onFrame 即统一的 buffered-upload 入口（saveFlowSnapshot）。
    if (onFrame) {
      for (const frame of listFrameFiles(framesDir, '.wvf')) {
        signal?.throwIfAborted();
        const data = readFrameFile(framesDir, frame.name);
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        await onFrame(decodeFlowSnapshot(buffer));
      }
    }
    return result;
  } finally {
    // 清理失败不得掩盖 try 中的真实错误（占住临时目录也比丢诊断好）。
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}

/**
 * 帧文件数上限：对齐 host 端 artifact 引用上限（4096）。半可信二进制
 * 写出无限多帧会拖垮 readdir/解码循环——超过即显式失败，绝不截断静默。
 */
const MAX_FRAME_FILES = 4096;
/**
 * 单帧读取上限：与解码器 MAX_FLOW_SNAPSHOT_BYTES 合同（32 MiB）。
 * readFileSync 之前先 stat —— 超大帧文件直接失败，不得先整个读进内存。
 */
const FRAME_FILE_MAX_BYTES = 32 * 1024 * 1024;

/** 按文件名 frame-<step>.<ext> 升序列出帧文件（数超 MAX_FRAME_FILES 即抛）。 */
function listFrameFiles(dir: string, ext: string): { name: string; step: number }[] {
  const pattern = new RegExp(`^frame-(\\d+)\\${ext}$`);
  const frames = fs.readdirSync(dir)
    .map((name) => ({ name, m: pattern.exec(name) }))
    .filter((f): f is { name: string; m: RegExpExecArray } => f.m !== null)
    .map((f) => ({ name: f.name, step: Number(f.m[1]) }))
    .filter((f) => Number.isSafeInteger(f.step))
    .sort((a, b) => a.step - b.step);
  if (frames.length > MAX_FRAME_FILES) {
    throw new Error(`w-sim-cuda wrote ${frames.length} ${ext} frames; exceeds the ${MAX_FRAME_FILES} bound`);
  }
  return frames;
}

/** stat-then-read a frame file — rejects oversize files before touching memory. */
function readFrameFile(dir: string, name: string): Buffer {
  const fp = path.join(dir, name);
  if (fs.statSync(fp).size > FRAME_FILE_MAX_BYTES) {
    throw new Error(`w-sim-cuda frame ${name} exceeds the ${FRAME_FILE_MAX_BYTES >> 20} MiB bound`);
  }
  return fs.readFileSync(fp);
}

/**
 * 子进程硬上限：W_SIM_NATIVE_TIMEOUT_MS（默认 120 s，钳制 [1s, 24h]）。
 * 只解决「kernel 卡死且无进度无取消」这一最坏的挂起形态；命中即 SIGKILL
 * 并以显式超时错误结算——绝不静默挂起。算子级超时归二进制内部。
 * 默认 120 s 是 fail-safe 下限：跑长作业的生产 fleet 必须在 agent.env
 * 显式设 W_SIM_NATIVE_TIMEOUT_MS（按 fleet 真实 p99 作业时长调）。
 */
export function nativeCudaTimeoutMs(env: string | undefined = process.env.W_SIM_NATIVE_TIMEOUT_MS): number {
  const parsed = env === undefined ? 120_000 : Number(env);
  if (!Number.isFinite(parsed) || parsed < 1_000 || parsed > 86_400_000) {
    throw new Error(`W_SIM_NATIVE_TIMEOUT_MS must be a finite ms in [1000, 86400000] (got ${JSON.stringify(env)})`);
  }
  return Math.floor(parsed);
}

/** result.json 读取上限（半可信二进制写出的文件不能 OOM agent）。 */
const RESULT_JSON_MAX_BYTES = 32 * 1024 * 1024;

/**
 * 通用子命令驱动：spawn `<bin> <args…>`，--progress 时把 stdout JSONL
 * 串行推给 onProgress；exit 0 后读 resultPath JSON。供 lbm/mac/各 family
 * 子命令共用。
 */
async function spawnAndCollect(
  binary: string,
  args: string[],
  resultPath: string,
  signal?: AbortSignal,
  onProgress?: (p: NativeCudaProgress) => void | Promise<void>,
): Promise<JobResultV1> {
  if (onProgress) args = [...args, '--progress'];
  const timeoutMs = nativeCudaTimeoutMs();
  // 进度回调串行执行；回调失败（如 abort）记录 progressError 并杀死子进程。
  let progressError: unknown = null;
  let progressChain: Promise<void> = Promise.resolve();
  // 高频进度合并：每条 stdout 行都会触发 heartbeat/lease HTTP——按最小间隔
  // 节流，期间只保留最新一条，避免 progressChain 无限积压。
  const PROGRESS_MIN_INTERVAL_MS = 2000;
  let lastForwardedAt = 0;
  let pendingProgress: NativeCudaProgress | null = null;

  const exit = await new Promise<{ code: number | null; stderr: string; timedOut: boolean }>((resolve, reject) => {
    // detached → 子进程自成进程组：超时/abort 杀整棵树——包装进程或孙
    // 进程占住 stdout/stderr 管道时 close 不会拖延结算。
    const child = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const killTree = () => {
      if (child.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch { /* ESRCH：组已退——退回直接 kill */ }
      }
      child.kill('SIGKILL');
    };
    let stderr = '';
    let stdoutBuf = '';
    let timedOut = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);
    const onAbort = () => {
      killTree();
    };
    if (signal?.aborted) killTree();
    else signal?.addEventListener('abort', onAbort, { once: true });

    const forward = (p: NativeCudaProgress) => {
      progressChain = progressChain.then(async () => {
        try {
          await onProgress?.(p);
        } catch (err) {
          if (progressError == null) progressError = err;
          killTree();
        }
      });
    };
    const drainLine = (raw: string, flush = false) => {
      const line = raw.trim();
      if (!line) return;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown> | null;
        if (typeof parsed?.step !== 'number' || typeof parsed?.total !== 'number') return;
        const p: NativeCudaProgress = { step: parsed.step, total: parsed.total };
        if (typeof parsed.cd === 'number') p.cd = parsed.cd;
        if (typeof parsed.cl === 'number') p.cl = parsed.cl;
        if (typeof parsed.message === 'string') p.message = parsed.message;
        pendingProgress = p;
        const now = Date.now();
        if (flush || now - lastForwardedAt >= PROGRESS_MIN_INTERVAL_MS) {
          lastForwardedAt = now;
          const latest = pendingProgress;
          pendingProgress = null;
          forward(latest);
        }
      } catch {
        /* 忽略非 JSON stdout 行 */
      }
    };

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutBuf += chunk.toString();
      // 无界大整行（无二进制契约保证行长）封顶，丢弃后截断的部分行。
      if (stdoutBuf.length > 262144) stdoutBuf = stdoutBuf.slice(-65536);
      let nl = stdoutBuf.indexOf('\n');
      while (nl >= 0) {
        drainLine(stdoutBuf.slice(0, nl));
        stdoutBuf = stdoutBuf.slice(nl + 1);
        nl = stdoutBuf.indexOf('\n');
      }
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > 65536) stderr = stderr.slice(-65536);
    });
    child.on('error', (err) => {
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      drainLine(stdoutBuf, true); // 结尾无换行的最后一条进度 + 冲掉节流暂存
      if (pendingProgress != null) {
        const latest = pendingProgress;
        pendingProgress = null;
        forward(latest);
      }
      resolve({ code, stderr, timedOut });
    });
  });

  await progressChain;
  if (progressError != null) throw progressError;
  signal?.throwIfAborted();
  // 超时先于退出码结算——SIGKILL 的 'null/signal' 退出形态不是根因。
  if (exit.timedOut) {
    throw new Error(`w-sim-cuda timed out after ${timeoutMs}ms (killed; stderr: ${exit.stderr.trim() || 'none'})`);
  }
  if (exit.code !== 0) {
    throw new Error(`w-sim-cuda failed (exit ${exit.code ?? 'signal'}): ${exit.stderr.trim() || 'no stderr'}`);
  }
  if (!fs.existsSync(resultPath)) {
    throw new Error('w-sim-cuda exited 0 but wrote no result.json');
  }
  if (fs.statSync(resultPath).size > RESULT_JSON_MAX_BYTES) {
    throw new Error(`w-sim-cuda result.json exceeds the ${RESULT_JSON_MAX_BYTES >> 20} MiB bound`);
  }
  return JSON.parse(fs.readFileSync(resultPath, 'utf8')) as JobResultV1;
}

export type NativeCudaSubcommandInput = {
  /** Persist validated thermal field and history/KPI before work-directory cleanup. */
  saveArtifact?: ThermalArtifactUploader;
  /** 可选 u8 体素掩码（mac 用；其它子命令缺省）。 */
  flags?: Uint8Array;
  /** 临时文件父目录；默认 os.tmpdir()。 */
  workDir?: string;
  /** probe 已解析的二进制路径；传入则跳过再发现（与 NativeCudaLbmInput.binary 同理）。 */
  binary?: string;
};

/**
 * 执行任意 w-sim-cuda 子命令（md/fdtd/acoustics/thermal-ss/structural/mac）。
 * 帧产物仅 mac 生成（frame-*.wvm，WVM1）——需要时传 onFrame 自行解码。
 */
export async function runNativeCudaSubcommand(
  subcommand: string,
  spec: JobSpecV1,
  input: NativeCudaSubcommandInput = {},
  signal?: AbortSignal,
  onProgress?: (p: NativeCudaProgress) => void | Promise<void>,
  onFrame?: (frame: { step: number; buffer: ArrayBuffer }) => void | Promise<void>,
): Promise<JobResultV1> {
  const binary = input.binary ?? findNativeCudaBinary();
  if (!binary) {
    throw new Error(`w-sim-cuda binary not found (${nativeCudaBinaryDiag()})`);
  }
  signal?.throwIfAborted();

  const workDir = fs.mkdtempSync(path.join(input.workDir ?? os.tmpdir(), 'w-sim-cuda-'));
  const specPath = path.join(workDir, 'spec.json');
  const resultPath = path.join(workDir, 'result.json');

  try {
    fs.writeFileSync(specPath, JSON.stringify(spec));
    const args = [subcommand, '--spec', specPath, '--result', resultPath];
    let framesDir: string | null = null;
    if (input.flags) {
      const flagsPath = path.join(workDir, 'flags.u8');
      fs.writeFileSync(flagsPath, Buffer.from(input.flags.buffer, input.flags.byteOffset, input.flags.byteLength));
      args.push('--flags', flagsPath);
      framesDir = path.join(workDir, 'frames');
      fs.mkdirSync(framesDir, { recursive: true });
      args.push('--frames-dir', framesDir);
    }
    const nativeResult = await spawnAndCollect(binary, args, resultPath, signal, onProgress);
    const parameters = spec.parameters as Record<string, unknown>;
    const result = spec.kind === 'thermal-3d-transient' ||
      (spec.kind === 'thermal-3d-steady' && parameters.dimension === 3) ||
      (spec.kind === 'electro-thermal-igbt' && parameters.mode === 'spatial-chip')
      ? await materializeNativeThermalArtifacts(spec, nativeResult, workDir, input.saveArtifact, signal)
      : nativeResult;

    if (onFrame && framesDir) {
      // mac 帧扩展名 .wvm；子命令约定 frame-<step>.*。
      for (const ext of ['.wvm', '.wvf']) {
        for (const frame of listFrameFiles(framesDir, ext)) {
          signal?.throwIfAborted();
          const data = readFrameFile(framesDir, frame.name);
          const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
          await onFrame({ step: frame.step, buffer });
        }
      }
    }
    return result;
  } finally {
    // 清理失败不得掩盖 try 中的真实错误（占住临时目录也比丢诊断好）。
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}
