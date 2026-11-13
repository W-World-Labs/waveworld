import { describe, expect, it } from 'vitest'
import { ansysModalStudyCsv, ansysModalStudyReport } from './ansys-modal-study-export'
import type { AnsysModalStudyInput } from './ansys-modal-study-input'
import type { AnsysModalStudyResult } from './ansys-modal-study-result'

const input: AnsysModalStudyInput = {
  module: 'sw-ansys-modal', backend: 'host', method: 'block-lanczos',
  stiffness: [[1000, 0], [0, 1000]], mass: [[1, 0], [0, 1]],
  direction: [1, 0], numModes: 2,
}

const result: AnsysModalStudyResult = {
  module: 'sw-ansys-modal', familyId: 'method-ansys-modal-analysis', ok: true,
  method: 'block-lanczos', methodId: 'method-block-lanczos',
  backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
  n: 2, numModes: 2,
  solver: { algorithm: 'block-lanczos', converged: true, residual: 1e-12, tolerance: 1e-9 },
  eigenvalues: [100, 400], frequenciesHz: [10 / (2 * Math.PI), 20 / (2 * Math.PI)],
  frequenciesRadS: [10, 20], periodsS: [2 * Math.PI / 10, 2 * Math.PI / 20],
  modeShapes: [[1, 0], [0, 1]], modalMass: [1, 1], participationFactors: [1, 0.5],
  effectiveMass: [1, 0.25], effectiveMassRatio: [0.8, 1], massNormalized: true,
  system: { type: 'explicit', n: 2 },
}

describe('ANSYS modal study exports', () => {
  it('writes one CSV row per native mode and preserves native cumulative effective mass ratio', () => {
    expect(ansysModalStudyCsv(result)).toBe([
      '"mode","eigenvalue","frequency_Hz","angular_frequency_rad_s","period_s","modal_mass","participation_factor","cumulative_effective_mass_ratio"',
      `"1","100","${10 / (2 * Math.PI)}","10","${2 * Math.PI / 10}","1","1","0.8"`,
      `"2","400","${20 / (2 * Math.PI)}","20","${2 * Math.PI / 20}","1","0.5","1"`,
      '',
    ].join('\r\n'))
  })

  it('serializes a stable report with exact input, native result, pin, and scope boundary', () => {
    const report = ansysModalStudyReport({ input, result, jobId: 'modal-job-1' })
    const parsed = JSON.parse(report)

    expect(report).toBe(ansysModalStudyReport({ input, result, jobId: 'modal-job-1' }))
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      projectName: 'ANSYS Modal Study',
      jobId: 'modal-job-1',
      modulePin: 'dda2f6f1e1def3d9a49bea48c8766d222b2d8a14',
      input,
      result,
    })
    expect(parsed.scopeDisclaimer).toMatch(/W-Sim host modal calculation/)
    expect(parsed.scopeDisclaimer).toMatch(/does not represent an ANSYS Mechanical project, mesh, vendor execution, or parity result/i)
    expect(report.endsWith('\n')).toBe(true)
  })

  it('quotes each CSV field and preserves a single row per mode', () => {
    expect(ansysModalStudyCsv({
      ...result,
      eigenvalues: [1], frequenciesHz: [1], frequenciesRadS: [1], periodsS: [1],
      modalMass: [1], participationFactors: [1], effectiveMassRatio: [1],
    })).toContain('"cumulative_effective_mass_ratio"\r\n"1","1","1","1","1","1","1","1"\r\n')
  })
})
