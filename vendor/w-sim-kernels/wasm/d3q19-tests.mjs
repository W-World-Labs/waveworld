// Native/WASM parity for the D3Q19 BGK solver behind `d3q19_init`,
// `d3q19_step` and `d3q19_display`: the 1888-byte parameter blob is decoded
// once per side, then init, indexed steps with the 19-word stats readout and
// both display strides (speed+vorticity, +temperature, +pressure) are compared
// byte-exact on evolved and fully supplied state, including partial writes and
// sentinel bytes after kernel-level errors. No JS duplicate of the
// collide/stream/boundary rules.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'w-sim-d3q19-'));
const generated = readFileSync(join(root, 'packages/solvers-lbm/src/wasm-kernel.ts'), 'utf8');
const module = new WebAssembly.Module(Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1], 'base64'));
assert.deepEqual(WebAssembly.Module.imports(module), []);

const u32 = values => { const b = Buffer.alloc(4 * values.length); values.forEach((v, i) => b.writeUInt32LE(v, i * 4)); return b; };
const f32 = values => { const b = Buffer.alloc(4 * values.length); values.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };
const f64 = values => { const b = Buffer.alloc(8 * values.length); values.forEach((v, i) => b.writeDoubleLE(v, i * 8)); return b; };
const flags3 = (dims, fn) => {
  const [nx, ny] = dims;
  return Array.from({ length: nx * ny * dims[2] }, (_, i) => fn(i % nx, ((i / nx) | 0) % ny, (i / (nx * ny)) | 0));
};
const vectors3 = (dims, fn) => flags3(dims, fn).flat();
const W = [1 / 3, ...Array(6).fill(1 / 18), ...Array(12).fill(1 / 36)];
// Rest-state populations at a per-cell density; u=0 keeps moments trivially in range.
const equilibrium = (count, rho) => f32(Array.from({ length: count * 19 }, (_, i) => W[i % 19] * rho((i / 19) | 0)));

// The 1888-byte ABI parameter blob: u32 nx/ny/nz/boundary/free_slip/fan_enabled,
// f64 tau/u_inlet/smagorinsky/turbulence, u32 version/thermal_enabled, the fan
// record, 112 bytes of thermal scalars, u32 material_count/ground_enabled,
// f64 ground_velocity, 16 material slots, contact mask/reserved/resistance.
function params(c) {
  const b = Buffer.alloc(1888);
  const u = (o, v) => b.writeUInt32LE(v, o);
  const d = (o, v) => b.writeDoubleLE(v, o);
  const [nx, ny, nz] = c.dims ?? [5, 4, 3];
  u(0, nx); u(4, ny); u(8, nz);
  u(12, c.boundary ?? 0); u(16, c.slip ?? 0); u(20, c.fanEnabled ?? (c.fan ? 1 : 0));
  d(24, c.tau ?? .8); d(32, c.u ?? .04); d(40, c.smag ?? 0); d(48, c.turb ?? 0);
  u(56, c.version ?? 11); u(60, c.thermalEnabled ?? (c.thermal ? 1 : 0));
  if (c.fan) {
    c.fan.center.forEach((v, i) => d(64 + 8 * i, v));
    d(88, c.fan.radius);
    c.fan.normal.forEach((v, i) => d(96 + 8 * i, v));
    d(120, c.fan.accel);
  }
  if (c.thermal) {
    const t = c.thermal;
    [t.gravity ?? 0, t.dt ?? .01, t.ambient ?? 25, t.fixed ?? 0, t.dx ?? .1,
      t.rho ?? 1, t.cp ?? 10, t.k ?? .01, t.solidRho ?? 0, t.solidCp ?? 0,
      t.solidK ?? 0, t.power ?? 0].forEach((v, i) => d(128 + 8 * i, v));
    u(224, t.mode ?? 0); u(228, t.substeps ?? 128); d(232, t.scale ?? 1);
  }
  u(240, c.materialCount ?? c.materials?.length ?? 0);
  u(244, c.groundEnabled ?? (c.ground != null ? 1 : 0));
  d(248, c.ground ?? 0);
  (c.materials ?? []).forEach((m, i) => m.forEach((v, j) => d(256 + 32 * i + 8 * j, v)));
  (c.contactMask ?? []).forEach((v, i) => u(768 + 4 * i, v));
  (c.contactResistance ?? []).forEach(([i, v]) => d(800 + 8 * i, v));
  for (const [o, kind, v] of c.patch ?? []) (kind === 'u32' ? u : d)(o, v);
  return b;
}

