// Native/WASM parity for the reduced-unit TMz Yee kernel: `fdtd_step`
// H -> E -> PEC mask -> outer boundary -> Mur history ordering under both
// boundary modes, `fdtd_source` additive deposits and the `fdtd_energy`
// sampled diagnostic are compared byte-exact, including partially written
// fields and histories left behind by kernel-level errors. No JS duplicate of
// the update rules.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'w-sim-fdtd-'));
const generated = readFileSync(join(root, 'packages/solvers-lbm/src/wasm-kernel.ts'), 'utf8');
const module = new WebAssembly.Module(Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1], 'base64'));
assert.deepEqual(WebAssembly.Module.imports(module), []);

const u32 = values => { const b = Buffer.alloc(4 * values.length); values.forEach((v, i) => b.writeUInt32LE(v, i * 4)); return b; };
const f32 = values => { const b = Buffer.alloc(4 * values.length); values.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };
const arr = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const grid = (nx, ny, fn) => arr(nx * ny, i => fn(i % nx, (i / nx) | 0, i));

const stepCase = (name, nx, ny, over = {}) => ({
  op: 0, name, nx, ny, boundary: 0, steps: 1, dt: .25, mu: 1.5,
  eps: arr(nx * ny, () => 1), mask: null,
  ez: arr(nx * ny, () => 0), hx: arr(nx * ny, () => 0), hy: arr(nx * ny, () => 0),
  left: arr(ny, () => 0), right: arr(ny, () => 0),
  bottom: arr(nx, () => 0), top: arr(nx, () => 0), ...over,
});
const energyCase = (name, nx, ny, over = {}) => ({
  op: 2, name, nx, ny, boundary: 0, dt: .25, mu: 1.5,
  eps: arr(nx * ny, () => 1), ez: arr(nx * ny, () => 0),
  hx: arr(nx * ny, () => 0), hy: arr(nx * ny, () => 0), ...over,
});

// The shared product fixture: mixed permittivity, a few PEC flags and nonzero
// Mur histories on every edge.
const goldenMask = arr(20, () => 0);
goldenMask[0] = 1; goldenMask[7] = 1; goldenMask[12] = 2;
const golden = {
  eps: grid(5, 4, (x, y, i) => i % 5 >= 3 ? 2 : 1), mask: goldenMask,
  ez: grid(5, 4, x => (x - 2) * .125),
  hx: grid(5, 4, (x, y, i) => (i % 3 - 1) * .0625),
  hy: grid(5, 4, (x, y, i) => (i % 4 - 2) * .03125),
  left: [-.01, 0, .01, .02], right: [0, .02, .04, .06],
  bottom: [-.03, -.015, 0, .015, .03], top: [0, .01, .02, .03, .04],
};

