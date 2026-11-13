import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import { createComsolJouleHeatingJob } from './comsol-joule-heating-input'
import { readComsolJouleHeatingResult } from './comsol-joule-heating-result'

const input = createComsolJouleHeatingJob({
  drive: 'current', current: 2,
  sigma0: 5, alpha: 0, T_ref: 300, k: 1, L: 1, area: 1, T_0: 300, T_L: 300, N: 3,
}).input
const voltageInput = createComsolJouleHeatingJob({
  drive: 'voltage', voltage: 0.4,
  sigma0: 5, alpha: 0, T_ref: 300, k: 1, L: 1, area: 1, T_0: 300, T_L: 300, N: 3,
}).input

const profile = {
  x: [0, 0.5, 1],
  T: [300, 300.1, 300],
  V: [0, -0.2, -0.4],
  sigma: [5, 5, 5],
  E: [0.4, 0.4, 0.4],
  qDot: [0.8, 0.8, 0.8],
}

const nativeResult = (
  payloadOverrides: Record<string, unknown> = {},
  wrapperOverrides: Record<string, unknown> = {},
  backendOverrides: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  status: 'succeeded',
  summary: { steps: 1, wallTimeMs: 1 },
  backend: { id: 'w-sim-cuda' },
  moduleResult: {
    ok: true,
    module: 'sw-comsol-joule-heating-b',
    backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host', ...backendOverrides },
    result: {
      drive: 'current',
      current: 2,
      voltageDrop: 0.4,
      currentDensity: 2,
      eFieldMean: 0.4,
      resistance: 0.2,
      resistanceNominal: 0.2,
      resistanceRatio: 1,
      power: 0.8,
      powerFromGeneration: 0.8,
      powerResidual: 0,
      qDotMax: 0.8,
      qDotMean: 0.8,
      sigma0: 5,
      alpha: 0,
      tRef: 300,
      thermalConductivity: 1,
      length: 1,
      area: 1,
      T0: 300,
      TL: 300,
      Tmax: 300.1,
      TmaxX: 0.5,
      selfHeating: false,
      beta: 0,
      generationPerArea: 0.8,
      conductionPerArea: 0.8,
      energyBalanceResidual: 0,
      profile,
      ok: true,
      methodId: 'method-algo-comsol-joule-heating-1d-coupled',
      familyId: 'method-comsol-joule-heating',
      ...payloadOverrides,
    },
    ...wrapperOverrides,
  },
})

const read = (value: unknown = nativeResult(), submitted = input) =>
  readComsolJouleHeatingResult(value as JobResultV1, submitted)

describe('COMSOL DC Joule native result reader', () => {
  it('preserves the native host result and profile samples', () => {
    const result = read()

    expect(result.backend).toEqual({ id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' })
    expect(result.result.drive).toBe('current')
    expect(result.result.current).toBe(2)
    expect(result.result.profile).toEqual(profile)
    expect(result.result.energyBalanceResidual).toBe(0)
  })

  it('requires exact native module, host-f64 provenance, and released method identity', () => {
    expect(() => read(nativeResult({}, { module: 'sw-other' }))).toThrow(/module/i)
    expect(() => read(nativeResult({}, {}, { id: 'native-cuda' }))).toThrow(/backend/i)
    expect(() => read(nativeResult({}, {}, { kind: 'cuda-f64' }))).toThrow(/backend/i)
    expect(() => read(nativeResult({}, {}, { deviceName: 'CPU' }))).toThrow(/backend/i)
    expect(() => read(nativeResult({ ok: false }))).toThrow(/successful|method/i)
    expect(() => read(nativeResult({ methodId: 'method-other' }))).toThrow(/method/i)
    expect(() => read(nativeResult({ familyId: 'method-other' }))).toThrow(/family/i)
  })

  it('binds reported drive and conductor endpoints to the submitted input', () => {
    expect(() => read(nativeResult({ drive: 'voltage' }))).toThrow(/drive/i)
    expect(() => read(nativeResult({ current: 2.1 }))).toThrow(/current drive/i)
    expect(() => read(nativeResult({ length: 1.1 }))).toThrow(/length/i)
    expect(() => read(nativeResult({ area: 1.1 }))).toThrow(/area/i)
    expect(() => read(nativeResult({ T0: 301 }))).toThrow(/left endpoint/i)
    expect(() => read(nativeResult({ TL: 301 }))).toThrow(/right endpoint/i)
    expect(() => read(nativeResult({ drive: 'voltage' }), voltageInput)).not.toThrow()
    expect(() => read(nativeResult({ drive: 'voltage' }))).toThrow(/drive/i)
  })

  it('requires all six profile arrays to be finite, aligned, and bounded by the native sample cap', () => {
    expect(() => read(nativeResult({ profile: undefined }))).toThrow(/profile/i)
    expect(() => read(nativeResult({ profile: { ...profile, qDot: [0.8] } }))).toThrow(/qDot|samples/i)
    expect(() => read(nativeResult({ profile: { ...profile, T: [300, Number.NaN, 300] } }))).toThrow(/finite/i)
    expect(() => read(nativeResult({ profile: { ...profile, sigma: [5, 0, 5] } }))).toThrow(/conductivity/i)
    expect(() => read(nativeResult({ profile: { ...profile, x: [0, 0.4, 1] } }))).toThrow(/position/i)
    expect(() => read(nativeResult({ profile: { ...profile, V: [0, -0.2, 0.4] } }))).toThrow(/voltage drop/i)
  })

  it('rejects inconsistent native power and energy closures', () => {
    expect(() => read(nativeResult({ power: 0.9 }))).toThrow(/power|electrical/i)
    expect(() => read(nativeResult({ powerResidual: 0.01 }))).toThrow(/power residual/i)
    expect(() => read(nativeResult({ powerFromGeneration: 0.7 }))).toThrow(/power from volumetric generation/i)
    expect(() => read(nativeResult({ conductionPerArea: 0.7 }))).toThrow(/energy balance residual/i)
    expect(() => read(nativeResult({ energyBalanceResidual: 1e-3 }))).toThrow(/energy.balance|tolerance/i)
  })
})