const POWER = { gravity: .001, mode: 1, solidRho: 2, solidCp: 20, solidK: .1, power: .2 };
const FIXED = { mode: 0, fixed: 35 };
const FAN = { center: [2.5, 2, 1.5], normal: [.6, .8, 0], radius: .5, accel: .001 };
const obstacle = flags3([5, 4, 3], (x, y, z) => x === 2 && y === 2 && z === 1 ? 1 : 0);
const still = f32(new Array(180).fill(0));
const rhoOf = (f, n) => f32(Array.from({ length: n }, (_, i) => {
  let s = 0;
  for (let q = 0; q < 19; q++) s += f.readFloatLE((i * 19 + q) * 4);
  return s;
}));

const cases = [
  // op0: init, indexed steps, then display without and with the pressure field.
  { op: 0, name: 'wind-tunnel-obstacle', flags: obstacle, turb: .01, smag: .12, steps: 5 },
  { op: 0, name: 'periodic-obstacle', boundary: 1, flags: obstacle, steps: 4 },
  { op: 0, name: 'closed-box', boundary: 2, u: .03, steps: 4 },
  { op: 0, name: 'free-slip-walls', slip: 1, steps: 4 },
  { op: 0, name: 'ground-moving', slip: 1, ground: .02, steps: 4 },
  { op: 0, name: 'fan-rotated', u: 0, flags: obstacle, fan: FAN, steps: 5 },
  { op: 0, name: 'turbulent-inlet', turb: .3, u: .05, steps: 6 },
  { op: 0, name: 'tau-near-limit', tau: .51, steps: 2 },
  { op: 0, name: 'thermal-power', thermal: POWER,
    flags: flags3([5, 4, 3], (x, y, z) => x === 2 && y === 2 && z === 1 ? 4 : 0), steps: 3 },
  { op: 0, name: 'thermal-fixed-wall', thermal: FIXED,
    flags: flags3([5, 4, 3], (x, y, z) => x === 2 && y === 2 && z === 1 ? 2 : 0), steps: 3 },
  { op: 0, name: 'thermal-regions-contact', thermal: POWER,
    materials: [[4, 5, .2, .3], [3, 30, .05, 0]],
    contactMask: [5, 0, 0, 0, 0], contactResistance: [[0, .5], [2, 2]],
    flags: flags3([5, 4, 3], (x, y, z) => x === 2 && y === 2 && z === 1 ? 4 : y === 2 && z === 1 && x === 3 ? 5 : y === 2 && z === 1 && x === 4 ? 6 : 0),
    steps: 3 },
  // op0 init rejections: ABI decode, then dimension/coefficient/state checks.
  { op: 0, name: 'dims-too-small', dims: [2, 4, 3], steps: 1 },
  { op: 0, name: 'dims-zero', dims: [5, 0, 3], steps: 1 },
  { op: 0, name: 'tau-half', tau: .5, steps: 1 },
  { op: 0, name: 'tau-nan', tau: NaN, steps: 1 },
  { op: 0, name: 'smag-over', smag: .31, steps: 1 },
  { op: 0, name: 'turb-over', turb: 1.5, steps: 1 },
  { op: 0, name: 'inlet-supersonic', u: .25, steps: 1 },
  { op: 0, name: 'slip-on-periodic', boundary: 1, slip: 1, steps: 1 },
  { op: 0, name: 'turb-on-closed', boundary: 2, turb: .1, steps: 1 },
  { op: 0, name: 'ground-on-closed', boundary: 2, ground: .02, steps: 1 },
  { op: 0, name: 'bad-boundary', boundary: 3, steps: 1 },
  { op: 0, name: 'bad-slip', slip: 2, steps: 1 },
  { op: 0, name: 'thermal-flag-without-model',
    flags: flags3([5, 4, 3], (x, y, z) => x === 2 && y === 2 && z === 1 ? 2 : 0), steps: 1 },
  { op: 0, name: 'all-solid', flags: flags3([5, 4, 3], () => 1), steps: 1 },
  { op: 0, name: 'inlet-obstructed', flags: flags3([5, 4, 3], x => x === 1 ? 1 : 0), steps: 1 },
  { op: 0, name: 'fan-disabled-nonzero', fanEnabled: 0, fan: FAN, steps: 1 },
  { op: 0, name: 'fan-bad-enabled', fanEnabled: 2, steps: 1 },
  { op: 0, name: 'fan-off-grid', fan: { ...FAN, center: [.5, 2, 1.5] }, steps: 1 },
  { op: 0, name: 'fan-no-fluid', fan: FAN,
    flags: flags3([5, 4, 3], (x, y, z) => x === 2 && z === 1 ? 1 : 0), steps: 1 },
  { op: 0, name: 'version-mismatch', version: 10, steps: 1 },
  { op: 0, name: 'material-over', materialCount: 17, steps: 1 },
  { op: 0, name: 'material-without-power', materials: [[1, 1, 1, 0]], steps: 1 },
  { op: 0, name: 'contact-reserved-nonzero', patch: [[788, 'u32', 1]], steps: 1 },
  { op: 0, name: 'contact-resistance-unmasked', contactResistance: [[0, .5]], steps: 1 },
  { op: 0, name: 'thermal-bytes-reserved', patch: [[128, 'f64', .5]], steps: 1 },
  { op: 0, name: 'thermal-bad-enabled', thermalEnabled: 2, steps: 1 },
  { op: 0, name: 'thermal-bad-mode', thermal: { ...POWER, mode: 5 }, steps: 1 },
  { op: 0, name: 'ground-bad-enabled', groundEnabled: 2, steps: 1 },
  { op: 0, name: 'ground-disabled-nonzero', groundEnabled: 0, patch: [[248, 'f64', .01]], steps: 1 },
  { op: 0, name: 'ground-speed-high', slip: 1, ground: .2, steps: 1 },
  { op: 0, name: 'thermal-missing-buffers', thermalEnabled: 1, th: 0, steps: 1 },
  { op: 0, name: 'thermal-extra-buffers', thermalEnabled: 0, th: 1, steps: 1 },
  // op1: display on fully supplied velocity/flags/populations/temperature.
  { op: 1, name: 'display-shear-pressure', flags: obstacle,
    velocity: f32(vectors3([5, 4, 3], (x, y) => [.04 * (y % 2) + .002 * x, .001 * x, -.001 * y])),
    populations: equilibrium(60, i => 1 + ((i * 7) % 13) * .001) },
  { op: 1, name: 'display-velocity-only', flags: obstacle,
    velocity: f32(vectors3([5, 4, 3], (x, y, z) => [.01 * ((x + 2 * y + 3 * z) % 5) - .02, .005 * x, -.003 * z])) },
  { op: 1, name: 'display-thermal-pressure', thermal: FIXED,
    flags: flags3([5, 4, 3], (x, y, z) => x === 2 && y === 2 && z === 1 ? 2 : 0),
    velocity: f32(vectors3([5, 4, 3], x => [.03, .001 * x, 0])),
    temperature: f64(flags3([5, 4, 3], (x, y, z) => x === 2 && y === 2 && z === 1 ? 10 : .1 * x)),
    populations: equilibrium(60, () => 1) },
  { op: 1, name: 'display-nan-velocity', flags: obstacle,
    velocity: (() => { const v = vectors3([5, 4, 3], () => [0, 0, 0]); v[41] = NaN; return f32(v); })(),
    populations: equilibrium(60, () => 1) },
  { op: 1, name: 'display-nan-population', flags: obstacle, velocity: still,
    populations: (() => { const p = equilibrium(60, () => 1); p.writeFloatLE(NaN, 100 * 4); return p; })() },
  { op: 1, name: 'display-nan-temperature', thermal: FIXED,
    flags: flags3([5, 4, 3], (x, y, z) => x === 2 && y === 2 && z === 1 ? 2 : 0),
    velocity: still,
    temperature: (() => { const t = new Array(60).fill(0); t[10] = NaN; return f64(t); })() },
  { op: 1, name: 'display-bad-flag', velocity: still,
    flags: flags3([5, 4, 3], (x, y, z) => x === 2 && y === 2 && z === 1 ? 3 : 0) },
  { op: 1, name: 'display-dims-bad', dims: [2, 4, 3], flags: new Array(27).fill(0),
    velocity: f32(new Array(81).fill(0)), displayFloats: 54 },
  // op2: indexed steps on fully supplied state.
  { op: 2, name: 'step-supplied-state', flags: obstacle, steps: 3,
    f: equilibrium(60, i => 1 + ((i * 7) % 13) * .001) },
  { op: 2, name: 'step-nonfinite', flags: obstacle, steps: 1,
    f: (() => { const p = equilibrium(60, () => 1); p.writeFloatLE(NaN, 0); return p; })() },
  { op: 2, name: 'step-supersonic', steps: 1,
    f: (() => { const p = equilibrium(60, () => 0); for (let i = 0; i < 60; i++) p.writeFloatLE(1, (i * 19 + 1) * 4); return p; })() },
  { op: 2, name: 'step-zero-density', f: equilibrium(60, () => 0), steps: 1 },
];

