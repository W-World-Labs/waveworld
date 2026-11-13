import { describe, expect, it } from 'vitest'
import {
  validateCanteraNasa7NativeOutput,
  type CanteraNasa7NativeInput,
} from './cantera-nasa7-prepared'

// The validator currently exposes the NASA7 input type. Keep this fixture
// local to the response-contract tests so NASA9 output can be specified
// independently of any future prepared-input implementation.
const input = {
  module: 'sw-cantera-nasa-poly',
  backend: 'host',
  model: 'nasa9',
  T: [1200],
  species: [{
    name: 'O2',
    'temperature-ranges': [200, 1000, 3000, 6000],
    data: [[0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]],
  }],
} as unknown as CanteraNasa7NativeInput

function response() {
  return {
    module: 'sw-cantera-nasa-poly',
    method: 'nasa9',
    backend: { name: 'w-sim-cuda-host', kind: 'host-f64' },
    nTemperatures: 1,
    species: [{
      name: 'O2',
      model: 'nasa9',
      temperatureRanges: [200, 1000, 3000, 6000],
      nRegions: 3,
      evaluations: [{
        T: 1200,
        region: 1,
        rangeName: 'region-1',
        cpOverR: 3.5,
        hOverRT: 1.2,
        sOverR: 2.1,
        cp: 29,
        h: 12000,
        s: 17,
        gOverRT: -0.9,
      }],
      continuity: [],
    }],
  }
}

describe('Cantera NASA9 native response validation', () => {
  it('accepts an evaluation from a matching three-region NASA9 species', () => {
    expect(validateCanteraNasa7NativeOutput(response(), input)).toMatchObject([
      { T: 1200, region: 1, rangeName: 'region-1', cp: 29, gOverRT: -0.9 },
    ])
  })

  it.each([
    ['wrong model', (value: ReturnType<typeof response>) => ({
      ...value, species: [{ ...value.species[0], model: 'nasa7' }],
    })],
    ['mismatched temperature ranges', (value: ReturnType<typeof response>) => ({
      ...value, species: [{ ...value.species[0], temperatureRanges: [200, 999, 3000, 6000] }],
    })],
    ['region outside the declared intervals', (value: ReturnType<typeof response>) => ({
      ...value, species: [{ ...value.species[0], evaluations: [{ ...value.species[0].evaluations[0], region: 3 }] }],
    })],
    ['NASA7 range name on a multi-region response', (value: ReturnType<typeof response>) => ({
      ...value, species: [{ ...value.species[0], evaluations: [{ ...value.species[0].evaluations[0], rangeName: 'high' }] }],
    })],
    ['wrong region count', (value: ReturnType<typeof response>) => ({
      ...value, species: [{ ...value.species[0], nRegions: 2 }],
    })],
    ['wrong temperature count', (value: ReturnType<typeof response>) => ({
      ...value, nTemperatures: 2,
    })],
    ['non-finite evaluation value', (value: ReturnType<typeof response>) => ({
      ...value, species: [{ ...value.species[0], evaluations: [{ ...value.species[0].evaluations[0], cp: Number.NaN }] }],
    })],
  ])('rejects %s', (_label, mutate) => {
    expect(() => validateCanteraNasa7NativeOutput(mutate(response()), input)).toThrow()
  })
})
