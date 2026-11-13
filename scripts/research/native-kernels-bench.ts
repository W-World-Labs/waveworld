// Opt-in timing, never part of CI. Scalar JS exists only as a measurement baseline.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Wave } from '../../src/lib/sim/wave'
import { HeatField, seedHeat2D } from '../../src/lib/sim/heat'
import { createModuleJobSpec, type ModuleComputeInput } from '../../src/lib/sim/module-compute'
import { createFluidScene, stepFluidScene, fluidResult, createConvectionScene, stepConvectionScene, convectionResult } from '../../src/lib/sim/fluid'
import { fluidScene, convectionScene } from '../ci/fluid-fixture'

const steps = 512, repeats = 7
const binary = resolve(process.env.WAVEWORLD_NATIVE_BIN ?? 'apps/lab/bin/native/waveworld-agent')
const directory = mkdtempSync(resolve(tmpdir(), 'waveworld-native-bench-'))
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
try {
  const rows = []
  for (const module of (process.argv.includes('--fluid') ? [] : ['ripple', 'sim']) as ('ripple' | 'sim')[]) {
    const W = module === 'ripple' ? 180 : 192, H = module === 'ripple' ? 180 : 120
    const seed = { x: 90, y: 60, radius: 4, amount: 6.123 }
    const input: ModuleComputeInput = module === 'ripple'
      ? { module, scene: { damping: 0.998, steps, seeds: [seed] } }
      : { module, scene: { r: 0.21, steps, seeds: [seed] } }
    const times = { scalarJs: [] as number[], wasm: [] as number[], native: [] as number[] }
    for (let repeat = -2; repeat < repeats; repeat++) {
      const wave = new Wave(W, { damp: 0.998 }), heat = new HeatField(W, H)
      wave.poke(seed.x, seed.y, seed.radius, seed.amount)
      seedHeat2D(heat.field, W, H, seed)
      let current = (module === 'ripple' ? wave.u : heat.field).slice(), next = current.slice()
      let start = performance.now()
      for (let step = 0; step < steps; step++) {
        if (module === 'ripple') {
          for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
            const k = x + y * W, c = current[k]
            const lap = current[k - 1] + current[k + 1] + current[k - W] + current[k + W] - 4 * c
            next[k] = (2 * c - next[k] + 0.25 * lap) * 0.998
          }
        } else {
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const k = x + y * W, c = current[k]
            const n = y > 0 ? current[k - W] : c, s = y < H - 1 ? current[k + W] : c
            const w = x > 0 ? current[k - 1] : c, e = x < W - 1 ? current[k + 1] : c
            next[k] = c + 0.21 * (n + s + w + e - 4 * c)
          }
        }
        const previous = current; current = next; next = previous
      }
      const jsMs = performance.now() - start
      start = performance.now()
      for (let step = 0; step < steps; step++) module === 'ripple' ? wave.step() : heat.step(0.21)
      const wasmMs = performance.now() - start
      const field = module === 'ripple' ? wave.u : heat.field
      assert.deepEqual(field, current)
      writeFileSync(resolve(directory, 'job.json'), JSON.stringify({ schemaVersion: 1, jobId: 'benchmark', spec: createModuleJobSpec(input), maxWallTimeMs: 10_000, inputs: [] }))
      const native = spawnSync(binary, ['execute-file', '--job-id', 'benchmark', '--directory', directory], { timeout: 15_000 })
      assert.equal(native.status, 0)
      const result = JSON.parse(readFileSync(resolve(directory, 'result.json'), 'utf8')).result
      assert.deepEqual(result.moduleResult.result.field, Array.from(current))
      if (repeat >= 0) { times.scalarJs.push(jsMs); times.wasm.push(wasmMs); times.native.push(result.summary.wallTimeMs) }
    }
    rows.push({ module, grid: `${W}x${H}`, steps, repeats, medianMs: Object.fromEntries(Object.entries(times).map(([key, values]) => [key, Number(median(values).toFixed(3))])) })
  }
  if (process.argv.includes('--fluid')) for (const input of [
    { module: 'fluid' as const, scene: { ...fluidScene(), steps: 40 } },
    { module: 'convection' as const, scene: { ...convectionScene(), steps: 40 } },
  ]) {
    const times = { wasm: [] as number[], native: [] as number[] }
    let memoryBytes = 0
    for (let repeat = -1; repeat < 5; repeat++) {
      const field = input.module === 'fluid' ? createFluidScene(input.scene) : createConvectionScene(input.scene)
      memoryBytes = field.kernel.memory.buffer.byteLength
      const start = performance.now()
      for (let step = 0; step < input.scene.steps; step++) {
        if (input.module === 'fluid') stepFluidScene(field, input.scene)
        else stepConvectionScene(field)
      }
      const wasmMs = performance.now() - start
      assert.equal(field.kernel.memory.buffer.byteLength, memoryBytes, 'stepping must not grow the field memory')
      const expected = input.module === 'fluid' ? fluidResult(field, input.scene.steps) : convectionResult(field, input.scene.steps)
      writeFileSync(resolve(directory, 'job.json'), JSON.stringify({ schemaVersion: 1, jobId: 'benchmark', spec: createModuleJobSpec(input), maxWallTimeMs: 10_000, inputs: [] }))
      const native = spawnSync(binary, ['execute-file', '--job-id', 'benchmark', '--directory', directory], { timeout: 15_000 })
      assert.equal(native.status, 0)
      const result = JSON.parse(readFileSync(resolve(directory, 'result.json'), 'utf8')).result
      assert.deepEqual(result.moduleResult.result, expected)
      if (repeat >= 0) { times.wasm.push(wasmMs); times.native.push(result.summary.wallTimeMs) }
    }
    rows.push({ module: input.module, grid: input.module === 'fluid' ? '100x100' : '110x110', steps: 40, repeats: 5,
      memoryBytes, medianMs: Object.fromEntries(Object.entries(times).map(([key, values]) => [key, Number(median(values).toFixed(3))])) })
  }
  console.log(JSON.stringify({ cpu: cpus()[0]?.model, node: process.version,
    scope: 'Single-threaded stepping, FP32 storage / FP64 arithmetic; native timing also includes readout, result-object assembly and progress fsync. Excludes launch/setup/final JSON encoding. No GPU or engineering accuracy claim; --fluid omits the scalar JS baseline.', rows }, null, 2))
} finally { rmSync(directory, { recursive: true, force: true }) }
