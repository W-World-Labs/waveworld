import { describe, expect, it } from 'vitest'
import {
  createCanteraNasa7NativeInput,
  parseCanteraNasa7PreparedText,
  validateCanteraNasa7NativeOutput,
  type CanteraNasa7NativeInput,
} from './cantera-nasa7-prepared'

const record = {
  name: 'O2',
  model: 'nasa7',
  'temperature-ranges': [200, 1000, 3500],
  data: [
    [3.78245636, -0.00299673416, 9.84730201e-6, -9.68129509e-9, 3.24372837e-12, -1063.94356, 3.65767573],
    [3.28253784, 0.00148308754, -7.57966669e-7, 2.09470555e-10, -2.16717794e-14, -1088.45772, 5.45323129],
  ],
  source: { file: 'ideal-gas.yaml', species: 'O2' },
}

// Official Cantera nasa9-test.yaml ALCL3 thermo record (NASA9, two regions).
// Keep this as a source-shaped prepared record, separate from the NASA7 O2 case.
const nasa9Record = {
  name: 'ALCL3',
  model: 'nasa9',
  'temperature-ranges': [200, 1000, 6000],
  data: [
    [77506.0097, -1440.779717, 14.01744141, -0.00638163124, 5.87167472e-6, -2.908872278e-9, 5.99405089e-13, -65793.4318, -44.94017799],
    [-137863.0916, -55.7920729, 10.04190387, -1.682165339e-5, 3.72466466e-9, -4.27552678e-13, 1.982341329e-17, -73434.0747, -20.45130429],
  ],
  source: { file: 'test/data/nasa9-test.yaml', species: 'ALCL3' },
}

function output(input: CanteraNasa7NativeInput) {
  return {
    module: 'sw-cantera-nasa-poly',
    method: 'nasa7',
    nTemperatures: input.T.length,
    species: [{
      name: 'O2', model: 'nasa7', temperatureRanges: [200, 1000, 3500],
      nRegions: 2,
      evaluations: input.T.map(T => ({
        T, region: T < 1000 ? 0 : 1, rangeName: T < 1000 ? 'low' : 'high',
        cpOverR: 3.5, hOverRT: 1.2, sOverR: 2.1,
        cp: 29, h: 3000, s: 17, gOverRT: -0.9,
      })),
    }],
  }
}

describe('prepared Cantera NASA7 boundary', () => {
  it('accepts the parseNasa7Yaml record and preserves provenance', () => {
    expect(parseCanteraNasa7PreparedText(JSON.stringify(record))).toMatchObject({
      name: 'O2', ranges: [200, 1000, 3500], sourceFile: 'ideal-gas.yaml', sourceSpecies: 'O2',
    })
  })

  it('accepts a native case envelope and carries its initial temperature', () => {
    const native = { module: 'sw-cantera-nasa-poly', model: 'nasa7', T: [300], species: [{
      name: 'O2', 'temperature-ranges': record['temperature-ranges'], data: record.data,
    }] }
    expect(parseCanteraNasa7PreparedText(JSON.stringify(native), 'fixture.yaml')).toMatchObject({
      name: 'O2', sourceFile: 'fixture.yaml', sourceSpecies: 'O2', initialTemperature: 300,
    })
  })

  it('builds the host input and validates matching native evaluations', () => {
    const prepared = parseCanteraNasa7PreparedText(JSON.stringify(record))
    const input = createCanteraNasa7NativeInput(prepared, 300)
    expect(input).toMatchObject({ module: 'sw-cantera-nasa-poly', backend: 'host', model: 'nasa7', T: [300] })
    expect(parseCanteraNasa7PreparedText(JSON.stringify(input))).toMatchObject({
      name: 'O2', ranges: [200, 1000, 3500], sourceSpecies: 'O2', initialTemperature: 300,
    })
    expect(validateCanteraNasa7NativeOutput(output(input), input)).toHaveLength(1)
  })

  it('tolerates additional native response fields while validating required values', () => {
    const input = createCanteraNasa7NativeInput(parseCanteraNasa7PreparedText(JSON.stringify(record)), 300)
    const valid = output(input)
    const evaluation = valid.species[0].evaluations[0]
    const extended = {
      ...valid,
      responseVersion: 2,
      diagnostics: { source: 'host' },
      species: [{
        ...valid.species[0],
        extraSpeciesMetadata: true,
        evaluations: [{ ...evaluation, uncertainty: 0.01, status: 'ok' }],
      }],
    }
    expect(validateCanteraNasa7NativeOutput(extended, input)).toMatchObject([{ T: 300, cp: 29, gOverRT: -0.9 }])
  })

  it.each([
    ['oversized text', () => parseCanteraNasa7PreparedText(' '.repeat(65537))],
    ['wrong native module', () => parseCanteraNasa7PreparedText(JSON.stringify({ module: 'other', model: 'nasa7', T: [300], species: [] }))],
    ['NASA9 model', () => parseCanteraNasa7PreparedText(JSON.stringify({ ...record, model: 'nasa9' }))],
    ['multiple species', () => parseCanteraNasa7PreparedText(JSON.stringify({ module: 'sw-cantera-nasa-poly', model: 'nasa7', T: [300], species: [{}, {}] }))],
    ['decreasing ranges', () => parseCanteraNasa7PreparedText(JSON.stringify({ ...record, 'temperature-ranges': [200, 3500, 1000] }))],
    ['out of bounds ranges', () => parseCanteraNasa7PreparedText(JSON.stringify({ ...record, 'temperature-ranges': [20, 1000, 3500] }))],
    ['short coefficient row', () => parseCanteraNasa7PreparedText(JSON.stringify({ ...record, data: [[1, 2], record.data[1]] }))],
    ['non-finite coefficient', () => parseCanteraNasa7PreparedText(JSON.stringify({ ...record, data: [[1, 2, 3, 4, 5, 6, null], record.data[1]] }))],
    ['provenance species mismatch', () => parseCanteraNasa7PreparedText(JSON.stringify({ ...record, source: { file: 'x', species: 'N2' } }))],
    ['unknown executable semantics', () => parseCanteraNasa7PreparedText(JSON.stringify({ ...record, reactions: [] }))],
  ])('rejects %s', (_label, invoke) => {
    expect(invoke).toThrow()
  })

  it('rejects native output module, species, ranges, temperatures, counts, and non-finite values', () => {
    const input = createCanteraNasa7NativeInput(parseCanteraNasa7PreparedText(JSON.stringify(record)), 300)
    const valid = output(input)
    expect(() => validateCanteraNasa7NativeOutput({ ...valid, module: 'wrong' }, input)).toThrow()
    expect(() => validateCanteraNasa7NativeOutput({ ...valid, species: [] }, input)).toThrow()
    expect(() => validateCanteraNasa7NativeOutput({ ...valid, species: [{ ...valid.species[0], name: 'N2' }] }, input)).toThrow()
    expect(() => validateCanteraNasa7NativeOutput({ ...valid, species: [{ ...valid.species[0], temperatureRanges: [200, 999, 3500] }] }, input)).toThrow()
    expect(() => validateCanteraNasa7NativeOutput({ ...valid, species: [{ ...valid.species[0], evaluations: [{ ...valid.species[0].evaluations[0], T: 301 }] }] }, input)).toThrow()
    expect(() => validateCanteraNasa7NativeOutput({ ...valid, nTemperatures: 2 }, input)).toThrow()
    expect(() => validateCanteraNasa7NativeOutput({ ...valid, species: [{ ...valid.species[0], evaluations: [{ ...valid.species[0].evaluations[0], cp: null }] }] }, input)).toThrow()
  })
})

