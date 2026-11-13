// Native/WASM parity for the MAC SI cell-field sampler behind `mac_sample`:
// two-face cell averaging, solid/reservoir flag handling, relative-to-ambient
// temperature conversion and the f64 maximum-speed readout are compared
// byte-exact, including partially written display output after kernel-level
// errors. No JS duplicate of the model.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'w-sim-mac-fields-'));
const generated = readFileSync(join(root, 'packages/solvers-lbm/src/wasm-kernel.ts'), 'utf8');
const module = new WebAssembly.Module(Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1], 'base64'));
assert.deepEqual(WebAssembly.Module.imports(module), []);

const f64 = values => { const b = Buffer.alloc(8 * values.length); values.forEach((v, i) => b.writeDoubleLE(v, i * 8)); return b; };
const u32 = values => { const b = Buffer.alloc(4 * values.length); values.forEach((v, i) => b.writeUInt32LE(v, i * 4)); return b; };
const counts = ([nx, ny, nz]) => [(nx + 1) * ny * nz, nx * (ny + 1) * nz, nx * ny * (nz + 1)];
// Deterministic nonuniform fields; V and W cross zero.
const U = i => .1 + .02 * ((i * 7) % 13);
const V = i => .05 - .01 * ((i * 5) % 11);
const W = i => .02 * ((i * 3) % 9) - .08;
const P = i => 90 + 3 * i;
const T = i => -4 + .5 * ((i * 3) % 17);
const BASE = { dims: [4, 3, 2], open: 0, flags: {}, u: U, v: V, w: W, pressure: P, temperature: T, thermal: 1, ambient: 20, status: 0 };
const kase = (name, over) => ({ name, ...BASE, ...over });
const cases = [
  kase('thermal-material-mix', { flags: { 0: 1, 5: 2, 6: 3, 11: 4, 17: 5, 23: 20 } }),
  kase('isothermal-solids', { thermal: 0, flags: { 3: 1, 9: 1 } }),
  kase('signed-zero-faces', { u: i => (i % 2 ? -0 : 0), v: () => -0, w: () => 0 }),
  kase('subnormal-faces', { u: () => 5e-324, v: i => (i % 3 ? 1e-310 : 0), w: () => -5e-324 }),
  kase('open-boundary-solids', { open: 63, flags: { 0: 1, 1: 1, 22: 1, 23: 1 } }),
  kase('all-solid', { flags: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i, 1])) }),
  kase('single-cell-cold-ambient', { dims: [1, 1, 1], ambient: -200, temperature: () => 0 }),
  // The last cell's +x face sits at index 29 of the (5,3,2) u grid.
  kase('display-overflow-last-cell', { u: i => (i === 29 ? 1e308 : U(i)), status: 4 }),
  kase('face-sum-overflow', { u: i => (i >= 28 ? 1e308 : U(i)), status: 4 }),
  kase('nan-face', { u: i => (i === 10 ? NaN : U(i)), status: 4 }),
  kase('nan-pressure', { pressure: i => (i === 7 ? NaN : P(i)), status: 4 }),
  kase('nan-temperature', { temperature: i => (i === 3 ? NaN : T(i)), status: 4 }),
  kase('isothermal-material-flag', { thermal: 0, flags: { 4: 2 }, status: 6 }),
  kase('thermal-flag-21', { flags: { 2: 21 }, status: 6 }),
  kase('ambient-nan', { ambient: NaN, status: 3 }),
  kase('ambient-at-absolute-zero', { ambient: -273.15, status: 3 }),
  kase('cell-at-absolute-zero', { temperature: i => (i === 5 ? -293.15 : T(i)), status: 5 }),
  kase('temperature-sum-nonfinite', { ambient: 1e308, temperature: i => (i === 2 ? 1e308 : T(i)), status: 4 }),
  kase('temperature-display-overflow', { temperature: i => (i === 9 ? 1e39 : T(i)), status: 4 }),
  kase('huge-finite-temperature', { temperature: i => (i === 9 ? 3e38 : T(i)) }),
  kase('zero-depth', { dims: [4, 3, 0], status: 1 }),
  kase('unused-config-fields', { dx: NaN, dt: -7, rho: 0, absTol: -1, relTol: 2 }),
];

