// Captured old-JS values and an independent 720-digit Decimal oracle; no JS solver.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'w-sim-plane-'))
const fixture = name => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))))
const original = fixture('plane-original-ts'), oracle = fixture('phase-high-precision')
const smallPrevious = fixture('phase-small-wasm')
const constants = readFileSync(join(root, 'crates/w-sim-kernels/src/phase.rs'), 'utf8').match(/const TWO_OVER_PI[^=]*= \[([\s\S]*?)\];/)[1].match(/0x[0-9a-f]+/g)
assert.equal(constants.reverse().map(v => v.slice(2).padStart(8, '0')).join(''), oracle.twoOverPiHex, 'core constants match independently generated 2/pi integer')
const bytes = Buffer.from(readFileSync(join(root, 'packages/solvers-lbm/src/wasm-kernel.ts'), 'utf8').match(/WASM_KERNEL_BASE64 = '([^']+)'/)[1], 'base64')
const module = new WebAssembly.Module(bytes)
{
  const e = new WebAssembly.Instance(module).exports, output = (e.heap_base() + 7) & ~7
  for (const [angle, bits] of smallPrevious.cases) {
    assert.equal(e.optics_unit(angle, output), 0)
    assert.equal(Buffer.from(e.memory.buffer, output, 16).toString('hex'), bits, 'previous WASM small-phase path remains byte-identical')
  }
}
const cases = [
  ...original.em.map(f => ({ kind: 0, p: [f.p.frequencyHz, f.p.refractiveIndex, f.p.ePeak, f.p.phase0 ?? 0], time: f.time, xs: f.xs,
    want: [f.obs.wavelengthM, f.obs.phaseVelocity, f.obs.impedance, f.obs.bPeak, f.obs.intensityWm2, ...f.sample.E, ...f.sample.B] })),
  ...original.sound.map(f => ({ kind: 1, p: [f.p.frequencyHz, f.p.rho, f.p.c, f.p.pPeak, f.p.phase0 ?? 0], time: f.time, xs: f.xs,
    want: [f.obs.wavelengthM, f.obs.impedance, f.obs.vPeak, f.obs.intensityWm2, ...f.sample.pressure, ...f.sample.velocity] })),
  ...original.em3d.map(f => ({ kind: 2, p: [f.p.waveNumber, f.p.amplitude, f.p.time], xs: new Array(140).fill(0),
    want: [f.result.wavelength, ...f.result.z, ...f.result.ey, ...f.result.cbx] })),
]
const decode = hex => Buffer.from(hex, 'hex').readDoubleBE()
cases.push({ kind: 3, p: [], xs: oracle.cases.map(c => decode(c[0])) })
const maxOldAbs = [0, 0, 0], maxOldScaled = [0, 0, 0]
let maxOracleAbs = 0, maxLargeUlp = 0n
try {
  const lib = join(scratch, 'libw_sim_kernels.rlib'), native = join(scratch, 'reference')
  execFileSync('rustc', [join(root, 'crates/w-sim-kernels/src/lib.rs'), '--edition', '2021', '--crate-name', 'w_sim_kernels', '--crate-type', 'rlib', '-O', '-C', 'panic=abort', '-o', lib], { stdio: 'inherit', timeout: 60000 })
  execFileSync('rustc', [fileURLToPath(new URL('./plane-reference.rs', import.meta.url)), '--edition', '2021', '--extern', `w_sim_kernels=${lib}`, '-O', '-C', 'panic=abort', '-o', native], { stdio: 'inherit', timeout: 60000 })
  for (const c of cases) {
    const n = c.xs.length, input = Buffer.alloc(56 + n * 8)
    input.writeUInt32LE(c.kind, 0); input.writeUInt32LE(n, 4); input.writeDoubleLE(c.time ?? 0, 8)
    c.p.forEach((v, i) => input.writeDoubleLE(v, 16 + i * 8))
    c.xs.forEach((v, i) => input.writeDoubleLE(v, 56 + i * 8))
    const file = join(scratch, 'input'); writeFileSync(file, input)
    const expected = execFileSync(native, [file], { timeout: 10000 })
    const e = new WebAssembly.Instance(module).exports, cp = (e.heap_base() + 7) & ~7, out = cp + 40, xp = out + 40, ap = xp + n * 8, bp = ap + n * 8, end = bp + n * 8
    if (end > e.memory.buffer.byteLength) e.memory.grow(Math.ceil((end - e.memory.buffer.byteLength) / 65536))
    const memory = new Uint8Array(e.memory.buffer), view = (p, n) => new Float64Array(e.memory.buffer, p, n)
    memory.set(input.subarray(16, 56), cp); view(xp, n).set(c.xs)
    const run = (time = c.time ?? 0) => c.kind === 0 ? e.plane_em_sample(cp, time, xp, n, ap, bp) : e.plane_acoustic_sample(cp, time, xp, n, ap, bp)
    const read = () => c.kind === 0 ? e.plane_em_read(cp, out) : e.plane_acoustic_read(cp, out)
    let got
    if (c.kind < 2) {
      assert.equal(read(), 0); assert.equal(run(), 0)
      const count = c.kind === 0 ? 5 : 4
      got = Buffer.concat([Buffer.from(memory.slice(out, out + count * 8)), Buffer.from(memory.slice(ap, end))])
      // Same owner, fields overwritten without allocations/copies or stale time.
      assert.equal(run((c.time ?? 0) + 0.125), 0); assert.equal(run(), 0)
      assert.deepEqual(Buffer.from(memory.slice(ap, end)), got.subarray(count * 8))
    } else if (c.kind === 2) {
      assert.equal(e.plane_em3d(cp, xp, ap, bp, out), 0)
      got = Buffer.concat([Buffer.from(memory.slice(out, out + 8)), Buffer.from(memory.slice(xp, end))])
      assert.deepEqual(Array.from(view(xp, 140)), c.want.slice(1, 141), 'z grid operation order')
      for (let i = 0; i < n; i++) assert(Object.is(view(bp, n)[i], -view(ap, n)[i]), 'signed cbx = -ey')
    } else {
      const chunks = []
      for (const [i, row] of oracle.cases.entries()) {
        const angle = decode(row[0]); assert.equal(e.plane_sincos(angle, out), 0)
        chunks.push(Buffer.from(memory.slice(out, out + 16)))
        for (let j = 0; j < 2; j++) {
          const reference = decode(row[j + 1]), actual = view(out, 2)[j]
          const err = Math.abs(reference - actual); maxOracleAbs = Math.max(maxOracleAbs, err)
          assert(err <= 7e-16, `oracle[${i},${j}] ${angle}: ${actual} vs ${reference}`)
          if (Math.abs(angle) > 262144) {
            const b = Buffer.alloc(8); b.writeDoubleBE(actual)
            let ulp = b.readBigUInt64BE() - BigInt(`0x${row[j + 1]}`); if (ulp < 0n) ulp = -ulp
            maxLargeUlp = maxLargeUlp > ulp ? maxLargeUlp : ulp
            assert(ulp <= 4n, `large phase error ${ulp} ulp at ${angle}`)
          }
        }
      }
      got = Buffer.concat(chunks)
      for (const bad of [NaN, Infinity, -Infinity]) assert.equal(e.plane_sincos(bad, out), 4)
      for (const bad of [0, cp + 1, e.memory.buffer.byteLength - 8]) assert.equal(e.plane_sincos(1, bad), 2)
    }
    assert.deepEqual(got, expected, `native/WASM all fields/readout exact, kind=${c.kind}`)
    if (c.want) c.want.forEach((v, i) => {
      const actual = got.readDoubleLE(i * 8), err = Math.abs(actual - v), scaled = err / Math.max(1, Math.abs(v))
      maxOldAbs[c.kind] = Math.max(maxOldAbs[c.kind], err); maxOldScaled[c.kind] = Math.max(maxOldScaled[c.kind], scaled)
      assert(scaled <= 2e-14, `old JS kind=${c.kind}[${i}]: ${actual} vs ${v}`)
    })
    if (c.kind < 2) {
      const sample = c.kind === 0 ? e.plane_em_sample : e.plane_acoustic_sample
      const readFn = c.kind === 0 ? e.plane_em_read : e.plane_acoustic_read
      const beforeMemory = Buffer.from(memory.slice(cp, end))
      for (const args of [[cp, 0, xp, n, ap, ap], [cp, 0, xp, n, xp, bp], [cp, 0, xp, n, cp, bp], [cp + 1, 0, xp, n, ap, bp], [cp, 0, 0, n, ap, bp], [cp, 0, xp, 0xffffffff, ap, bp], [cp, 0, xp, n, ap, e.memory.buffer.byteLength - 8]]) assert.equal(sample(...args), 2)
      assert.equal(sample(cp, 0, 0, 0, 0, 0), 0)
      assert.equal(readFn(cp, cp), 2); assert.equal(readFn(cp, out + 1), 2)
      assert.deepEqual(Buffer.from(memory.slice(cp, end)), beforeMemory, 'invalid regions reject before mutation')
      assert.equal(run(NaN), 4); assert.equal(run(Infinity), 4)
      const x = view(xp, n)[0]; view(xp, n)[0] = NaN; assert.equal(run(), 4); view(xp, n)[0] = x
      const phaseIndex = c.kind === 0 ? 3 : 4, originalPhase = view(cp, 5)[phaseIndex]
      view(cp, 5)[phaseIndex] = NaN; assert.equal(read(), 4); assert.equal(run(), 4); view(cp, 5)[phaseIndex] = originalPhase
      const frequency = view(cp, 1)[0]; view(cp, 1)[0] = 0; assert.equal(read(), 3); view(cp, 1)[0] = Number.MAX_VALUE; assert.equal(run(), 4); view(cp, 1)[0] = frequency
    } else if (c.kind === 2) {
      assert.equal(e.plane_em3d(cp, xp, ap, ap, out), 2); assert.equal(e.plane_em3d(cp, xp, ap, bp, cp), 2)
      const k = view(cp, 1)[0]; view(cp, 1)[0] = 0; assert.equal(e.plane_em3d(cp, xp, ap, bp, out), 3); view(cp, 1)[0] = k
      view(cp + 16, 1)[0] = Infinity; assert.equal(e.plane_em3d(cp, xp, ap, bp, out), 4)
    }
  }
  console.log(`Plane waves: ${cases.length - 1} old-JS cases, ${oracle.cases.length} independent 720-digit phase references, ${smallPrevious.cases.length} previous-WASM small-phase records unchanged; native/WASM all fields/readouts exact. Old-JS max absolute EM/acoustic/3D=${maxOldAbs.join('/')}, scaled=${maxOldScaled.join('/')}; oracle max absolute=${maxOracleAbs}, large-phase max ulp=${maxLargeUlp}. Memory, nonfinite and overflow checks pass.`)
} finally { rmSync(scratch, { recursive: true, force: true }) }