describe('prepared Cantera NASA9 boundary', () => {
  it('accepts the genuine multirange nine-coefficient source record', () => {
    const prepared = parseCanteraNasa7PreparedText(JSON.stringify(nasa9Record))
    expect(prepared).toMatchObject({
      name: 'ALCL3', model: 'nasa9', ranges: [200, 1000, 6000],
      coefficients: nasa9Record.data,
      sourceFile: 'test/data/nasa9-test.yaml', sourceSpecies: 'ALCL3',
    })
    expect(createCanteraNasa7NativeInput(prepared, 500)).toEqual({
      module: 'sw-cantera-nasa-poly', backend: 'host', model: 'nasa9', T: [500],
      species: [{ name: 'ALCL3', 'temperature-ranges': [200, 1000, 6000], data: nasa9Record.data }],
    })
  })

  it('accepts the same single-species native schema used by sw-cantera-nasa-poly', () => {
    const native = {
      module: 'sw-cantera-nasa-poly', model: 'nasa9', T: [500],
      species: [{
        name: 'ALCL3', 'temperature-ranges': nasa9Record['temperature-ranges'], data: nasa9Record.data,
      }],
    }
    expect(parseCanteraNasa7PreparedText(JSON.stringify(native), 'test/data/nasa9-test.yaml')).toMatchObject({
      name: 'ALCL3', model: 'nasa9', ranges: [200, 1000, 6000],
      sourceFile: 'test/data/nasa9-test.yaml', sourceSpecies: 'ALCL3', initialTemperature: 500,
    })
  })

  it.each([
    ['eight-coefficient row', { ...nasa9Record, data: [[1, 2, 3, 4, 5, 6, 7, 8], nasa9Record.data[1]] }],
    ['seven-coefficient row', { ...nasa9Record, data: [[1, 2, 3, 4, 5, 6, 7], nasa9Record.data[1]] }],
    ['range and row count mismatch', { ...nasa9Record, 'temperature-ranges': [200, 500, 1000, 6000] }],
    ['non-increasing ranges', { ...nasa9Record, 'temperature-ranges': [200, 1000, 1000] }],
    ['provenance species mismatch', { ...nasa9Record, source: { file: 'test/data/nasa9-test.yaml', species: 'ALCL2' } }],
    ['empty provenance file', { ...nasa9Record, source: { file: '', species: 'ALCL3' } }],
    ['empty provenance species', { ...nasa9Record, source: { file: 'test/data/nasa9-test.yaml', species: '' } }],
  ])('rejects malformed NASA9 %s', (_label, malformed) => {
    expect(() => parseCanteraNasa7PreparedText(JSON.stringify(malformed))).toThrow()
  })
})
