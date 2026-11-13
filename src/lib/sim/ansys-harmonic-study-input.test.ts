import { describe, expect, it } from 'vitest'
import {
  createAnsysHarmonicStudyInput,
  createDefaultAnsysHarmonicStudy,
  createDefaultAnsysModalHarmonicStudy,
  validateAnsysHarmonicStudyInput,
} from './ansys-harmonic-study-input'

describe('Ansys harmonic study input', () => {
  it('builds a bounded SDOF frequency sweep with the pinned module fields', () => {
    expect(createAnsysHarmonicStudyInput(createDefaultAnsysHarmonicStudy())).toEqual({
      module: 'sw-ansys-harmonic-response', backend: 'host', system: 'sdof',
      mass: 1, stiffness: 1000, dampingRatio: 0.05, force: 1,
      freqs: [0, 5, 10, 15], freqUnit: 'hz',
    })
  })

  it('serializes the modal system and Rayleigh damping selection', () => {
    const draft = createDefaultAnsysModalHarmonicStudy()
    draft.modes.push({ frequencyHz: 12, shape: [0, 1] })
    draft.damping = { kind: 'rayleigh', alpha: 0.1, beta: 0.002 }
    expect(createAnsysHarmonicStudyInput(draft)).toEqual({
      module: 'sw-ansys-harmonic-response', backend: 'host', system: 'modal',
      modes: [
        { frequencyHz: 5, shape: [1, 0] },
        { frequencyHz: 12, shape: [0, 1] },
      ],
      force: [1, 0], rayleigh: { alpha: 0.1, beta: 0.002 },
      freqs: [0, 5, 10, 15], freqUnit: 'hz',
    })
  })

  it('supports coefficient damping for SDOF and radians per second sweeps', () => {
    const draft = createDefaultAnsysHarmonicStudy()
    draft.damping = { kind: 'coefficient', value: 4 }
    draft.freqUnit = 'rads'
    expect(createAnsysHarmonicStudyInput(draft)).toMatchObject({ damping: 4, freqUnit: 'rads' })
  })

  it('rejects non-finite values, invalid bounds, and unsupported draft fields', () => {
    const base = createDefaultAnsysHarmonicStudy()
    for (const invalid of [
      { ...base, mass: 0 }, { ...base, force: Number.NaN },
      { ...base, damping: { kind: 'ratio', value: -0.1 } },
      { ...base, startFrequency: -1 }, { ...base, endFrequency: Number.POSITIVE_INFINITY },
      { ...base, points: 202 }, { ...base, points: 3.5 }, { ...base, extra: true },
    ]) expect(() => createAnsysHarmonicStudyInput(invalid as never)).toThrow()
  })

  it('bounds modal count, DOFs, shape values, and work before serialization', () => {
    const base = createDefaultAnsysModalHarmonicStudy()
    expect(() => createAnsysHarmonicStudyInput({ ...base, modes: Array(9).fill(base.modes[0]) })).toThrow(/modes/)
    expect(() => createAnsysHarmonicStudyInput({ ...base, modes: [{ ...base.modes[0], shape: Array(17).fill(1) }], force: Array(17).fill(1) })).toThrow(/shape/)
    expect(() => createAnsysHarmonicStudyInput({ ...base, modes: [{ ...base.modes[0], shape: [Number.POSITIVE_INFINITY, 0] }] })).toThrow(/finite/)
  })

  it('strictly validates direct native payloads and uniform frequency sweeps', () => {
    const valid = createAnsysHarmonicStudyInput(createDefaultAnsysModalHarmonicStudy())
    expect(validateAnsysHarmonicStudyInput(valid)).toEqual(valid)
    const invalid = [
      { ...valid, module: 'sw-ansys-modal' },
      { ...valid, backend: 'cuda' },
      { ...valid, unexpected: true },
      { ...valid, freqs: [0, 5, 11, 15] },
      { ...valid, modes: [{ frequencyHz: 0, shape: [1, 0] }] },
    ]
    for (const input of invalid) expect(() => validateAnsysHarmonicStudyInput(input)).toThrow()
  })
})
