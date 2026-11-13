/**
 * native-cuda 后端测试：不依赖真实 w-sim-cuda / GPU，
 * 用一个 node 假二进制脚本模拟 CLI 契约（--version / lbm 子命令、
 * WVF1 帧、result.json、JSONL 进度、非零退出与挂起）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JobSpecV1 } from '../../../src/types/task.ts';
import {
  findNativeCudaBinary,
  probeNativeCuda,
  nativeCudaEligible,
  resolveLbmBackendPreference,
  runNativeCudaLbm,
  invalidateNativeCudaProbeCache,
  NATIVE_CUDA_BACKEND_ID,
} from './native-cuda.ts';

/** 假 w-sim-cuda：lbm 子命令读取 --flags（必须非空）、写两帧 WVF1 + result.json。 */
const FAKE_BINARY = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const mode = process.env.FAKE_W_SIM_CUDA_MODE || 'ok';
if (args[0] === '--version') {
  console.log('w-sim-cuda 0.1.0 device: fake-cuda-gpu');
  process.exit(mode === 'badprobe' ? 1 : 0);
}
if (args[0] !== 'lbm') { console.error('unknown subcommand ' + args[0]); process.exit(2); }
if (mode === 'hang') { setTimeout(() => {}, 600000); return; }
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const specPath = get('--spec'), flagsPath = get('--flags'), framesDir = get('--frames-dir'), resultPath = get('--result');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const flags = fs.readFileSync(flagsPath);
if (!flags.length) { console.error('empty flags'); process.exit(4); }
if (mode === 'fail') { console.error('boom: simulated solver fault'); process.exit(3); }
const nx = 2, ny = 2, nz = 2, stride = 2, uLattice = 0.05, cells = nx * ny * nz;
const writeFrame = (step) => {
  const buf = Buffer.alloc(32 + cells * (stride + 1) * 4);
  buf.writeUInt32LE(0x31465657, 0);
  buf.writeUInt32LE(nx, 4); buf.writeUInt32LE(ny, 8); buf.writeUInt32LE(nz, 12);
  buf.writeUInt32LE(step, 16); buf.writeUInt32LE(stride, 20);
  buf.writeFloatLE(uLattice, 24); buf.writeUInt32LE(0, 28);
  let off = 32;
  for (let i = 0; i < cells * stride; i++) { buf.writeFloatLE(step * 0.01 + i * 0.001, off); off += 4; }
  for (let i = 0; i < cells; i++) { buf.writeUInt32LE(flags[i] ? 1 : 0, off); off += 4; }
  fs.writeFileSync(path.join(framesDir, 'frame-' + step + '.wvf'), buf);
};
const maxSteps = spec.run.maxSteps;
const frameSteps = [Math.floor(maxSteps / 2), maxSteps];
if (mode === 'frames_flood') { for (let s = 1; s <= 4097; s++) writeFrame(s); }
else if (mode === 'frame_big') { fs.writeFileSync(path.join(framesDir, 'frame-1.wvf'), Buffer.alloc(33 * 1024 * 1024)); }
// 乱序落盘，验证调用方按 step 排序解码
else for (const s of [...frameSteps].reverse()) writeFrame(s);
if (args.includes('--progress')) {
  for (const s of frameSteps) console.log(JSON.stringify({ step: s, total: maxSteps }));
  console.log('noise line, not json');
}
const result = { schemaVersion: 1, summary: { steps: maxSteps, wallTimeMs: 1, cd: 0.5, cl: 0.01 },
  derived: { precision: 'float32' }, backend: { id: 'native-cuda', deviceName: 'fake-cuda-gpu' } };
