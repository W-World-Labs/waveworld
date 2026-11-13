import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import type { AnsysThermalStudyInput } from './ansys-thermal-study-input'
import { parseAnsysThermalNativeOutput, parseAnsysThermalStudyResult } from './ansys-thermal-study-result'

const input = {
  module: 'sw-ansys-thermal-fem', backend: 'host', analysis: 'steady', dimension: 1,
  mesh: { element: 'bar', nodes: [[0], [1], [2]], elements: [[0, 1], [1, 2]] },
  conductivity: 1, dirichlet: [{ node: 0, temperature: 100 }, { node: 2, temperature: 0 }],
} as unknown as AnsysThermalStudyInput

const native = (overrides: Record<string, unknown> = {}) => ({
  module: 'sw-ansys-thermal-fem', method: 'method-algo-thermal-fem-theta', family: 'method-ansys-mechanical-thermal',
  backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
  scope: 'linear constant-property FEM heat conduction on supplied bar connectivity',
  result: {
    analysis: 'steady', element: 'bar', dimension: 1, nNodes: 3, nElements: 2,
    temperatures: [100, 50, 0], minTemperature: 0, maxTemperature: 100, meanTemperature: 50,
    reactions: [50, 0, -50],
    heatBalance: { sourceTotal: 0, robinHeatIn: 0, dirichletHeatIn: 0, balanceResidual: 0 },
    maxResidual: 0,
  },
  ...overrides,
})

const envelope = (payload = native()): JobResultV1 => ({
  schemaVersion: 1, status: 'succeeded', summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'w-sim-cuda' },
  moduleResult: payload,
} as JobResultV1)

describe('ANSYS thermal study result parser', () => {
  it('validates a host bar result and preserves nodal temperatures and reactions', () => {
    const parsed = parseAnsysThermalStudyResult(envelope(), input)
    expect(parsed.module).toBe('sw-ansys-thermal-fem')
    expect(parsed.backend).toMatchObject({ id: 'w-sim-cuda-host', kind: 'host-f64' })
    expect(parsed.result.temperatures).toEqual([100, 50, 0])
    expect(parsed.result.reactions).toEqual([50, 0, -50])
  })

  it('validates an already-unwrapped native result', () => {
    expect(parseAnsysThermalNativeOutput(native(), input).result.meanTemperature).toBe(50)
  })

  it('rejects a mismatched identity, model, backend provenance, or submitted mesh count', () => {
    expect(() => parseAnsysThermalStudyResult(envelope(native({ module: 'other' })), input)).toThrow(/module/)
    expect(() => parseAnsysThermalNativeOutput(native({ method: 'other' }), input)).toThrow(/identity/)
    expect(() => parseAnsysThermalNativeOutput(native({ backend: { id: 'cuda', kind: 'gpu', deviceName: 'GPU' } }), input)).toThrow(/provenance/)
    expect(() => parseAnsysThermalNativeOutput(native({ result: { ...native().result, dimension: 2 } }), input)).toThrow(/model/)
    expect(() => parseAnsysThermalNativeOutput(native({ result: { ...native().result, nElements: 1 } }), input)).toThrow(/counts/)
  })

  it('rejects inconsistent aggregates, arrays, heat balance, and non-finite values', () => {
    expect(() => parseAnsysThermalNativeOutput(native({ result: { ...native().result, temperatures: [100, 50] } }), input)).toThrow(/exactly 3/)
    expect(() => parseAnsysThermalNativeOutput(native({ result: { ...native().result, meanTemperature: 40 } }), input)).toThrow(/mean temperature/)
    expect(() => parseAnsysThermalNativeOutput(native({ result: { ...native().result, reactions: [0, Number.NaN, 0] } }), input)).toThrow(/finite/)
    expect(() => parseAnsysThermalNativeOutput(native({ result: { ...native().result, heatBalance: { sourceTotal: 1, robinHeatIn: 0, dirichletHeatIn: 0, balanceResidual: 0 } } }), input)).toThrow(/heat balance residual/)
  })

  it('checks transient controls and aggregate-only samples without assuming nodal history', () => {
    const transientInput = { ...input, analysis: 'transient', initialTemperature: [50, 50, 50], timeStep: 0.25, steps: 2, theta: 1, capacity: 'lumped' } as unknown as AnsysThermalStudyInput
    const baseResult = native().result
    const transientResult = {
      ...baseResult, analysis: 'transient', temperatures: [100, 50, 0], minTemperature: 0, maxTemperature: 100, meanTemperature: 50,
      transient: {
        timeStep: 0.25, steps: 2, theta: 1, capacity: 'lumped', finalTime: 0.5, maxStepResidual: 1e-12,
        samples: [
          { step: 0, time: 0, minTemperature: 0, maxTemperature: 100, meanTemperature: 50 },
          { step: 2, time: 0.5, minTemperature: 0, maxTemperature: 100, meanTemperature: 50 },
        ],
      },
    }
    const result = parseAnsysThermalNativeOutput(native({ result: transientResult }), transientInput)
    expect(result.result.transient?.samples[1]).toEqual({ step: 2, time: 0.5, minTemperature: 0, maxTemperature: 100, meanTemperature: 50 })
    expect(() => parseAnsysThermalNativeOutput(native({ result: { ...transientResult, transient: { ...transientResult.transient, samples: [transientResult.transient.samples[0]] } } }), transientInput)).toThrow(/initial and final aggregate states/)
    expect(() => parseAnsysThermalNativeOutput(native({ result: { ...transientResult, transient: { ...transientResult.transient, steps: 3 } } }), transientInput)).toThrow(/step count/)
  })
})
