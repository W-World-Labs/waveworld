// Native/WASM parity for the standalone heat kernel and its region helpers:
// `heat` insulated-boundary stepping, `seed_heat` clipped circular deposits,
// `thermal_regions` normalized-space material assignment and
// `thermal_contact_faces` pair masks are compared byte-exact, including
// partially written buffers after kernel-level errors. No JS duplicate of the
// stencil or raster rules.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'w-sim-thermal-'));
const generated = readFileSync(join(root, 'packages/solvers-lbm/src/wasm-kernel.ts'), 'utf8');
const module = new WebAssembly.Module(Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1], 'base64'));
assert.deepEqual(WebAssembly.Module.imports(module), []);

const u32 = values => { const b = Buffer.alloc(4 * values.length); values.forEach((v, i) => b.writeUInt32LE(v, i * 4)); return b; };
const f32 = values => { const b = Buffer.alloc(4 * values.length); values.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };
const f64 = values => { const b = Buffer.alloc(8 * values.length); values.forEach((v, i) => b.writeDoubleLE(v, i * 8)); return b; };
const field = (w, h, fn) => f32(Array.from({ length: w * h }, (_, i) => fn(i % w, (i / w) | 0, i)));
// Map each axis' cell centers to [0,1]; the last x center lands exactly on 1.
const NORMALIZE = [.2, 0, 0, .1, 0, .2, 0, 0, 0, 0, .2, 0];
const flags3 = (dims, fn) => {
  const [nx, ny] = dims;
  return Array.from({ length: nx * ny * dims[2] }, (_, i) => fn(i % nx, ((i / nx) | 0) % ny, (i / (nx * ny)) | 0));
};

