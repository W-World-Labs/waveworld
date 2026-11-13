import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import type { PidStudyInput } from './dymola-pid-study-input'
import { readPidStudyResult } from './dymola-pid-study-result'

const input = {
  module: 'sw-openmodelica-state-space-observers',
  backend: 'host',
  method: 'state-space',
  times: [0, 0.1, 0.2],
} as unknown as PidStudyInput

const nativeResult = (resultOverrides: Record<string, unknown> = {}, moduleOverrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  status: 'succeeded',
  summary: { steps: 1, wallTimeMs: 1 },
  backend: { id: 'w-sim-cuda' },
  moduleResult: {
    module: 'sw-openmodelica-state-space-observers',
    backend: 'w-sim-cuda-host',
    ok: true,
    ...moduleOverrides,
    result: {
      methodId: 'method-openmodelica-state-space',
      method: 'state-space',
      discrete: false,
      finite: true,
      ok: true,
      times: [0, 0.1, 0.2],
      y: [[0], [0.2], [0.36]],
      ...resultOverrides,
    },
  },
})

const read = (value: unknown = nativeResult(), submitted = input) =>
  readPidStudyResult(value as JobResultV1, submitted)

describe('Dymola PI study result reader', () => {
  it('returns native output samples and the exact submitted time grid', () => {
    expect(read()).toEqual({
      backend: 'w-sim-cuda-host',
      methodId: 'method-openmodelica-state-space',
      times: [0, 0.1, 0.2],
      output: [0, 0.2, 0.36],
    })
  })

  it('rejects module, backend, method, and success mismatches', () => {
    expect(() => read(nativeResult({}, { module: 'sw-other' }))).toThrow(/module/)
    expect(() => read(nativeResult({}, { backend: 'host-f64' }))).toThrow(/backend/)
    expect(() => read(nativeResult({ methodId: 'method-other' }))).toThrow(/method/)
    expect(() => read(nativeResult({ method: 'other' }))).toThrow(/method/)
    expect(() => read(nativeResult({ discrete: true }))).toThrow(/continuous/)
    expect(() => read(nativeResult({ finite: false }))).toThrow(/finite successful/)
    expect(() => read(nativeResult({ ok: false }))).toThrow(/finite successful/)
  })

  it('rejects stale, malformed, or mismatched native time and output arrays', () => {
    expect(() => read(nativeResult({ times: [0, 0.1] }))).toThrow(/time count/)
    expect(() => read(nativeResult({ times: [0, 0.11, 0.2] }))).toThrow(/does not match/)
    expect(() => read(nativeResult({ times: [0, Number.NaN, 0.2] }))).toThrow(/finite/)
    expect(() => read(nativeResult({ times: [0, 0, 0.2] }))).toThrow(/strictly ascending/)
    expect(() => read(nativeResult({ y: [[0], [0.2]] }))).toThrow(/row count/)
    expect(() => read(nativeResult({ y: [[0], [0.2, 0.3], [0.36]] }))).toThrow(/exactly one output/)
    expect(() => read(nativeResult({ y: [[0], [Number.POSITIVE_INFINITY], [0.36]] }))).toThrow(/finite/)
    expect(() => read(nativeResult({ times: [0, 0.1, 0.2] }), { ...input, times: [0, 0.1, 0.3] } as PidStudyInput)).toThrow(/does not match/)
  })
})