fs.writeFileSync(resultPath, JSON.stringify(result));
`;

function makeSpec(maxSteps = 8, fields = false): JobSpecV1 {
  return {
    schemaVersion: 1,
    kind: 'lbm-d3q19',
    parameters: {},
    run: { maxSteps, forceSampleEvery: 4 },
    outputs: fields ? { fields: ['velocity'], fieldFrames: 2 } : {},
  } as JobSpecV1;
}

function withFakeBinary(t: { after: (fn: () => void) => void }): { dir: string; bin: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w-sim-cuda-test-'));
  const bin = path.join(dir, 'w-sim-cuda');
  fs.writeFileSync(bin, FAKE_BINARY, { mode: 0o755 });
  const prevPath = process.env.W_SIM_CUDA_PATH;
  const prevMode = process.env.FAKE_W_SIM_CUDA_MODE;
  process.env.W_SIM_CUDA_PATH = bin;
  delete process.env.FAKE_W_SIM_CUDA_MODE;
  invalidateNativeCudaProbeCache();
  t.after(() => {
    if (prevPath === undefined) delete process.env.W_SIM_CUDA_PATH;
    else process.env.W_SIM_CUDA_PATH = prevPath;
    if (prevMode === undefined) delete process.env.FAKE_W_SIM_CUDA_MODE;
    else process.env.FAKE_W_SIM_CUDA_MODE = prevMode;
    invalidateNativeCudaProbeCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, bin };
}

test('resolveLbmBackendPreference parses W_SIM_BACKEND and rejects invalid values', () => {
  assert.equal(resolveLbmBackendPreference(undefined), 'auto');
  assert.equal(resolveLbmBackendPreference('auto'), 'auto');
  assert.equal(resolveLbmBackendPreference(' CUDA '), 'cuda');
  assert.equal(resolveLbmBackendPreference('dawn'), 'dawn');
  assert.equal(resolveLbmBackendPreference('wasm'), 'wasm');
  assert.throws(() => resolveLbmBackendPreference('metal'), /W_SIM_BACKEND/);
});

test('nativeCudaEligible honors explicit backend requests and upgrades generic ones', () => {
  assert.equal(nativeCudaEligible([]), true);
  assert.equal(nativeCudaEligible(['cuda']), true);
  assert.equal(nativeCudaEligible(['native-cuda']), true);
  assert.equal(nativeCudaEligible(['webgpu']), true);
  assert.equal(nativeCudaEligible(['webgpu', 'cuda']), true);
  assert.equal(nativeCudaEligible(['webgpu-dawn']), false);
  assert.equal(nativeCudaEligible(['webgpu-browser']), false);
  assert.equal(nativeCudaEligible(['webgpu', 'cpu']), false);
  assert.equal(nativeCudaEligible(['cpu']), false);
});

test('probeNativeCuda reports version/device and fails cleanly when probe exits nonzero', async (t) => {
  const { bin } = withFakeBinary(t);
  assert.equal(findNativeCudaBinary(), bin);
  const probe = await probeNativeCuda();
  assert.equal(probe.ok, true);
  assert.equal(probe.binary, bin);
  assert.equal(probe.version, '0.1.0');
  assert.equal(probe.deviceName, 'fake-cuda-gpu');

  process.env.FAKE_W_SIM_CUDA_MODE = 'badprobe';
  invalidateNativeCudaProbeCache();
  const bad = await probeNativeCuda();
  assert.equal(bad.ok, false);
  assert.equal(bad.binary, bin);
  assert.ok(bad.reason);
});

test('probeNativeCuda returns unavailable when no binary exists', async (t) => {
  const prevPath = process.env.W_SIM_CUDA_PATH;
  const prevPathEnv = process.env.PATH;
  process.env.W_SIM_CUDA_PATH = path.join(os.tmpdir(), 'w-sim-cuda-does-not-exist');
  process.env.PATH = '';
  t.after(() => {
    if (prevPath === undefined) delete process.env.W_SIM_CUDA_PATH;
    else process.env.W_SIM_CUDA_PATH = prevPath;
    process.env.PATH = prevPathEnv;
  });
  assert.equal(findNativeCudaBinary(), null);
  invalidateNativeCudaProbeCache();
  const probe = await probeNativeCuda();
  assert.equal(probe.ok, false);
  assert.match(probe.reason ?? '', /not found/);
});

test('runNativeCudaLbm parses JSONL progress and decodes WVF1 frames in step order', async (t) => {
  withFakeBinary(t);
  const spec = makeSpec(8, true);
  const flags = new Uint8Array([0, 1, 0, 1]);
  const progress: { step: number; total: number }[] = [];
  const frames: { step: number; nx: number; stride: number; flags: number }[] = [];
  const result = await runNativeCudaLbm(spec, { flags }, undefined,
    (p) => { progress.push({ step: p.step, total: p.total }); },
    (snapshot) => {
      frames.push({ step: snapshot.step, nx: snapshot.nx, stride: snapshot.displayStride, flags: snapshot.flags.length });
      assert.ok(Math.abs(snapshot.uLattice - 0.05) < 1e-6);
      assert.equal(snapshot.display.length, snapshot.nx * snapshot.ny * snapshot.nz * snapshot.displayStride);
    });
  assert.deepEqual(progress, [{ step: 4, total: 8 }, { step: 8, total: 8 }]);
  // 假二进制乱序写盘，调用方必须按 step 升序回调
  assert.deepEqual(frames, [
    { step: 4, nx: 2, stride: 2, flags: 8 },
    { step: 8, nx: 2, stride: 2, flags: 8 },
  ]);
  assert.equal(result.summary.steps, 8);
  assert.equal(result.summary.cd, 0.5);
  assert.equal(result.backend?.id, NATIVE_CUDA_BACKEND_ID);
});

test('runNativeCudaLbm fails closed when the binary floods frame files', async (t) => {
  withFakeBinary(t);
  process.env.FAKE_W_SIM_CUDA_MODE = 'frames_flood';
  const frames: number[] = [];
  await assert.rejects(
    runNativeCudaLbm(makeSpec(4, true), { flags: new Uint8Array([0, 1]) }, undefined, undefined, () => { frames.push(1); }),
    /exceeds the 4096 bound/,
  );
  assert.equal(frames.length, 0, 'enumeration bound must trip before any frame decode');
});

test('runNativeCudaLbm fails closed on an oversize frame before reading it', async (t) => {
  withFakeBinary(t);
  process.env.FAKE_W_SIM_CUDA_MODE = 'frame_big';
  await assert.rejects(
    runNativeCudaLbm(makeSpec(4, true), { flags: new Uint8Array([0, 1]) }, undefined, undefined, () => {}),
    /exceeds the 32 MiB bound/,
  );
});

test('runNativeCudaLbm propagates non-zero exit with stderr', async (t) => {
  withFakeBinary(t);
  process.env.FAKE_W_SIM_CUDA_MODE = 'fail';
  await assert.rejects(
    runNativeCudaLbm(makeSpec(), { flags: new Uint8Array([1]) }),
    /w-sim-cuda failed \(exit 3\): boom: simulated solver fault/,
  );
});

test('runNativeCudaLbm kills the child on abort', async (t) => {
  withFakeBinary(t);
  process.env.FAKE_W_SIM_CUDA_MODE = 'hang';
  const ac = new AbortController();
  const run = runNativeCudaLbm(makeSpec(), { flags: new Uint8Array([0]) }, ac.signal);
  setTimeout(() => ac.abort(), 50);
  await assert.rejects(run, (err: unknown) => err instanceof Error && err.name === 'AbortError');
});

test('runNativeCudaLbm fails without the binary', async (t) => {
  const prevPath = process.env.W_SIM_CUDA_PATH;
  const prevPathEnv = process.env.PATH;
  process.env.W_SIM_CUDA_PATH = path.join(os.tmpdir(), 'w-sim-cuda-does-not-exist');
  process.env.PATH = '';
  t.after(() => {
    if (prevPath === undefined) delete process.env.W_SIM_CUDA_PATH;
    else process.env.W_SIM_CUDA_PATH = prevPath;
    process.env.PATH = prevPathEnv;
  });
  await assert.rejects(
    runNativeCudaLbm(makeSpec(), { flags: new Uint8Array([0]) }),
    /w-sim-cuda binary not found/,
  );
});

test('runNativeCudaLbm honors input.binary over env discovery (probe→spawn consistency)', async (t) => {
  const { bin } = withFakeBinary(t);
  const prevPath = process.env.W_SIM_CUDA_PATH;
  // Point env discovery at a dead path — the explicit input.binary must win,
  // so the process that runs is the one the probe resolved.
  process.env.W_SIM_CUDA_PATH = path.join(os.tmpdir(), 'w-sim-cuda-does-not-exist');
  t.after(() => {
    if (prevPath === undefined) delete process.env.W_SIM_CUDA_PATH;
    else process.env.W_SIM_CUDA_PATH = prevPath;
  });
  const result = await runNativeCudaLbm(makeSpec(4), { flags: new Uint8Array([0, 1]), binary: bin });
  assert.equal(result.summary.steps, 4);
});
