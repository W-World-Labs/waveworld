import { describe, expect, it } from 'vitest'
import type { JobSpecV1 } from '@w-sim/contracts'
import { createSpiceDcSweepJob, type MnaImport } from './spice-import-adapter'

const mnaInput = {
  module: 'mna',
  method: 'method-algo-mna-dc-sweep',
  circuit: {
    nodes: 2,
    resistors: [{ a: 1, b: 2, r: 1000 }, { a: 2, b: 0, r: 3000 }],
    capacitors: [],
    inductors: [],
    vSources: [{ a: 1, b: 0, v: 10 }],
    iSources: [],
    diodes: [],
  },
  sweep: { source: 0, start: 0, stop: 10, steps: 3 },
} as const

const mnaJobSpec = {
  schemaVersion: 1,
  kind: 'waveworld-module',
  parameters: { module: 'mna' },
  model: { source: 'inline', inline: mnaInput },
  run: { maxSteps: 3 },
  outputs: {},
} as const

const nodeMap = { '0': 0, in: 1, out: 2 }
const imported = (overrides: Partial<MnaImport> = {}): MnaImport => ({
  mnaInput,
  mnaJobSpec: mnaJobSpec as unknown as JobSpecV1,
  nodeMap,
  diagnostics: [],
  ...overrides,
})

