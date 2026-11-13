import { describe, expect, it } from 'vitest'
import { createDefaultExchangerStudy, createExchangerStudyJob, validateExchangerSweepInput } from './exchanger-study-input'

function validInput() {
  return createExchangerStudyJob(createDefaultExchangerStudy()).input
}

function changed(change: (input: any) => void) {
  const input = structuredClone(validInput())
  change(input)
  return input
}

describe('validateExchangerSweepInput direct-caller boundary', () => {
  it('accepts the exact guided steady host UA sweep input', () => {
    const input = validInput()
    expect(validateExchangerSweepInput(input)).toEqual(input)
  })

  it('rejects untrusted non-object and incomplete inputs', () => {
    for (const value of [null, undefined, [], 'input', 12, {}]) {
      expect(() => validateExchangerSweepInput(value)).toThrow()
    }
    expect(() => validateExchangerSweepInput({ ...validInput(), sweep_UA: undefined })).toThrow()
  })

  it('requires the supported module, host backend, steady selector, and arrangement', () => {
    for (const patch of [
      { module: 'other-module' },
      { backend: 'cuda' },
      { backend: 'w-sim-cuda-host' },
      { dynamic: true },
      { dynamic: 'false' },
      { arrangement: 'crossflow' },
    ]) {
      expect(() => validateExchangerSweepInput({ ...validInput(), ...patch })).toThrow()
    }
  })

  it('rejects unsupported fields that could select other native behavior', () => {
    for (const patch of [
      { unexpected: true },
      { method: 'alternate-method' },
      { UA: 200 },
      { solver: 'transient' },
      { backendOptions: { device: 'gpu' } },
    ]) {
      expect(() => validateExchangerSweepInput({ ...validInput(), ...patch })).toThrow()
    }
  })

  it('requires a 2 to 64 value UA sweep in bounds and strict ascending order', () => {
    expect(validateExchangerSweepInput({ ...validInput(), sweep_UA: [100, 200] }).sweep_UA).toEqual([100, 200])
    expect(validateExchangerSweepInput({ ...validInput(), sweep_UA: Array.from({ length: 64 }, (_, i) => i + 1) }).sweep_UA).toHaveLength(64)
    for (const sweep_UA of [
      [], [100], Array.from({ length: 65 }, (_, i) => i + 1),
      [100, 100], [200, 100], [100, 200, 200],
      [0, 100], [1e-7, 100], [100, 1e9 + 1],
      [100, Number.NaN], [100, Number.POSITIVE_INFINITY], [100, '200'],
    ]) {
      expect(() => validateExchangerSweepInput({ ...validInput(), sweep_UA })).toThrow()
    }
  })

  it('checks finite capacity bounds, their ratio, and inlet temperature limits', () => {
    for (const [field, value] of [
      ['Chot', 0], ['Chot', 1e-7], ['Chot', 1e9 + 1], ['Chot', Number.NaN], ['Chot', Number.POSITIVE_INFINITY],
      ['Ccold', 0], ['Ccold', 1e-7], ['Ccold', 1e9 + 1], ['Ccold', Number.NaN],
      ['T_hot_in', 0], ['T_hot_in', 2000.1], ['T_hot_in', Number.NaN],
      ['T_cold_in', 0.9], ['T_cold_in', 2001], ['T_cold_in', Number.POSITIVE_INFINITY],
      ['T_hot_in', 292],
    ] as const) {
      expect(() => validateExchangerSweepInput({ ...validInput(), [field]: value })).toThrow()
    }

    const edgeCapacityRatio = { ...validInput(), Chot: 1e-6, Ccold: 1, sweep_UA: [1e-6, 2e-6] }
    expect(validateExchangerSweepInput(edgeCapacityRatio).Chot).toBe(1e-6)
    expect(() => validateExchangerSweepInput({ ...edgeCapacityRatio, Ccold: 1e9 })).toThrow()

    const equalInlets = { ...validInput(), T_hot_in: 293.15, T_cold_in: 293.15 }
    expect(validateExchangerSweepInput(equalInlets).T_hot_in).toBe(293.15)
  })

  it('enforces numeric NTU limits for every submitted UA', () => {
    const lowerEdge = { ...validInput(), Chot: 1, Ccold: 1e6, sweep_UA: [1e-6, 2e-6] }
    expect(validateExchangerSweepInput(lowerEdge).sweep_UA).toEqual([1e-6, 2e-6])
    expect(() => validateExchangerSweepInput({ ...lowerEdge, Chot: 1e3, Ccold: 1e9, sweep_UA: [1e-6, 2e-6] })).toThrow()

    const upperEdge = { ...validInput(), Chot: 1e-6, Ccold: 1, sweep_UA: [1e-6, 1] }
    expect(validateExchangerSweepInput(upperEdge).sweep_UA).toEqual([1e-6, 1])
    expect(() => validateExchangerSweepInput({ ...upperEdge, sweep_UA: [1e-6, 1.000001] })).toThrow()
  })

  it('rejects arrays and nonnumeric physical values instead of coercing them', () => {
    for (const update of [
      (input: any) => { input.Chot = '100' },
      (input: any) => { input.Ccold = null },
      (input: any) => { input.T_hot_in = '' },
      (input: any) => { input.sweep_UA = '100,200' },
      (input: any) => { input.sweep_UA[0] = [100] },
    ]) {
      expect(() => validateExchangerSweepInput(changed(update))).toThrow()
    }
  })
})
