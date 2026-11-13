#!/usr/bin/env node
/**
 * waveworld/lab native-CUDA benchmark + CI gate.
 *
 * Fixed scene set → warmup → timed reps → p50/p95/p99 + throughput + peak
 * VRAM (nvidia-smi poll) + kernel time when the binary reports it.
 * `--baseline <prev-report.json>` gates cuda p95 ≤ baseline × slack (default
 * 1.1). The baseline file is the previous releasable commit's report — keep
 * it as a CI artifact.
 *
 * Scenes (from `w-sim-cuda describe` — never drift from the binary):
 *   lbm            all-fluid D3Q19 lattice (flags = all zeros), cuda path
 *   module-host    actuator-line with backend:'host'  (host-f64 path)
 *   module-cuda    same scene with backend:'cuda' → same-scene numeric
 *                  comparison at rel-tol 1e-3 + honest backend.id check
 *
 * Usage:
 *   node cuda-bench.mjs --binary /path/to/w-sim-cuda [--reps 7] [--warmup 2]
 *                       [--out report.json] [--baseline prev.json]
 *                       [--p95-slack 1.1] [--timeout-ms 600000]
 * Exit: 0 = all scenes ran + gate passed; 1 = run failure or gate breach.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

const BINARY = args.binary ?? process.env.W_SIM_CUDA_PATH;
const REPS = Number(args.reps ?? 7);
const WARMUP = Number(args.warmup ?? 2);
const OUT = args.out ?? null;
const BASELINE = args.baseline ?? null;
const P95_SLACK = Number(args['p95-slack'] ?? 1.1);
const TIMEOUT_MS = Number(args['timeout-ms'] ?? 600_000);
const REL_TOL = 1e-3; // same-scene cuda-vs-host band (project bf16-class band)

if (!BINARY || !existsSync(BINARY)) {
  console.error('cuda-bench: --binary <path-to-w-sim-cuda> required (or W_SIM_CUDA_PATH)');
  process.exit(1);
}
if (!Number.isInteger(REPS) || REPS < 1 || !Number.isInteger(WARMUP) || WARMUP < 0) {
  console.error('cuda-bench: --reps >=1 and --warmup >=0 required');
  process.exit(1);
}

const GIT_SHA = process.env.GIT_SHA ?? process.env.WAVEWORLD_BUILD_ID ??
  (() => { try { return spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(); } catch { return 'unknown'; } })();

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', timeout: opts.timeoutMs ?? 30_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} → exit ${r.status}: ${(r.stderr ?? '').slice(0, 400)}`);
  return r.stdout;
}

/** nvidia-smi poller: peak used MiB during a run; null when unavailable. */
function vramSampler() {
  if (spawnSync('which', ['nvidia-smi']).status !== 0) return { peak: () => null, stop: () => {} };
  let peak = 0;
  const timer = setInterval(() => {
    try {
      const out = spawnSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 2000 }).stdout;
      for (const line of out.trim().split('\n')) {
        const v = Number(line.trim());
        if (Number.isFinite(v) && v > peak) peak = v;
      }
    } catch { /* sampler never kills the bench */ }
  }, 100);
  timer.unref();
  return { peak: () => (peak > 0 ? peak : null), stop: () => clearInterval(timer) };
}

/** One timed subcommand run; returns {ms, result, vramPeakMb, timedOut}. */
async function timedRun(argv, timeoutMs) {
  const sampler = vramSampler();
  const t0 = performance.now();
  const child = spawn(BINARY, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 256 * 1024) stderr = stderr.slice(-256 * 1024); });
  child.stdout.resume(); // progress JSONL — drain, not used
  const timedOut = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(true); }, timeoutMs);
    child.on('close', () => { clearTimeout(timer); resolve(false); });
    child.on('error', () => { clearTimeout(timer); resolve(false); });
  });
  const ms = performance.now() - t0;
  sampler.stop();
  if (timedOut) throw new Error(`run timed out after ${timeoutMs}ms`);
  if (child.exitCode !== 0) throw new Error(`run failed (exit ${child.exitCode}): ${stderr.slice(0, 400)}`);
  return { ms, vramPeakMb: sampler.peak() };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function stats(latencies, vramPeaks, kernelMs, throughputPerMin) {
  const s = [...latencies].sort((a, b) => a - b);
  return {
    reps: latencies.length,
    p50_ms: percentile(s, 50),
    p95_ms: percentile(s, 95),
    p99_ms: percentile(s, 99),
    min_ms: s[0] ?? null,
    max_ms: s[s.length - 1] ?? null,
    throughput_per_min: throughputPerMin,
    vram_peak_mb: vramPeaks.length ? Math.max(...vramPeaks) : null,
    kernel_ms: kernelMs.length ? percentile([...kernelMs].sort((a, b) => a - b), 95) : null,
  };
}

