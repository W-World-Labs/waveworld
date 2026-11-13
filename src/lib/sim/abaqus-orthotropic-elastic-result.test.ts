import { describe, expect, it } from 'vitest'
import { parseAbaqusOrthotropicElasticResult } from './abaqus-orthotropic-elastic-result'

const input = {
  module: 'sw-calculix-orthotropic-elastic',
  method: 'method-algo-calculix-elastic-card',
  backend: 'host',
  type: 'iso',
  E: 100,
  nu: 0.25,
  eps: [0.01, 0, 0, 0.02, 0, 0],
}

// Analytic isotropic material: lambda = mu = 40, so C has normal
// diagonals 120, normal off-diagonals 40, and engineering-shear diagonals 40.
const stiffness = [
  120, 40, 40, 0, 0, 0,
  40, 120, 40, 0, 0, 0,
  40, 40, 120, 0, 0, 0,
  0, 0, 0, 40, 0, 0,
  0, 0, 0, 0, 40, 0,
  0, 0, 0, 0, 0, 40,
]
const compliance = [
  0.01, -0.0025, -0.0025, 0, 0, 0,
  -0.0025, 0.01, -0.0025, 0, 0, 0,
  -0.0025, -0.0025, 0.01, 0, 0, 0,
  0, 0, 0, 0.025, 0, 0,
  0, 0, 0, 0, 0.025, 0,
  0, 0, 0, 0, 0, 0.025,
]

function response() {
  return {
    ok: true,
    module: 'sw-calculix-orthotropic-elastic',
    backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
    result: {
      methodId: 'method-algo-calculix-elastic-card',
      elasticType: 'iso',
      voigtOrder: ['11', '22', '33', '12', '13', '23'],
      lineCount: 1,
      cardConstants: { E: 100, nu: 0.25 },
      stiffness: [...stiffness],
      compliance: [...compliance],
      mechanicalStrain: [...input.eps],
      stress: [1.2, 0.4, 0.4, 0.8, 0, 0],
    },
  }
}

describe('parseAbaqusOrthotropicElasticResult', () => {
  it('accepts analytic isotropic C/S and checks engineering-shear stress', () => {
    expect(parseAbaqusOrthotropicElasticResult(response(), input).stress).toEqual([1.2, 0.4, 0.4, 0.8, 0, 0])
  })

  it('rejects malformed or non-finite matrices', () => {
    const malformed = response()
    malformed.result.stiffness = [1, 2, 3]
    expect(() => parseAbaqusOrthotropicElasticResult(malformed, input)).toThrow(/36 values/)

    const nonfinite = response()
    nonfinite.result.compliance[0] = Number.NaN
    expect(() => parseAbaqusOrthotropicElasticResult(nonfinite, input)).toThrow(/finite/)
  })

  it('rejects asymmetric and non-inverse matrices', () => {
    const asymmetric = response()
    asymmetric.result.stiffness[1] = 41
    expect(() => parseAbaqusOrthotropicElasticResult(asymmetric, input)).toThrow(/inconsistent/)

    const noninverse = response()
    noninverse.result.compliance[0] = 0.02
    expect(() => parseAbaqusOrthotropicElasticResult(noninverse, input)).toThrow(/inverse/)
  })

  it('rejects an unexpected backend', () => {
    const wrongBackend = response()
    wrongBackend.backend.kind = 'cuda'
    expect(() => parseAbaqusOrthotropicElasticResult(wrongBackend, input)).toThrow(/host-f64/)
  })
})
