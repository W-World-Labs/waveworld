// Short shared-kernel heat transport, native/WASM parity and unsafe ABI guards.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'w-sim-mac-thermal-'));
const generated = readFileSync(join(root, 'packages/solvers-lbm/src/wasm-kernel.ts'), 'utf8');
const module = new WebAssembly.Module(Buffer.from(generated.match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1], 'base64'));
assert.deepEqual(WebAssembly.Module.imports(module), []);
const floatBytes = values => { const b = Buffer.alloc(values.length * 8); values.forEach((v, i) => b.writeDoubleLE(v, i * 8)); return b; };
const near = (got, want, name, tol = 2e-11) => assert(Math.abs(got - want) <= tol, `${name}: ${got} vs ${want}`);
const index = (d, p) => p[0] + d[0] * (p[1] + d[1] * p[2]);

function sample(name, dims, open = 0, dt = .1) {
  const [nx, ny, nz] = dims, config = Buffer.alloc(1816), n = nx * ny * nz;
  [...dims, open, 100].forEach((v, i) => config.writeUInt32LE(v, 4 * i));
  [1, dt, 1, 1e-10, 0].forEach((v, i) => config.writeDoubleLE(v, 24 + 8 * i));
  [0, dt, 20, 0, 1, 1, 1, 1, 1, 1, 1, 0].forEach((v, i) => config.writeDoubleLE(v, 64 + 8 * i));
  config.writeUInt32LE(1, 160); config.writeUInt32LE(64, 164); config.writeDoubleLE(1, 168);
  const counts = [(nx + 1) * ny * nz, nx * (ny + 1) * nz, nx * ny * (nz + 1)];
  return { name, dims, config, counts, flags: Buffer.alloc(n), fields: counts.map(n => Array(n).fill(0)), energy: Array(n).fill(0), steps: 1, status: 0 };
}

function duct(axis, sign) {
  const dims = [1, 1, 1], cross = (axis + 1) % 3;
  dims[axis] = 2; dims[cross] = 3;
  const c = sample(`axis ${axis} flow ${sign}`, dims, 3 << (2 * axis));
  c.flags.fill(1);
  for (let j = 0; j < 2; j++) {
    const p = [0, 0, 0]; p[axis] = j;
    const i = index(dims, p); c.flags[i] = 0; c.energy[i] = sign > 0 ? 20 + 20 * j : 40 - 20 * j;
  }
  const solid = [0, 0, 0]; solid[cross] = 2; c.flags[index(dims, solid)] = 4;
  const faces = [...dims]; faces[axis]++;
  for (let j = 0; j < 3; j++) { const p = [0, 0, 0]; p[axis] = j; c.fields[axis][index(faces, p)] = sign; }
  c.steps = 3;
  c.check = (s, e, step) => {
    if (step !== 0) return;
    const first = [0, 0, 0], last = [0, 0, 0]; last[axis] = 1;
    near(e[index(dims, first)], sign > 0 ? 20 : 36, 'upwind/conduction first');
    near(e[index(dims, last)], sign > 0 ? 36 : 20, 'upwind/conduction last');
    near(s[2], -4, 'external sensible heat'); near(s[0], 56, 'remaining energy');
    assert.equal(s[6], 1);
  };
  return c;
}

