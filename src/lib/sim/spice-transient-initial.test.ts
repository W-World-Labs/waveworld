import { describe, expect, it } from 'vitest'
import { createSpiceTransientJob, supportsSpiceTransient, type SpiceTransientInitialState } from './spice-transient-adapter'
import type { MnaImport } from './spice-import-adapter'

const deck = [
  '.title named initial state',
  'V1 in 0 DC 1',
  'R1 in mid 10',
  'C2 out 0 2u',
  'C1 mid 0 1u',
  'L2 in out 2m',
  'L1 mid out 1m',
  '.tran 0.1 1',
  '.end',
].join('\n')

const circuit = {
  nodes: 3,
  vSources: [{ a: 1, b: 0, v: 1 }],
  resistors: [{ a: 1, b: 2, r: 10 }],
  capacitors: [{ a: 3, b: 0, c: 2e-6 }, { a: 2, b: 0, c: 1e-6 }],
  inductors: [{ a: 1, b: 3, l: 2e-3 }, { a: 2, b: 3, l: 1e-3 }],
  iSources: [],
  diodes: [],
}

const imported = (): MnaImport => {
  const mnaInput = {
    module: 'mna' as const, method: 'method-algo-mna-transient-be' as const, circuit, dt: 0.1, steps: 10,
  }
  return {
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
  }
}

describe('PSpice transient named initial state UI input', () => {
  it('preserves the existing zero-state default and rejects .ic and UIC decks', () => {
    const source = imported()
    expect(supportsSpiceTransient(deck, source)).toBe(true)
    const { input } = createSpiceTransientJob(source, 3, deck)
    expect(input).not.toHaveProperty('initial')

    for (const initialDirective of [
      '.ic V(out)=2',
      '.tran 0.1 1 UIC',
      '.uic',
    ]) {
      expect(supportsSpiceTransient(deck.replace('.tran 0.1 1', initialDirective), source)).toBe(false)
    }
  })

  it('maps named nodes and inductor cards into pinned MNA array order', () => {
    const source = imported()
    const { input, spec } = createSpiceTransientJob(source, 3, deck, {
      nodeVoltages: { out: 3, in: 1 },
      inductorCurrents: { L1: 2, L2: -1 },
    })

    expect(input.initial).toEqual({
      nodeVoltages: [1, 0, 3],
      inductorCurrents: [-1, 2],
    })
    expect(spec.model).toMatchObject({ source: 'inline', inline: input })
  })

  it('fills unspecified names with zero whenever any named initial value is supplied', () => {
    const { input } = createSpiceTransientJob(imported(), 3, deck, {
      inductorCurrents: { L1: 0.75 },
    })
    expect(input.initial).toEqual({
      nodeVoltages: [0, 0, 0],
      inductorCurrents: [0, 0.75],
    })
  })

  const invalidInitialStates: SpiceTransientInitialState[] = [
    { nodeVoltages: { '0': 1 } },
    { nodeVoltages: { missing: 1 } },
    { nodeVoltages: { out: Number.NaN } },
    { nodeVoltages: { out: 1e21 } },
    { inductorCurrents: { missing: 1 } },
    { inductorCurrents: { L2: Number.NEGATIVE_INFINITY } },
    { inductorCurrents: { L1: 1e21 } },
  ]
  it.each(invalidInitialStates)('rejects unknown, non-finite, or out-of-bound named initial values: %o', (initialState) => {
    expect(() => createSpiceTransientJob(imported(), 3, deck, initialState)).toThrow()
  })

  it('rejects the ineffective capacitor-current field for the pinned BE method', () => {
    const unsupportedField = { capacitorCurrents: { C1: 1 } }
    expect(() => createSpiceTransientJob(
      imported(), 3, deck, unsupportedField as unknown as SpiceTransientInitialState,
    )).toThrow(/unsupported field/)
  })
})
