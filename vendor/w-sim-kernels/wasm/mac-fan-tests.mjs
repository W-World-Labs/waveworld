// Native/WASM parity for the MAC actuator-disk kernel behind `mac_fans`:
// rasterized disk face selection, signed flow sums, shared-curve affinity
// interpolation and readouts are compared byte-exact, including partially
// written output after kernel-level errors. No JS duplicate of the model.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'w-sim-mac-fan-'));
const generated = readFileSync(join(root, 'packages/solvers-lbm/src/wasm-kernel.ts'), 'utf8');
const module = new WebAssembly.Module(Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1], 'base64'));
assert.deepEqual(WebAssembly.Module.imports(module), []);

const f64 = values => { const b = Buffer.alloc(8 * values.length); values.forEach((v, i) => b.writeDoubleLE(v, i * 8)); return b; };
const u32 = values => { const b = Buffer.alloc(4 * values.length); values.forEach((v, i) => b.writeUInt32LE(v, i * 4)); return b; };
const diskBytes = d => {
  const b = Buffer.alloc(56);
  b.writeUInt32LE(d.axis, 0); b.writeInt32LE(d.dir, 4);
  d.center.forEach((v, i) => b.writeDoubleLE(v, 8 + 8 * i));
  b.writeDoubleLE(d.radius, 32); b.writeDoubleLE(d.rpm, 40);
  b.writeUInt32LE(d.offset, 48); b.writeUInt32LE(d.count, 52);
  return b;
};
const pointBytes = p => f64(p);
// Deterministic nonuniform face fields; VN is negative for a -1-direction fan.
const U = i => .05 + .01 * ((i * 7) % 13);
const V = i => .01 + .005 * ((i * 5) % 11);
const VN = i => -(.02 + .005 * ((i * 5) % 11));
const W = i => .01 + .004 * ((i * 3) % 9);
const counts = ([nx, ny, nz]) => [(nx + 1) * ny * nz, nx * (ny + 1) * nz, nx * ny * (nz + 1)];
const X = (center, extra = {}) => ({ axis: 0, dir: 1, center, radius: 1, rpm: 1, offset: 0, count: 2, ...extra });
const CURVE = [[0, 50], [10, 5]];
const BASE = { dims: [4, 4, 4], dx: .5, dt: .01, rho: 1.2, open: 0, disks: [X([2, 2, 2])], points: CURVE, u: U, v: V, w: W, status: 0 };
const fan = (name, over) => ({ name, ...BASE, ...over });
const cases = [
  fan('three-axis-disks', {
    disks: [
      X([2, 2, 2]),
      { axis: 1, dir: -1, center: [1.5, 2.5, 1.5], radius: .6, rpm: .8, offset: 2, count: 2 },
      { axis: 2, dir: 1, center: [2.5, 2.5, 1.49], radius: .5, rpm: .5, offset: 4, count: 2 },
    ],
    points: [[0, 50], [10, 5], [0, 20], [5, 2], [0, 15], [3, 8]],
    v: VN,
  }),
  fan('affinity-half-rpm', { disks: [X([2, 2, 2], { rpm: .5 })] }),
  fan('stall-shoulder-curve', { points: [[0, 10], [1, 30], [2, 18], [4, 26], [8, 0]], disks: [X([2, 2, 2], { count: 5 })] }),
  fan('twin-planes', { disks: [X([1, 2, 2], { radius: .6 }), X([3, 2, 2], { radius: .6 })] }),
  fan('off-axis-snapped-plane', { disks: [X([2.49, 2, 2], { radius: .6 })] }),
  fan('wall-plane', { disks: [X([.4, 2, 2])], status: 5 }),
  fan('far-wall-plane', { disks: [X([3.6, 2, 2])], status: 5 }),
  fan('empty-raster', { disks: [X([2, 1, 1], { radius: .2 })], status: 5 }),
  fan('solid-face', { flags: [42], status: 5 }),
  fan('same-axis-overlap', { disks: [X([2, 2, 2], { radius: .6 }), X([2.1, 2, 2], { radius: .6, offset: 0 })], status: 5 }),
  fan('reverse-flow', { u: i => -U(i), status: 6 }),
  fan('beyond-curve', { u: () => 5, status: 5 }),
  fan('rpm-zero', { disks: [X([2, 2, 2], { rpm: 0 })], status: 6 }),
  fan('rpm-overdrive', { disks: [X([2, 2, 2], { rpm: 1.5 })], status: 3 }),
  fan('bad-axis', { disks: [X([2, 2, 2], { axis: 3 })], status: 3 }),
  fan('bad-direction', { disks: [X([2, 2, 2], { dir: 0 })], status: 3 }),
  fan('off-domain-center', { disks: [X([-.5, 2, 2])], status: 3 }),
  fan('nan-center', { disks: [X([2, NaN, 2])], status: 3 }),
  fan('negative-radius', { disks: [X([2, 2, 2], { radius: -.5 })], status: 3 }),
  fan('short-curve', { disks: [X([2, 2, 2], { count: 1 })], status: 2 }),
  fan('curve-window-overrun', { disks: [X([2, 2, 2], { offset: 4, count: 4 })], points: [[0, 50], [10, 5], [0, 20], [5, 2], [0, 15], [3, 8]], status: 2 }),
  fan('nan-velocity', { u: i => i === 0 ? NaN : U(i), status: 4 }),
  fan('nan-curve-point', { points: [[0, NaN], [10, 5]], status: 4 }),
  fan('unordered-curve', { points: [[1, 5], [0, 50]], status: 3 }),
  fan('empty-fan', { disks: [], points: [] }),
];

