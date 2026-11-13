/**
 * Loop EVALS harness: 每个 LBM 预设模型走真实求解路径跑通。
 * loadPresetModel → createActiveLbmJobSpec → prepareLbmInput → runLbmWasm（CPU 内核，与浏览器同路径）
 *
 * 用法: cd apps/lab && npx tsx evals/preset-matrix.mts [--steps N] [--only id1,id2]
 * 输出: JSON 记分卡到 stdout；非零退出 = 有用例失败。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Worker as ThreadWorker } from 'node:worker_threads';

const here = dirname(fileURLToPath(import.meta.url));
const modelsDir = join(here, '../public/models');

// Node 环境补齐浏览器面（同 lbm-smoke.test.ts 的做法）
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  },
});
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: globalThis.localStorage } });
// Node 的 Request 构造不接受相对 URL；three FileLoader 会 new Request('/draco/...')。
const NativeRequest = globalThis.Request;
class EvalRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === 'string' && input.startsWith('/') ? `http://eval.local${input}` : input, init);
  }
}
Object.defineProperty(globalThis, 'Request', { configurable: true, value: EvalRequest });

// DRACOLoader 用 Blob+createObjectURL+Web Worker 解码。Node 无此面：
// 记住 Blob 文本（loader 只塞字符串），Worker 桥接到 worker_threads。
// worker 侧 draco_decoder.js 走 Emscripten 的 Node 分支，wasmBinary 由
// decoderConfig 直接带入，不需要 fs/fetch。
const blobSources = new Map<string, string>();
const NativeBlob = globalThis.Blob;
class EvalBlob extends NativeBlob {
  readonly evalText: string;
  constructor(parts?: BlobPart[], opts?: BlobPropertyBag) {
    super(parts, opts);
    this.evalText = (parts ?? []).map((p) => (typeof p === 'string' ? p : '')).join('');
  }
}
Object.defineProperty(globalThis, 'Blob', { configurable: true, value: EvalBlob });
URL.createObjectURL = (b: Blob) => {
  const id = `blob:eval-${blobSources.size}`;
  blobSources.set(id, (b as EvalBlob).evalText ?? '');
  return id;
};
URL.revokeObjectURL = (u: string) => { blobSources.delete(u); };

const WORKER_BOOTSTRAP = `
const { parentPort, workerData } = require('worker_threads');
globalThis.self = globalThis;
self.postMessage = (msg, transfer) => parentPort.postMessage(msg, Array.isArray(transfer) ? transfer : undefined);
eval(workerData.code);
parentPort.on('message', (data) => { if (typeof self.onmessage === 'function') self.onmessage({ data }) });
`;
class EvalWorker {
  private inner: ThreadWorker;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(url: string | URL) {
    const code = blobSources.get(String(url));
    if (code === undefined) throw new Error(`EvalWorker: unknown source ${url}`);
    this.inner = new ThreadWorker(WORKER_BOOTSTRAP, { eval: true, workerData: { code } });
    this.inner.on('message', (data) => this.onmessage?.({ data }));
    this.inner.on('error', (e) => this.onerror?.(e));
  }
  postMessage(msg: unknown, transfer?: unknown[]) { this.inner.postMessage(msg, transfer as never); }
  terminate() { void this.inner.terminate(); }
}
Object.defineProperty(globalThis, 'Worker', { configurable: true, value: EvalWorker });

globalThis.fetch = async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
  const file = url.split('/').at(-1)!;
  const dir = url.includes('/draco/') ? join(here, '../public/draco') : modelsDir;
  return new Response(await readFile(join(dir, file)));
};

function failUsage(message: string): never {
  console.error(`${message}\n用法: npx tsx evals/preset-matrix.mts [--steps N] [--only id1,id2]`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let steps = 5;
  let only: string[] | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--steps') {
      const raw = argv[++i];
      const parsed = raw === undefined ? NaN : Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        failUsage(`--steps 需要正整数，收到 ${raw ?? '空值'}`);
      }
      steps = parsed;
      continue;
    }
    if (arg === '--only') {
      const raw = argv[++i];
      if (raw === undefined || raw.startsWith('--')) {
        failUsage('--only 需要逗号分隔的 preset id 列表');
      }
      const ids = raw.split(',').map((id) => id.trim());
      if (ids.some((id) => !id)) {
        failUsage(`--only 含空 preset id：${raw}`);
      }
      only = [...new Set(ids)];
      continue;
    }
    failUsage(`未知参数：${arg}`);
  }
  return { steps, only };
}

const { steps, only } = parseArgs(process.argv.slice(2));

type Row = {
  preset: string; ok: boolean; stage: string; steps?: number;
  rePhysical?: number; reLattice?: number; tau?: number;
  cellCount?: number; solidCells?: number; cd?: number; cl?: number;
  wallMs?: number; error?: string;
};

const { PRESET_MODELS, loadPresetModel } = await import('../src/lib/models/preset-models');
const { createActiveLbmJobSpec } = await import('../src/lib/models/sim-session');
const { createWindTunnelModel } = await import('../src/lib/stores/project-store');
const { useSimulationStore } = await import('../src/lib/stores/simulation-store');
const { prepareLbmInput, runLbmWasm } = await import('../../../src/lib/sim/lbm-compute');

const defaults = useSimulationStore.getState().parameters;
const selected = only ? PRESET_MODELS.filter((preset) => only.includes(preset.id)) : PRESET_MODELS;
const unknown = only?.filter((id) => !PRESET_MODELS.some((preset) => preset.id === id)) ?? [];
if (unknown.length) {
  failUsage(`未知 preset id：${unknown.join(', ')}`);
}
if (!selected.length) {
  failUsage('没有可执行的 preset');
}
const rows: Row[] = [];

for (const preset of selected) {
  const row: Row = { preset: preset.id, ok: false, stage: 'load' };
  try {
    const loaded = await loadPresetModel(preset);
    row.stage = 'spec';
    const inputs = { ...defaults, ...preset.defaultParameters, maxIterations: steps, durationSeconds: undefined };
    const spec = createActiveLbmJobSpec(inputs, createWindTunnelModel(loaded.metadata));
    row.stage = 'admit';
    const prepared = prepareLbmInput(spec, loaded.geometry);
    row.tau = prepared.lbm.tau;
    row.cellCount = prepared.flags.length;
    row.solidCells = prepared.lbm.solidCells;
    row.rePhysical = prepared.lbm.units.reynoldsPhysical;
    row.reLattice = prepared.lbm.units.reynoldsLattice;
    row.stage = 'run';
    const t0 = performance.now();
    const { result } = await runLbmWasm(spec, prepared);
    row.wallMs = Math.round(performance.now() - t0);
    row.steps = result.summary.steps;
    row.cd = result.summary.dragCoefficient === undefined ? undefined : Number(result.summary.dragCoefficient);
    row.cl = result.summary.liftCoefficient === undefined ? undefined : Number(result.summary.liftCoefficient);
    const finite = [row.cd, row.cl].every((v) => v === undefined || v === null || Number.isFinite(v));
    if (!finite) throw new Error('non-finite force coefficients');
    row.ok = row.steps === steps;
    row.stage = row.ok ? 'done' : 'short-run';
  } catch (e) {
    row.error = e instanceof Error ? e.message.slice(0, 200) : String(e);
  }
  rows.push(row);
  console.error(`${row.ok ? 'PASS' : 'FAIL'} ${row.preset} [${row.stage}] ${row.error ?? `steps=${row.steps} re=${row.reLattice?.toExponential(2)} wall=${row.wallMs}ms`}`);
}

console.log(JSON.stringify(rows, null, 2));
const failed = rows.filter((r) => !r.ok);
console.error(`\n${rows.length - failed.length}/${rows.length} presets passed`);
process.exit(failed.length ? 1 : 0);