const cases = [
  // op0: heat stepping — w, h, r, steps, initial field.
  { op: 0, name: 'impulse-7x5', w: 7, h: 5, r: .23, steps: 6, field: field(7, 5, (x, y) => x === 3 && y === 2 ? 1.3 : 0) },
  { op: 0, name: 'nonuniform-5x8', w: 5, h: 8, r: .25, steps: 4, field: field(5, 8, (x, y, i) => .01 * ((i * 7) % 13) - .05) },
  { op: 0, name: 'frozen-r0', w: 6, h: 4, r: 0, steps: 3, field: field(6, 4, (x, y) => x * y * .1) },
  { op: 0, name: 'gradient-3x9', w: 3, h: 9, r: .1, steps: 8, field: field(3, 9, (x, y) => y * .25) },
  { op: 0, name: 'single-row', w: 9, h: 1, r: .2, steps: 4, field: field(9, 1, x => x * .1 - .4) },
  { op: 0, name: 'single-column', w: 1, h: 7, r: .24, steps: 5, field: field(1, 7, (x, y) => y * -.15) },
  { op: 0, name: 'r-over-limit', w: 4, h: 4, r: .2500000001, steps: 1, field: field(4, 4, () => 1) },
  { op: 0, name: 'r-nan', w: 4, h: 4, r: NaN, steps: 1, field: field(4, 4, () => .5) },
  { op: 0, name: 'r-negative', w: 4, h: 4, r: -.01, steps: 1, field: field(4, 4, () => .5) },
  { op: 0, name: 'nan-source', w: 4, h: 4, r: .2, steps: 1, field: field(4, 4, (x, y, i) => i === 7 ? NaN : .1) },
  // op1: seed_heat — w, h, x, y, radius, amount over the supplied field.
  { op: 1, name: 'seed-center', w: 7, h: 5, x: 3, y: 2, radius: 2, amount: 1.3, field: field(7, 5, () => 0) },
  { op: 1, name: 'seed-clip-corner', w: 6, h: 6, x: -1, y: -1, radius: 3, amount: .5, field: field(6, 6, () => 0) },
  { op: 1, name: 'seed-clip-edge-accumulate', w: 7, h: 5, x: 6, y: 4, radius: 2, amount: -.25, field: field(7, 5, () => .1) },
  { op: 1, name: 'seed-radius-zero', w: 5, h: 5, x: 2, y: 2, radius: 0, amount: 2, field: field(5, 5, () => 0) },
  { op: 1, name: 'seed-blanket', w: 5, h: 4, x: 1, y: 1, radius: 100, amount: .75, field: field(5, 4, () => -.2) },
  { op: 1, name: 'seed-off-grid', w: 5, h: 4, x: -10, y: -10, radius: 2, amount: 1, field: field(5, 4, () => .3) },
  { op: 1, name: 'seed-nan-amount', w: 5, h: 4, x: 2, y: 2, radius: 1, amount: NaN, field: field(5, 4, () => 0) },
  { op: 1, name: 'seed-overflow', w: 5, h: 4, x: 2, y: 2, radius: 0, amount: 3e38, field: field(5, 4, (x, y, i) => i === 12 ? 3e38 : 0) },
  // op2: thermal_regions — dims, matrix, bounds, initial flags.
  { op: 2, name: 'regions-split-x', dims: [5, 5, 5], matrix: NORMALIZE,
    bounds: [[0, 0, 0, .5, 1, 1], [.5, 0, 0, 1, 1, 1]],
    flags: flags3([5, 5, 5], (x, y, z) => z === 0 || (x === 2 && y === 2) ? 0 : 4) },
  { op: 2, name: 'regions-mixed-flags', dims: [6, 4, 3], matrix: NORMALIZE,
    bounds: [[0, 0, 0, 1, .5, 1], [0, .5, 0, 1, 1, .6], [.1, .6, .1, .9, 1, 1]],
    flags: flags3([6, 4, 3], (x, y, z) => (x + y + z) % 5 === 0 ? 1 : (x + z) % 7 === 0 ? 2 : (x * y) % 11 === 0 ? 3 : 4) },
  { op: 2, name: 'regions-inclusive-boundary', dims: [5, 4, 3], matrix: NORMALIZE,
    bounds: [[0, 0, 0, 1, .5, 1]],
    flags: flags3([5, 4, 3], () => 4) },
  { op: 2, name: 'regions-touching', dims: [4, 4, 4], matrix: NORMALIZE,
    bounds: [[0, 0, 0, .5, .5, .5], [.5, .5, .5, 1, 1, 1]],
    flags: flags3([4, 4, 4], () => 4) },
  { op: 2, name: 'regions-empty-member', dims: [5, 5, 5], matrix: NORMALIZE,
    bounds: [[0, 0, 0, .5, 1, 1], [.7, .7, .7, .71, .71, .71]],
    flags: flags3([5, 5, 5], () => 4) },
  { op: 2, name: 'regions-overlap', dims: [5, 5, 5], matrix: NORMALIZE,
    bounds: [[0, 0, 0, .6, 1, 1], [.5, 0, 0, 1, 1, 1]],
    flags: flags3([5, 5, 5], () => 4) },
  { op: 2, name: 'regions-degenerate', dims: [5, 5, 5], matrix: NORMALIZE,
    bounds: [[0, .5, 0, .5, .4, 1]],
    flags: flags3([5, 5, 5], () => 4) },
  { op: 2, name: 'regions-out-of-range', dims: [5, 5, 5], matrix: NORMALIZE,
    bounds: [[0, 0, 0, .5, 1.5, 1]],
    flags: flags3([5, 5, 5], () => 4) },
  { op: 2, name: 'regions-nan-matrix', dims: [5, 5, 5],
    matrix: [.2, 0, 0, NaN, 0, .2, 0, 0, 0, 0, .2, 0],
    bounds: [[0, 0, 0, .5, 1, 1]],
    flags: flags3([5, 5, 5], () => 4) },
  { op: 2, name: 'regions-count-17', dims: [5, 5, 5], matrix: NORMALIZE,
    bounds: Array.from({ length: 17 }, () => [0, 0, 0, .5, 1, 1]),
    flags: flags3([5, 5, 5], () => 4) },
  { op: 2, name: 'regions-bad-flag', dims: [5, 5, 5], matrix: NORMALIZE,
    bounds: [[0, 0, 0, .5, 1, 1]],
    flags: flags3([5, 5, 5], (x, y, z) => x === 1 && y === 1 && z === 1 ? 5 : 4) },
  { op: 2, name: 'regions-none', dims: [5, 5, 5], matrix: NORMALIZE, bounds: [],
    flags: flags3([5, 5, 5], (x, y) => x === 0 && y === 0 ? 1 : 4) },
  // op3: thermal_contact_faces — dims, periodic, flags.
  { op: 3, name: 'contacts-three-materials', dims: [4, 3, 2], periodic: 0,
    flags: flags3([4, 3, 2], (x, y) => x < 2 ? 4 : y === 0 ? 5 : 6) },
  { op: 3, name: 'contacts-periodic-wrap', dims: [4, 3, 2], periodic: 1,
    flags: flags3([4, 3, 2], x => x === 0 ? 4 : x === 3 ? 5 : 0) },
  { op: 3, name: 'contacts-nonperiodic-edge', dims: [4, 3, 2], periodic: 0,
    flags: flags3([4, 3, 2], x => x === 0 ? 4 : x === 3 ? 5 : 0) },
  { op: 3, name: 'contacts-diagonal-only', dims: [4, 4, 2], periodic: 0,
    flags: flags3([4, 4, 2], (x, y) => x === 0 && y === 0 ? 4 : x === 1 && y === 1 ? 5 : 0) },
  { op: 3, name: 'contacts-default-vs-palette', dims: [5, 4, 3], periodic: 0,
    flags: flags3([5, 4, 3], (x, y, z) => z === 1 && x < 3 ? 4 : z === 1 && x === 3 ? 8 : z === 2 && y < 2 ? 9 : 0) },
  { op: 3, name: 'contacts-no-solids', dims: [4, 4, 2], periodic: 0, flags: flags3([4, 4, 2], () => 0) },
  { op: 3, name: 'contacts-bad-flag', dims: [4, 4, 2], periodic: 0,
    flags: flags3([4, 4, 2], (x, y) => x === 1 && y === 1 ? 21 : 4) },
];

