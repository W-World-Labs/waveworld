import { describe, expect, it } from 'vitest'
import { readModuleJobInput } from './module-compute'
import { createDefaultPemfcStudy, createPemfcStudyJob } from './pemfc-study-input'

describe('PEMFC native job envelope', () => {
  it('creates an exact polarization input and routes it to the native CUDA executor', () => {
    const { input, spec } = createPemfcStudyJob(createDefaultPemfcStudy())

    expect(input).toEqual({
      module: 'sw-comsol-pemfc', method: 'polarization', backend: 'host', n: 2, E0: 1.229,
      T: 353.15, pH2: 1, pO2: 0.21, pH2O: 1, j0: 1e-4, alpha: 0.5,
      R: 0.05, jLim: 2, j: 0.5, imax: 1, points: 21,
    })
    expect(Object.keys(input).sort()).toEqual([
      'E0', 'R', 'T', 'alpha', 'backend', 'imax', 'j', 'j0', 'jLim', 'method',
      'module', 'n', 'pH2', 'pH2O', 'pO2', 'points',
    ])

    expect(spec).toMatchObject({
      schemaVersion: 1,
      kind: 'waveworld-module',
      name: 'sw-comsol-pemfc',
      parameters: { module: 'sw-comsol-pemfc' },
      model: { source: 'inline', inline: input },
      run: { maxSteps: 1 },
      requirements: { backends: ['cuda'] },
    })
    expect(spec.requirements).not.toHaveProperty('precision')
    expect(readModuleJobInput(JSON.parse(JSON.stringify(spec)))).toEqual(input)
  })

  it('rejects job envelopes that would move or alter the native submission', () => {
    const { input, spec } = createPemfcStudyJob(createDefaultPemfcStudy())

    for (const malformed of [
      { ...spec, requirements: { backends: ['cpu'] } },
      { ...spec, requirements: { backends: ['native-cuda'] } },
      { ...spec, run: { maxSteps: 0 } },
      { ...spec, parameters: { module: 'other-module' } },
      { ...spec, kind: 'other-kind' },
      { ...spec, model: { source: 'artifact', inline: input } },
    ]) {
      expect(() => readModuleJobInput(malformed as never)).toThrow()
    }
  })
})
