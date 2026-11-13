import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import { createDefaultExchangerStudy, createExchangerStudyJob } from './exchanger-study-input'
import type { ExchangerSweepInput } from './exchanger-study-input'
import { readExchangerStudyResult } from './exchanger-study-result'

const input = createExchangerStudyJob(createDefaultExchangerStudy()).input

const methodId = 'method-algo-sw-openmodelica-heat-exchanger'
const familyId = 'method-sw-openmodelica-heat-exchanger'

// Captured expected equal-capacity native fixture for UA=100, 200, 300 W/K.
// Values are declared here as source expectations; the client reader must only
// validate and preserve the native outputs, never reconstruct the correlation.
const fixtureCases = [
  {
    model: 'steady-effectiveness-NTU', arrangement: 'counterflow',
    Chot: 100, Ccold: 100, UA: 100, Cmin: 100, Cmax: 100, Cr: 1, NTU: 1,
    effectiveness: 0.5, T_hot_in: 363.15, T_cold_in: 293.15, Q: 3500,
    T_hot_out: 328.15, T_cold_out: 328.15, hotLoss: 3500, coldGain: 3500,
    energyBalance: 'hotLoss == coldGain == Q', methodId, familyId,
  },
  {
    model: 'steady-effectiveness-NTU', arrangement: 'counterflow',
    Chot: 100, Ccold: 100, UA: 200, Cmin: 100, Cmax: 100, Cr: 1, NTU: 2,
    effectiveness: 0.6666666666666666, T_hot_in: 363.15, T_cold_in: 293.15, Q: 4666.666666666667,
    T_hot_out: 316.48333333333335, T_cold_out: 339.81666666666666,
    hotLoss: 4666.666666666667, coldGain: 4666.666666666667,
    energyBalance: 'hotLoss == coldGain == Q', methodId, familyId,
  },
  {
    model: 'steady-effectiveness-NTU', arrangement: 'counterflow',
    Chot: 100, Ccold: 100, UA: 300, Cmin: 100, Cmax: 100, Cr: 1, NTU: 3,
    effectiveness: 0.75, T_hot_in: 363.15, T_cold_in: 293.15, Q: 5250,
    T_hot_out: 310.65, T_cold_out: 345.65, hotLoss: 5250, coldGain: 5250,
    energyBalance: 'hotLoss == coldGain == Q', methodId, familyId,
  },
]

const nativeResult = (
  cases: unknown[] = fixtureCases,
  payloadOverrides: Record<string, unknown> = {},
  wrapperOverrides: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  status: 'succeeded',
  summary: { steps: 1, wallTimeMs: 1 },
  backend: { id: 'w-sim-cuda' },
  moduleResult: {
    ok: true,
    module: 'sw-openmodelica-heat-exchanger',
    backend: 'w-sim-cuda-host',
    result: {
      model: 'steady-effectiveness-NTU-UA-parameter-sweep',
      parameter: 'UA',
      cases,
      methodId,
      familyId,
      ...payloadOverrides,
    },
    ...wrapperOverrides,
  },
})

const read = (value: unknown = nativeResult(), submitted: ExchangerSweepInput = input) =>
  readExchangerStudyResult(value as JobResultV1, submitted)