function pack(c) {
  const head = Buffer.alloc(32);
  head.writeUInt32LE(c.op, 0);
  if (c.op === 0 || c.op === 1) {
    head.writeUInt32LE(c.w, 4);
    head.writeUInt32LE(c.h, 8);
    if (c.op === 0) {
      head.writeDoubleLE(c.r, 12);
      head.writeUInt32LE(c.steps, 20);
      return { input: Buffer.concat([head.subarray(0, 24), c.field]), n: c.w * c.h, field: c.field };
    }
    head.writeInt32LE(c.x, 12);
    head.writeInt32LE(c.y, 16);
    head.writeUInt32LE(c.radius, 20);
    head.writeDoubleLE(c.amount, 24);
    return { input: Buffer.concat([head.subarray(0, 32), c.field]), n: c.w * c.h, field: c.field };
  }
  const [nx, ny, nz] = c.dims, n = nx * ny * nz, flags = Buffer.from(c.flags);
  head.writeUInt32LE(nx, 4);
  head.writeUInt32LE(ny, 8);
  head.writeUInt32LE(nz, 12);
  if (c.op === 2) {
    head.writeUInt32LE(c.bounds.length, 16);
    const matrix = f64(c.matrix), bounds = Buffer.concat(c.bounds.map(f64));
    return { input: Buffer.concat([head.subarray(0, 24), matrix, bounds, flags]), n, count: c.bounds.length, matrix, bounds, flags };
  }
  head.writeUInt32LE(c.periodic, 16);
  return { input: Buffer.concat([head.subarray(0, 20), flags]), n, flags };
}

