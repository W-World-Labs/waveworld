import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import type { AnsysModalStudyInput } from './ansys-modal-study-input'
import { parseAnsysModalNativeOutput, parseAnsysModalStudyResult, type AnsysModalNativeInput } from './ansys-modal-study-result'

const input: AnsysModalStudyInput = {
  module: 'sw-ansys-modal', backend: 'host', method: 'block-lanczos',
  stiffness: [[4, 0], [0, 9]], mass: [[1, 0], [0, 1]], direction: [1, 0], numModes: 2,
}

const envelope = (payload: Record<string, unknown> = {}): JobResultV1 => ({
  schemaVersion: 1,
  status: 'succeeded',
  summary: { steps: 1, wallTimeMs: 1 },
  backend: { id: 'w-sim-cuda' },
  moduleResult: {
    module: 'sw-ansys-modal',
    ok: true,
    familyId: 'method-ansys-modal-analysis',
    method: 'block-lanczos',
    methodId: 'method-block-lanczos',
    backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
    n: 2,
    numModes: 2,
    solver: { algorithm: 'shift-invert block Lanczos', converged: true, residual: 1e-12, tolerance: 1e-10 },
    eigenvalues: [4, 9],
    frequenciesRadS: [2, 3],
    frequenciesHz: [2 / (2 * Math.PI), 3 / (2 * Math.PI)],
    periodsS: [Math.PI, 2 * Math.PI / 3],
    modeShapes: [[1, 0], [0, 1]],
    massNormalized: true,
    modalMass: [1, 1],
    participationFactors: [1, 0],
    effectiveMass: [1, 0],
    effectiveMassRatio: [1, 1],
    system: { type: 'explicit', n: 2 },
    ...payload,
  },
} as JobResultV1)

const parse = (result: JobResultV1 = envelope(), submitted: AnsysModalNativeInput = input) => parseAnsysModalStudyResult(result, submitted)

