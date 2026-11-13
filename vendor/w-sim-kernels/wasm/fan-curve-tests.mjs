// Hand-calculated P-Q cases; no fan geometry or engineering operating-point claim.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'w-sim-fan-curve-'));
const generated = readFileSync(join(root, 'packages/solvers-lbm/src/wasm-kernel.ts'), 'utf8');
const bytes = Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1], 'base64');
const module = new WebAssembly.Module(bytes);
assert.deepEqual(WebAssembly.Module.imports(module), []);
const e = new WebAssembly.Instance(module).exports;
assert.equal(e.abi_version(), 11);
const points = Math.ceil(e.heap_base() / 8) * 8, output = points + 256 * 16;
if (output + 8 > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((output + 8 - e.memory.buffer.byteLength) / 65536));
const view = new DataView(e.memory.buffer);
const curve = [[0, 100], [.01, 40], [.02, 50], [.03, 0]];
function fill(data = curve) {
  data.flat().forEach((v, i) => view.setFloat64(points + i * 8, v, true));
  view.setFloat64(output, 9876.5, true);
}

try {
  const lib = join(scratch, 'libw_sim_kernels.rlib'), native = join(scratch, 'reference');
  const rustc = args => execFileSync('rustc', args, { stdio: 'inherit', timeout: 60000 });
  rustc([join(root, 'crates/w-sim-kernels/src/lib.rs'), '--edition', '2021', '--crate-name', 'w_sim_kernels',
    '--crate-type', 'rlib', '-O', '-C', 'panic=abort', '-o', lib]);
  rustc([fileURLToPath(new URL('./fan-curve-reference.rs', import.meta.url)), '--edition', '2021',
    '--extern', `w_sim_kernels=${lib}`, '-O', '-C', 'panic=abort', '-o', native]);
  const cases = [[0, 1, 100], [.005, 1, 70], [.01, 1, 40], [.015, 1, 45], [.02, 1, 50], [.03, 1, 0],
    [0, .5, 25], [.0025, .5, 17.5], [.0075, .5, 11.25], [.015, .5, 0]];
  for (const [flow, rpm, pressure] of cases) {
    fill();
    const expected = execFileSync(native, [flow, rpm, ...curve.flat()].map(String), { timeout: 10000 });
    assert.equal(e.fan_curve_pressure(points, curve.length, flow, rpm, output), 0);
    assert.deepEqual(Buffer.from(new Uint8Array(e.memory.buffer, output, 8)), expected, 'exact native/WASM pressure');
    assert(Math.abs(view.getFloat64(output, true) - pressure) < 1e-12, 'hand interpolation/affinity oracle');
  }
  // Error paths preserve the scalar output; all malformed memory is rejected before Rust slices.
  for (const [p, n, q, s, out, status] of [
    [0, 4, 0, 1, output, 2], [points + 4, 4, 0, 1, output, 2],
    [points, 4, 0, 1, points, 2], [points, 4, 0, 1, output + 4, 2],
    [points, 4, 0, 1, 0, 2], [e.memory.buffer.byteLength, 4, 0, 1, output, 2],
    [points, 0, 0, 1, output, 2], [points, 1, 0, 1, output, 2], [points, 257, 0, 1, output, 2],
  ]) {
    fill(); assert.equal(e.fan_curve_pressure(p, n, q, s, out), status);
    assert.equal(view.getFloat64(output, true), 9876.5);
  }
  for (const [q, s] of [[-.001, 1], [.031, 1], [.02, .5], [0, 0], [0, -1], [0, 1.01], [NaN, 1], [0, Infinity]]) {
    fill(); assert.notEqual(e.fan_curve_pressure(points, curve.length, q, s, output), 0);
    assert.equal(view.getFloat64(output, true), 9876.5);
  }
  for (const invalid of [ [[0, 100], [0, 0]], [[.01, 20], [0, 10]], [[0, 100], [.01, -1]], [[0, 100], [NaN, 0]] ]) {
    fill(invalid); assert.notEqual(e.fan_curve_pressure(points, invalid.length, 0, 1, output), 0);
    assert.equal(view.getFloat64(output, true), 9876.5);
  }
  fill(); assert.equal(e.fan_curve_pressure(points, curve.length, .005, 1, output), 0);
  assert.equal(view.getFloat64(output, true), 70);
  console.log('Fan P-Q: ten analytic/native/WASM cases, nonmonotone interpolation, RPM affinity, invalid range and memory rejection passed.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