const cases = [
  // op0: fdtd_step — dims, boundary, dt, mu, optional mask, fields, histories.
  stepCase('mur-5x4-masked', 5, 4, { steps: 3, ...golden }),
  stepCase('pec-5x4-masked', 5, 4, { steps: 3, boundary: 1, ...golden }),
  stepCase('mur-5x4-unmasked', 5, 4, { steps: 3, ...golden, mask: null }),
  stepCase('mur-3x3-minimal', 3, 3, { steps: 4, dt: .5, mu: 1,
    ez: grid(3, 3, (x, y) => x * .1 - y * .05),
    hx: grid(3, 3, (x, y) => (x + y) * .01), hy: grid(3, 3, (x, y) => (x - y) * .01) }),
  stepCase('pec-4x6-layered', 4, 6, { steps: 3, boundary: 1, dt: .3, mu: 2,
    eps: grid(4, 6, x => 1 + (x % 2) * .5),
    mask: grid(4, 6, (x, y) => x === 2 && y === 3 ? 7 : 0),
    ez: grid(4, 6, (x, y) => (x - 1.5) * (y - 2.5) * .02),
    hx: grid(4, 6, (x, y) => x * .01 - y * .005),
    hy: grid(4, 6, (x, y) => y * .008 - x * .004),
    left: arr(6, j => (j - 2) * .01), right: arr(6, j => j * .01),
    bottom: arr(4, i => (i - 1) * .02), top: arr(4, i => i * -.015) }),
  stepCase('mur-6x5-mask-palette', 6, 5, { steps: 5, dt: .2, mu: .8,
    eps: grid(6, 5, (x, y, i) => 1 + (i * 7) % 5 * .25),
    mask: grid(6, 5, (x, y) => (x + 2 * y) % 7 === 0 ? 1 : x === 3 && y === 2 ? 255 : 0),
    ez: grid(6, 5, (x, y, i) => ((i * 11) % 9 - 4) * .04),
    hx: grid(6, 5, (x, y) => (x - y) * .02), hy: grid(6, 5, (x, y) => (x + y - 4) * .015),
    left: arr(5, j => j * .02 - .03), right: arr(5, j => .04 - j * .01),
    bottom: arr(6, i => i * .01), top: arr(6, i => -.02 - i * .005) }),
  // courant_squared lands exactly on the inclusive limit.
  stepCase('mur-cfl-boundary', 5, 4, { steps: 2, dt: Math.sqrt(.75),
    ez: grid(5, 4, x => (x - 2) * .1), hx: arr(20, () => .01), hy: arr(20, () => -.01) }),
  stepCase('mur-cfl-exceeded', 5, 4, { dt: .87 }),
  stepCase('dt-zero', 5, 4, { dt: 0 }),
  stepCase('dt-negative', 5, 4, { dt: -.1 }),
  stepCase('dt-nan', 5, 4, { dt: NaN }),
  stepCase('mu-zero', 5, 4, { mu: 0 }),
  stepCase('mu-negative', 5, 4, { mu: -2 }),
  stepCase('mu-nan', 5, 4, { mu: NaN }),
  stepCase('eps-zero-cell', 5, 4, { eps: arr(20, i => i === 7 ? 0 : 1) }),
  stepCase('eps-negative-cell', 5, 4, { eps: arr(20, i => i === 3 ? -.5 : 1) }),
  stepCase('eps-nan-cell', 5, 4, { eps: arr(20, i => i === 11 ? NaN : 1) }),
  // The fastest cell controls the CFL bound, so one tiny eps rejects the step.
  stepCase('eps-fastest-cfl', 5, 4, { eps: arr(20, i => i === 0 ? 1e-38 : 1) }),
  stepCase('nx-below-minimum', 2, 4),
  stepCase('ny-below-minimum', 4, 2),
  stepCase('ez-nan', 5, 4, { ez: arr(20, i => i === 9 ? NaN : .05) }),
  stepCase('hx-infinite', 5, 4, { hx: arr(20, i => i === 4 ? Infinity : 0) }),
  stepCase('hy-negative-infinite', 5, 4, { hy: arr(20, i => i === 15 ? -Infinity : 0) }),
  stepCase('prev-left-nan', 5, 4, { left: arr(4, j => j === 2 ? NaN : .01) }),
  stepCase('prev-top-infinite', 5, 4, { top: arr(5, i => i === 0 ? Infinity : 0) }),
  // The f64 update overflows f32 mid-sweep; the written prefix is compared.
  stepCase('h-update-overflow', 5, 4, { steps: 2, dt: .8,
    ez: arr(20, i => i === 6 ? 3e38 : i === 11 ? -3e38 : 0),
    hx: arr(20, i => i === 6 ? 3e38 : 0) }),
  stepCase('e-update-overflow', 5, 4, { steps: 2, dt: .8,
    hy: arr(20, i => i === 6 ? -3e38 : i === 7 ? 3e38 : 0) }),
  stepCase('mur-all-masked', 5, 4, { steps: 3, mask: arr(20, () => 1),
    ez: grid(5, 4, (x, y) => x * y * .1) }),
  stepCase('pec-mask-outer-ring', 5, 4, { steps: 2, boundary: 1,
    mask: grid(5, 4, (x, y) => x === 0 || y === 0 || x === 4 || y === 3 ? 1 : 0),
    ez: grid(5, 4, (x, y) => (x - 2) * (y - 1.5) * .1) }),
  // op1: fdtd_source — independent deposits over one shared field.
  { op: 1, name: 'source-center', nx: 5, ny: 4, sources: [[1, 2, .3]],
    ez: grid(5, 4, x => (x - 2) * .125) },
  { op: 1, name: 'source-accumulate', nx: 5, ny: 4,
    sources: [[1, 2, .3], [1, 2, -.2], [3, 1, .05]], ez: arr(20, () => .1) },
  { op: 1, name: 'source-corners', nx: 4, ny: 4,
    sources: [[0, 0, .5], [3, 3, -.5]], ez: arr(16, () => 0) },
  { op: 1, name: 'source-x-bounds', nx: 5, ny: 4, sources: [[5, 0, 1]], ez: arr(20, () => .2) },
  { op: 1, name: 'source-y-bounds', nx: 5, ny: 4, sources: [[0, 4, 1]], ez: arr(20, () => .2) },
  { op: 1, name: 'source-mixed-results', nx: 5, ny: 4,
    sources: [[1, 1, .25], [5, 1, 1], [2, 2, .5]], ez: arr(20, () => 0) },
  { op: 1, name: 'source-nan', nx: 5, ny: 4, sources: [[1, 1, NaN]], ez: arr(20, () => .2) },
  { op: 1, name: 'source-infinite', nx: 5, ny: 4, sources: [[1, 1, Infinity]], ez: arr(20, () => .2) },
  { op: 1, name: 'source-fail-then-ok', nx: 5, ny: 4,
    sources: [[2, 2, 1e38], [0, 0, .5]], ez: arr(20, i => i === 12 ? 3e38 : 0) },
  { op: 1, name: 'source-empty-grid', nx: 0, ny: 4, sources: [[0, 0, 1]], ez: [] },
  // op2: fdtd_energy — sampled diagnostic; sentinel bits on rejection.
  energyCase('energy-uniform', 5, 4, {
    eps: grid(5, 4, (x, y, i) => 1 + i % 4 * .5), ez: grid(5, 4, x => (x - 2) * .1),
    hx: grid(5, 4, (x, y) => y * .02), hy: grid(5, 4, (x, y) => (x - y) * .03) }),
  energyCase('energy-pec', 5, 4, { boundary: 1,
    ez: grid(5, 4, x => x * .05), hx: arr(20, () => .1), hy: arr(20, () => -.05) }),
  energyCase('energy-zero-fields', 5, 4),
  energyCase('energy-eps-zero', 5, 4, { eps: arr(20, i => i === 0 ? 0 : 1) }),
  energyCase('energy-eps-nan', 5, 4, { eps: arr(20, i => i === 4 ? NaN : 1) }),
  energyCase('energy-ez-nan', 5, 4, { ez: arr(20, i => i === 9 ? NaN : .05) }),
  energyCase('energy-hx-infinite', 5, 4, { hx: arr(20, i => i === 2 ? Infinity : 0) }),
  // Finite state whose squared sum overflows f64 inside the diagnostic.
  energyCase('energy-mu-overflow', 5, 4, { mu: 1e300, hx: arr(20, () => 1e20) }),
  energyCase('energy-mu-nan', 5, 4, { mu: NaN }),
  energyCase('energy-dt-over-cfl', 5, 4, { dt: 5 }),
  energyCase('energy-nx-below-minimum', 2, 4),
];

