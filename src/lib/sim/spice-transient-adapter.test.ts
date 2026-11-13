import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import {
  createSpiceTransientJob,
  readSpiceTransientResult,
  supportsSpiceTransient,
} from './spice-transient-adapter'
import type { MnaImport } from './spice-import-adapter'

const netlist = [
  '.title series RLC transient',
  'V1 in 0 DC 1',
  'R1 in mid 10',
  'L1 mid out 1m',
  'C1 out 0 1u',
  '.tran 0.1 1',
  '.end',
].join('\n')

const mnaInput = {
  module: 'mna',
  method: 'method-algo-mna-transient-be',
  circuit: {
    nodes: 3,
    vSources: [{ a: 1, b: 0, v: 1 }],
    resistors: [{ a: 1, b: 2, r: 10 }],
    capacitors: [{ a: 3, b: 0, c: 1e-6 }],
    inductors: [{ a: 2, b: 3, l: 1e-3 }],
    iSources: [],
    diodes: [],
  },
  dt: 0.1,
  steps: 10,
} as const

const imported = (): MnaImport => ({
  mnaInput,
  mnaJobSpec: {
    schemaVersion: 1,
    kind: 'waveworld-module',
    parameters: { module: 'mna' },
    model: { source: 'inline', inline: mnaInput },
    run: { maxSteps: 10 },
    outputs: {},
  } as unknown as MnaImport['mnaJobSpec'],
  nodeMap: { '0': 0, in: 1, mid: 2, out: 3 },
  diagnostics: [],
})

const transientResult = (
  overrides: Record<string, unknown> = {},
  envelope: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  status: 'succeeded',
  summary: { steps: 10 },
  moduleResult: {
    module: 'mna',
    backend: { id: 'host-f64' },
    result: {
      methodId: 'method-algo-mna-transient-be',
      familyId: 'method-mna',
      scheme: 'be',
      dt: 0.1,
      steps: 10,
      outputNode: 3,
      finalNodeVoltages: [1, 1, 1],
      finalCapacitorCurrents: [0.0005],
      finalInductorCurrents: [0.05],
      outputWaveform: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
      finalOutput: 1,
      newtonIterations: 1,
      converged: true,
      ...overrides,
    },
  },
  ...envelope,
})