describe('ANSYS modal study result parser', () => {
  it('accepts a successful host-f64 two degree of freedom modal result', () => {
    const result = parse()
    expect(result.module).toBe('sw-ansys-modal')
    expect(result.methodId).toBe('method-block-lanczos')
    expect(result.modeShapes).toEqual([[1, 0], [0, 1]])
    expect(result.solver.converged).toBe(true)
  })

  it('shares the same native payload validation when the job hook already unwrapped the envelope', () => {
    const payload = (envelope() as JobResultV1 & { moduleResult: Record<string, unknown> }).moduleResult
    expect(parseAnsysModalNativeOutput(payload, input)).toMatchObject({
      module: 'sw-ansys-modal',
      methodId: 'method-block-lanczos',
      backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
      modeShapes: [[1, 0], [0, 1]],
    })
  })

  it('rejects mismatched identity, failure, method, dimensions, or provenance', () => {
    expect(() => parse(envelope({ module: 'other' }))).toThrow(/module/)
    expect(() => parse(envelope({ ok: false }))).toThrow(/reports failure/)
    expect(() => parse(envelope({ methodId: 'other' }))).toThrow(/successful/)
    expect(() => parse(envelope({ numModes: 1 }))).toThrow(/dimensions/)
    expect(() => parse(envelope({ familyId: 'other' }))).toThrow(/identity/)
    expect(() => parse(envelope({ method: 'other' }))).toThrow(/successful/)
    expect(() => parse(envelope({ backend: { id: 'host-f64', kind: 'cpu', deviceName: 'other-host' } }))).toThrow(/backend/)
    expect(() => parse(envelope({ backend: { id: 'cuda', kind: 'gpu', deviceName: 'GPU' } }))).toThrow(/backend/)
  })

  it('rejects nonconverged, malformed, or non-finite solver status', () => {
    expect(() => parse(envelope({ solver: { algorithm: 'Lanczos', converged: false, residual: 0, tolerance: 1e-8 } }))).toThrow(/converge/)
    expect(() => parse(envelope({ solver: { algorithm: '', converged: true, residual: 0, tolerance: 1e-8 } }))).toThrow(/solver status/)
    expect(() => parse(envelope({ solver: { algorithm: 'Lanczos', converged: true, residual: Number.NaN, tolerance: 1e-8 } }))).toThrow(/finite/)
    expect(() => parse(envelope({ solver: { algorithm: 'Lanczos', converged: true, residual: 1e-4, tolerance: 1e-8 } }))).toThrow(/residual/)
  })

  it('rejects malformed numerical arrays and unordered modes while preserving returned frequency values', () => {
    expect(() => parse(envelope({ eigenvalues: [4] }))).toThrow(/exactly 2/)
    expect(() => parse(envelope({ modeShapes: [[1, 0], [0, Number.POSITIVE_INFINITY]] }))).toThrow(/finite/)
    expect(() => parse(envelope({ frequenciesHz: [1, 0.1] }))).toThrow(/ascending/)
    expect(() => parse(envelope({ periodsS: [Math.PI, 0] }))).toThrow(/out of range/)
    expect(() => parse(envelope({ effectiveMassRatio: [0.8, 0.7] }))).toThrow(/cumulative effective mass ratios/)
    expect(() => parse(envelope({ system: { type: 'matrix', n: 2 } }))).toThrow(/system/)
    expect(parse(envelope({ frequenciesHz: [7, 8], frequenciesRadS: [70, 80], periodsS: [0.25, 0.125] })).frequenciesHz).toEqual([7, 8])
  })

  it('checks mass normalization using the submitted mass matrix', () => {
    const changedMass: AnsysModalStudyInput = { ...input, mass: [[2, 0], [0, 1]] }
    expect(() => parse(envelope(), changedMass)).toThrow(/mass normalization/)
    expect(() => parse(envelope({ massNormalized: false }))).toThrow(/mass normalized/)
    expect(() => parse(envelope({ modeShapes: [[1e308, 0], [0, 1]] }))).toThrow(/mass normalization/)
  })

  it('requires the requested number of modes', () => {
    const oneModeInput: AnsysModalStudyInput = { ...input, numModes: 1 }
    expect(() => parse(envelope(), oneModeInput)).toThrow(/dimensions/)
    const oneModeResult = envelope({
      numModes: 1,
      eigenvalues: [4], frequenciesRadS: [2], frequenciesHz: [2 / (2 * Math.PI)], periodsS: [Math.PI],
      modeShapes: [[1, 0]], modalMass: [1], participationFactors: [1], effectiveMass: [1], effectiveMassRatio: [1],
    })
    expect(parse(oneModeResult, oneModeInput).numModes).toBe(1)
  })

  it('accepts an arbitrary three degree of freedom explicit system with diagonal mass', () => {
    const input3: AnsysModalNativeInput = {
      module: 'sw-ansys-modal', backend: 'host', method: 'block-lanczos',
      stiffness: [[1, 0, 0], [0, 2, 0], [0, 0, 3]], mass: [2, 1, 4], numModes: 3,
    }
    const result3 = envelope({
      n: 3, numModes: 3,
      eigenvalues: [1, 2, 3], frequenciesHz: [1, 2, 3], frequenciesRadS: [4, 5, 6], periodsS: [3, 2, 1],
      modeShapes: [[1 / Math.sqrt(2), 0, 0], [0, 1, 0], [0, 0, 0.5]],
      modalMass: [1, 1, 1], participationFactors: [1, 1, 1], effectiveMass: [1, 1, 1], effectiveMassRatio: [0.3, 0.6, 1],
      system: { type: 'explicit', n: 3 },
    })
    const parsed = parse(result3, input3)
    expect(parsed.n).toBe(3)
    expect(parsed.modeShapes).toHaveLength(3)
    expect(parsed.modeShapes[0]).toHaveLength(3)
  })

  it('rejects native result dimensions that do not match the submitted matrix', () => {
    const input3: AnsysModalNativeInput = {
      module: 'sw-ansys-modal', backend: 'host', method: 'block-lanczos',
      stiffness: [[1, 0, 0], [0, 2, 0], [0, 0, 3]], mass: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], numModes: 2,
    }
    expect(() => parse(envelope(), input3)).toThrow(/dimensions/)
    expect(() => parse(envelope({ system: { type: 'explicit', n: 3 } }))).toThrow(/system dimension/)
  })
})
