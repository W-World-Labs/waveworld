import { describe, expect, it } from 'vitest'
import { pidStudyCsv, pidStudyReport } from './dymola-pid-study-export'
import type { PidStudyDraft, PidStudyInput } from './dymola-pid-study-input'
import type { PidStudyResult } from './dymola-pid-study-result'

const draft: PidStudyDraft = {
  processGain: 1,
  timeConstant: 2,
  proportionalGain: 3,
  integralGain: 0.5,
  setpoint: 1,
  duration: 4,
  points: 3,
}
const input: PidStudyInput = {
  module: 'sw-openmodelica-state-space-observers',
  method: 'state-space',
  backend: 'host',
  A: [[-2, 0.25], [-1, 0]],
  B: [[1.5], [1]],
  C: [[1, 0]],
  D: [[0]],
  x0: [0, 0],
  u: [1],
  times: [0, 2, 4],
}
const result: PidStudyResult = {
  backend: 'w-sim-cuda-host',
  methodId: 'method-openmodelica-state-space',
  times: [0, 2, 4],
  output: [0, 0.8, 1],
}

describe('Dymola PI study exports', () => {
  it('exports native samples in returned time order with unit-bearing CSV columns', () => {
    expect(pidStudyCsv(result)).toBe([
      '"time_s","output_dimensionless"',
      '"0","0"',
      '"2","0.8"',
      '"4","1"',
      '',
    ].join('\r\n'))
  })

  it('captures the submitted study, exact input, native result, provenance, and narrow scope deterministically', () => {
    const args = { draft, input, result, jobId: 'job-pi-1' }
    const report = pidStudyReport(args)
    expect(pidStudyReport(args)).toBe(report)
    const parsed = JSON.parse(report)
    expect(parsed).toMatchObject({ schemaVersion: 1, jobId: 'job-pi-1', draft, input, result })
    expect(parsed.provenance).toEqual({
      backend: 'w-sim-cuda-host',
      methodId: 'method-openmodelica-state-space',
      operation: 'W-Sim host-f64 state-space operation',
    })
    expect(parsed.scope).toMatchObject({
      study: 'bounded-first-order-plant-with-PI-feedback',
      included: expect.stringMatching(/native returned times and output/i),
      excluded: expect.stringMatching(/not a Dymola exchange or execution report/i),
    })
    expect(parsed.scope.excluded).toMatch(/no test, vendor, or GPU parity claim/i)
    expect(parsed.units).toEqual({ time: 's', output: 'dimensionless' })
    expect(report.endsWith('\n')).toBe(true)
  })

  it('does not mutate captured study data while exporting', () => {
    const before = structuredClone({ draft, input, result })
    pidStudyCsv(result)
    pidStudyReport({ draft, input, result, jobId: null })
    expect({ draft, input, result }).toEqual(before)
  })
})