function pack(c) {
  const [nx, ny, nz] = c.dims, n = nx * ny * nz, cc = counts(c.dims);
  const cfg = Buffer.alloc(64);
  [...c.dims, c.open, 500, 0].forEach((v, i) => cfg.writeUInt32LE(v, 4 * i));
  [c.dx ?? .1, c.dt ?? .001, c.rho ?? 1.2, c.absTol ?? 1e-9, c.relTol ?? 0].forEach((v, i) => cfg.writeDoubleLE(v, 24 + 8 * i));
  const flags = Buffer.alloc(n);
  for (const [index, flag] of Object.entries(c.flags)) flags[index] = flag;
  const fields = [c.u, c.v, c.w].map((fn, a) => f64(Array.from({ length: cc[a] }, (_, i) => fn(i))));
  const pressure = f64(Array.from({ length: n }, (_, i) => c.pressure(i)));
  const temperature = c.thermal ? f64(Array.from({ length: n }, (_, i) => c.temperature(i))) : null;
  const input = Buffer.concat([
    u32([c.thermal]), cfg, f64([c.ambient]), flags, ...fields, pressure, ...(temperature ? [temperature] : []),
  ]);
  return { input, cfg, flags, fields, pressure, temperature, n, cc };
}

try {
  const lib = join(scratch, 'libw_sim_kernels.rlib'), native = join(scratch, 'mac-fields-reference'), file = join(scratch, 'input');
  const rustc = args => execFileSync('rustc', args, { stdio: 'inherit', timeout: 60000 });
  rustc([join(root, 'crates/w-sim-kernels/src/lib.rs'), '--edition', '2021', '--crate-name', 'w_sim_kernels', '--crate-type', 'rlib', '-O', '-C', 'panic=abort', '-o', lib]);
  rustc([fileURLToPath(new URL('./mac-fields-reference.rs', import.meta.url)), '--edition', '2021', '--extern', `w_sim_kernels=${lib}`, '-O', '-C', 'panic=abort', '-o', native]);

  for (const c of cases) {
    const { input, cfg, flags, fields, pressure, temperature, n, cc } = pack(c);
    const e = new WebAssembly.Instance(module).exports;
    let at = Math.ceil(e.heap_base() / 8) * 8;
    const alloc = (bytes, align = 8) => { at = Math.ceil(at / align) * align; const p = at; at += bytes; return p; };
    const stride = 4 + c.thermal;
    const cp = alloc(64), table = alloc(28, 4), flagsPtr = alloc(n, 1);
    const [u, v, w] = cc.map(len => alloc(len * 8));
    const pressurePtr = alloc(n * 8), temperaturePtr = c.thermal ? alloc(n * 8) : 0;
    const display = alloc(n * stride * 4, 4), speed = alloc(8);
    if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
    const memory = new Uint8Array(e.memory.buffer), view = new DataView(e.memory.buffer);
    memory.set(cfg, cp); memory.set(flags, flagsPtr);
    fields.forEach((b, a) => memory.set(b, [u, v, w][a]));
    memory.set(pressure, pressurePtr);
    if (temperature) memory.set(temperature, temperaturePtr);
    memory.fill(0xa5, display, display + n * stride * 4);
    memory.fill(0xa5, speed, speed + 8);
    [flagsPtr, u, v, w, pressurePtr, temperaturePtr, display].forEach((p, i) => view.setUint32(table + 4 * i, p, true));
    const status = e.mac_sample(cp, table, c.thermal, c.ambient, speed);
    assert.equal(status, c.status, c.name);
    const got = Buffer.concat([
      u32([status]),
      Buffer.from(memory.slice(speed, speed + 8)),
      Buffer.from(memory.slice(display, display + n * stride * 4)),
    ]);
    writeFileSync(file, input);
    assert.deepEqual(got, execFileSync(native, [file], { timeout: 10000 }), `${c.name}: status/max-speed/display native/WASM bytes`);
  }

  // ABI-level rejections must leave every caller byte untouched.
  {
    const c = cases[0], { cfg, flags, fields, pressure, temperature, n, cc } = pack(c);
    const e = new WebAssembly.Instance(module).exports;
    let at = Math.ceil(e.heap_base() / 8) * 8;
    const alloc = (bytes, align = 8) => { at = Math.ceil(at / align) * align; const p = at; at += bytes; return p; };
    const cp = alloc(64), table = alloc(28, 4), flagsPtr = alloc(n, 1);
    const [u, v, w] = cc.map(len => alloc(len * 8));
    const pressurePtr = alloc(n * 8), temperaturePtr = alloc(n * 8), display = alloc(n * 5 * 4, 4), speed = alloc(8);
    if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
    const memory = new Uint8Array(e.memory.buffer), view = new DataView(e.memory.buffer);
    memory.set(cfg, cp); memory.set(flags, flagsPtr);
    fields.forEach((b, a) => memory.set(b, [u, v, w][a]));
    memory.set(pressure, pressurePtr); memory.set(temperature, temperaturePtr);
    [flagsPtr, u, v, w, pressurePtr, temperaturePtr, display].forEach((p, i) => view.setUint32(table + 4 * i, p, true));
    const run = (config = cp, tab = table, thermal = 1, ambient = 20, out = speed) => e.mac_sample(config, tab, thermal, ambient, out);
    assert.equal(run(), 0);
    const before = Buffer.from(memory.slice(cp));
    const unchanged = () => assert.deepEqual(Buffer.from(memory.slice(cp)), before, 'rejection precedes caller-memory writes');
    for (const [call, want] of [
      [() => run(cp, table, 2), 6], [() => run(cp, table, 0xffffffff), 6],
      [() => run(0), 2], [() => run(cp + 4), 2], [() => run(e.heap_base() - 8), 2],
      [() => run(e.memory.buffer.byteLength - 32), 2],
      [() => run(cp, 0), 2], [() => run(cp, table + 2), 2], [() => run(cp, table + 4), 2],
      [() => run(cp, table, 1, 20, 0), 2], [() => run(cp, table, 1, 20, speed + 4), 2],
      [() => run(cp, table, 1, 20, e.memory.buffer.byteLength - 4), 2],
      [() => run(cp, table, 1, 20, flagsPtr), 2], [() => run(cp, table, 1, 20, display), 2],
      [() => run(cp, table, 1, 20, cp), 2], [() => run(cp, table, 1, 20, table), 2],
    ]) {
      assert.equal(call(), want);
      unchanged();
    }
    // Pointer-table entries: null, misaligned, out-of-bounds and overlapping.
    // The snapshot follows the intentional mutation: only the call's own
    // writes would move memory.
    const entry = (i, p, want = 2) => {
      const old = view.getUint32(table + 4 * i, true);
      view.setUint32(table + 4 * i, p, true);
      const mutated = Buffer.from(memory.slice(cp));
      assert.equal(run(), want, `table[${i}]=${p}`);
      assert.deepEqual(Buffer.from(memory.slice(cp)), mutated, 'rejection precedes caller-memory writes');
      view.setUint32(table + 4 * i, old, true);
    };
    for (const p of [0, e.heap_base() - 1, e.memory.buffer.byteLength, u]) entry(0, p);
    for (const p of [0, u + 4, e.memory.buffer.byteLength - 8, flagsPtr, pressurePtr]) entry(1, p);
    for (const p of [v + 4, e.memory.buffer.byteLength - 8, w]) entry(2, p);
    entry(3, 0); entry(3, w + 4); entry(3, u);
    for (const p of [0, pressurePtr + 4, display, u + 8]) entry(4, p);
    for (const p of [0, temperaturePtr + 4, display, pressurePtr + 8]) entry(5, p);
    for (const p of [0, display + 2, e.memory.buffer.byteLength - 2 * n, speed, pressurePtr + 4]) entry(6, p);
    // The temperature slot is exactly zero iff thermal=0.
    const old5 = view.getUint32(table + 20, true);
    view.setUint32(table + 20, temperaturePtr, true);
    const nonnull = Buffer.from(memory.slice(cp));
    assert.equal(run(cp, table, 0), 2);
    assert.deepEqual(Buffer.from(memory.slice(cp)), nonnull, 'isothermal call rejects a temperature pointer');
    view.setUint32(table + 20, 0, true);
    const isoFlags = Buffer.alloc(n);
    isoFlags[0] = 1;
    memory.set(isoFlags, flagsPtr);
    assert.equal(run(cp, table, 0), 0, 'isothermal run without temperature buffer');
    memory.set(flags, flagsPtr);
    view.setUint32(table + 20, old5, true);
    // Reserved/unsupported config words are rejected before any table access.
    const config = (offset, value, want) => {
      const old = view.getUint32(cp + offset, true);
      view.setUint32(cp + offset, value, true);
      const mutated = Buffer.from(memory.slice(cp));
      assert.equal(run(), want, `config+${offset}=${value}`);
      assert.deepEqual(Buffer.from(memory.slice(cp)), mutated, 'config rejection precedes caller-memory writes');
      view.setUint32(cp + offset, old, true);
    };
    config(20, 1, 7);
    config(12, 64, 7);
    config(8, 0, 1);
    assert.equal(run(), 0, 'same memory reusable after rejected calls');
    const stable = Buffer.from(memory.slice(display, display + n * 5 * 4));
    assert.equal(run(), 0);
    assert.deepEqual(Buffer.from(memory.slice(display, display + n * 5 * 4)), stable, 'deterministic rerun');
    assert.equal(view.getFloat64(speed, true) > 0, true, 'maximum speed readout written');
  }
  console.log(`MAC fields: ${cases.length} cases native/WASM exact — thermal/isothermal strides, material flags, signed zeros, subnormals, absolute-zero and f32-overflow partial writes, sentinel max-speed through every kernel rejection; ABI thermal/alias/bounds checks pass.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