function pack(c) {
  if (c.op === 0) {
    const head = Buffer.alloc(40);
    head.writeUInt32LE(c.nx, 4);
    head.writeUInt32LE(c.ny, 8);
    head.writeUInt32LE(c.boundary, 12);
    head.writeUInt32LE(c.steps, 16);
    head.writeUInt32LE(c.mask ? 1 : 0, 20);
    head.writeDoubleLE(c.dt, 24);
    head.writeDoubleLE(c.mu, 32);
    const parts = [head, f32(c.eps)];
    if (c.mask) parts.push(Buffer.from(c.mask));
    parts.push(f32(c.ez), f32(c.hx), f32(c.hy), f32(c.left), f32(c.right), f32(c.bottom), f32(c.top));
    return Buffer.concat(parts);
  }
  if (c.op === 1) {
    const head = Buffer.alloc(16);
    head.writeUInt32LE(1, 0);
    head.writeUInt32LE(c.nx, 4);
    head.writeUInt32LE(c.ny, 8);
    head.writeUInt32LE(c.sources.length, 12);
    const deposits = c.sources.map(([x, y, amplitude]) => {
      const b = Buffer.alloc(16);
      b.writeUInt32LE(x, 0);
      b.writeUInt32LE(y, 4);
      b.writeDoubleLE(amplitude, 8);
      return b;
    });
    return Buffer.concat([head, ...deposits, f32(c.ez)]);
  }
  const head = Buffer.alloc(32);
  head.writeUInt32LE(2, 0);
  head.writeUInt32LE(c.nx, 4);
  head.writeUInt32LE(c.ny, 8);
  head.writeUInt32LE(c.boundary, 12);
  head.writeDoubleLE(c.dt, 16);
  head.writeDoubleLE(c.mu, 24);
  return Buffer.concat([head, f32(c.eps), f32(c.ez), f32(c.hx), f32(c.hy)]);
}