describe('exchanger study result reader', () => {
  it('extracts and preserves the native wrapper fixture in submitted UA order', () => {
    const result = read()

    expect(result).toEqual({ backend: 'w-sim-cuda-host', cases: fixtureCases })
    expect(result.cases.map(row => row.UA)).toEqual([100, 200, 300])
    expect(result.cases[2]?.T_cold_out).toBeGreaterThan(result.cases[2]?.T_hot_out ?? Infinity)
  })

  it('accepts unknown native response fields without copying them into the stable result', () => {
    const result = read(nativeResult(
      fixtureCases.map(row => ({ ...row, nativeDiagnostic: { iteration: 4 } })),
      { nativeVersion: 'future', solverTrace: ['ignored'] },
      { deviceName: 'CPU' },
    ))

    expect(result.cases).toEqual(fixtureCases)
    expect(result).not.toHaveProperty('solverTrace')
    expect(result.cases[0]).not.toHaveProperty('nativeDiagnostic')
  })

  it('accepts equal inlet temperatures and a native zero-heat energy account', () => {
    const equalInput = { ...input, T_hot_in: 300, T_cold_in: 300 }
    const zeroHeatCases = fixtureCases.map(row => ({
      ...row,
      T_hot_in: 300,
      T_cold_in: 300,
      Q: 0,
      T_hot_out: 300,
      T_cold_out: 300,
      hotLoss: 0,
      coldGain: 0,
    }))

    expect(read(nativeResult(zeroHeatCases), equalInput).cases.map(row => row.Q)).toEqual([0, 0, 0])
  })

  it('rejects wrapper identity, provenance, model, parameter, and count mismatches', () => {
    const base = nativeResult()
    const wrapper = base.moduleResult
    const payload = wrapper.result

    expect(() => read({ ...base, moduleResult: { ...wrapper, module: 'other' } })).toThrow(/module/)
    expect(() => read({ ...base, moduleResult: { ...wrapper, backend: { id: 'host-f64' } } })).toThrow(/backend/)
    expect(() => read(nativeResult(fixtureCases, { model: 'other' }))).toThrow(/model/)
    expect(() => read(nativeResult(fixtureCases, { parameter: 'effectiveness' }))).toThrow(/parameter/)
    expect(() => read(nativeResult(fixtureCases, { methodId: 'method-other' }))).toThrow(/method or family/)
    expect(() => read(nativeResult(fixtureCases, { familyId: 'family-other' }))).toThrow(/method or family/)
    expect(() => read(nativeResult(fixtureCases.slice(0, 2)))).toThrow(/case count/)
    expect(() => read({ ...base, moduleResult: { ...wrapper, result: { ...payload, cases: [...fixtureCases, fixtureCases[2]] } } })).toThrow(/case count/)
  })

  it('rejects row-order and submitted-condition mismatches', () => {
    expect(() => read(nativeResult([fixtureCases[1]!, fixtureCases[0]!, fixtureCases[2]!]))).toThrow(/UA|order/)
    expect(() => read(nativeResult(fixtureCases.map((row, index) => index === 1 ? { ...row, arrangement: 'parallel' } : row)))).toThrow(/arrangement/)
    expect(() => read(nativeResult(fixtureCases.map((row, index) => index === 0 ? { ...row, Chot: 99 } : row)))).toThrow(/conditions/)
    expect(() => read(nativeResult(fixtureCases.map((row, index) => index === 0 ? { ...row, T_hot_in: 360 } : row)))).toThrow(/conditions/)
    expect(() => read(nativeResult(fixtureCases.map((row, index) => index === 0 ? { ...row, T_cold_in: 290 } : row)))).toThrow(/conditions/)
  })

  it('rejects missing or non-finite fields and inconsistent energy accounting', () => {
    expect(() => read(nativeResult(fixtureCases.map((row, index) => {
      if (index !== 0) return row
      const { Q: _missing, ...withoutQ } = row
      return withoutQ
    })))).toThrow(/Q|finite/)
    expect(() => read(nativeResult(fixtureCases.map((row, index) => index === 0 ? { ...row, effectiveness: Number.NaN } : row)))).toThrow(/finite/)
    expect(() => read(nativeResult(fixtureCases.map((row, index) => index === 0 ? { ...row, hotLoss: 3501 } : row)))).toThrow(/inconsistent/)
    expect(() => read(nativeResult(fixtureCases.map((row, index) => index === 0 ? { ...row, T_cold_out: 328.16 } : row)))).toThrow(/inconsistent/)
    expect(() => read(nativeResult(fixtureCases.map((row, index) => index === 0 ? { ...row, energyBalance: 'unverified' } : row)))).toThrow(/energy balance/)
  })
})