/** Recursive numeric compare for same-scene host-vs-cuda parity. */
function maxRelDiff(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return 0;
    const denom = Math.max(Math.abs(a), Math.abs(b), 1e-12);
    return Math.abs(a - b) / denom;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return Infinity;
    return a.reduce((m, v, i) => Math.max(m, maxRelDiff(v, b[i])), 0);
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let m = 0;
    for (const k of keys) {
      if (k === 'backend' || k === 'deviceName') continue; // provenance fields differ by design
      if (!(k in a) || !(k in b)) return Infinity;
      m = Math.max(m, maxRelDiff(a[k], b[k]));
    }
    return m;
  }
  return a === b ? 0 : Infinity;
}

const tmp = mkdtempSync(join(tmpdir(), 'cuda-bench-'));
const report = { git_sha: GIT_SHA, binary: BINARY, at: new Date().toISOString(), scenes: {}, gate: { slack: P95_SLACK, checks: [] } };
let hardFail = null;

try {
  // --- scene specs -------------------------------------------------------
  const describe = JSON.parse(run(BINARY, ['describe']));
  const lbmExample = describe.subcommands?.find?.((s) => s.name === 'lbm')?.example;
  if (!lbmExample) throw new Error('describe catalog lacks an lbm example');
  const lbmSpec = join(tmp, 'lbm.json');
  const lbmFlags = join(tmp, 'flags.bin');
  const lbmResult = join(tmp, 'lbm-result.json');
  const lbmFrames = join(tmp, 'frames');
  writeFileSync(lbmSpec, JSON.stringify(lbmExample));
  // The catalog example selects a gridPreset, not raw dims — resolve the
  // binary's actual grid by letting a deliberately-short flags file fail
  // closed with the "does not match grid WxHxD" admission error, then size
  // the all-fluid mask from it.
  const lbmCells = (() => {
    const probe = join(tmp, 'probe-flags.bin');
    writeFileSync(probe, Buffer.alloc(1, 0));
    const r = spawnSync(BINARY, ['lbm', '--spec', lbmSpec, '--flags', probe, '--frames-dir', join(tmp, 'pf'), '--result', join(tmp, 'pr.json')], { encoding: 'utf8', timeout: 60_000 });
    const m = /does not match grid (\d+)x(\d+)x(\d+) \((\d+) cells\)/.exec(`${r.stderr ?? ''}${r.stdout ?? ''}`);
    if (!m) throw new Error(`grid probe failed: ${(r.stderr ?? r.stdout ?? 'no output').slice(0, 300)}`);
    return Number(m[4]);
  })();
  writeFileSync(lbmFlags, Buffer.alloc(lbmCells, 0)); // all-fluid scene

  // actuator-line has a real host-f64 path AND a real fatbin CUDA path —
  // the only honest host↔cuda parity scene. input:'root' ⇒ the describe
  // example fields are the spec body; `backend` selects the path.
  const swModule = 'actuator-line';
  const alExample = describe.modules?.find?.((m) => m.name === swModule)?.example;
  if (!alExample) throw new Error(`describe catalog lacks a ${swModule} module example`);
  const swScene = (backend) => ({ ...alExample, backend });
  const swSpec = (backend) => { const p = join(tmp, `sw-${backend}.json`); writeFileSync(p, JSON.stringify(swScene(backend))); return p; };

  const scenes = [
    { id: 'lbm', argv: () => ['lbm', '--spec', lbmSpec, '--flags', lbmFlags, '--frames-dir', lbmFrames, '--result', lbmResult], resultFile: lbmResult, expectCuda: true },
    { id: 'module-host', argv: () => ['module', '--spec', swSpec('host'), '--result', join(tmp, 'sw-host-result.json')], resultFile: join(tmp, 'sw-host-result.json'), expectCuda: false },
    { id: 'module-cuda', argv: () => ['module', '--spec', swSpec('cuda'), '--result', join(tmp, 'sw-cuda-result.json')], resultFile: join(tmp, 'sw-cuda-result.json'), expectCuda: true },
  ];

  for (const scene of scenes) {
    const lat = [], vram = [], kernel = [];
    try {
      for (let i = 0; i < WARMUP; i++) await timedRun(scene.argv(), TIMEOUT_MS);
      const t0 = performance.now();
      for (let i = 0; i < REPS; i++) {
        const r = await timedRun(scene.argv(), TIMEOUT_MS);
        lat.push(r.ms);
        if (r.vramPeakMb != null) vram.push(r.vramPeakMb);
        // kernel share when the binary reports it (result.meta.kernel_ms)
        try {
          const res = JSON.parse(readFileSync(scene.resultFile, 'utf8'));
          const kms = res?.meta?.kernel_ms ?? res?.moduleResult?.meta?.kernel_ms;
          if (typeof kms === 'number' && Number.isFinite(kms)) kernel.push(kms);
          if (i === 0) {
            // Honest provenance check: cuda scenes must report a cuda-family
            // backend on the INNER self-report — the JobResult envelope id is
            // always 'w-sim-cuda' regardless of which path actually ran, so
            // moduleResult.backend.id (or result.backend.id) is the only
            // field that can catch a silent host fallback.
            const bid = String(res?.moduleResult?.backend?.id ?? res?.result?.backend?.id ?? res?.backend?.id ?? '');
            // 'w-sim-cuda-host' contains 'cuda' — require cuda-family AND
            // not host-marked, or a silent host fallback would pass.
            if (scene.expectCuda && (!/cuda/i.test(bid) || /host/i.test(bid))) {
              throw new Error(`scene ${scene.id}: expected cuda-family backend.id, got ${JSON.stringify(bid)}`);
            }
          }
        } catch (err) {
          if (i === 0 && String(err.message ?? err).startsWith('scene ')) throw err;
          // result unreadable for kernel_ms — honest null, not a failure
        }
      }
      const totalMin = (performance.now() - t0) / 60000;
      report.scenes[scene.id] = stats(lat, vram, kernel, REPS / totalMin);
    } catch (err) {
      report.scenes[scene.id] = { error: String(err instanceof Error ? err.message : err) };
      hardFail ??= `scene ${scene.id}: ${err instanceof Error ? err.message : err}`;
    }
  }

  // --- same-scene numeric parity: module host vs cuda --------------------
  try {
    const host = JSON.parse(readFileSync(join(tmp, 'sw-host-result.json'), 'utf8'));
    const cuda = JSON.parse(readFileSync(join(tmp, 'sw-cuda-result.json'), 'utf8'));
    const h = host?.moduleResult?.result ?? host?.result ?? host;
    const c = cuda?.moduleResult?.result ?? cuda?.result ?? cuda;
    const diff = maxRelDiff(h, c);
    report.parity = { scene: swModule, max_rel_diff: diff, tolerance: REL_TOL, within: diff <= REL_TOL };
    if (!(diff <= REL_TOL)) hardFail ??= `parity breach: max_rel_diff ${diff} > ${REL_TOL}`;
  } catch (err) {
    report.parity = { error: String(err instanceof Error ? err.message : err) };
  }

  // --- baseline gate: p95 ≤ baseline × slack ------------------------------
  if (BASELINE) {
    const prev = JSON.parse(readFileSync(BASELINE, 'utf8'));
    for (const [id, s] of Object.entries(report.scenes)) {
      if (s.error || !/cuda|lbm/.test(id)) continue;
      const base = prev.scenes?.[id]?.p95_ms;
      if (base == null) { report.gate.checks.push({ scene: id, status: 'no-baseline' }); continue; }
      const ratio = s.p95_ms / base;
      const pass = ratio <= P95_SLACK;
      report.gate.checks.push({ scene: id, p95_ms: s.p95_ms, baseline_p95_ms: base, ratio, slack: P95_SLACK, pass });
      if (!pass) hardFail ??= `gate breach ${id}: p95 ${s.p95_ms.toFixed(1)}ms > ${P95_SLACK}× baseline ${base}ms`;
    }
    report.gate.baseline = BASELINE;
  }
  report.gate.pass = hardFail == null;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const out = JSON.stringify(report, null, 2);
if (OUT) writeFileSync(OUT, out + '\n');
console.log(out);
process.exit(hardFail ? 1 : 0);
