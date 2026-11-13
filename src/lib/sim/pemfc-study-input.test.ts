import { describe, expect, it } from 'vitest'
import {
  createDefaultPemfcStudy,
  createPemfcStudyJob,
  validatePemfcPolarizationInput,
} from './pemfc-study-input'

describe('bounded PEMFC polarization input', () => {
  it('creates fresh guided defaults and builds the pinned host input and native job', () => {
    const first = createDefaultPemfcStudy()
    const second = createDefaultPemfcStudy()
    expect(first).toEqual({
      T: 353.15, pH2: 1, pO2: 0.21, pH2O: 1, j0: 1e-4, alpha: 0.5,
      R: 0.05, jLim: 2, j: 0.5, imax: 1, points: 21,
    })
    expect(first).not.toBe(second)

    const { input, spec } = createPemfcStudyJob(first)
    expect(input).toEqual({
      module: 'sw-comsol-pemfc', method: 'polarization', backend: 'host', n: 2, E0: 1.229,
      ...first,
    })
    expect(spec.model?.inline).toEqual(input)
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    expect(spec.run.maxSteps).toBe(1)
  })

  it('accepts documented inclusive bounds and valid zero-current operating points', () => {
    const boundary = {
      T: 273.15, pH2: 0.01, pO2: 0.01, pH2O: 0.01, j0: 1e-8,
      alpha: 0.1, R: 0, jLim: 0.01, j: 0, imax: 0.001, points: 2,
    }
    expect(createPemfcStudyJob(boundary).input).toMatchObject(boundary)

    const high = {
      ...boundary, T: 393.15, pH2: 10, pO2: 10, pH2O: 10, j0: 0.1,
      alpha: 1, R: 5, jLim: 10, j: 0.1, imax: 1, points: 11,
    }
    expect(createPemfcStudyJob(high).input).toMatchObject(high)
  })

  it('requires exact input keys and exact module, selector, backend, electron count and standard potential', () => {
    const valid = { module: 'sw-comsol-pemfc', method: 'polarization', backend: 'host', n: 2, E0: 1.229, ...createDefaultPemfcStudy() }
    expect(validatePemfcPolarizationInput(valid)).toEqual(valid)

    for (const [key, value] of Object.entries({
      module: 'sw-comsol-pemfc-other', method: 'method-algo-pemfc-polarization',
      backend: 'cuda', n: 1, E0: 1.23,
    })) {
      expect(() => validatePemfcPolarizationInput({ ...valid, [key]: value })).toThrow()
    }
    expect(() => validatePemfcPolarizationInput({ ...valid, membrane: 'nafion' })).toThrow(/unsupported field membrane/)
    expect(() => validatePemfcPolarizationInput({ ...valid, quantity: 'voltage' })).toThrow(/unsupported field quantity/)
    expect(() => validatePemfcPolarizationInput({ ...valid, species: ['H2'] })).toThrow(/unsupported field species/)
    expect(() => validatePemfcPolarizationInput({ ...valid, j: undefined })).toThrow(/j is required/)
    expect(() => validatePemfcPolarizationInput(null)).toThrow(/must be an object/)
  })

  it('rejects non-finite, non-numeric, out-of-range, and non-integer values without coercion', () => {
    const base = createDefaultPemfcStudy()
    const invalid: Array<[keyof typeof base, unknown]> = [
      ['T', Number.NaN], ['T', Number.POSITIVE_INFINITY], ['T', '353.15'],
      ['T', 273.14], ['T', 393.16], ['pH2', 0.009], ['pH2', 10.01],
      ['pO2', Number.NEGATIVE_INFINITY], ['pH2O', null],
      ['j0', 0], ['j0', 0.100_001], ['alpha', 0.099], ['alpha', 1.001],
      ['R', -0.001], ['R', 5.001], ['jLim', 0.009], ['jLim', 10.001],
      ['imax', 0.000_9], ['imax', 10.001], ['j', -0.001], ['j', 1.001],
      ['points', 1], ['points', 202], ['points', 2.5],
    ]
    for (const [key, value] of invalid) {
      expect(() => createPemfcStudyJob({ ...base, [key]: value } as never), `${key}=${String(value)}`).toThrow()
    }
  })

  it('keeps the current, limit, and Tafel sample guards explicit', () => {
    const base = createDefaultPemfcStudy()
    expect(() => createPemfcStudyJob({ ...base, imax: base.jLim })).toThrow(/imax must be less than jLim/)
    expect(() => createPemfcStudyJob({ ...base, j: 0.000_05 })).toThrow(/j must be zero or at least j0/)
    expect(() => createPemfcStudyJob({ ...base, j: 0, imax: 0.001, points: 21 })).toThrow(/first positive curve sample/)
    expect(createPemfcStudyJob({ ...base, j: 0, imax: 0.001, points: 11 }).input.j).toBe(0)
    // The scalar operating current is independently evaluated and need not be a sweep sample.
    expect(createPemfcStudyJob({ ...base, j: 0.53, imax: 1, points: 21 }).input.j).toBe(0.53)
  })
})
