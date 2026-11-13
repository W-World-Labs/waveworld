// Single pressure projections, tiny grids, exact native/WASM parity and analytic oracles.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'w-sim-mac-projection-'));
const generated = readFileSync(join(root, 'packages/solvers-lbm/src/wasm-kernel.ts'), 'utf8');
const bytes = Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1], 'base64');
const module = new WebAssembly.Module(bytes);
assert.deepEqual(WebAssembly.Module.imports(module), []);

function config(dims, openFaces, iterations = 500) {
  const b = Buffer.alloc(64);
  [...dims, openFaces, iterations].forEach((v, i) => b.writeUInt32LE(v, i * 4));
  [.2, .01, 1.25, 1e-9, 1e-11].forEach((v, i) => b.writeDoubleLE(v, 24 + i * 8));
  return b;
}

function sample(dims, openFaces, varying = false, iterations = 500) {
  const [nx, ny, nz] = dims;
  const fields = [(nx + 1) * ny * nz, nx * (ny + 1) * nz, nx * ny * (nz + 1)]
    .map((n, axis) => Array.from({ length: n }, (_, i) => varying ? ((i * 7 + axis * 3) % 17 - 8) / 4 : 0));
  return { dims, config: config(dims, openFaces, iterations), flags: Buffer.alloc(nx * ny * nz), fields };
}

function floatBytes(values) {
  const b = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => b.writeDoubleLE(v, i * 8));
  return b;
}

function load(c) {
  const e = new WebAssembly.Instance(module).exports;
  assert.equal(e.abi_version(), 11);
  assert.equal(typeof e.mac_project, 'function');
  let at = Math.ceil(e.heap_base() / 8) * 8;
  const alloc = length => { const p = at; at = Math.ceil((at + length) / 8) * 8; return p; };
  const n = c.flags.length;
  const cp = alloc(64), flags = alloc(n), fields = c.fields.map(f => alloc(f.length * 8));
  const pressure = alloc(n * 8), work = alloc(n * 48), topology = alloc(n * 8), stats = alloc(48);
  if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
  const memory = new Uint8Array(e.memory.buffer), view = new DataView(e.memory.buffer);
  const args = [cp, flags, ...fields, pressure, work, topology, stats];
  function reset() {
    memory.set(c.config, cp);
    memory.set(c.flags, flags);
    c.fields.forEach((f, i) => memory.set(floatBytes(f), fields[i]));
    new Float64Array(e.memory.buffer, pressure, n).fill(NaN);
    new Float64Array(e.memory.buffer, work, 6 * n).fill(NaN);
    new Uint32Array(e.memory.buffer, topology, 2 * n).fill(0xffffffff);
    memory.fill(0xa5, stats, stats + 48);
  }
  const readFields = () => Buffer.concat([...fields, pressure].map((p, i) =>
    Buffer.from(memory.slice(p, p + (i < 3 ? c.fields[i].length : n) * 8))));
  reset();
  return { e, args, memory, view, cp, flags, fields, pressure, stats, reset, readFields,
    run: () => e.mac_project(...args) };
}

function near(actual, expected, name) {
  assert(Math.abs(actual - expected) < 2e-10, `${name}: ${actual} vs ${expected}`);
}

