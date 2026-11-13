import { afterEach, describe, expect, it, vi } from 'vitest'
import { signalArrayInputs, signalArrayRcInputs, signalArrayScene, invalidSignalArrays } from '../../../scripts/ci/signal-array-fixture'
import { signalArrayExample, signalArrayResult } from './signal-array'
import { WasmSignalArray } from './wasm-fields'
import { computeModule, createModuleJobSpec, readModuleResult, validateModuleInput } from './module-compute'

afterEach(() => vi.unstubAllGlobals())

describe('calibrated spatial array shared Rust core', () => {
  it('recovers a two-cell coupled sensor with nonzero offsets', () => {
    const r = signalArrayResult(signalArrayScene())
    expect(r.sensorV).toEqual([4.5, 4.75])
    expect(r.measuredV).toEqual([4.5, 4.75])
    expect(r.rank).toBe(2)
    expect(r.reconstructed![0]).toBeCloseTo(3, 12)
    expect(r.reconstructed![1]).toBeCloseTo(-2, 12)
    expect(r.rmse).toBeLessThan(1e-12)
  })
  it('uses normalized H4 and preserves the hand-computed encoded values', () => {
    const r = signalArrayResult({ ...signalArrayScene(), rows: 2, cols: 2, input: [1, 2, 3, 4],
      sensing: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], bias: [0, 0, 0, 0], encoding: { kind: 'hadamard' } })
    expect(r.measuredV).toEqual([5, -1, -2, 0])
    r.reconstructed!.forEach((v, i) => expect(v).toBeCloseTo(i + 1, 12))
  })
  it('does not invent a unique image from row/column sums', () => {
    const r = signalArrayResult(signalArrayExample(true))
    expect(r.measuredV).toEqual([0, 1.5, 1.5, 0, 0, 1.5, 1.5, 0])
    expect(r.rank).toBe(7)
    expect(r.status).toBe('rank-deficient')
    expect([r.reconstructed, r.error, r.rmse, r.residualRmsV]).toEqual([null, null, null, null])
  })
  it('ridge reports the measured rank and matches a scalar hand solution', () => {
    const r = signalArrayResult({ ...signalArrayScene(), sensing: [[1, 1]], bias: [0], regularization: 2 })
    // min (x1+x2-1)^2 + 2(x1²+x2²) has x1=x2=1/4.
    expect(r.rank).toBe(1)
    expect(r.status).toBe('regularized')
    r.reconstructed!.forEach(v => expect(v).toBeCloseTo(0.25, 12))
    expect(r.residualRmsV).toBeCloseTo(0.5, 12)
  })
  it('resets seeded noise and scratch buffers on reuse, including rectangular custom codes', () => {
    const owner = new WasmSignalArray()
    for (const { scene } of [...signalArrayInputs, ...signalArrayRcInputs, ...signalArrayInputs.slice().reverse()]) {
      expect(owner.solve(scene)).toEqual(signalArrayResult(scene))
    }
    const scene = { ...signalArrayScene(), noisePeakV: 0.1 }
    const r = owner.solve(scene)
    r.measuredV.forEach((v, i) => expect(Math.abs(v - r.sensorV[i])).toBeLessThanOrEqual(0.1))
    expect(owner.solve({ ...scene, seed: 8 }).measuredV).not.toEqual(r.measuredV)
  })
  it('validates malformed input before Agent allocation and rejects fabricated null/status diagnostics', async () => {
    for (const change of invalidSignalArrays) expect(() => validateModuleInput({ module: 'signal-array', scene: { ...signalArrayScene(), ...change } })).toThrow()
    const input = signalArrayInputs[3], output = await computeModule(input)
    const envelope = { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 0 }, moduleResult: output }
    expect(readModuleResult(envelope as never, input)).toEqual(output)
    for (const change of [{ rankTolerance: NaN }, { rank: 3 }, { status: 'solved' }, { reconstructed: [0, 0] }, { rmse: 0 }]) {
      expect(() => readModuleResult({ ...envelope, moduleResult: { ...output, result: { ...(output as any).result, ...change } } } as never, input)).toThrow()
    }
  })
  it('rejects numerically unresolved ridge instead of returning a plausible image', () => {
    expect(() => signalArrayResult({ ...signalArrayScene(), sensing: [[1, 2], [2, 4]], regularization: 1e-30 })).toThrow(/numerically rank deficient/)
  })
  it('samples one shared RC node in code-row order and decodes the settled operator', () => {
    const scene = { ...signalArrayScene(), readout: { resistanceOhm: 1000, capacitanceF: 1e-7, dwellS: 1e-4 * Math.LN2, initialV: 0.5 } }
    // Half the previous voltage and half the new target: [2.5, 3.625].
    const r = signalArrayResult(scene)
    expect(r.idealV).toEqual([4.5, 4.75])
    expect(r.readoutTauS).toBeCloseTo(1e-4, 15)
    expect(r.settlingFraction).toBeCloseTo(0.5, 14)
    r.sampledV!.forEach((v, i) => expect(v).toBeCloseTo([2.5, 3.625][i], 13))
    expect(r.measuredV).toEqual(r.sampledV)
    r.reconstructed!.forEach((v, i) => expect(v).toBeCloseTo(scene.input[i], 12))
    const reversed = signalArrayResult({ ...scene, encoding: { kind: 'custom', matrix: [[0, 1], [1, 0]] } })
    reversed.sampledV!.forEach((v, i) => expect(v).toBeCloseTo([2.625, 3.5625][i], 13))
    reversed.reconstructed!.forEach((v, i) => expect(v).toBeCloseTo(scene.input[i], 12))
  })
  it('preserves rank deficiency and applies ridge to the actual sampled measurements', () => {
    const scene = { ...signalArrayScene(), sensing: [[1, 0], [0, 1]], bias: [0, 0],
      encoding: { kind: 'custom' as const, matrix: [[1, 1]] },
      readout: { resistanceOhm: 1000, capacitanceF: 1e-3, dwellS: Math.LN2, initialV: 2 } }
    const deficient = signalArrayResult(scene)
    expect(deficient.rank).toBe(1)
    expect(deficient.status).toBe('rank-deficient')
    expect(deficient.reconstructed).toBeNull()
    expect(deficient.sampledV![0]).toBeCloseTo(1.5, 13)
    const regularized = signalArrayResult({ ...scene, regularization: 0.25 })
    // min (0.5*x1 + 0.5*x2 - 0.5)^2 + 0.25*(x1²+x2²) gives x1=x2=1/3.
    expect(regularized.status).toBe('regularized')
    expect(regularized.rank).toBe(1)
    regularized.reconstructed!.forEach(v => expect(v).toBeCloseTo(1 / 3, 12))
    expect(regularized.residualRmsV).toBeCloseTo(1 / 6, 12)
  })
  it('replays old ideal results without WASM but refuses them for RC jobs', async () => {
    const input = signalArrayInputs[0], output = await computeModule(input)
    if (output.module !== 'signal-array') throw new Error('unexpected fixture module')
    const { idealV, sampledV, settlingFraction, readoutTauS, ...oldResult } = output.result
    const envelope = { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 0 }, moduleResult: { ...output, result: oldResult } }
    vi.stubGlobal('WebAssembly', undefined)
    expect(readModuleResult(envelope as never, input)).toEqual(envelope.moduleResult)
    expect(() => readModuleResult(envelope as never, signalArrayRcInputs[0])).toThrow()
    for (const change of [{ idealV }, { sampledV }, { settlingFraction }, { readoutTauS }]) {
      expect(() => readModuleResult({ ...envelope, moduleResult: { ...output, result: { ...oldResult, ...change } } } as never, input)).toThrow()
    }
  })
  it('submits and replays without local WASM; local execution fails explicitly', async () => {
    const input = signalArrayInputs[0], output = await computeModule(input)
    vi.stubGlobal('WebAssembly', undefined)
    const spec = createModuleJobSpec(input)
    expect(spec.run.maxSteps).toBe(1)
    expect(spec.requirements?.precision).toBe('float64')
    expect(readModuleResult({ schemaVersion: 1, summary: { steps: 1, wallTimeMs: 0 }, moduleResult: output } as never, input)).toEqual(output)
    await expect(computeModule(input)).rejects.toThrow(/WASM/)
  })
})
