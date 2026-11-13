import { describe, expect, it } from 'vitest'
import {
  createDefaultPidStudy,
  createPidStudyJob,
  validatePidStudyDraft,
  validatePidStudyInput,
} from './dymola-pid-study-input'

describe('guided Dymola PI state-space input', () => {
  it('builds the two-state PI closed-loop matrices and a native state-space job', () => {
    const draft = createDefaultPidStudy()
    const { input, spec } = createPidStudyJob(draft)
    expect(input).toEqual({
      module: 'sw-openmodelica-state-space-observers', method: 'state-space', backend: 'host',
      A: [[-2, 1], [-1, 0]], B: [[1], [1]], C: [[1, 0]], D: [[0]],
      x0: [0, 0], u: [1], times: Array.from({ length: 51 }, (_, i) => 5 * i / 50),
    })
    expect(spec.model?.inline).toEqual(input)
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    expect(spec.run.maxSteps).toBe(1)
  })

  it('validates inclusive draft bounds and preserves accepted values', () => {
    const boundary = {
      processGain: 0.1, timeConstant: 0.05, proportionalGain: 0, integralGain: 0,
      setpoint: 0.1, duration: 0.1, points: 2,
    }
    expect(validatePidStudyDraft(boundary)).toEqual(boundary)
    expect(createPidStudyJob(boundary).input.times).toEqual([0, 0.1])
    expect(validatePidStudyDraft({
      processGain: 10, timeConstant: 100, proportionalGain: 20, integralGain: 20,
      setpoint: 100, duration: 0.1, points: 256,
    })).toMatchObject({ processGain: 10, points: 256 })
  })

  it('rejects non-finite, out-of-range, fractional, and extra draft values without coercion', () => {
    const base = createDefaultPidStudy()
    const invalid: Array<[keyof typeof base, unknown]> = [
      ['processGain', Number.NaN], ['processGain', 0.099], ['processGain', 10.01],
      ['timeConstant', Infinity], ['timeConstant', 0.049], ['timeConstant', 100.1],
      ['proportionalGain', -0.01], ['proportionalGain', 20.1], ['integralGain', '1'],
      ['integralGain', -1], ['integralGain', 20.1], ['setpoint', 0], ['setpoint', 101],
      ['duration', 0.09], ['duration', 501], ['points', 1], ['points', 2.5], ['points', 257],
    ]
    for (const [key, value] of invalid) {
      expect(() => validatePidStudyDraft({ ...base, [key]: value } as never), `${key}=${String(value)}`).toThrow()
    }
    expect(() => validatePidStudyDraft({ ...base, pid: true } as never)).toThrow(/unsupported field pid/)
    expect(() => validatePidStudyDraft(null as never)).toThrow(/must be an object/)
  })

  it('rejects matrix-exponential workloads above the native norm-duration bound', () => {
    const base = createDefaultPidStudy()
    expect(() => createPidStudyJob({ ...base, proportionalGain: 20, duration: 10 })).toThrow(/must be at most 64/)
    expect(() => createPidStudyJob({ ...base, processGain: 10, integralGain: 20, duration: 1 })).toThrow(/must be at most 64/)
  })

  it('strictly validates the continuous state-space input shape and values', () => {
    const input = createPidStudyJob(createDefaultPidStudy()).input
    expect(validatePidStudyInput(input)).toEqual(input)
    for (const change of [
      { module: 'sw-other' }, { method: 'lqr' }, { backend: 'cuda' },
      { discrete: true }, { A: [[1, 2], [3]] }, { B: [[1], [1], [1]] },
      { C: [[1, 1]] }, { D: [[1]] }, { x0: [0, 1] }, { u: [1, 2] },
      { times: [0, 0, 5] }, { times: [0, Number.NaN, 5] },
      { A: [[Number.MAX_VALUE, Number.MAX_VALUE], [-1, 0]] },
      { B: [[1e6], [1]], u: [100] },
    ]) {
      expect(() => validatePidStudyInput({ ...input, ...change } as never)).toThrow()
    }
  })
})
