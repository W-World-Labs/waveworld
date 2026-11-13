// Real shared MAC momentum, projection and P-Q composition; no long integrations.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'w-sim-mac-step-'));
const generated = readFileSync(join(root, 'packages/solvers-lbm/src/wasm-kernel.ts'), 'utf8');
const module = new WebAssembly.Module(Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1], 'base64'));
assert.deepEqual(WebAssembly.Module.imports(module), []);
const floatBytes = values => { const b = Buffer.alloc(values.length * 8); values.forEach((v, i) => b.writeDoubleLE(v, i * 8)); return b; };
const near = (got, want, name, tol = 2e-10) => assert(Math.abs(got - want) < tol, `${name}: ${got} vs ${want}`);

function sample(name, dims, open, h = .1, dt = .001, rho = 1.225, nu = 1.81e-5 / 1.225) {
  const [nx, ny, nz] = dims, config = Buffer.alloc(96);
  [...dims, open, 500].forEach((v, i) => config.writeUInt32LE(v, i * 4));
  [h, dt, rho, 1e-9, 0, nu, 0, 0, 0].forEach((v, i) => config.writeDoubleLE(v, 24 + i * 8));
  const counts = [(nx + 1) * ny * nz, nx * (ny + 1) * nz, nx * ny * (nz + 1)];
  return { name, dims, config, counts, flags: Buffer.alloc(nx * ny * nz),
    current: counts.map(n => Array(n).fill(0)), acceleration: counts.map(n => Array(n).fill(0)), steps: 1, fan: false };
}

function load(c) {
  const e = new WebAssembly.Instance(module).exports;
  assert.equal(e.abi_version(), 11);
  let at = Math.ceil(e.heap_base() / 8) * 8;
  const alloc = bytes => { const p = at; at = Math.ceil((at + bytes) / 8) * 8; return p; };
  const n = c.flags.length, cp = alloc(96), table = alloc(52), flags = alloc(n);
  const initial = c.counts.map(n => alloc(n * 8)), accel = c.counts.map(n => alloc(n * 8)), destination = c.counts.map(n => alloc(n * 8));
  const pressure = alloc(n * 8), work = alloc(n * 48), topology = alloc(n * 8), stats = alloc(168);
  const curve = alloc(32), fanOutput = alloc(8);
  if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
  const memory = new Uint8Array(e.memory.buffer), view = new DataView(e.memory.buffer);
  let current = initial.slice(), next = destination.slice();
  const field = (p, count) => new Float64Array(e.memory.buffer, p, count);
  const tablePointers = () => [flags, ...current, ...accel, ...next, pressure, work, topology];
  const fillTable = () => tablePointers().forEach((p, i) => view.setUint32(table + 4 * i, p, true));
  function reset() {
    current = initial.slice(); next = destination.slice();
    memory.set(c.config, cp); memory.set(c.flags, flags); fillTable();
    c.current.forEach((f, i) => memory.set(floatBytes(f), current[i]));
    c.acceleration.forEach((f, i) => memory.set(floatBytes(f), accel[i]));
    next.forEach((p, i) => field(p, c.counts[i]).fill(NaN));
    field(pressure, n).fill(NaN); field(work, 6 * n).fill(NaN);
    new Uint32Array(e.memory.buffer, topology, 2 * n).fill(0xffffffff);
    memory.fill(0xa5, stats, stats + 168);
    memory.set(floatBytes([0, 20, .01, 0]), curve);
  }
  const readOutput = () => Buffer.concat([...next, pressure].map((p, i) => Buffer.from(memory.slice(p, p + (i < 3 ? c.counts[i] : n) * 8))));
  const readInputs = () => Buffer.concat([
    Buffer.from(memory.slice(cp, cp + 96)), Buffer.from(memory.slice(table, table + 52)), Buffer.from(memory.slice(flags, flags + n)),
    ...[...current, ...accel].map((p, i) => Buffer.from(memory.slice(p, p + c.counts[i % 3] * 8))),
  ]);
  function updateFan(step) {
    if (!c.fan) return [0, 0];
    accel.forEach((p, i) => field(p, c.counts[i]).fill(0));
    const [nx, ny, nz] = c.dims, dx = view.getFloat64(cp + 24, true), rho = view.getFloat64(cp + 40, true);
    let q = 0, dp = 0;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) q += field(current[0], c.counts[0])[Math.floor(nx / 2) + (nx + 1) * (y + ny * z)] * dx * dx;
    if (step < 2) {
      assert.equal(e.fan_curve_pressure(curve, 2, q, 1, fanOutput), 0);
      dp = view.getFloat64(fanOutput, true);
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) field(accel[0], c.counts[0])[Math.floor(nx / 2) + (nx + 1) * (y + ny * z)] = dp / (rho * dx);
    }
    return [q, dp];
  }
  reset();
  return { e, cp, table, flags, stats, pressure, view, memory, field, reset, readInputs, readOutput, tablePointers, updateFan,
    nextFields: () => next.map((p, i) => field(p, c.counts[i])),
    swap: () => { [current, next] = [next, current]; fillTable(); },
    run: () => e.mac_step(cp, table, stats) };
}