function run(c) {
  const e = new WebAssembly.Instance(module).exports;
  let at = Math.ceil(e.heap_base() / 8) * 8;
  const alloc = (bytes, align = 8) => { at = Math.ceil(at / align) * align; const ptr = at; at += bytes; return ptr; };
  const n = c.nx * c.ny;
  if (c.op === 0) {
    const params = alloc(32), eps = alloc(n * 4), mask = c.mask ? alloc(n, 1) : 0;
    const ez = alloc(n * 4), hx = alloc(n * 4), hy = alloc(n * 4);
    const left = alloc(c.ny * 4), right = alloc(c.ny * 4), bottom = alloc(c.nx * 4), top = alloc(c.nx * 4);
    if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
    const memory = new Uint8Array(e.memory.buffer);
    const p = new DataView(e.memory.buffer, params, 32);
    p.setUint32(0, c.nx, true); p.setUint32(4, c.ny, true);
    p.setUint32(8, c.boundary, true); p.setUint32(12, 0, true);
    p.setFloat64(16, c.dt, true); p.setFloat64(24, c.mu, true);
    memory.set(f32(c.eps), eps);
    if (c.mask) memory.set(c.mask, mask);
    memory.set(f32(c.ez), ez); memory.set(f32(c.hx), hx); memory.set(f32(c.hy), hy);
    memory.set(f32(c.left), left); memory.set(f32(c.right), right);
    memory.set(f32(c.bottom), bottom); memory.set(f32(c.top), top);
    const codes = arr(c.steps, () => e.fdtd_step(params, eps, mask, ez, hx, hy, left, right, bottom, top));
    return Buffer.concat([u32(codes),
      memory.slice(ez, ez + n * 4), memory.slice(hx, hx + n * 4), memory.slice(hy, hy + n * 4),
      memory.slice(left, left + c.ny * 4), memory.slice(right, right + c.ny * 4),
      memory.slice(bottom, bottom + c.nx * 4), memory.slice(top, top + c.nx * 4)]);
  }
  if (c.op === 1) {
    const ez = alloc(Math.max(n * 4, 4));
    if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
    const memory = new Uint8Array(e.memory.buffer);
    memory.set(f32(c.ez), ez);
    const codes = c.sources.map(([x, y, amplitude]) => e.fdtd_source(ez, c.nx, c.ny, x, y, amplitude));
    return Buffer.concat([u32(codes), memory.slice(ez, ez + n * 4)]);
  }
  const params = alloc(32), eps = alloc(n * 4);
  const ez = alloc(n * 4), hx = alloc(n * 4), hy = alloc(n * 4), out = alloc(8);
  if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
  const memory = new Uint8Array(e.memory.buffer);
  const p = new DataView(e.memory.buffer, params, 32);
  p.setUint32(0, c.nx, true); p.setUint32(4, c.ny, true);
  p.setUint32(8, c.boundary, true); p.setUint32(12, 0, true);
  p.setFloat64(16, c.dt, true); p.setFloat64(24, c.mu, true);
  memory.set(f32(c.eps), eps); memory.set(f32(c.ez), ez);
  memory.set(f32(c.hx), hx); memory.set(f32(c.hy), hy);
  memory.fill(0xa5, out, out + 8);
  const code = e.fdtd_energy(params, eps, ez, hx, hy, out);
  return Buffer.concat([u32([code]), memory.slice(out, out + 8)]);
}