function load(c) {
  const e = new WebAssembly.Instance(module).exports;
  assert.equal(e.abi_version(), 11);
  let at = Math.ceil(e.heap_base() / 8) * 8;
  const alloc = n => { const p = at; at = Math.ceil((at + n) / 8) * 8; return p; };
  const n = c.flags.length, config = alloc(1816), table = alloc(32), flags = alloc(n);
  const fields = c.counts.map(n => alloc(8 * n)), initial = alloc(8 * n), destination = alloc(8 * n);
  const temperature = alloc(8 * n), work = alloc(8 * n), output = alloc(56);
  if (at > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((at - e.memory.buffer.byteLength) / 65536));
  const memory = new Uint8Array(e.memory.buffer), view = new DataView(e.memory.buffer);
  let energy = initial, next = destination;
  const values = (p, count = n) => new Float64Array(e.memory.buffer, p, count);
  const pointers = () => [flags, ...fields, energy, next, temperature, work];
  const fillTable = () => pointers().forEach((p, i) => view.setUint32(table + 4 * i, p, true));
  const read = (p, bytes) => Buffer.from(memory.slice(p, p + bytes));
  function reset() {
    energy = initial; next = destination;
    memory.set(c.config, config); memory.set(c.flags, flags); fillTable();
    c.fields.forEach((f, i) => memory.set(floatBytes(f), fields[i]));
    memory.set(floatBytes(c.energy), energy);
    for (const p of [next, temperature, work]) values(p).fill(NaN);
    memory.fill(0xa5, output, output + 56);
  }
  const inputs = () => Buffer.concat([read(config, 1816), read(table, 32), read(flags, n),
    ...fields.map((p, i) => read(p, c.counts[i] * 8)), read(energy, n * 8)]);
  reset();
  return { e, config, table, output, flags, fields, memory, view, values, pointers, reset, read, inputs,
    all: () => read(config, at - config),
    next: () => next, temperature,
    run: () => e.mac_thermal_step(config, table, output),
    swap: () => { [energy, next] = [next, energy]; fillTable(); } };
}

