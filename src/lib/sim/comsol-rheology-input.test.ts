import { describe, expect, it } from 'vitest'
import {
  COMSOL_RHEOLOGY_CSV_HEADER,
  createComsolRheologyInput,
  createDefaultComsolRheologyDraft,
  parseComsolRheologyCsv,
  readComsolRheologySamples,
} from './comsol-rheology-input'

describe('COMSOL rheology input', () => {
  it('provides a usable power-law default and builds the exact host viscosity operation', () => {
    const draft = createDefaultComsolRheologyDraft()
    expect(draft).toMatchObject({ model: 'power-law', K: 1, n: 0.5, shearRates: [0, 0.1, 1, 10, 100], csv: '' })
    expect(createComsolRheologyInput(draft)).toEqual({
      module: 'sw-comsol-nonnewtonian-b', backend: 'host', method: 'method-algo-rheology-viscosity',
      model: 'power-law', K: 1, n: 0.5, shearRates: [0, 0.1, 1, 10, 100],
    })
  })

  it('emits only the selected native model parameters for all five supported models', () => {
    const base = createDefaultComsolRheologyDraft()
    const cases = [
      [{ model: 'newtonian' as const }, { model: 'newtonian', viscosity: 1 }],
      [{ model: 'power-law' as const }, { model: 'power-law', K: 1, n: 0.5 }],
      [{ model: 'carreau' as const }, { model: 'carreau', mu0: 0.1, muInf: 0.001, lambda: 1, n: 0.5 }],
      [{ model: 'bingham' as const }, { model: 'bingham', muP: 0.01, tauY: 1, regularizationM: 1000 }],
      [{ model: 'herschel-bulkley' as const }, { model: 'herschel-bulkley', K: 1, n: 0.5, tauY: 1, regularizationM: 1000 }],
    ] as const
    for (const [patch, expected] of cases) {
      const input = createComsolRheologyInput({ ...base, ...patch })
      expect(input).toMatchObject({
        module: 'sw-comsol-nonnewtonian-b', backend: 'host', method: 'method-algo-rheology-viscosity',
        ...expected, shearRates: base.shearRates,
      })
      const parameterKeys = Object.keys(input).filter(key => !['module', 'backend', 'method', 'model', 'shearRates'].includes(key))
      const expectedParameterKeys = Object.keys(expected).filter(key => key !== 'model').sort()
      expect(parameterKeys.sort()).toEqual(expectedParameterKeys)
    }
  })

  it('bounds and validates app shear-rate input and active model parameters', () => {
    const base = createDefaultComsolRheologyDraft()
    for (const patch of [
      { shearRates: [] }, { shearRates: Array(257).fill(1) }, { shearRates: [1, -1] },
      { shearRates: [Number.NaN] }, { model: 'unknown' as never }, { K: 0 },
      { model: 'carreau' as const, mu0: 0.1, muInf: 0.1 },
      { model: 'carreau' as const, n: 1.01 }, { model: 'bingham' as const, regularizationM: 0 },
      { unexpected: true } as never,
    ]) {
      expect(() => createComsolRheologyInput({ ...base, ...patch } as never)).toThrow()
    }
    expect(createComsolRheologyInput({ ...base, shearRates: Array(256).fill(0) }).shearRates).toHaveLength(256)
  })

  it('imports a single app-defined shear-rate column with an optional header', () => {
    expect(parseComsolRheologyCsv('\uFEFFshearRate\r\n0\r\n0.25\r\n1e2\r\n')).toEqual([0, 0.25, 100])
    expect(parseComsolRheologyCsv('0\n 0.5 \n2')).toEqual([0, 0.5, 2])
    expect(parseComsolRheologyCsv(`${COMSOL_RHEOLOGY_CSV_HEADER}\n${Array.from({ length: 256 }, (_, index) => index).join('\n')}`)).toHaveLength(256)
  })

  it('rejects malformed, multi-column, non-finite, negative, empty, oversized, and over-limit CSV data', () => {
    for (const csv of [
      '', `${COMSOL_RHEOLOGY_CSV_HEADER}\n`, 'not-a-number', 'shearrate\n1',
      '1,2', '1;2', '1\t2', '1\n\n2', '-0.1', 'NaN', 'Infinity', '0x10',
      Array.from({ length: 257 }, (_, index) => index).join('\n'),
      '1'.repeat(1024 * 1024 + 1),
    ]) {
      expect(() => parseComsolRheologyCsv(csv)).toThrow()
    }
  })

  it('reads regular and singular native samples while tolerating added response fields', () => {
    expect(readComsolRheologySamples({
      result: {
        methodId: 'method-algo-rheology-viscosity', nSamples: 2, model: 'power-law', futureField: true,
        samples: [
          { shearRate: 0, effectiveViscosity: null, shearStress: null, singular: true },
          { shearRate: 2, effectiveViscosity: 3, shearStress: 6, singular: false, futureSampleField: 1 },
        ],
      },
    })).toEqual([
      { shearRate: 0, effectiveViscosity: null, shearStress: null, singular: true },
      { shearRate: 2, effectiveViscosity: 3, shearStress: 6, singular: false },
    ])
    expect(() => readComsolRheologySamples({ result: { methodId: 'wrong', nSamples: 0, samples: [] } })).toThrow()
  })
})