try {
  const lib = join(scratch, 'libw_sim_kernels.rlib'), native = join(scratch, 'fdtd-parity-reference'), file = join(scratch, 'input');
  execFileSync('rustc', [join(root, 'crates/w-sim-kernels/src/lib.rs'), '--edition', '2021', '--crate-name', 'w_sim_kernels', '--crate-type', 'rlib', '-O', '-C', 'panic=abort', '-o', lib], { stdio: 'inherit', timeout: 60000 });
  execFileSync('rustc', [fileURLToPath(new URL('./fdtd-parity-reference.rs', import.meta.url)), '--edition', '2021', '--extern', `w_sim_kernels=${lib}`, '-O', '-C', 'panic=abort', '-o', native], { stdio: 'inherit', timeout: 60000 });

  for (const c of cases) {
    writeFileSync(file, pack(c));
    assert.deepEqual(run(c), execFileSync(native, [file], { timeout: 10000 }), `${c.name}: status/fields native/WASM bytes`);
  }

  // ABI-level rejections must leave every caller buffer untouched.
  {
    const e = new WebAssembly.Instance(module).exports;
    let at = Math.ceil(e.heap_base() / 8) * 8;
    const alloc = (bytes, align = 8) => { at = Math.ceil(at / align) * align; const ptr = at; at += bytes; return ptr; };
    const nx = 5, ny = 4, n = nx * ny;
    const base = alloc(32), eps = alloc(n * 4), mask = alloc(n, 1);
    const ez = alloc(n * 4), hx = alloc(n * 4), hy = alloc(n * 4);
    const left = alloc(ny * 4), right = alloc(ny * 4), bottom = alloc(nx * 4), top = alloc(nx * 4);
    const out = alloc(8);
    if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
    const memory = new Uint8Array(e.memory.buffer);
    const params = base, p = new DataView(e.memory.buffer, params, 32);
    const setParams = () => {
      p.setUint32(0, nx, true); p.setUint32(4, ny, true);
      p.setUint32(8, 0, true); p.setUint32(12, 0, true);
      p.setFloat64(16, .25, true); p.setFloat64(24, 1.5, true);
    };
    setParams();
    const F = new Float32Array(e.memory.buffer);
    F.fill(1, eps / 4, eps / 4 + n);
    new Uint8Array(e.memory.buffer, mask, n).fill(0);
    const step = () => e.fdtd_step(params, eps, mask, ez, hx, hy, left, right, bottom, top);
    const energy = (output = out) => e.fdtd_energy(params, eps, ez, hx, hy, output);
    assert.equal(step(), 0);
    assert.equal(e.fdtd_source(ez, nx, ny, 1, 2, .25), 0);
    assert.equal(energy(), 0);
    const before = Buffer.from(memory.slice(base));
    const end = e.memory.buffer.byteLength;
    for (const call of [
      () => e.fdtd_step(0, eps, mask, ez, hx, hy, left, right, bottom, top),
      () => e.fdtd_step(params + 4, eps, mask, ez, hx, hy, left, right, bottom, top),
      () => e.fdtd_step(params, ez, mask, ez, hx, hy, left, right, bottom, top),
      () => e.fdtd_step(params, eps, ez, ez, hx, hy, left, right, bottom, top),
      () => e.fdtd_step(params, eps, mask, ez, ez, hy, left, right, bottom, top),
      () => e.fdtd_step(params, eps, mask, ez, hx, hx, left, right, bottom, top),
      () => e.fdtd_step(params, eps, mask, ez, hx, hy, left, left, bottom, top),
      () => e.fdtd_step(params, eps, mask, ez, hx, hy, left, right, bottom, bottom),
      () => e.fdtd_step(params, eps, mask, ez, hx, hy, params, right, bottom, top),
      () => e.fdtd_step(params, eps + 1, mask, ez, hx, hy, left, right, bottom, top),
      () => e.fdtd_step(params, eps, mask, ez + 1, hx, hy, left, right, bottom, top),
      () => e.fdtd_step(params, eps, end - 10, ez, hx, hy, left, right, bottom, top),
      () => e.fdtd_step(params, eps, mask, ez, hx, hy, left, right, bottom, end - 4),
      () => e.fdtd_step(params, 0, mask, ez, hx, hy, left, right, bottom, top),
      () => energy(ez),
      () => energy(out + 4),
      () => energy(0),
      () => energy(end - 4),
      () => e.fdtd_energy(0, eps, ez, hx, hy, out),
      () => e.fdtd_source(ez + 1, nx, ny, 1, 1, .5),
      () => e.fdtd_source(0, nx, ny, 1, 1, .5),
      () => e.fdtd_source(end - 4, nx, ny, 1, 1, .5),
    ]) {
      assert.equal(call(), 2);
      assert.deepEqual(Buffer.from(memory.slice(base)), before, 'memory rejection precedes caller-memory writes');
    }
    for (const [mutate, restore, code] of [
      [() => p.setUint32(12, 1, true), () => p.setUint32(12, 0, true), 7],
      [() => p.setUint32(8, 2, true), () => p.setUint32(8, 0, true), 6],
      [() => p.setUint32(0, 2, true), () => p.setUint32(0, nx, true), 1],
      [() => { p.setUint32(0, 0xffffffff, true); p.setUint32(4, 0xffffffff, true); }, setParams, 1],
      [() => p.setFloat64(16, NaN, true), () => p.setFloat64(16, .25, true), 3],
      [() => p.setFloat64(16, 2, true), () => p.setFloat64(16, .25, true), 3],
      [() => p.setFloat64(24, 0, true), () => p.setFloat64(24, 1.5, true), 3],
    ]) {
      mutate();
      const mutated = Buffer.from(memory.slice(base));
      assert.equal(step(), code);
      assert.equal(energy(), code);
      assert.deepEqual(Buffer.from(memory.slice(base)), mutated, 'parameter rejection precedes caller-memory writes');
      restore();
    }
    const mutateField = (index, bad, call, code) => {
      const keep = F[index];
      F[index] = bad;
      const mutated = Buffer.from(memory.slice(base));
      assert.equal(call(), code);
      assert.deepEqual(Buffer.from(memory.slice(base)), mutated, 'kernel rejection precedes caller-memory writes');
      F[index] = keep;
    };
    mutateField(eps / 4, 0, step, 3);
    mutateField(eps / 4, NaN, step, 3);
    mutateField(eps / 4, .001, step, 3);
    mutateField(hx / 4, NaN, step, 4);
    mutateField(left / 4, Infinity, step, 4);
    mutateField(eps / 4 + 3, -1, energy, 3);
    mutateField(hy / 4 + 1, NaN, energy, 4);
    for (const [call, code] of [
      [() => e.fdtd_source(ez, 0, ny, 0, 0, 1), 1],
      [() => e.fdtd_source(ez, nx, ny, nx, 0, 1), 1],
      [() => e.fdtd_source(ez, nx, ny, 0, ny, 1), 1],
      [() => e.fdtd_source(ez, nx, ny, 0, 0, NaN), 4],
      [() => e.fdtd_source(ez, nx, ny, 0, 0, Infinity), 4],
    ]) {
      assert.equal(call(), code);
      assert.deepEqual(Buffer.from(memory.slice(base)), before, 'source rejection precedes caller-memory writes');
    }
    assert.equal(e.fdtd_step(params, eps, 0, ez, hx, hy, left, right, bottom, top), 0, 'mask is optional');
    assert.equal(step(), 0, 'valid call still succeeds after rejections');
    assert.equal(energy(), 0);
  }
  console.log(`FDTD: ${cases.length} cases native/WASM exact — Mur/PEC stepping with PEC masks and histories at the CFL bound, soft-source deposits and sampled energy through every kernel rejection including mid-sweep overflow; ABI alias/bounds checks pass.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