try {
  const lib = join(scratch, 'libw_sim_kernels.rlib'), native = join(scratch, 'reference');
  const rustc = args => execFileSync('rustc', args, { stdio: 'inherit', timeout: 60000 });
  rustc([join(root, 'crates/w-sim-kernels/src/lib.rs'), '--edition', '2021', '--crate-name', 'w_sim_kernels', '--crate-type', 'rlib', '-O', '-C', 'panic=abort', '-o', lib]);
  rustc([fileURLToPath(new URL('./mac-thermal-reference.rs', import.meta.url)), '--edition', '2021', '--extern', `w_sim_kernels=${lib}`, '-O', '-C', 'panic=abort', '-o', native]);
  const cases = [0, 1, 2].flatMap(axis => [duct(axis, 1), duct(axis, -1)]);
  const contact = sample('material contacts and regional power', [4, 1, 1]);
  contact.flags.set([0, 4, 5, 5]); contact.energy = [0, 10, 20, 20];
  contact.config.writeDoubleLE(2, 152); contact.config.writeUInt32LE(1, 176);
  [1, 1, 4, 6].forEach((v, i) => contact.config.writeDoubleLE(v, 184 + i * 8));
  contact.config.writeUInt32LE(1, 696); contact.config.writeDoubleLE(.375, 728);
  contact.steps = 3;
  contact.check = (s, e, step) => {
    near(s[1], .8, 'power is region total'); near(s[2], 0, 'closed boundary');
    near(s[0], 50 + .8 * (step + 1), 'closed source balance');
    if (step === 0) {
      // Fluid/default G=1, default/palette G=1/(.5+.375+.125)=1 W/K.
      [1, 10.2, 19.3, 20.3].forEach((v, i) => near(e[i], v, 'contact one-face budget'));
    }
  };
  cases.push(contact);
  const fixed = sample('half-cell fixed and ambient reservoirs', [3, 1, 1]);
  fixed.flags.set([2, 0, 3]); fixed.energy = [0, 10, 0];
  fixed.config.writeUInt32LE(0, 160); fixed.config.writeDoubleLE(60, 88);
  [128, 136, 144].forEach(at => fixed.config.writeDoubleLE(0, at));
  fixed.check = (s, e) => { near(e[1], 14, 'net reservoir energy'); near(s[2], 4, 'reservoir balance'); assert.equal(s[6], 1); };
  cases.push(fixed);
  const substeps = sample('combined advection .6 + conduction .4', [2, 3, 1], 3, 1);
  substeps.flags.set([0, 0, 1, 1, 4, 4]); substeps.energy = [48, 24, 0, 0, 0, 0];
  substeps.fields[0].fill(.6, 0, 3);
  substeps.config.writeDoubleLE(2, 40); substeps.config.writeDoubleLE(2, 104);
  substeps.config.writeDoubleLE(3, 112); substeps.config.writeDoubleLE(2.4, 120);
  substeps.check = (s, e) => {
    assert.equal(s[6], 2); near(e[0], 21.6, 'combined substeps inlet'); near(e[1], 32.4, 'combined substeps outlet');
    near(s[0], 54, 'combined total'); near(s[2], -18, 'combined outlet'); near(s[3], 0, 'substep energy residual');
  };
  cases.push(substeps);
  const limited = { ...substeps, name: 'substep limit rejects macro step', config: Buffer.from(substeps.config), status: 3 };
  limited.config.writeUInt32LE(1, 164); cases.push(limited);
  const badState = duct(0, 1); badState.name = 'input divergence rejected'; badState.steps = 1; badState.fields[0][1] = 2; badState.status = 5;
  cases.push(badState);

  for (const [i, c] of cases.entries()) {
    const fixture = join(scratch, `${i}.bin`), header = Buffer.alloc(4); header.writeUInt32LE(c.steps);
    writeFileSync(fixture, Buffer.concat([header, c.config, c.flags, ...c.fields.map(floatBytes), floatBytes(c.energy)]));
    const expected = execFileSync(native, [fixture], { timeout: 10000 });
    const m = load(c); let at = 0;
    for (let step = 0; step < c.steps; step++) {
      const input = m.inputs(), status = m.run();
      assert.equal(status, c.status, c.name); assert.equal(status, expected.readUInt32LE(at), c.name); at += 4;
      assert.deepEqual(m.inputs(), input, `${c.name}: read-only inputs`);
      assert.deepEqual(m.read(m.output, 56), expected.subarray(at, at + 56), `${c.name}: all stats`); at += 56;
      if (status) break;
      for (const p of [m.next(), m.temperature]) {
        assert.deepEqual(m.read(p, c.flags.length * 8), expected.subarray(at, at + c.flags.length * 8), `${c.name}: f64 fields`);
        at += c.flags.length * 8;
      }
      c.check?.(m.values(m.output, 7), m.values(m.next()), step);
      m.swap();
    }
    assert.equal(at, expected.length);
    m.reset(); assert.equal(m.run(), c.status, `${c.name}: reset/reuse`);
  }

  const m = load(contact);
  function memoryFailure(change, invoke = () => m.run()) {
    m.reset(); change(); const before = m.all();
    assert.equal(invoke(), 2); assert.deepEqual(m.all(), before, 'invalid region must not mutate caller memory');
  }
  for (let i = 0; i < 8; i++) {
    for (const address of [0, m.e.memory.buffer.byteLength - 1, m.config]) memoryFailure(() => m.view.setUint32(m.table + 4 * i, address, true));
    if (i > 0) memoryFailure(() => m.view.setUint32(m.table + 4 * i, m.pointers()[i] + 1, true));
  }
  memoryFailure(() => {}, () => m.e.mac_thermal_step(m.config + 1, m.table, m.output));
  memoryFailure(() => {}, () => m.e.mac_thermal_step(m.config, m.table + 1, m.output));
  memoryFailure(() => {}, () => m.e.mac_thermal_step(m.config, m.table, m.output + 1));
  memoryFailure(() => {}, () => m.e.mac_thermal_step(m.config, m.table, m.pointers()[4]));
  memoryFailure(() => m.view.setUint32(m.table + 20, m.pointers()[4], true));
  memoryFailure(() => m.view.setUint32(m.table + 28, m.temperature, true));
  for (const [at, value, status, word] of [
    [20, 1, 7, true], [180, 1, 7, true], [716, 1, 7, true],
    [64, .1, 6, false], [72, .2, 3, false], [96, 2, 3, false], [104, 2, 3, false],
    [164, 0, 3, true], [176, 17, 6, true],
  ]) {
    m.reset(); word ? m.view.setUint32(m.config + at, value, true) : m.view.setFloat64(m.config + at, value, true);
    const input = m.inputs(), output = m.read(m.output, 56);
    assert.equal(m.run(), status, `invalid config offset ${at}`);
    assert.deepEqual(m.inputs(), input); assert.deepEqual(m.read(m.output, 56), output);
  }
  console.log(`WASM ABI9: ${cases.length} short MAC heat cases match native bytes; independent heat budgets, substeps, state and memory guards passed.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
