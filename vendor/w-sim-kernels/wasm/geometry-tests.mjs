// Native/WASM parity for the triangle scan converter behind `voxelize` and
// `voxelize_solids`: z-slice even-odd fill, DDA surface marking, explicit
// solid groups, clipped/out-of-grid geometry and the boundary-edge closure
// checks are compared byte-exact, including partially written flags/scratch
// buffers after kernel-level errors. No JS duplicate of the scan rules.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const scratchDir = mkdtempSync(join(tmpdir(), 'w-sim-geometry-'));
const generated = readFileSync(join(root, 'packages/solvers-lbm/src/wasm-kernel.ts'), 'utf8');
const module = new WebAssembly.Module(Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1], 'base64'));
assert.deepEqual(WebAssembly.Module.imports(module), []);

const u32 = values => { const b = Buffer.alloc(4 * values.length); values.forEach((v, i) => b.writeUInt32LE(v, i * 4)); return b; };
const f32 = values => { const b = Buffer.alloc(4 * values.length); values.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };

// Consistently wound outward cube: every geometric edge occurs exactly twice
// in opposite directions, so each mesh is a closed boundary set.
const cube = (x0, y0, z0, x1, y1, z1) => ({
  v: [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1],
  i: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5],
});
const tetra = (x0, y0, z0, x1, y1, z1) => ({
  v: [x0, y0, z0, x1, y0, z0, x0, y1, z0, x0, y0, z1],
  i: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
});
const merge = (...meshes) => {
  const v = [], i = [], g = [];
  for (const m of meshes) {
    const base = v.length / 3;
    v.push(...m.v);
    i.push(...m.i.map(index => index + base));
    g.push(m.i.length / 3);
  }
  return { v, i, g };
};
const kase = (name, dims, mesh, over = {}) => ({
  name, dims, vertices: mesh.v, indices: mesh.i, groups: mesh.g ?? [], status: 0, ...over,
});

const box = cube(1.5, 1, 1, 6.5, 4.5, 3.5);
const cases = [
  kase('single-cube', [8, 6, 5], { ...box, g: [] }),
  kase('unit-cell-cube', [6, 5, 4], { ...cube(1, 1, 1, 2, 2, 2), g: [] }),
  kase('tetra', [6, 6, 6], { ...tetra(1, 1, 1, 4, 4, 4), g: [] }),
  kase('two-cubes-grouped', [8, 8, 5], merge(cube(.5, .5, .5, 3, 3, 3), cube(4, 4, 1, 6.5, 7, 4))),
  kase('nested-cube-sets', [8, 8, 5], merge(cube(.5, .5, .5, 7.5, 7.5, 4.5), cube(2, 2, 1.5, 5, 5, 3.5))),
  kase('overlapping-cubes', [7, 7, 5], merge(cube(.5, .5, .5, 4, 4, 4), cube(2, 2, 1, 6, 6, 4))),
  kase('shared-face-cubes', [7, 4, 4], merge(cube(.5, .5, .5, 3.5, 3.5, 3.5), cube(3.5, .5, .5, 6.5, 3.5, 3.5))),
  kase('wide-slab-clip', [6, 5, 4], { ...cube(-1e6, -1e6, 1, 1e6, 1e6, 3), g: [] }),
  kase('partial-negative', [6, 5, 4], { ...cube(-2, -1, .5, 3, 2, 4), g: [] }),
  kase('cube-off-grid', [5, 5, 5], { ...cube(20, 20, 20, 30, 30, 30), g: [] }),
  kase('subcell-slab', [5, 5, 5], { ...cube(1.1, 1.1, 1.1, 1.4, 1.4, 1.4), g: [] }),
  kase('single-cell-grid', [1, 1, 1], { ...cube(0, 0, 0, 1, 1, 1), g: [] }),
  // A degenerate zero-area triangle inside the set is ignored by both the
  // closure check and the scan.
  kase('degenerate-extra-triangle', [8, 6, 5], { v: box.v, i: [...box.i, 0, 0, 0], g: [] }),
  kase('open-mesh', [8, 6, 5], { v: box.v, i: box.i.slice(0, -3), g: [] }, { status: 11 }),
  kase('flipped-triangle', [8, 6, 5], { v: box.v, i: [box.i[2], box.i[1], box.i[0], ...box.i.slice(3)], g: [] }, { status: 11 }),
  kase('duplicate-triangles', [5, 5, 3], { v: [0, 0, 0, 4, 0, 0, 0, 4, 0], i: [0, 1, 2, 0, 1, 2], g: [] }, { status: 11 }),
  kase('all-degenerate', [5, 5, 3], { v: [0, 0, 0, 4, 0, 0, 0, 4, 0], i: [0, 1, 0], g: [] }, { status: 11 }),
  kase('empty-indices', [8, 6, 5], { v: box.v, i: [], g: [] }, { status: 11 }),
  kase('index-out-of-range', [8, 6, 5], { v: box.v, i: [...box.i.slice(0, -1), 8], g: [] }, { status: 5 }),
  kase('nan-vertex', [8, 6, 5], { v: [NaN, ...box.v.slice(1)], i: box.i, g: [] }, { status: 4 }),
  kase('infinite-vertex', [8, 6, 5], { v: [...box.v.slice(0, 9), -Infinity, ...box.v.slice(10)], i: box.i, g: [] }, { status: 4 }),
  kase('huge-coordinate', [8, 6, 5], { v: [3e15, ...box.v.slice(1)], i: box.i, g: [] }, { status: 5 }),
  kase('group-sum-short', [8, 8, 5], { ...merge(cube(.5, .5, .5, 3, 3, 3), cube(4, 4, 1, 6.5, 7, 4)), g: [12, 11] }, { status: 5 }),
  kase('group-sum-over', [8, 8, 5], { ...merge(cube(.5, .5, .5, 3, 3, 3), cube(4, 4, 1, 6.5, 7, 4)), g: [12, 13] }, { status: 5 }),
  kase('group-zero-count', [8, 6, 5], { ...box, g: [12, 0] }, { status: 5 }),
  kase('zero-dimension', [5, 4, 0], { ...box, g: [] }, { status: 1 }),
];

