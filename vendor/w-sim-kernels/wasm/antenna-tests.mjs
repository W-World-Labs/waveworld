// Old-JS captured values; all executed math uses Rust native/WASM.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../..', import.meta.url)), scratch = mkdtempSync(join(tmpdir(), 'w-sim-antenna-'))
const fixture = name => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))))
const original = fixture('antenna-original-ts'), oracle = fixture('antenna-math-oracle')
const binary = Buffer.from(readFileSync(join(root, 'packages/solvers-lbm/src/wasm-kernel.ts'), 'utf8').match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1], 'base64')
const module = new WebAssembly.Module(binary), types = ['isotropic', 'dipole', 'directional'], cases = []
const cfgLink = p => [p.ptDbm, p.gtDbi, p.grDbi, p.frequencyHz, p.distM]
const cfgArray = p => [p.dOverLambda, p.steerDeg]
for (const f of original.links) {
  cases.push({ op: 0, p: cfgLink(f.p), type: types.indexOf(f.p.type), want: [f.result.directivityDb, f.result.beamwidthDeg, f.result.link.prDbm, f.result.link.fsplDb, ...f.result.pattern, ...f.result.powersDbm] })
  cases.push({ op: 12, p: cfgLink(f.p), type: types.indexOf(f.p.type), want: [f.result.link.prDbm, f.result.link.fsplDb] })
}
for (const f of original.links.slice(0, 1).concat(original.links.slice(3, 4), original.links.slice(6, 7))) {
  cases.push({ op: 4, type: types.indexOf(f.p.type), want: [f.result.directivityDb] })
  cases.push({ op: 5, type: types.indexOf(f.p.type), want: [f.result.beamwidthDeg] })
}
for (const f of original.three) cases.push({ op: 1, p: [f.p.frequencyHz, f.p.ptDbm, f.p.distM, f.p.elevationDeg, f.p.polarizationDeg], want: [f.result.prDbm ?? 0, f.result.fsplDb, f.result.plf, f.result.prDbm === null ? 0 : 1, ...f.result.pattern] })
for (const f of original.arrays) cases.push({ op: 2, p: cfgArray(f.p), n: f.p.n, old: f.result })
for (const f of original.helpers) {
  if (f.kind === 'pattern') cases.push({ op: 3, type: types.indexOf(f.type), x: f.args[0], want: [f.result] })
  if (f.kind === 'polarization' || f.kind === 'power') cases.push({ op: f.kind === 'polarization' ? 6 : 7, x: f.args[0], want: [f.result] })
  if (f.kind === 'factor') cases.push({ op: 8, x: f.args[0], n: f.args[1], p: f.args.slice(2), want: [f.result] })
  if (f.kind === 'grating') cases.push({ op: 10, p: f.args, want: [f.result.length, ...f.result, ...Array(20 - f.result.length).fill(0)] })
  if (f.kind === 'array') cases.push({ op: 9, n: f.args[0], p: f.args.slice(1, 3), count: f.args[3], old: f })
}
const decode = hex => Buffer.from(hex, 'hex').readDoubleBE()
const mathErrors = [0, 0, 0], oldErrors = { pattern: 0, linkDb: 0, threeDb: 0, array: 0 }
try {
  const lib = join(scratch, 'libw_sim_kernels.rlib'), native = join(scratch, 'reference'), inputFile = join(scratch, 'input')
  execFileSync('rustc', [join(root, 'crates/w-sim-kernels/src/lib.rs'), '--edition', '2021', '--crate-name', 'w_sim_kernels', '--crate-type', 'rlib', '-O', '-C', 'panic=abort', '-o', lib], { stdio: 'inherit', timeout: 60000 })
  execFileSync('rustc', [fileURLToPath(new URL('./antenna-reference.rs', import.meta.url)), '--edition', '2021', '--extern', `w_sim_kernels=${lib}`, '-O', '-C', 'panic=abort', '-o', native], { stdio: 'inherit', timeout: 60000 })
  for (const c of cases) {
    const input = Buffer.alloc(64); input.writeUInt32LE(c.op, 0); input.writeUInt32LE(c.type ?? 0, 8); input.writeUInt32LE(c.count ?? 0, 12)
    ;(c.p ?? [c.x ?? 0]).forEach((v, i) => input.writeDoubleLE(v, 16 + i * 8))
    if ([0, 12].includes(c.op)) input.writeUInt32LE(c.type, 56)
    if ([2, 8, 9].includes(c.op)) input.writeUInt32LE(c.n, 32)
    if (c.op === 8) input.writeDoubleLE(c.x, 48)
    writeFileSync(inputFile, input); const expected = execFileSync(native, [inputFile], { timeout: 10000 })
    const e = new WebAssembly.Instance(module).exports, cp = (e.heap_base() + 7) & ~7, out = cp + 64, pattern = out + 32, scan = pattern + 361 * 16, phases = scan + 2001 * 16, grating = phases + 48 * 8, end = grating + 20 * 8
    if (end > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((end - e.memory.buffer.byteLength) / 65536))
    const memory = new Uint8Array(e.memory.buffer), f64 = (p, n) => new Float64Array(e.memory.buffer, p, n), v = new DataView(e.memory.buffer)
    memory.set(input.subarray(16), cp)
    const run = () => {
      switch (c.op) {
        case 0: return e.antenna_link(cp, pattern, scan, out)
        case 1: return e.antenna_3d(cp, pattern, out)
        case 2: return e.array_result(cp, pattern, scan, phases, grating, out)
        case 3: return e.antenna_pattern(c.type, c.x, out)
        case 4: return e.antenna_directivity(c.type, out)
        case 5: return e.antenna_beamwidth(c.type, out)
        case 6: return e.antenna_polarization(c.x, out)
        case 7: return e.antenna_dipole_power(c.x, out)
        case 8: return e.array_factor(cp, c.x, out)
        case 9: return e.array_beamwidth(cp, scan, c.count, out)
        case 10: return e.array_grating(c.p[0], c.p[1], grating, out)
        case 12: return e.antenna_friis(cp, out)
      }
    }
    assert.equal(run(), 0, `op=${c.op}`)
    const chunks = c.op === 0 ? [[out, 32], [pattern, 361 * 8], [scan, 121 * 8]] : c.op === 1 ? [[out, 32], [pattern, 49 * 8]] : c.op === 2 ? [[out, 24], [pattern, 361 * 16], [scan, 2001 * 16], [phases, c.n * 8], [grating, 160]] : c.op === 9 ? [[out, 16], [scan, c.count * 16]] : c.op === 10 ? [[out, 8], [grating, 160]] : [[out, c.op === 12 ? 16 : 8]]
    if (c.op === 10) f64(out, 1)[0] = v.getUint32(out, true)
    const collect = () => Buffer.concat(chunks.map(([p, bytes]) => Buffer.from(memory.slice(p, p + bytes))))
    const got = collect(); assert.deepEqual(got, expected, `native/WASM complete outputs op=${c.op}`)
    const compare = (actual, wanted, category, tolerance) => {
      assert.equal(actual.length, wanted.length)
      actual.forEach((x, i) => { const err = Math.abs(x - wanted[i]); oldErrors[category] = Math.max(oldErrors[category], err); assert(err <= tolerance, `${category}[${i}]: ${x} vs ${wanted[i]}, error ${err}`) })
    }
    if (c.want) {
      const values = c.want.map((_, i) => got.readDoubleLE(i * 8))
      if (c.op === 0) { assert.equal(values[1], c.want[1], 'antenna scan boundary exact'); compare(values.slice(0, 4), c.want.slice(0, 4), 'linkDb', 2e-12); compare(values.slice(4, 365), c.want.slice(4, 365), 'pattern', 5e-14); compare(values.slice(365), c.want.slice(365), 'linkDb', 2e-12) }
      else if (c.op === 1) { assert.equal(values[3], c.want[3], 'zero-power null flag exact'); compare(values.slice(0, 2), c.want.slice(0, 2), 'threeDb', 2e-9); compare(values.slice(2), c.want.slice(2), 'pattern', 5e-14) }
      else if ([3, 6, 7].includes(c.op)) compare(values, c.want, 'pattern', 5e-14)
      else if ([8, 10].includes(c.op)) { compare(values, c.want, 'array', 2e-12); if (c.op === 10) assert.equal(values[0], c.want[0], 'grating count exact') }
      else compare(values, c.want, 'linkDb', 2e-12)
    }
    if (c.op === 2) {
      assert.deepEqual(Array.from(f64(out, 3)), [c.old.beamwidthDeg, Number(c.old.beamwidthClipped), c.old.grating.length], 'array scan width/clipping/count exact')
      compare(Array.from(f64(pattern, 722)), c.old.pattern.flatMap(s => [s.theta, s.gain]), 'array', 2e-12)
      compare(Array.from(f64(phases, c.n)), c.old.phases, 'array', 2e-12)
      compare(Array.from(f64(grating, c.old.grating.length)), c.old.grating, 'array', 2e-12)
      assert.equal(e.array_pattern(cp, 361, pattern), 0); assert.deepEqual(collect(), got, 'shared array helper pattern equals full result')
      f64(cp + 8, 1)[0] = 0; assert.equal(run(), 0); assert(f64(phases, c.n).every(x => Object.is(x, 0)), 'zero steering resets phases to +0')
      memory.set(input.subarray(16), cp); assert.equal(run(), 0); assert.deepEqual(collect(), got, 'persistent owner resets grating tails and output')
    }
    if (c.op === 9) { assert.equal(f64(out, 1)[0], c.old.width); compare(Array.from(f64(scan, c.count * 2)), c.old.result.flatMap(s => [s.theta, s.gain]), 'array', 2e-12) }
    // Reject alias, alignment, range and oversized product n before constructing slices.
    const snapshot = Buffer.from(memory.slice(cp, end))
    const malformed = [() => e.antenna_friis(cp, cp), () => e.antenna_link(cp, pattern, pattern, out), () => e.antenna_link(cp, pattern, e.memory.buffer.byteLength - 8, out), () => e.antenna_3d(cp, pattern, cp), () => e.array_pattern(cp, 361, cp), () => e.array_factor(cp, 0, cp), () => e.array_beamwidth(cp, scan, 2001, scan), () => e.array_grating(1, 0, grating, grating), () => e.array_result(cp, pattern, pattern, phases, grating, out), () => e.array_result(cp, pattern, scan, grating, grating, out), () => e.array_result(cp, pattern, scan, phases, grating, cp), () => e.array_result(cp + 1, pattern, scan, phases, grating, out), () => e.antenna_pattern(0, 0, out + 1), () => e.antenna_math(0, 1, e.memory.buffer.byteLength - 4)]
    // Config layouts differ: build canonical valid records for invalid-memory calls.
    memory.fill(0, cp, cp + 48); f64(cp, 5).set([1, 1, 1, 1, 1]); v.setUint32(cp + 16, 8, true); v.setUint32(cp + 20, 0, true)
    const clean = Buffer.from(memory.slice(cp, end)); for (const call of malformed) assert.equal(call(), 2); assert.deepEqual(Buffer.from(memory.slice(cp, end)), clean)
    memory.set(snapshot, cp)
    if ([0, 12].includes(c.op)) { v.setUint32(cp + 44, 1, true); assert.equal(run(), 7); v.setUint32(cp + 44, 0, true); v.setUint32(cp + 40, 3, true); assert.equal(run(), 3) }
    if ([2, 8, 9].includes(c.op)) { v.setUint32(cp + 20, 1, true); assert.equal(run(), 7); v.setUint32(cp + 20, 0, true); v.setUint32(cp + 16, c.op === 2 ? 49 : 4097, true); assert.equal(run(), 3); v.setUint32(cp + 16, c.n, true); f64(cp, 1)[0] = NaN; assert.equal(run(), 4) }
    for (const bad of [NaN, Infinity]) { assert.equal(e.antenna_pattern(0, bad, out), 4); assert.equal(e.antenna_polarization(bad, out), 4); assert.equal(e.array_grating(1, bad, grating, out), 4); assert.equal(e.antenna_math(0, bad, out), 4) }
    v.setUint32(cp + 20, 0, true); assert.equal(e.array_pattern(cp, 1, pattern), 1); assert.equal(e.array_beamwidth(cp, scan, 0, out), 1)
  }
  // Batch native oracle execution; WASM writes one scalar at a time on one owner.
  const input = Buffer.alloc(16 + oracle.cases.length * 16); input.writeUInt32LE(13, 0); input.writeUInt32LE(oracle.cases.length, 12)
  const e = new WebAssembly.Instance(module).exports, out = (e.heap_base() + 7) & ~7, parts = []
  for (const [i, [op, xHex, yHex]] of oracle.cases.entries()) {
    const x = decode(xHex), expected = decode(yHex); input.writeUInt32LE(op, 16 + i * 16); input.writeDoubleLE(x, 24 + i * 16)
    assert.equal(e.antenna_math(op, x, out), 0); const bytes = Buffer.from(new Uint8Array(e.memory.buffer).slice(out, out + 8)); parts.push(bytes)
    const actual = bytes.readDoubleLE(), err = Math.abs(actual - expected), metric = op === 1 ? err / expected : err / Math.max(1, Math.abs(expected))
    mathErrors[op] = Math.max(mathErrors[op], metric); assert(metric <= [7e-16, 4e-15, 7e-16][op], `oracle op${op} x${x}: ${actual} != ${expected}`)
  }
  writeFileSync(inputFile, input); assert.deepEqual(Buffer.concat(parts), execFileSync(native, [inputFile], { timeout: 10000 }), 'native/WASM all oracle bits exact')
  for (const [op, x] of [[0, 0], [0, -1], [1, -.1], [1, 5.01], [2, 1.00001], [3, 1]]) assert.equal(e.antenna_math(op, x, out), 3)
  console.log(`Antenna: 39 captured complete scenes +57 helpers, ${cases.length} native/WASM calls and ${oracle.cases.length} independent math references exact; width/clipping/grating/null semantics unchanged. Old-JS max abs ${JSON.stringify(oldErrors)}; oracle log10-scaled/pow10-relative/asin-scaled=${mathErrors.join('/')}. Memory/config/overflow checks pass.`)
} finally { rmSync(scratch, { recursive: true, force: true }) }
