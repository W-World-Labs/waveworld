import { describe, expect, it } from 'vitest'
import { validateComsolRheologyOutput } from './ComsolRheologyResults'

describe('COMSOL rheology results', () => {
  it('accepts native samples and retains explicit nulls for singular values', () => {
    expect(validateComsolRheologyOutput({ module: 'sw-comsol-nonnewtonian-b', result: {
      methodId: 'method-algo-rheology-viscosity', nSamples: 2, samples: [
        { shearRate: 0, effectiveViscosity: 1.5, shearStress: 0, singular: false },
        { shearRate: 1, effectiveViscosity: null, shearStress: null, singular: true },
      ],
    } }, 'sw-comsol-nonnewtonian-b')).toEqual([
      { shearRate: 0, effectiveViscosity: 1.5, shearStress: 0, singular: false },
      { shearRate: 1, effectiveViscosity: null, shearStress: null, singular: true },
    ])
  })

  it('fails closed for missing or malformed native samples', () => {
    expect(validateComsolRheologyOutput({ module: 'sw-comsol-nonnewtonian-b', result: {
      methodId: 'method-algo-rheology-viscosity', nSamples: 1,
      samples: [{ shearRate: 1, effectiveViscosity: Infinity, shearStress: 2, singular: false }],
    } }, 'sw-comsol-nonnewtonian-b')).toBeNull()
    expect(validateComsolRheologyOutput({ module: 'sw-comsol-nonnewtonian-b', result: {
      methodId: 'method-algo-rheology-viscosity', nSamples: 1,
      samples: [{ shearRate: 1, effectiveViscosity: null, shearStress: 2, singular: false }],
    } }, 'sw-comsol-nonnewtonian-b')).toBeNull()
    expect(validateComsolRheologyOutput({ module: 'wrong-module', result: { methodId: 'method-algo-rheology-viscosity', nSamples: 0, samples: [] } }, 'sw-comsol-nonnewtonian-b')).toBeNull()
    expect(validateComsolRheologyOutput({ status: 'ok' }, 'sw-comsol-nonnewtonian-b')).toBeNull()
  })

})