function pack(c) {
  const dims = c.dims ?? [5, 4, 3];
  const n = dims.every(v => v >= 3) ? dims[0] * dims[1] * dims[2] : 27;
  const th = c.th ?? (c.thermal ? 1 : 0);
  const flags = Buffer.from(c.flags ?? new Array(n).fill(0));
  const head = Buffer.alloc(12);
  head.writeUInt32LE(c.op, 0); head.writeUInt32LE(n, 4); head.writeUInt32LE(th, 8);
  const parts = [head, params(c), flags];
  if (c.op === 0) {
    parts.push(u32([c.steps]));
  } else if (c.op === 1) {
    parts.push(c.velocity, u32([c.populations ? 1 : 0]));
    if (c.populations) parts.push(c.populations);
    parts.push(u32([c.temperature ? 1 : 0]));
    if (c.temperature) parts.push(c.temperature);
    parts.push(u32([c.displayFloats ?? n * (2 + th + (c.populations ? 1 : 0))]));
  } else {
    parts.push(c.f, c.post ?? Buffer.from(c.f), c.velocity ?? f32(new Array(3 * n).fill(0)),
      c.density ?? rhoOf(c.f, n));
    if (th) {
      for (const key of ['energy', 'nextEnergy', 'temperature', 'mass']) {
        parts.push(c[key] ?? f64(new Array(n).fill(key === 'mass' ? 1 : 0)));
      }
    }
    parts.push(u32([c.steps]));
  }
  return { input: Buffer.concat(parts), n, th };
}