try {
  const lib = join(scratch, 'libw_sim_kernels.rlib'), native = join(scratch, 'thermal-reference'), file = join(scratch, 'input');
  execFileSync('rustc', [join(root, 'crates/w-sim-kernels/src/lib.rs'), '--edition', '2021', '--crate-name', 'w_sim_kernels', '--crate-type', 'rlib', '-O', '-C', 'panic=abort', '-o', lib], { stdio: 'inherit', timeout: 60000 });
  execFileSync('rustc', [fileURLToPath(new URL('./thermal-reference.rs', import.meta.url)), '--edition', '2021', '--extern', `w_sim_kernels=${lib}`, '-O', '-C', 'panic=abort', '-o', native], { stdio: 'inherit', timeout: 60000 });

  for (const c of cases) {
    const p = pack(c);
    const e = new WebAssembly.Instance(module).exports;
    let at = Math.ceil(e.heap_base() / 8) * 8;
    const alloc = (bytes, align = 8) => { at = Math.ceil(at / align) * align; const ptr = at; at += bytes; return ptr; };
    let got;
    if (c.op === 0) {
      let cur = alloc(p.n * 4), next = alloc(p.n * 4);
      if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
      const memory = new Uint8Array(e.memory.buffer);
      memory.set(p.field, cur);
      memory.fill(0xa5, next, next + p.n * 4);
      const codes = [];
      for (let i = 0; i < c.steps; i++) {
        const s = e.heat(cur, next, c.w, c.h, c.r);
        codes.push(s);
        if (s === 0) [cur, next] = [next, cur];
      }
      got = Buffer.concat([u32(codes), Buffer.from(memory.slice(cur, cur + p.n * 4)), Buffer.from(memory.slice(next, next + p.n * 4))]);
    } else if (c.op === 1) {
      const ptr = alloc(p.n * 4);
      if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
      const memory = new Uint8Array(e.memory.buffer);
      memory.set(p.field, ptr);
      const s = e.seed_heat(ptr, c.w, c.h, c.x, c.y, c.radius, c.amount);
      got = Buffer.concat([u32([s]), Buffer.from(memory.slice(ptr, ptr + p.n * 4))]);
    } else if (c.op === 2) {
      const flags = alloc(p.n, 1), matrix = alloc(96), bounds = p.count ? alloc(48 * p.count) : 0, counts = alloc(68, 4);
      if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
      const memory = new Uint8Array(e.memory.buffer);
      memory.set(p.flags, flags);
      memory.set(p.matrix, matrix);
      if (p.count) memory.set(p.bounds, bounds);
      memory.fill(0xa5, counts, counts + 68);
      const s = e.thermal_regions(flags, ...c.dims, matrix, bounds, p.count, counts);
      got = Buffer.concat([u32([s]), Buffer.from(memory.slice(flags, flags + p.n)), Buffer.from(memory.slice(counts, counts + 68))]);
    } else {
      const flags = alloc(p.n, 1), mask = alloc(20, 4);
      if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
      const memory = new Uint8Array(e.memory.buffer);
      memory.set(p.flags, flags);
      memory.fill(0xa5, mask, mask + 20);
      const s = e.thermal_contact_faces(flags, ...c.dims, c.periodic, mask);
      got = Buffer.concat([u32([s]), Buffer.from(memory.slice(mask, mask + 20))]);
    }
    writeFileSync(file, p.input);
    assert.deepEqual(got, execFileSync(native, [file], { timeout: 10000 }), `${c.name}: status/fields native/WASM bytes`);
  }

  // ABI-level rejections must leave every caller buffer untouched.
  {
    const e = new WebAssembly.Instance(module).exports;
    let at = Math.ceil(e.heap_base() / 8) * 8;
    const alloc = (bytes, align = 8) => { at = Math.ceil(at / align) * align; const ptr = at; at += bytes; return ptr; };
    const w = 5, h = 4, n = w * h;
    const field = alloc(n * 4), next = alloc(n * 4);
    const flags = alloc(60, 1), matrix = alloc(96), bounds = alloc(96), counts = alloc(68, 4), mask = alloc(20, 4);
    if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
    const memory = new Uint8Array(e.memory.buffer);
    const base = field;
    assert.equal(e.seed_heat(field, w, h, 2, 2, 1, .7), 0);
    assert.equal(e.heat(field, next, w, h, .2), 0);
    new Uint8Array(e.memory.buffer, flags, 60).fill(4);
    new Float64Array(e.memory.buffer, matrix, 12).set(NORMALIZE);
    new Float64Array(e.memory.buffer, bounds, 12).set([0, 0, 0, .5, 1, 1, .5, 0, 0, 1, 1, 1]);
    assert.equal(e.thermal_regions(flags, 5, 4, 3, matrix, bounds, 2, counts), 0);
    assert.equal(e.thermal_contact_faces(flags, 5, 4, 3, 0, mask), 0);
    const before = Buffer.from(memory.slice(base));
    for (const call of [
      () => e.heat(field, field, w, h, .2),
      () => e.heat(field + 1, next, w, h, .2),
      () => e.heat(0, next, w, h, .2),
      () => e.heat(field, e.memory.buffer.byteLength - 4, w, h, .2),
      () => e.seed_heat(field + 1, w, h, 1, 1, 1, 1),
      () => e.seed_heat(0, w, h, 1, 1, 1, 1),
      () => e.seed_heat(e.memory.buffer.byteLength - 4, w, h, 1, 1, 1, 1),
      () => e.thermal_regions(flags, 5, 4, 3, matrix, flags, 2, counts),
      () => e.thermal_regions(flags, 5, 4, 3, matrix + 1, bounds, 2, counts),
      () => e.thermal_regions(flags, 5, 4, 3, matrix, bounds + 4, 2, counts),
      () => e.thermal_regions(flags, 5, 4, 3, matrix, bounds, 2, counts + 1),
      () => e.thermal_regions(flags, 5, 4, 3, matrix, counts, 2, counts),
      () => e.thermal_regions(0, 5, 4, 3, matrix, bounds, 2, counts),
      () => e.thermal_contact_faces(flags, 5, 4, 3, 0, flags),
      () => e.thermal_contact_faces(flags, 5, 4, 3, 0, mask + 1),
      () => e.thermal_contact_faces(0, 5, 4, 3, 0, mask),
      () => e.thermal_contact_faces(flags, 5, 4, 3, 0, e.memory.buffer.byteLength - 4),
    ]) {
      assert.equal(call(), 2);
      assert.deepEqual(Buffer.from(memory.slice(base)), before, 'memory rejection precedes caller-memory writes');
    }
    for (const [call, code] of [
      [() => e.heat(field, next, 0, h, .2), 1],
      [() => e.heat(field, next, 0xffffffff, 0xffffffff, .2), 1],
      [() => e.heat(field, next, w, h, .26), 3],
      [() => e.heat(field, next, w, h, NaN), 3],
      [() => e.seed_heat(field, 0, h, 1, 1, 1, 1), 1],
      [() => e.seed_heat(field, w, h, 1, 1, 1, NaN), 4],
      [() => e.seed_heat(field, w, h, 1, 1, 1, Infinity), 4],
      [() => e.thermal_regions(flags, 0, 4, 3, matrix, bounds, 2, counts), 1],
      [() => e.thermal_regions(flags, 5, 4, 3, matrix, bounds, 17, counts), 6],
      [() => e.thermal_contact_faces(flags, 5, 4, 3, 2, mask), 1],
      [() => e.thermal_contact_faces(flags, 0, 4, 3, 0, mask), 1],
      [() => e.thermal_contact_faces(flags, 5, 4, 0, 0, mask), 1],
    ]) {
      assert.equal(call(), code);
      assert.deepEqual(Buffer.from(memory.slice(base)), before, 'parameter rejection precedes caller-memory writes');
    }
    new Float32Array(e.memory.buffer, field, n)[0] = NaN;
    assert.equal(e.heat(field, next, w, h, .2), 4, 'nonfinite source stops mid-write');
    memory.set(before, base);
    assert.equal(e.heat(field, next, w, h, .2), 0, 'valid call still succeeds after rejections');
    assert.equal(e.heat(next, field, w, h, .2), 0, 'buffers remain swappable');
  }
  console.log(`Thermal: ${cases.length} cases native/WASM exact — insulated stepping at r bounds, clipped/overflowing deposits, normalized region assignment through every kernel rejection and periodic contact masks; ABI alias/bounds checks pass.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