describe('PSpice transient adapter', () => {
  it('supports a constant-source series RLC .tran deck and creates a backward-Euler host job', () => {
    const source = imported()
    expect(supportsSpiceTransient(netlist, source)).toBe(true)

    const { input, spec } = createSpiceTransientJob(source, 3, netlist)
    expect(input).toMatchObject({
      module: 'mna', method: 'method-algo-mna-transient-be', backend: 'host',
      dt: 0.1, steps: 10, outputNode: 3, circuit: mnaInput.circuit,
    })
    expect(spec.kind).toBe('waveworld-module')
    expect(spec.parameters).toMatchObject({ module: 'mna' })
    expect(spec.model).toMatchObject({ source: 'inline', inline: input })
    expect(spec.requirements?.backends).toEqual(['cuda'])
    expect(spec.run.maxSteps).toBe(10)
  })

  it('rejects unsupported source waveforms, initial conditions, UIC, AC, and non-RLC circuits', () => {
    const source = imported()
    for (const unsupported of [
      netlist.replace('DC 1', 'PULSE(0 1 0 1n 1n 1u 2u)'),
      netlist.replace('DC 1', 'SIN(0 1 1k)'),
      netlist.replace('DC 1', 'EXP(0 1 1n 1n 1u 1u)'),
      netlist.replace('DC 1', 'PWL(0 0 1 1)'),
      netlist.replace('.tran 0.1 1', '.ic V(out)=0'),
      netlist.replace('.tran 0.1 1', '.tran 0.1 1 UIC'),
      netlist.replace('.tran 0.1 1', '.ac dec 10 1 1k'),
    ]) {
      expect(supportsSpiceTransient(unsupported, source)).toBe(false)
    }

    const resistiveInput = {
      ...mnaInput,
      circuit: { ...mnaInput.circuit, capacitors: [], inductors: [] },
    }
    const resistive = {
      ...source,
      mnaInput: resistiveInput,
      mnaJobSpec: {
        ...source.mnaJobSpec,
        model: { source: 'inline', inline: resistiveInput },
      },
    } as unknown as MnaImport
    expect(supportsSpiceTransient(netlist, resistive)).toBe(false)
    expect(() => createSpiceTransientJob(resistive, 3, netlist)).toThrow()
  })

  it('rejects invalid, non-integral, and over-limit transient grids', () => {
    const source = imported()
    for (const badGrid of [
      netlist.replace('.tran 0.1 1', '.tran 0 1'),
      netlist.replace('.tran 0.1 1', '.tran -0.1 1'),
      netlist.replace('.tran 0.1 1', '.tran 0.3 1'),
      netlist.replace('.tran 0.1 1', '.tran 0.000000001 1000000'),
    ]) {
      expect(supportsSpiceTransient(badGrid, source)).toBe(false)
    }
    expect(supportsSpiceTransient(netlist.replace('.tran 0.1 1', '.tran 0.2 1'), source)).toBe(false)
    expect(supportsSpiceTransient(netlist.replace('.tran 0.1 1', '.tran 0.1 2'), source)).toBe(false)
  })

  it('maps the selected output node waveform and validates native vectors and provenance', () => {
    const source = imported()
    const { input } = createSpiceTransientJob(source, 3, netlist)
    const result = readSpiceTransientResult(
      transientResult() as unknown as JobResultV1,
      input,
      source.nodeMap,
    )
    expect(result).toMatchObject({
      nodeName: 'out',
      methodId: 'method-algo-mna-transient-be',
      familyId: 'method-mna',
      scheme: 'be',
      dt: 0.1,
      steps: 10,
      finalNodeVoltages: { '0': 0, in: 1, mid: 1, out: 1 },
      finalCapacitorCurrents: [0.0005],
      finalInductorCurrents: [0.05],
      finalOutput: 1,
      newtonIterations: 1,
      converged: true,
      backend: { id: 'host-f64' },
    })
    expect(result.samples).toHaveLength(10)
    expect(result.samples[0]).toEqual({ time: 0.1, value: 0.1 })
    expect(result.samples[9]).toEqual({ time: 1, value: 1 })

    for (const overrides of [
      { finalNodeVoltages: [1] },
      { finalCapacitorCurrents: [] },
      { finalInductorCurrents: [Number.NaN] },
      { outputWaveform: [0, 1] },
      { outputWaveform: [0, 1, 2, 3, 4, 5, 6, 7, 8, Number.POSITIVE_INFINITY] },
      { finalOutput: 0.1 },
      { methodId: 'method-algo-mna-ac' },
      { familyId: undefined },
      { scheme: 'trap' },
      { dt: 0.2 },
      { steps: 9 },
      { outputNode: 2 },
      { converged: false },
    ]) {
      expect(() => readSpiceTransientResult(
        transientResult(overrides) as unknown as JobResultV1,
        input,
        source.nodeMap,
      )).toThrow()
    }

    const badBackend = transientResult()
    ;(badBackend.moduleResult as { backend: { id: string } }).backend.id = 'cuda'
    expect(() => readSpiceTransientResult(badBackend as unknown as JobResultV1, input, source.nodeMap)).toThrow(/backend/)
    expect(() => readSpiceTransientResult(transientResult() as unknown as JobResultV1, input, { ...source.nodeMap, out: 2 })).toThrow()
  })

  it('rejects exported input and JobSpec mismatches', () => {
    const source = imported()
    expect(() => createSpiceTransientJob({
      ...source,
      mnaJobSpec: {
        ...source.mnaJobSpec,
        model: { source: 'inline', inline: { ...mnaInput, method: 'method-algo-mna-ac' } },
      },
    } as MnaImport, 3, netlist)).toThrow(/match|mismatch|exact/i)
    expect(() => createSpiceTransientJob(source, 4, netlist)).toThrow()
  })
})