try {
  const lib = join(scratch, 'libw_sim_kernels.rlib'), native = join(scratch, 'd3q19-reference'), file = join(scratch, 'input');
  execFileSync('rustc', [join(root, 'crates/w-sim-kernels/src/lib.rs'), '--edition', '2021', '--crate-name', 'w_sim_kernels', '--crate-type', 'rlib', '-O', '-C', 'panic=abort', '-o', lib], { stdio: 'inherit', timeout: 60000 });
  execFileSync('rustc', [fileURLToPath(new URL('./d3q19-reference.rs', import.meta.url)), '--edition', '2021', '--extern', `w_sim_kernels=${lib}`, '-O', '-C', 'panic=abort', '-o', native], { stdio: 'inherit', timeout: 60000 });

  for (const c of cases) {
    const p = pack(c);
    const n = p.n, th = p.th;
    const e = new WebAssembly.Instance(module).exports;
    let at = Math.ceil(e.heap_base() / 8) * 8;
    const alloc = (bytes, align = 8) => { at = Math.ceil(at / align) * align; const ptr = at; at += bytes; return ptr; };
    const cp = alloc(1888, 8), mask = alloc(Math.max(n, 1), 1);
    const f = alloc(n * 19 * 4, 4), post = alloc(n * 19 * 4, 4);
    const velocity = alloc(n * 3 * 4, 4), density = alloc(n * 4, 4);
    const [energy, nextEnergy, temperature, mass] = th ? [alloc(n * 8), alloc(n * 8), alloc(n * 8), alloc(n * 8)] : [0, 0, 0, 0];
    const stats = alloc(152, 8);
    const stride = 2 + th + (c.populations ? 1 : 0);
    const frame = alloc(Math.max(n * (3 + th), 1) * 4, 4);
    if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
    const memory = new Uint8Array(e.memory.buffer);
    memory.set(params(c), cp);
    memory.set(Buffer.from(c.flags ?? new Array(n).fill(0)), mask);
    const parts = [];
    const slice = (ptr, bytes) => Buffer.from(memory.slice(ptr, ptr + bytes));
    const pushState = () => {
      parts.push(slice(f, n * 76), slice(post, n * 76), slice(velocity, n * 12), slice(density, n * 4));
      if (th) for (const ptr of [energy, nextEnergy, temperature, mass]) parts.push(slice(ptr, n * 8));
    };
    if (c.op === 0) {
      memory.fill(0xa5, f, density + n * 4);
      if (th) memory.fill(0xa5, energy, mass + n * 8);
      const d0len = n * (2 + th) * 4, d1len = n * (3 + th) * 4;
      memory.fill(0xa5, frame, frame + d1len);
      const initStatus = e.d3q19_init(cp, mask, f, post, velocity, density, energy, nextEnergy, temperature, mass);
      parts.push(u32([initStatus]));
      if (initStatus === 0) {
        for (let i = 1; i <= c.steps; i++) {
          memory.fill(0xa5, stats, stats + 152);
          parts.push(u32([e.d3q19_step(cp, mask, f, post, velocity, density, energy, nextEnergy, temperature, mass, i, stats)]), slice(stats, 152));
        }
      }
      pushState();
      if (initStatus === 0) {
        parts.push(u32([e.d3q19_display(cp, velocity, mask, temperature, 0, frame)]), slice(frame, d0len));
        parts.push(u32([e.d3q19_display(cp, velocity, mask, temperature, f, frame)]), slice(frame, d1len));
      }
    } else if (c.op === 1) {
      memory.set(c.velocity, velocity);
      if (c.populations) memory.set(c.populations, f);
      if (c.temperature) memory.set(c.temperature, temperature);
      const len = (c.displayFloats ?? n * stride) * 4;
      memory.fill(0xa5, frame, frame + len);
      parts.push(u32([e.d3q19_display(cp, velocity, mask, c.temperature ? temperature : 0, c.populations ? f : 0, frame)]), slice(frame, len));
    } else {
      memory.set(c.f, f);
      memory.set(c.post ?? c.f, post);
      memory.set(c.velocity ?? f32(new Array(3 * n).fill(0)), velocity);
      memory.set(c.density ?? rhoOf(c.f, n), density);
      if (th) {
        memory.set(c.energy ?? f64(new Array(n).fill(0)), energy);
        memory.set(c.nextEnergy ?? f64(new Array(n).fill(0)), nextEnergy);
        memory.set(c.temperature ?? f64(new Array(n).fill(0)), temperature);
        memory.set(c.mass ?? f64(new Array(n).fill(1)), mass);
      }
      for (let i = 1; i <= c.steps; i++) {
        memory.fill(0xa5, stats, stats + 152);
        parts.push(u32([e.d3q19_step(cp, mask, f, post, velocity, density, energy, nextEnergy, temperature, mass, i, stats)]), slice(stats, 152));
      }
      pushState();
    }
    writeFileSync(file, p.input);
    assert.deepEqual(Buffer.concat(parts), execFileSync(native, [file], { timeout: 10000 }), `${c.name}: status/stats/state/display native/WASM bytes`);
  }

  // ABI-level rejections must leave every caller byte untouched.
  {
    const e = new WebAssembly.Instance(module).exports;
    let at = Math.ceil(e.heap_base() / 8) * 8;
    const alloc = (bytes, align = 8) => { at = Math.ceil(at / align) * align; const ptr = at; at += bytes; return ptr; };
    const n = 60; // matches the default 5x4x3 parameter blob below
    const cp = alloc(1888, 8), mask = alloc(n, 1);
    const f = alloc(n * 19 * 4, 4), post = alloc(n * 19 * 4, 4);
    const velocity = alloc(n * 3 * 4, 4), density = alloc(n * 4, 4);
    const stats = alloc(152, 8), frame = alloc(n * 3 * 4, 4), guard = alloc(8);
    if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
    const memory = new Uint8Array(e.memory.buffer);
    memory.set(params({}), cp);
    new Uint8Array(e.memory.buffer, mask, n).fill(0);
    new Uint8Array(e.memory.buffer, guard, 8).fill(0xa5);
    const end = e.memory.buffer.byteLength;
    const init = (p = cp, fl = mask, a = f, b = post, v = velocity, d = density, t1 = 0, t2 = 0, t3 = 0, t4 = 0) =>
      e.d3q19_init(p, fl, a, b, v, d, t1, t2, t3, t4);
    const step = (p = cp, fl = mask, a = f, b = post, v = velocity, d = density, t1 = 0, t2 = 0, t3 = 0, t4 = 0, i = 1, s = stats) =>
      e.d3q19_step(p, fl, a, b, v, d, t1, t2, t3, t4, i, s);
    const show = (v = velocity, fl = mask, t = 0, pop = 0, out = frame) => e.d3q19_display(cp, v, fl, t, pop, out);
    assert.equal(init(), 0);
    const before = Buffer.from(memory.slice(cp));
    const unchanged = () => assert.deepEqual(Buffer.from(memory.slice(cp)), before, 'rejection precedes caller-memory writes');
    for (const [call, want] of [
      // Parameter blob: null, misaligned, below heap and out of bounds.
      [() => init(0), 2], [() => init(cp + 4), 2], [() => init(e.heap_base() - 8), 2], [() => init(end - 1880), 2],
      // Every region: null, misaligned, out of bounds and pairwise overlap.
      [() => init(cp, 0), 2], [() => init(cp, end - n + 1), 2], [() => init(cp, f), 2],
      [() => init(cp, mask, 0), 2], [() => init(cp, mask, f + 1), 2], [() => init(cp, mask, end - 8), 2],
      [() => init(cp, mask, f, f), 2], [() => init(cp, mask, f, post, f), 2],
      [() => init(cp, mask, f, post, velocity + 1), 2], [() => init(cp, mask, f, post, velocity, f), 2],
      [() => init(cp, mask, f, post, velocity, density + 2), 2],
      // Thermal buffers must be null when the model is disabled.
      [() => init(cp, mask, f, post, velocity, density, stats, 0, 0, 0), 2],
      [() => init(cp, mask, f, post, velocity, density, 0, 0, 0, f), 2],
      [() => step(cp, mask, f, post, velocity, density, 0, stats, 0, 0), 2],
      // Stats slot: alias, misalignment and a short tail are rejected.
      [() => step(cp, mask, f, post, velocity, density, 0, 0, 0, 0, 1, f), 2],
      [() => step(cp, mask, f, post, velocity, density, 0, 0, 0, 0, 1, stats + 4), 2],
      [() => step(cp, mask, f, post, velocity, density, 0, 0, 0, 0, 1, end - 96), 2],
      // Display: output must not alias inputs; temperature needs the model.
      [() => show(velocity, mask, f), 2], [() => show(velocity, mask, 0, 0, velocity), 2],
      [() => show(velocity, mask, 0, f + 1), 2], [() => show(velocity, mask, 0, 0, end - n * 2 * 4 + 4), 2],
      [() => show(velocity, mask, 0, f, f), 2],
      // Dimension and enum failures precede all region validation.
      [() => { const b = params({ dims: [0, 4, 3] }); memory.set(b, cp); const s = init(cp, 0, 0, 0, 0, 0); memory.set(params({}), cp); return s; }, 1],
      [() => { const b = params({ version: 10 }); memory.set(b, cp); const s = step(cp, 0, 0, 0, 0, 0); memory.set(params({}), cp); return s; }, 7],
    ]) {
      assert.equal(call(), want);
      unchanged();
    }
    assert.equal(step(), 0, 'same memory reusable after rejected calls');
    const stable = Buffer.from(memory.slice(f, f + n * 76));
    assert.equal(e.d3q19_display(cp, velocity, mask, 0, f, frame), 0);
    const copy = Buffer.from(memory.slice(frame, frame + n * 12));
    assert.equal(e.d3q19_display(cp, velocity, mask, 0, f, frame), 0);
    assert.deepEqual(Buffer.from(memory.slice(frame, frame + n * 12)), copy, 'deterministic pressure frame');
    assert.deepEqual(Buffer.from(memory.slice(f, f + n * 76)), stable, 'display leaves populations untouched');
    assert(new Uint8Array(e.memory.buffer, guard, 8).every(v => v === 0xa5), 'display stays inside its frame');
  }
  console.log(`D3Q19: ${cases.length} cases native/WASM exact — wind-tunnel/periodic/closed runs, slip/ground/fan/turbulence forcing, solid-power/fixed/region-contact heat, 19-word step stats, both display strides including the pressure channel, supplied-state steps and every decode rejection; ABI alias/bounds checks pass.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