describe('SPICE DC sweep input admission', () => {
  it('rebuilds the seven-key native importer circuit as a host MNA sweep job', () => {
    const { input, spec } = createSpiceDcSweepJob(imported())

    expect(input).toEqual({
      module: 'mna',
      method: 'method-algo-mna-dc-sweep',
      backend: 'host',
      circuit: {
        nodes: 2,
        resistors: mnaInput.circuit.resistors,
        vSources: mnaInput.circuit.vSources,
        iSources: [],
      },
      sweep: { source: 0, start: 0, stop: 10, steps: 3 },
    })
    expect(spec).toEqual({
      schemaVersion: 1,
      kind: 'waveworld-module',
      name: 'mna',
      parameters: { module: 'mna' },
      model: { source: 'inline', inline: input },
      run: { maxSteps: 3 },
      outputs: {},
      requirements: { backends: ['cuda'] },
    })
    expect(spec.model).not.toEqual(mnaJobSpec.model)
  })

  it('requires the importer export to match the complete sweep input and point count', () => {
    expect(() => createSpiceDcSweepJob(imported({
      mnaJobSpec: {
        ...mnaJobSpec,
        model: { source: 'inline', inline: { ...mnaInput, sweep: { ...mnaInput.sweep, stop: 9 } } },
      } as unknown as JobSpecV1,
    }))).toThrow(/exactly match/i)
    expect(() => createSpiceDcSweepJob(imported({
      mnaJobSpec: { ...mnaJobSpec, run: { maxSteps: 2 } } as unknown as JobSpecV1,
    }))).toThrow(/exactly match|run\.maxSteps|point count/i)
  })

  it('rejects non-sweep methods, wrong modules, and invalid source indices', () => {
    expect(() => createSpiceDcSweepJob(imported({
      mnaInput: { ...mnaInput, method: 'method-algo-mna-dc' },
    } as unknown as Partial<MnaImport>))).toThrow(/DC sweep/i)
    expect(() => createSpiceDcSweepJob(imported({
      mnaInput: { ...mnaInput, module: 'sw-ngspice-netlist' },
    } as unknown as Partial<MnaImport>))).toThrow(/module|MNA input/i)
    for (const source of [-1, 1, 0.5, Number.NaN]) {
      const invalid = { ...mnaInput, sweep: { ...mnaInput.sweep, source } }
      expect(() => createSpiceDcSweepJob(imported({
        mnaInput: invalid,
        mnaJobSpec: { ...mnaJobSpec, model: { source: 'inline', inline: invalid } } as unknown as JobSpecV1,
      } as unknown as Partial<MnaImport>))).toThrow(/source/i)
    }
  })

  it('admits empty unsupported device arrays but rejects any populated unsupported device array', () => {
    expect(() => createSpiceDcSweepJob(imported())).not.toThrow()
    for (const [key, value] of [
      ['capacitors', [{ a: 1, b: 2, c: 1e-6 }]],
      ['inductors', [{ a: 1, b: 2, l: 1e-3 }]],
      ['diodes', [{ a: 1, b: 2 }]],
    ] as const) {
      const circuit = { ...mnaInput.circuit, [key]: value }
      const changed = { ...mnaInput, circuit }
      expect(() => createSpiceDcSweepJob(imported({
        mnaInput: changed,
        mnaJobSpec: { ...mnaJobSpec, model: { source: 'inline', inline: changed } } as unknown as JobSpecV1,
      } as unknown as Partial<MnaImport>))).toThrow(new RegExp(`${key}.*empty|empty.*${key}`, 'i'))
    }
  })

  it('enforces circuit size, endpoint, element, and finite-value bounds', () => {
    const cases: Array<[string, (source: typeof mnaInput) => unknown]> = [
      ['node lower bound', (source) => ({ ...source, circuit: { ...source.circuit, nodes: 0 } })],
      ['node upper bound', (source) => ({ ...source, circuit: { ...source.circuit, nodes: 65 } })],
      ['finite endpoint', (source) => ({ ...source, sweep: { ...source.sweep, start: Number.NaN } })],
      ['ascending endpoints', (source) => ({ ...source, sweep: { ...source.sweep, start: 10 } })],
      ['finite resistor', (source) => ({ ...source, circuit: { ...source.circuit, resistors: [{ a: 1, b: 2, r: Number.POSITIVE_INFINITY }] } })],
      ['element count', (source) => ({ ...source, circuit: { ...source.circuit, resistors: Array.from({ length: 512 }, () => ({ a: 1, b: 0, r: 1000 })) } })],
    ]
    for (const [label, mutate] of cases) {
      const changed = mutate(mnaInput) as typeof mnaInput
      expect(() => createSpiceDcSweepJob(imported({
        mnaInput: changed,
        mnaJobSpec: { ...mnaJobSpec, model: { source: 'inline', inline: changed } } as unknown as JobSpecV1,
      } as unknown as Partial<MnaImport>)), label).toThrow()
    }
  })

  it('accepts the native point-count limits of two and one thousand one', () => {
    for (const steps of [2, 1001]) {
      const changed = { ...mnaInput, sweep: { ...mnaInput.sweep, steps } }
      const { spec } = createSpiceDcSweepJob(imported({
        mnaInput: changed,
        mnaJobSpec: { ...mnaJobSpec, model: { source: 'inline', inline: changed }, run: { maxSteps: steps } } as unknown as JobSpecV1,
      } as unknown as Partial<MnaImport>))
      expect(spec.run.maxSteps).toBe(steps)
    }
  })

  it('bounds sweep point counts and rejects non-finite, descending, or degenerate sweeps', () => {
    const invalidSweeps = [
      { source: 0, start: 0, stop: 10, steps: 1 },
      { source: 0, start: 0, stop: 10, steps: 1002 },
      { source: 0, start: 0, stop: 10, steps: 2.5 },
      { source: 0, start: 0, stop: 10, steps: Number.NaN },
      { source: 0, start: 0, stop: Number.POSITIVE_INFINITY, steps: 3 },
      { source: 0, start: 5, stop: 5, steps: 3 },
      { source: 0, start: 6, stop: 5, steps: 3 },
    ]
    for (const sweep of invalidSweeps) {
      const changed = { ...mnaInput, sweep }
      expect(() => createSpiceDcSweepJob(imported({
        mnaInput: changed,
        mnaJobSpec: { ...mnaJobSpec, model: { source: 'inline', inline: changed }, run: { maxSteps: sweep.steps } } as unknown as JobSpecV1,
      } as unknown as Partial<MnaImport>))).toThrow()
    }
  })
})
