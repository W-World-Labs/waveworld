import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import { createDefaultPemfcStudy, createPemfcStudyJob } from './pemfc-study-input'
import { readPemfcStudyResult } from './pemfc-study-result'

const input = createPemfcStudyJob({ ...createDefaultPemfcStudy(), points: 3 }).input
const scopeNote = 'Bounded zero-dimensional PEMFC polarization study.'

const nativeResult = (overrides: Record<string, unknown> = {}) => {
  const E_nernst = 1.1703765480706372
  const V = 0.8818029808135259
  return {
    schemaVersion: 1,
    status: 'succeeded',
    summary: { steps: 1, wallTimeMs: 1 },
    backend: { id: 'w-sim-cuda' },
    moduleResult: {
      module: 'sw-comsol-pemfc',
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
      result: {
        T: input.T, pH2: input.pH2, pO2: input.pO2, pH2O: input.pH2O,
        E0: input.E0, E0T: 1.18225, j: input.j, j0: input.j0, alpha: input.alpha,
        n: input.n, R: input.R, jLim: input.jLim, thermalVoltage: 0.03043,
        E_nernst, eta_act: 0.25919618067260647, eta_ohm: 0.025,
        eta_conc: 0.004377386584504772, V, powerDensity: input.j * V,
        voltageEfficiency: V / E_nernst,
        curve: {
          current: [0, 0.5, 1],
          voltage: [E_nernst, V, 0.8],
          power: [0, 0.5 * V, 0.8],
        },
        units: 'V; current density A/cm^2; R ohm cm^2; power density W/cm^2',
        method: 'polarization', ok: true,
        methodId: 'method-algo-pemfc-polarization', familyId: 'method-pemfc', scopeNote,
        ...overrides,
      },
    },
  }
}

const read = (value: unknown = nativeResult(), submitted = input) =>
  readPemfcStudyResult(value as JobResultV1, submitted)

describe('PEMFC study result reader', () => {
  it('accepts the native host-f64 polarization envelope and preserves samples and scope note', () => {
    const result = read(nativeResult({ futureNativeField: { retainedByNative: true } }))
    expect(result.backend).toEqual({ id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' })
    expect(result.result.curve).toEqual({
      current: [0, 0.5, 1], voltage: [1.1703765480706372, 0.8818029808135259, 0.8],
      power: [0, 0.44090149040676295, 0.8],
    })
    expect(result.result.scopeNote).toBe(scopeNote)
    expect(result.result).not.toHaveProperty('futureNativeField')
  })

  it('accepts native zero-voltage floor samples and the explicit zero-current operating point', () => {
    const zeroInput = { ...input, j: 0 }
    const base = nativeResult()
    const resultPayload = base.moduleResult.result
    const output = read({
      ...base,
      moduleResult: {
        ...base.moduleResult,
        result: {
          ...resultPayload,
          j: 0, eta_act: 0, eta_ohm: 0, eta_conc: 0,
          V: 1.1703765480706372, powerDensity: 0, voltageEfficiency: 1,
          curve: { current: [0, 0.5, 1], voltage: [1.1703765480706372, 0, 0], power: [0, 0, 0] },
        },
      },
    }, zeroInput)
    expect(output.result.V).toBe(output.result.E_nernst)
    expect(output.result.curve.voltage.slice(1)).toEqual([0, 0])
  })

  it('rejects bad identity, provenance, success, echoes, dimensions, grid, and energy accounting', () => {
    const base = nativeResult()
    const envelope = base as ReturnType<typeof nativeResult>
    expect(() => read({ ...base, moduleResult: { ...base.moduleResult, module: 'other' } })).toThrow(/module/)
    expect(() => read({ ...base, moduleResult: { ...base.moduleResult, backend: { id: 'host-f64', kind: 'host-f64', deviceName: 'CPU' } } })).toThrow(/backend/)
    expect(() => read(nativeResult({ method: 'other' }))).toThrow(/method/)
    expect(() => read(nativeResult({ ok: false }))).toThrow(/successful|polarization/)
    expect(() => read(nativeResult({ scopeNote: ' ' }))).toThrow(/scope note/)
    expect(() => read(nativeResult({ T: Number.NaN }))).toThrow(/finite/)
    expect(() => read(nativeResult({ j: 0.4 }))).toThrow(/echo/)
    expect(() => read(nativeResult({ curve: { ...envelope.moduleResult.result.curve, current: [0, 1] } }))).toThrow(/points/)
    expect(() => read(nativeResult({ curve: { ...envelope.moduleResult.result.curve, current: [0, 0.6, 1] } }))).toThrow(/grid/)
    expect(() => read(nativeResult({ curve: { ...envelope.moduleResult.result.curve, power: [0, 0.3, 0.8] } }))).toThrow(/power/)
    expect(() => read(nativeResult({ voltageEfficiency: 0.5 }))).toThrow(/inconsistent/)
  })
})