// ABI-only checks use one 3^3 grid; rejected calls never advance physics.
function checkMacAdapters() {
  const e = new WebAssembly.Instance(module).exports;
  let end = Math.ceil(e.heap_base() / 8) * 8;
  const sizes = { config: 64, fanTable: 28, sampleTable: 28, flags: 27,
    u: 288, v: 288, w: 288, au: 288, av: 288, aw: 288,
    disks: 56, points: 32, fanOutput: 40, pressure: 216, temperature: 216,
    display: 540, speed: 8 };
  const base = Object.fromEntries(Object.entries(sizes).map(([key, bytes]) => {
    const p = end; end = Math.ceil((end + bytes + 16) / 8) * 8; return [key, p];
  }));
  if (end > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((end - e.memory.buffer.byteLength) / 65536));
  const memory = new Uint8Array(e.memory.buffer), view = new DataView(e.memory.buffer);
  const doubles = (p, values) => values.forEach((v, i) => view.setFloat64(p + 8 * i, v, true));
  const words = (p, values) => values.forEach((v, i) => view.setUint32(p + 4 * i, v, true));
  const field = (key, count) => new Float64Array(e.memory.buffer, base[key], count);
  const reset = () => {
    memory.fill(0, base.config, end);
    words(base.config, [3, 3, 3, 63, 20, 0]); doubles(base.config + 24, [1, .01, 2, 1e-9, 0]);
    words(base.disks, [0, 1]); doubles(base.disks + 8, [1.4, 1.5, 1.5, .6, 1]);
    words(base.disks + 48, [0, 2]); doubles(base.points, [0, 10, 1, 0]);
    ['u', 'v', 'w'].forEach((key, i) => field(key, 36).fill([.25, .5, .75][i]));
    ['au', 'av', 'aw'].forEach(key => field(key, 36).fill(123));
    field('pressure', 27).fill(3); field('temperature', 27).fill(5); field('speed', 1).fill(9876);
    memory.fill(0xa5, base.fanOutput, base.fanOutput + 40);
    memory.fill(0xa5, base.display, base.display + 540);
  };
  const fanKeys = ['config', 'fanTable', 'flags', 'u', 'v', 'w', 'au', 'av', 'aw', 'disks', 'points', 'fanOutput'];
  const sampleKeys = ['config', 'sampleTable', 'flags', 'u', 'v', 'w', 'pressure', 'temperature', 'display', 'speed'];
  const tables = p => {
    words(base.fanTable, ['flags', 'u', 'v', 'w', 'au', 'av', 'aw'].map(key => p[key]));
    words(base.sampleTable, ['flags', 'u', 'v', 'w', 'pressure', 'temperature', 'display'].map(key => p[key]));
  };
  const fan = (p = base, count = 1, points = 2) => e.mac_fans(p.config, p.disks, count, p.points, points, p.fanTable, p.fanOutput);
  const sample = (p = base, thermal = 1) => e.mac_sample(p.config, p.sampleTable, thermal, 20, p.speed);
  // Below heap_base the module owns its stack, which may change even on rejection.
  const bytes = () => memory.slice(base.config);
  const unchanged = (before, label) => assert.deepEqual(memory.subarray(base.config), before, `${label}: rejection must precede caller-memory writes`);
  const readonly = keys => Buffer.concat(keys.map(key => Buffer.from(memory.slice(base[key], base[key] + sizes[key]))));
  reset(); tables(base);
  const fanReadonly = ['config', 'fanTable', 'flags', 'u', 'v', 'w', 'disks', 'points'];
  let before = readonly(fanReadonly);
  assert.equal(fan(), 0); assert.deepEqual(readonly(fanReadonly), before, 'fan immutable inputs');
  assert.deepEqual(Array.from(new Uint32Array(e.memory.buffer, base.fanOutput, 2)), [1, 1], '56B disk/40B result layout');
  assert.deepEqual(Array.from(new Float64Array(e.memory.buffer, base.fanOutput + 8, 4)), [1, .25, 7.5, 7.5]);
  ['au', 'av', 'aw'].forEach(key => field(key, 36).forEach((v, i) => assert.equal(v, key === 'au' && i === 17 ? 3.75 : 0)));
  const sampleReadonly = ['config', 'sampleTable', 'flags', 'u', 'v', 'w', 'pressure', 'temperature'];
  before = readonly(sampleReadonly);
  assert.equal(sample(), 0); assert.deepEqual(readonly(sampleReadonly), before, 'sampling immutable inputs');
  const display = new Float32Array(e.memory.buffer, base.display, 135);
  for (let i = 0; i < 27; i++) assert.deepEqual(Array.from(display.subarray(i * 5, i * 5 + 5)), [.25, .5, .75, 3, 25]);
  near(field('speed', 1)[0], Math.sqrt(.875), 'f64 SI maximum speed', 1e-15);

  for (const [keys, invoke, tableKey] of [[fanKeys, fan, 'fanTable'], [sampleKeys, sample, 'sampleTable']]) {
    for (const key of keys) {
      const alignment = key === 'flags' ? 1 : key === tableKey || key === 'display' ? 4 : 8;
      for (const address of [0, e.heap_base() - 8, e.memory.buffer.byteLength,
        ...(sizes[key] > alignment ? [e.memory.buffer.byteLength - alignment] : []),
        ...(alignment > 1 ? [base[key] + alignment / 2] : [])]) {
        reset(); const p = { ...base, [key]: address }; tables(p); const before = bytes();
        assert.equal(invoke(p), 2, `${tableKey} invalid region ${key}@${address}`); unchanged(before, key);
      }
    }
    // Config/table contents have already been read by the ABI. All data regions
    // must still be distinct, even two nominally readonly slices.
    const data = keys.filter(key => key !== 'config' && key !== tableKey);
    for (let a = 0; a < data.length; a++) for (let b = a + 1; b < data.length; b++) {
      reset(); const p = { ...base, [data[a]]: base[data[b]] }; tables(p); const before = bytes();
      assert.equal(invoke(p), 2, `${tableKey} alias ${data[a]}/${data[b]}`); unchanged(before, 'data alias');
    }
    for (const key of data) for (const target of ['config', tableKey]) {
      reset(); const p = { ...base, [key]: base[target] }; tables(p); const before = bytes();
      assert.equal(invoke(p), 2, `${tableKey} alias ${key}/${target}`); unchanged(before, 'control alias');
    }
    reset(); const p = { ...base, [tableKey]: base.config }; tables(p); const before = bytes();
    assert.equal(invoke(p), 2, 'config/table alias'); unchanged(before, 'config/table alias');
  }
  for (const [invoke, key, target, offset] of [[fan, 'au', 'u', 8], [fan, 'fanOutput', 'disks', 8],
    [sample, 'display', 'pressure', 4], [sample, 'speed', 'display', 8]]) {
    reset(); const p = { ...base, [key]: base[target] + offset }; tables(p); const before = bytes();
    assert.equal(invoke(p), 2, `partial overlap ${key}/${target}`); unchanged(before, 'partial overlap');
  }
  // The no-actuator path has explicit zero-only nullable descriptors/readouts.
  reset(); const empty = { ...base, disks: 0, points: 0, fanOutput: 0 }; tables(empty);
  assert.equal(fan(empty, 0, 0), 0);
  ['au', 'av', 'aw'].forEach(key => field(key, 36).forEach(v => assert.equal(v, 0)));
  for (const p of [{ ...empty, disks: base.disks }, { ...empty, fanOutput: base.fanOutput }, { ...empty, points: base.points }]) {
    reset(); tables(p); const before = bytes(); assert.equal(fan(p, 0, 0), 2); unchanged(before, 'non-null empty fan');
  }
  for (const [count, points] of [[0, 2], [17, 2], [1, 4097]]) {
    reset(); tables(base); const before = bytes(); assert.equal(fan(base, count, points), 2); unchanged(before, 'fan count bound');
  }
  reset(); const isothermal = { ...base, temperature: 0 }; tables(isothermal);
  assert.equal(sample(isothermal, 0), 0);
  assert.deepEqual(Array.from(new Float32Array(e.memory.buffer, base.display, 4)), [.25, .5, .75, 3]);
  for (const [p, thermal, status] of [[base, 0, 2], [isothermal, 1, 2], [base, 2, 6]]) {
    reset(); tables(p); const before = bytes(); assert.equal(sample(p, thermal), status); unchanged(before, 'temperature option');
  }
  reset(); tables(base); assert.equal(fan(), 0); assert.equal(sample(), 0, 'same memory reusable after invalid calls');
  console.log('MAC fan/sample ABI: tiny SI layout, immutable inputs, all data aliases, memory bounds/alignment and zero-only optional pointers passed.');
}

