import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import { readSpiceDcSweepResult, type MnaDcSweepInput } from './spice-import-adapter'

const input: MnaDcSweepInput = {
  module: 'mna',
  method: 'method-algo-mna-dc-sweep',
  backend: 'host',
  circuit: {
    nodes: 2,
    resistors: [{ a: 1, b: 2, r: 1000 }, { a: 2, b: 0, r: 3000 }],
    vSources: [{ a: 1, b: 0, v: 10 }],
    iSources: [],
  },
  sweep: { source: 0, start: 0, stop: 10, steps: 3 },
}
const nodeMap = { '0': 0, in: 1, out: 2 }

// Native mna::dc_sweep_result response. The enclosing backend is transport
// provenance; the module backend identifies the native host-f64 implementation.
const sweepResult = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  status: 'succeeded',
  summary: { steps: 3 },
  backend: { id: 'w-sim-cuda' },
  moduleResult: {
    module: 'mna',
    backend: { id: 'host-f64-mna' },
    result: {
      methodId: 'method-algo-mna-dc-sweep',
      familyId: 'method-mna',
      sweepSource: 0,
      points: [
        { value: 0, nodeVoltages: [0, 0] },
        { value: 5, nodeVoltages: [5, 3.75] },
        { value: 10, nodeVoltages: [10, 7.5] },
      ],
      ...overrides,
    },
  },
})

const read = (
  result: unknown = sweepResult(),
  submittedInput: MnaDcSweepInput = input,
  submittedNodeMap: Record<string, number> = nodeMap,
) =>
  readSpiceDcSweepResult(result as JobResultV1, submittedInput, submittedNodeMap)

describe('SPICE DC sweep result adapter', () => {
  it('maps native sweep points to named node voltages and includes ground', () => {
    expect(read()).toEqual({
      methodId: 'method-algo-mna-dc-sweep',
      familyId: 'method-mna',
      sweepSource: 0,
      points: [
        { value: 0, nodeVoltages: { '0': 0, in: 0, out: 0 } },
        { value: 5, nodeVoltages: { '0': 0, in: 5, out: 3.75 } },
        { value: 10, nodeVoltages: { '0': 0, in: 10, out: 7.5 } },
      ],
      backend: { id: 'host-f64-mna' },
    })
  })

  it('rejects wrong native module, method, family, backend, or swept source', () => {
    const base = sweepResult()
    expect(() => read({ ...base, moduleResult: { ...base.moduleResult, module: 'other' } })).toThrow(/module/)
    expect(() => read(sweepResult({ methodId: 'method-algo-mna-dc' }))).toThrow(/method, family/)
    expect(() => read(sweepResult({ familyId: 'method-other' }))).toThrow(/method, family/)
    expect(() => read({ ...base, moduleResult: { ...base.moduleResult, backend: { id: 'cuda-f32' } } })).toThrow(/backend/)
    expect(() => read(sweepResult({ sweepSource: 1 }))).toThrow(/source/)
  })

  it('rejects an unrequested or malformed submitted node map', () => {
    expect(() => read(sweepResult(), { ...input, method: 'method-algo-mna-dc' } as unknown as MnaDcSweepInput, nodeMap)).toThrow(/submitted MNA job/)
    expect(() => read(sweepResult(), input, { in: 1, out: 2 })).toThrow(/ground/)
    expect(() => read(sweepResult(), input, { '0': 0, in: 1, out: 3 })).toThrow(/node index/)
    expect(() => read(sweepResult(), input, { '0': 0, '': 1 })).toThrow(/node/)
  })

  it('rejects missing, extra, or non-finite points and wrong voltage dimensions', () => {
    const points = sweepResult().moduleResult.result.points
    expect(() => read(sweepResult({ points: points.slice(0, 2) }))).toThrow(/point count|points/)
    expect(() => read(sweepResult({ points: [...points, points[2]] }))).toThrow(/point count|points/)
    expect(() => read(sweepResult({ points: [{ ...points[0], value: Number.NaN }, ...points.slice(1)] }))).toThrow(/finite|value/)
    expect(() => read(sweepResult({ points: [{ ...points[0], nodeVoltages: [0, Number.POSITIVE_INFINITY] }, ...points.slice(1)] }))).toThrow(/finite/)
    expect(() => read(sweepResult({ points: [{ ...points[0], nodeVoltages: [0] }, ...points.slice(1)] }))).toThrow(/dimension|length/)
  })

  it('rejects truncated, out-of-order, or incorrectly positioned sweep coordinates', () => {
    const points = sweepResult().moduleResult.result.points
    expect(() => read(sweepResult({ points: [{ ...points[0], value: 5 }, ...points.slice(1)] }))).toThrow(/sweep value|coordinate|order/)
    expect(() => read(sweepResult({ points: [points[0], points[2], points[1]] }))).toThrow(/sweep value|coordinate|order/)
    expect(() => read(sweepResult({ points: [points[0], { ...points[1], value: 4.9 }, points[2]] }))).toThrow(/sweep value|coordinate/)
  })
})