function pack(c) {
  const [nx, ny, nz] = c.dims, n = nx * ny * nz, cc = counts(c.dims);
  const cfg = Buffer.alloc(64);
  [...c.dims, c.open, 500, 0].forEach((v, i) => cfg.writeUInt32LE(v, 4 * i));
  [c.dx, c.dt, c.rho, 1e-9, 0].forEach((v, i) => cfg.writeDoubleLE(v, 24 + 8 * i));
  const flags = Buffer.alloc(n);
  for (const index of c.flags ?? []) flags[index] = 1;
  const fields = [c.u, c.v, c.w].map((fn, a) => f64(Array.from({ length: cc[a] }, (_, i) => fn(i))));
  const input = Buffer.concat([
    u32([0]), cfg, u32([c.disks.length]), u32([c.points.length]),
    ...c.disks.map(diskBytes), ...c.points.map(pointBytes), flags, ...fields,
  ]);
  return { input, cfg, flags, fields, n, cc };
}

try {
  const lib = join(scratch, 'libw_sim_kernels.rlib'), native = join(scratch, 'mac-fan-reference'), file = join(scratch, 'input');
  execFileSync('rustc', [join(root, 'crates/w-sim-kernels/src/lib.rs'), '--edition', '2021', '--crate-name', 'w_sim_kernels', '--crate-type', 'rlib', '-O', '-C', 'panic=abort', '-o', lib], { stdio: 'inherit', timeout: 60000 });
  execFileSync('rustc', [fileURLToPath(new URL('./mac-fan-reference.rs', import.meta.url)), '--edition', '2021', '--extern', `w_sim_kernels=${lib}`, '-O', '-C', 'panic=abort', '-o', native], { stdio: 'inherit', timeout: 60000 });

  for (const c of cases) {
    const { input, cfg, flags, fields, n, cc } = pack(c);
    const e = new WebAssembly.Instance(module).exports;
    let at = Math.ceil(e.heap_base() / 8) * 8;
    const alloc = (bytes, align = 8) => { at = Math.ceil(at / align) * align; const p = at; at += bytes; return p; };
    const count = c.disks.length, pc = c.points.length;
    const cp = alloc(64), table = alloc(28, 4), flagsPtr = alloc(n, 1);
    const [u, v, w] = cc.map(len => alloc(len * 8));
    const [au, av, aw] = cc.map(len => alloc(len * 8));
    const disks = count ? alloc(56 * count) : 0, points = pc ? alloc(16 * pc) : 0, out = count ? alloc(40 * count) : 0;
    if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
    const memory = new Uint8Array(e.memory.buffer), view = new DataView(e.memory.buffer);
    memory.set(cfg, cp); memory.set(flags, flagsPtr);
    c.disks.forEach((d, i) => memory.set(diskBytes(d), disks + 56 * i));
    c.points.forEach((p, i) => memory.set(pointBytes(p), points + 16 * i));
    fields.forEach((b, a) => memory.set(b, [u, v, w][a]));
    [au, av, aw].forEach((p, a) => memory.fill(0xa5, p, p + cc[a] * 8));
    if (out) memory.fill(0xa5, out, out + 40 * count);
    [flagsPtr, u, v, w, au, av, aw].forEach((p, i) => view.setUint32(table + 4 * i, p, true));
    const status = e.mac_fans(cp, disks, count, points, pc, table, out);
    assert.equal(status, c.status, c.name);
    const got = Buffer.concat([
      u32([status]),
      Buffer.from(memory.slice(au, au + cc[0] * 8)),
      Buffer.from(memory.slice(av, av + cc[1] * 8)),
      Buffer.from(memory.slice(aw, aw + cc[2] * 8)),
      Buffer.from(memory.slice(out, out + 40 * count)),
    ]);
    writeFileSync(file, input);
    assert.deepEqual(got, execFileSync(native, [file], { timeout: 10000 }), `${c.name}: status/acceleration/readout native/WASM bytes`);
  }

  // ABI-level rejections must leave every caller buffer untouched.
  {
    const c = cases[0], { cfg, flags, n, cc } = pack(c);
    const e = new WebAssembly.Instance(module).exports;
    let at = Math.ceil(e.heap_base() / 8) * 8;
    const alloc = (bytes, align = 8) => { at = Math.ceil(at / align) * align; const p = at; at += bytes; return p; };
    const cp = alloc(64), table = alloc(28, 4), flagsPtr = alloc(n, 1);
    const [u, v, w] = cc.map(len => alloc(len * 8));
    const [au, av, aw] = cc.map(len => alloc(len * 8));
    const disks = alloc(56 * 3), points = alloc(16 * 6), out = alloc(40 * 3);
    if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
    const memory = new Uint8Array(e.memory.buffer), view = new DataView(e.memory.buffer);
    memory.set(cfg, cp); memory.set(flags, flagsPtr);
    c.disks.forEach((d, i) => memory.set(diskBytes(d), disks + 56 * i));
    c.points.forEach((p, i) => memory.set(pointBytes(p), points + 16 * i));
    [flagsPtr, u, v, w, au, av, aw].forEach((p, i) => view.setUint32(table + 4 * i, p, true));
    const run = (d = disks, k = 3, p = points, m = 6, t = table, o = out) => e.mac_fans(cp, d, k, p, m, t, o);
    assert.equal(run(), 0);
    const before = Buffer.from(memory.slice(cp));
    for (const call of [
      () => run(disks, 17), () => run(disks, 3, points, 4097),
      () => run(disks + 4), () => run(u),
      () => run(disks, 3, points, 6, table, u), () => run(disks, 3, points, 6, table, flagsPtr),
      () => e.mac_fans(cp + 4, disks, 3, points, 6, table, out),
      () => e.mac_fans(cp, disks, 0, points, 0, table, out),
      () => e.mac_fans(cp, 0, 1, points, 6, table, out),
    ]) {
      assert.equal(call(), 2);
      assert.deepEqual(Buffer.from(memory.slice(cp)), before, 'rejection precedes caller-memory writes');
    }
    view.setUint32(table + 16, u, true);
    const aliased = Buffer.from(memory.slice(cp));
    assert.equal(run(), 2, 'acceleration must not alias velocity');
    assert.deepEqual(Buffer.from(memory.slice(cp)), aliased);
    view.setUint32(table + 16, au, true);
    assert.equal(run(), 0, 'table restored');
    assert.deepEqual(Buffer.from(memory.slice(cp)), before, 'deterministic rerun');
    assert.equal(e.mac_fans(cp, 0, 0, 0, 0, table, 0), 0, 'empty fan still clears acceleration');
    [au, av, aw].forEach((p, a) => assert(memory.subarray(p, p + cc[a] * 8).every(v => v === 0), 'empty fan zeroed every face'));
  }
  console.log(`MAC fans: ${cases.length} cases native/WASM exact — multi-axis disks, affinity RPM scaling, stall-shoulder curves, snapped planes, sentinel readouts through every kernel rejection; ABI alias/bounds checks pass.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