try {
  const lib = join(scratch, 'libw_sim_kernels.rlib'), native = join(scratch, 'reference');
  const rustc = args => execFileSync('rustc', args, { stdio: 'inherit', timeout: 60000 });
  rustc([join(root, 'crates/w-sim-kernels/src/lib.rs'), '--edition', '2021', '--crate-name', 'w_sim_kernels',
    '--crate-type', 'rlib', '-O', '-C', 'panic=abort', '-o', lib]);
  rustc([fileURLToPath(new URL('./mac-projection-reference.rs', import.meta.url)), '--edition', '2021',
    '--extern', `w_sim_kernels=${lib}`, '-O', '-C', 'panic=abort', '-o', native]);

  const cases = [];
  for (let axis = 0; axis < 3; axis++) for (const open of [false, true]) {
    const dims = [1, 1, 1]; dims[axis] = 2;
    const c = sample(dims, open ? 3 << (axis * 2) : 0);
    c.fields[axis][1] = 3;
    cases.push({ ...c, axis, open });
  }
  const chambers = sample([5, 2, 2], 0, true);
  for (let i = 2; i < chambers.flags.length; i += 5) chambers.flags[i] = 20;
  cases.push(chambers, sample([5, 3, 2], 63, true), sample([5, 3, 2], 63, true, 1));

  for (const c of cases) {
    const input = join(scratch, 'input');
    writeFileSync(input, Buffer.concat([c.config, c.flags, ...c.fields.map(floatBytes)]));
    const expected = execFileSync(native, [input], { timeout: 10000, maxBuffer: 1024 * 1024 });
    const h = load(c), code = h.run();
    assert.equal(code === 0 ? 1 : 0, expected.readUInt32LE(0), 'native/WASM success flag');
    assert([0, 9].includes(code), `unexpected projection status ${code}`);
    assert.deepEqual(Buffer.from(h.memory.slice(h.stats, h.stats + 48)), expected.subarray(4, 52), 'exact stats or nonconvergence diagnostic');
    assert.deepEqual(h.readFields(), expected.subarray(52), 'exact native/WASM face velocities and pressure');
    if (code === 9) {
      assert.equal(h.view.getUint32(h.stats, true), 1);
      assert(h.view.getFloat64(h.stats + 16, true) > h.view.getFloat64(h.stats + 24, true), 'failure residual exceeds allowed residual');
      assert.deepEqual(h.readFields().subarray(0, c.fields.flat().length * 8), Buffer.concat(c.fields.map(floatBytes)), 'failed solve preserves input velocities');
    } else {
      const final = h.view.getFloat64(h.stats + 24, true), allowed = h.view.getFloat64(h.stats + 32, true);
      assert(final <= allowed && allowed <= c.config.readDoubleLE(48), 'absolute divergence remains a hard bound');
      if (c.axis !== undefined) {
        for (let i = 0; i < 3; i++) near(h.view.getFloat64(h.fields[c.axis] + i * 8, true), c.open ? 1.5 : 0, 'analytic face velocity');
        near(h.view.getFloat64(h.pressure, true), c.open ? -18.75 : 0, 'analytic pressure 0 Pa');
        near(h.view.getFloat64(h.pressure + 8, true), c.open ? 18.75 : 75, 'analytic pressure 1 Pa');
      }
      if (c === chambers) assert.equal(h.view.getUint32(h.stats + 8, true), 2, 'two independently pinned closed components');
    }
    h.reset();
    assert.equal(h.run(), code, 'caller-owned buffers can be reset and reused');
    assert.deepEqual(h.readFields(), expected.subarray(52));
    if (code === 9) {
      h.reset(); h.view.setUint32(h.cp + 16, 500, true);
      assert.equal(h.run(), 0, 'corrected iteration budget recovers using the same memory');
    }
  }

  const h = load(cases[1]);
  // Every region (including read-only config/mask) must be disjoint and in bounds.
  for (let i = 0; i < h.args.length; i++) {
    const args = h.args.slice(); args[i] = 0;
    assert.equal(h.e.mac_project(...args), 2, `null pointer ${i}`);
    args[i] = h.e.memory.buffer.byteLength;
    assert.equal(h.e.mac_project(...args), 2, `past memory ${i}`);
  }
  for (const [a, b] of [[0, 8], [1, 2], [2, 3], [4, 5], [6, 7], [7, 8]]) {
    const args = h.args.slice(); args[a] = args[b];
    const code = h.e.mac_project(...args);
    if (a === 0) assert.notEqual(code, 0, 'aliased config may be rejected while reading its header');
    else assert.equal(code, 2, `alias ${a}/${b} rejected before entering the kernel`);
  }
  for (const i of [0, 2, 3, 4, 5, 6, 8]) {
    const args = h.args.slice(); args[i] += 4;
    assert.equal(h.e.mac_project(...args), 2, `misaligned f64 region ${i}`);
  }
  h.view.setUint32(h.cp + 20, 1, true); assert.equal(h.run(), 7); h.reset();
  h.view.setUint32(h.cp + 12, 64, true); assert.equal(h.run(), 7); h.reset();
  for (const iterations of [0, 4097]) { h.view.setUint32(h.cp + 16, iterations, true); assert.equal(h.run(), 3); h.reset(); }
  for (const at of [0, 4, 8]) { h.view.setUint32(h.cp + at, 0, true); assert.equal(h.run(), 1); h.reset(); }
  for (const at of [24, 32, 40, 48]) { h.view.setFloat64(h.cp + at, 0, true); assert.equal(h.run(), 3); h.reset(); }
  h.view.setFloat64(h.cp + 56, 1, true); assert.equal(h.run(), 3); h.reset();
  h.view.setFloat64(h.fields[0], NaN, true); assert.equal(h.run(), 4); h.reset();
  h.memory.fill(1, h.flags, h.flags + cases[1].flags.length); assert.equal(h.run(), 5); h.reset();
  h.view.setUint32(h.cp, 0xffffffff, true); h.view.setUint32(h.cp + 4, 0xffffffff, true);
  assert.equal(h.run(), 1); h.reset();
  assert.equal(h.run(), 0, 'valid call recovers after rejected inputs');
  console.log('MAC3D projection: nine tiny native/WASM cases, three-axis half-cell pressure oracles, disconnected cavities, explicit nonconvergence and ABI memory rejection passed.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