function pack(c) {
  const input = Buffer.concat([
    u32([...c.dims, c.vertices.length / 3, c.indices.length / 3, c.groups.length]),
    f32(c.vertices), u32(c.indices), u32(c.groups),
  ]);
  return { input, n: c.dims[0] * c.dims[1] * c.dims[2], vc: c.vertices.length / 3, tc: c.indices.length / 3, sc: c.groups.length };
}

try {
  const lib = join(scratchDir, 'libw_sim_kernels.rlib'), native = join(scratchDir, 'geometry-reference'), file = join(scratchDir, 'input');
  const rustc = args => execFileSync('rustc', args, { stdio: 'inherit', timeout: 60000 });
  rustc([join(root, 'crates/w-sim-kernels/src/lib.rs'), '--edition', '2021', '--crate-name', 'w_sim_kernels', '--crate-type', 'rlib', '-O', '-C', 'panic=abort', '-o', lib]);
  rustc([fileURLToPath(new URL('./geometry-reference.rs', import.meta.url)), '--edition', '2021', '--extern', `w_sim_kernels=${lib}`, '-O', '-C', 'panic=abort', '-o', native]);

  for (const c of cases) {
    const { input, n, vc, tc, sc } = pack(c);
    const e = new WebAssembly.Instance(module).exports;
    let at = Math.ceil(e.heap_base() / 8) * 8;
    const alloc = (bytes, align = 8) => { at = Math.ceil(at / align) * align; const p = at; at += bytes; return p; };
    const vp = vc ? alloc(vc * 12, 4) : 0, ip = tc ? alloc(tc * 12, 4) : 0, gp = sc ? alloc(sc * 4, 4) : 0;
    const fp = alloc(Math.max(n, 1), 1), sp = tc ? alloc(tc * 40, 8) : 0, op = alloc(8, 4);
    if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
    const memory = new Uint8Array(e.memory.buffer);
    if (vc) memory.set(f32(c.vertices), vp);
    if (tc) memory.set(u32(c.indices), ip);
    if (sc) memory.set(u32(c.groups), gp);
    memory.fill(0xa5, fp, fp + n);
    if (tc) memory.fill(0xa5, sp, sp + tc * 40);
    memory.fill(0xa5, op, op + 8);
    const status = e.voxelize_solids(vp, vc, ip, tc, gp, sc, ...c.dims, fp, sp, op);
    assert.equal(status, c.status, c.name);
    const got = Buffer.concat([
      u32([status]),
      Buffer.from(memory.slice(op, op + 8)),
      Buffer.from(memory.slice(fp, fp + n)),
      Buffer.from(memory.slice(sp, sp + tc * 40)),
    ]);
    writeFileSync(file, input);
    assert.deepEqual(got, execFileSync(native, [file], { timeout: 10000 }), `${c.name}: status/counts/flags/scratch native/WASM bytes`);
    // The legacy entry point is the same single-boundary-set implementation.
    if (sc === 0) {
      memory.fill(0xa5, fp, fp + n);
      if (tc) memory.fill(0xa5, sp, sp + tc * 40);
      memory.fill(0xa5, op, op + 8);
      const legacy = e.voxelize(vp, vc, ip, tc, ...c.dims, fp, sp, op);
      const again = Buffer.concat([
        u32([legacy]),
        Buffer.from(memory.slice(op, op + 8)),
        Buffer.from(memory.slice(fp, fp + n)),
        Buffer.from(memory.slice(sp, sp + tc * 40)),
      ]);
      assert.deepEqual(again, got, `${c.name}: legacy voxelize matches voxelize_solids`);
    }
  }

  // ABI-level rejections must leave every caller byte untouched.
  {
    const c = cases[0], { n, vc, tc, sc } = pack(c);
    const e = new WebAssembly.Instance(module).exports;
    let at = Math.ceil(e.heap_base() / 8) * 8;
    const alloc = (bytes, align = 8) => { at = Math.ceil(at / align) * align; const p = at; at += bytes; return p; };
    const vp = alloc(vc * 12, 4), ip = alloc(tc * 12, 4), gp = alloc(Math.max(sc, 1) * 4, 4);
    const fp = alloc(n, 1), sp = alloc(tc * 40, 8), op = alloc(8, 4);
    if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
    const memory = new Uint8Array(e.memory.buffer);
    memory.set(f32(c.vertices), vp); memory.set(u32(c.indices), ip);
    const end = e.memory.buffer.byteLength;
    const run = (v = vp, nv = vc, i = ip, nt = tc, g = 0, ng = 0, x = 8, y = 6, z = 5, f = fp, s = sp, o = op) =>
      e.voxelize_solids(v, nv, i, nt, g, ng, x, y, z, f, s, o);
    assert.equal(run(), 0);
    const before = Buffer.from(memory.slice(vp));
    const unchanged = () => assert.deepEqual(Buffer.from(memory.slice(vp)), before, 'rejection precedes caller-memory writes');
    for (const [call, want] of [
      // Null, misaligned, sub-heap and out-of-bounds regions for every buffer.
      [() => run(0), 2], [() => run(vp + 2), 2], [() => run(e.heap_base() - 8), 2], [() => run(end - 8), 2],
      [() => run(vp, vc, 0), 2], [() => run(vp, vc, ip + 1), 2], [() => run(vp, vc, end - 4), 2],
      [() => run(vp, vc, ip, tc, gp + 2, 1), 2], [() => run(vp, vc, ip, tc, end - 2, 1), 2],
      [() => run(vp, vc, ip, tc, 0, 0, 8, 6, 5, 0), 2],
      [() => run(vp, vc, ip, tc, 0, 0, 8, 6, 5, end), 2],
      [() => run(vp, vc, ip, tc, 0, 0, 8, 6, 5, fp, 0), 2], [() => run(vp, vc, ip, tc, 0, 0, 8, 6, 5, fp, sp + 4), 2],
      [() => run(vp, vc, ip, tc, 0, 0, 8, 6, 5, fp, end - 8), 2],
      [() => run(vp, vc, ip, tc, 0, 0, 8, 6, 5, fp, sp, 0), 2], [() => run(vp, vc, ip, tc, 0, 0, 8, 6, 5, fp, sp, op + 2), 2],
      [() => run(vp, vc, ip, tc, 0, 0, 8, 6, 5, fp, sp, end - 4), 2],
      // Pairwise overlap between any two regions is rejected.
      [() => run(fp, vc, ip, tc, 0, 0, 8, 6, 5, fp, sp, op), 2],
      [() => run(vp, vc, sp, tc, 0, 0, 8, 6, 5, fp, sp, op), 2],
      [() => run(vp, vc, ip, tc, fp, 1, 8, 6, 5, fp, sp, op), 2],
      [() => run(vp, vc, ip, tc, 0, 0, 8, 6, 5, ip + 2, sp, op), 2],
      [() => run(vp, vc, ip, tc, 0, 0, 8, 6, 5, fp, vp, op), 2],
      [() => run(vp, vc, ip, tc, 0, 0, 8, 6, 5, fp, sp, fp), 2],
      // Dimension failures precede all region validation.
      [() => run(0, vc, 0, tc, 0, 0, 0, 6, 5, 0, 0, 0), 1],
      [() => run(vp, vc, ip, tc, 0, 0, 8, 0, 5, fp, sp, op), 1],
      [() => run(vp, vc, ip, tc, 0, 0, 8, 6, 0, fp, sp, op), 1],
      [() => run(vp, vc, ip, tc, 0, 0, 0x10000, 0x10000, 5, fp, sp, op), 1],
      // Legacy wrapper shares the same validation.
      [() => e.voxelize(0, vc, ip, tc, 8, 6, 5, fp, sp, op), 2],
      [() => e.voxelize(vp, vc, ip, tc, 8, 0, 5, fp, sp, op), 1],
    ]) {
      assert.equal(call(), want);
      unchanged();
    }
    assert.equal(run(), 0, 'same memory reusable after rejected calls');
    const stable = Buffer.from(memory.slice(fp, fp + n));
    assert.equal(run(), 0);
    assert.deepEqual(Buffer.from(memory.slice(fp, fp + n)), stable, 'deterministic rerun');
  }
  console.log(`Geometry: ${cases.length} cases native/WASM exact — even-odd fill, DDA surface marks, grouped/nested/overlapping/clipped solids, closure and coordinate rejections, sentinel counts/flags/scratch through every kernel error; legacy voxelize identical, ABI alias/bounds checks pass.`);
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}