try {
  const lib = join(scratch, 'libw_sim_kernels.rlib'), native = join(scratch, 'reference');
  const rustc = args => execFileSync('rustc', args, { stdio: 'inherit', timeout: 60000 });
  rustc([join(root, 'crates/w-sim-kernels/src/lib.rs'), '--edition', '2021', '--crate-name', 'w_sim_kernels', '--crate-type', 'rlib', '-O', '-C', 'panic=abort', '-o', lib]);
  rustc([fileURLToPath(new URL('./mac-step-reference.rs', import.meta.url)), '--edition', '2021', '--extern', `w_sim_kernels=${lib}`, '-O', '-C', 'panic=abort', '-o', native]);
  const uniform = sample('uniform open flow', [3, 2, 2], 63);
  [1, .5, -.25].forEach((v, a) => { uniform.current[a].fill(v); uniform.config.writeDoubleLE(v, 72 + a * 8); });
  uniform.steps = 3;
  const circulation = sample('closed circulation', [2, 2, 1], 0, 1, .01, 1, .1);
  circulation.current[0][1] = 1; circulation.current[0][4] = -1;
  circulation.current[1][2] = -1; circulation.current[1][3] = 1;
  const corner = sample('staircase obstacle', [4, 3, 2], 63);
  corner.flags[5] = 1; corner.flags[22] = 20; corner.steps = 2;
  corner.acceleration.forEach((f, a) => f.forEach((_, i) => { f[i] = ((i + a * 3) % 5 - 2) / 10; }));
  const failure = { ...corner, name: 'projection nonconvergence', config: Buffer.from(corner.config), steps: 1 };
  failure.config.writeUInt32LE(1, 16);
  const cfl = sample('combined CFL failure', [3, 3, 3], 63, 1, 1, 1, .11);
  cfl.current[0].fill(.45); cfl.config.writeDoubleLE(.45, 72);
  const reservoir = sample('tangential reservoir', [1, 1, 1], 63, 1, .1, 1, 0);
  reservoir.current[0].fill(1); reservoir.config.writeDoubleLE(17, 72); reservoir.config.writeDoubleLE(2, 80);
  const fan = sample('fan P-Q coupled air duct', [5, 3, 3], 3, .01, 1e-4);
  fan.fan = true; fan.steps = 3;
  const cases = [uniform, circulation, corner, failure, cfl, reservoir, fan];
  for (const c of cases) {
    const header = Buffer.alloc(8); header.writeUInt32LE(c.steps, 0); header.writeUInt32LE(c.fan ? 1 : 0, 4);
    const input = join(scratch, 'input');
    writeFileSync(input, Buffer.concat([header, c.config, c.flags, ...c.current.map(floatBytes), ...c.acceleration.map(floatBytes)]));
    const expected = execFileSync(native, [input], { timeout: 10000, maxBuffer: 1024 * 1024 });
    const h = load(c), fieldBytes = (c.counts.reduce((a, b) => a + b, 0) + c.flags.length) * 8;
    let at = 0, previousFlow = 0;
    for (let step = 0; step < c.steps; step++) {
      const [flow, dp] = h.updateFan(step), before = h.readInputs(), code = h.run();
      assert.equal(code, expected.readUInt32LE(at), `${c.name}: native/WASM status`);
      assert.deepEqual(h.readInputs(), before, 'step preserves current fields, acceleration, config, flags and pointer table');
      assert.deepEqual(Buffer.from(h.memory.slice(h.stats, h.stats + 168)), expected.subarray(at + 4, at + 172), `${c.name}: exact diagnostics and impulses`);
      assert.deepEqual(floatBytes([flow, dp]), expected.subarray(at + 172, at + 188), 'exact P-Q coupled driver');
      assert.deepEqual(h.readOutput(), expected.subarray(at + 188, at + 188 + fieldBytes), `${c.name}: exact next velocity and pressure`);
      at += 188 + fieldBytes;
      if (c === cfl) {
        assert.equal(code, 10); near(h.view.getFloat64(h.stats + 48, true), .9, 'advection CFL');
        near(h.view.getFloat64(h.stats + 56, true), .66, 'diffusion CFL'); near(h.view.getFloat64(h.stats + 64, true), 1.56, 'combined CFL');
      } else if (c === failure) assert.equal(code, 9);
      else {
        assert.equal(code, 0, c.name);
        assert(h.view.getFloat64(h.stats + 24, true) <= c.config.readDoubleLE(48), 'hard divergence bound');
        if (c === uniform) h.nextFields().forEach((f, a) => f.forEach(v => near(v, [1, .5, -.25][a], 'uniform throughflow')));
        if (c === reservoir) h.nextFields().forEach((f, a) => f.forEach(v => near(v, [1, .2, 0][a], 'normal extrapolation and tangential donor')));
        if (c === fan) {
          if (step === 0) {
            const speed = 20 * 1e-4 / (1.225 * .05);
            h.nextFields()[0].forEach(v => near(v, speed, 'fan impulse/pressure analytic velocity', 1e-11));
            near(h.view.getFloat64(h.stats + 120, true), 20 * .0009 * 1e-4, 'body impulse', 1e-15);
          } else if (step === 1) { assert(flow > previousFlow); assert(dp > 0 && dp < 20); }
          else { assert.equal(dp, 0); assert.equal(h.view.getFloat64(h.stats + 120, true), 0); }
          previousFlow = flow;
        }
      }
      if (code !== 0) break;
      h.swap();
    }
    assert.equal(at, expected.length, 'complete native fixture consumed');
  }

  const h = load(corner), initialPointers = h.tablePointers();
  for (let i = 0; i < 13; i++) {
    h.view.setUint32(h.table + i * 4, 0, true); assert.equal(h.run(), 2, `null table pointer ${i}`); h.reset();
    h.view.setUint32(h.table + i * 4, h.e.memory.buffer.byteLength, true); assert.equal(h.run(), 2, `out-of-range table pointer ${i}`); h.reset();
  }
  for (const [a, b] of [[0, 1], [1, 4], [1, 7], [7, 8], [9, 10], [10, 11], [11, 12]]) {
    h.view.setUint32(h.table + a * 4, initialPointers[b], true); assert.equal(h.run(), 2, `alias ${a}/${b}`); h.reset();
  }
  for (const i of [1, 4, 7, 10, 11]) {
    h.view.setUint32(h.table + i * 4, initialPointers[i] + 4, true); assert.equal(h.run(), 2, `misaligned f64 ${i}`); h.reset();
  }
  for (const args of [[0, h.table, h.stats], [h.cp + 4, h.table, h.stats], [h.cp, h.table + 2, h.stats], [h.cp, h.table, h.stats + 4], [h.cp, h.table, h.cp], [h.cp, h.table, h.table]]) assert.equal(h.e.mac_step(...args), 2);
  h.view.setFloat64(h.cp + 64, -1, true); assert.equal(h.run(), 3); h.reset();
  h.view.setUint32(h.cp + 20, 1, true); assert.equal(h.run(), 7); h.reset();
  h.view.setFloat64(initialPointers[4], NaN, true); assert.equal(h.run(), 4); h.reset();
  h.view.setFloat64(initialPointers[1], 1, true); assert.equal(h.run(), 5, 'unprojected initial fields rejected'); h.reset();
  assert.equal(h.run(), 0, 'same memory remains usable after rejected calls');
  checkMacAdapters();
  console.log('MAC3D momentum: seven tiny native/WASM cases, 1–3 steps, exact fields/impulses/P-Q driver, half-volume boundaries, combined CFL and alias rejection passed.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
