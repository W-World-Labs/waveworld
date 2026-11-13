import { describe, expect, it } from 'vitest'
import type { AnsysModalStudyResult } from './ansys-modal-study-result'
import { abaqusMatrixStudyCsv, abaqusMatrixStudyReport } from './abaqus-matrix-study-export'

const result: AnsysModalStudyResult = {
  module: 'sw-ansys-modal', familyId: 'method-ansys-modal-analysis', ok: true,
  methodId: 'method-block-lanczos', method: 'block-lanczos',
  backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
  n: 3, numModes: 2,
  solver: { algorithm: 'block Lanczos', converged: true, residual: 1e-12, tolerance: 1e-10 },
  eigenvalues: [4, 9], frequenciesHz: [1, 1.5], frequenciesRadS: [2, 3], periodsS: [Math.PI, 2 * Math.PI / 3],
  rigidBodyModes: 0,
  modeShapes: [[1, 0, -1], [0, 1, 0.5]],
  massNormalized: true, modalMass: [1, 1], participationFactors: [2, 0.5],
  effectiveMass: [4, 0.25], effectiveMassRatio: [0.8, 0.05], totalEffectiveMass: 5,
  system: { type: 'explicit', n: 3 },
}

const dofMap = [
  { node: 10, dof: 'ux' },
  { node: 10, dof: 'uy' },
  { node: 'A-2', dof: 'rz' },
]

describe('Abaqus matrix study export', () => {
  it('exports modal quantities and maps mode components to submitted node/DOF order', () => {
    const csv = abaqusMatrixStudyCsv({ result, dofMap })
    expect(csv).toContain('"metadata","unit_assumption","The .mtx input has no unit metadata.')
    expect(csv).toContain('"mode","eigenvalue","frequency_Hz","angular_frequency_rad_s","period_s","participation_factor","effective_mass","effective_mass_ratio","mode_shape_node_10_dof_ux","mode_shape_node_10_dof_uy","mode_shape_node_A-2_dof_rz"')
    expect(csv).toContain('"1","4","1","2","3.141592653589793","2","4","0.8","1","0","-1"')
    expect(csv).toContain('"2","9","1.5","3","2.0943951023931953","0.5","0.25","0.05","0","1","0.5"')
  })

  it('rejects mismatched mapping dimensions and malformed entries', () => {
    expect(() => abaqusMatrixStudyCsv({ result, dofMap: dofMap.slice(0, 2) })).toThrow(/exactly 3/)
    expect(() => abaqusMatrixStudyCsv({ result, dofMap: [...dofMap.slice(0, 2), { node: 3, dof: '' }] })).toThrow(/DOF label/)
  })

  it('retains exact input, file names and sizes, mapped result, and scope in JSON', () => {
    const input = { stiffness: [[1, 2], [2, 5]], mass: [[3, 0], [0, 4]], sourceText: 'original.inp' }
    const report = JSON.parse(abaqusMatrixStudyReport({
      input, dofMap, files: [{ name: 'beam model.inp', sizeBytes: 184 }, { name: 'mass.csv', sizeBytes: 42 }], result, jobId: 'job-17',
    }))
    expect(report.input).toEqual(input)
    expect(report.inputFiles).toEqual([{ name: 'beam model.inp', sizeBytes: 184 }, { name: 'mass.csv', sizeBytes: 42 }])
    expect(report.dofMap).toEqual(dofMap)
    expect(report.result).toEqual(result)
    expect(report.jobId).toBe('job-17')
    expect(report.scope).toMatch(/W-Sim host-f64 assembled-matrix modal analysis/)
    expect(report.scope).toMatch(/no Abaqus solve, Ansys solve, or vendor parity/i)
    expect(report.unitAssumption).toMatch(/no unit metadata/)
    expect(report.unitAssumption).toMatch(/passed unchanged with no conversion or unit inference/)
    expect(report.unitAssumption).toMatch(/seconds timebase/)
    expect(report.unitAssumption).toMatch(/No force, length, mass, or rotational-DOF units are asserted/)
    expect(abaqusMatrixStudyReport({ input, dofMap, files: [], result, jobId: null }).endsWith('\n')).toBe(true)
  })

  it('rejects invalid input file metadata', () => {
    expect(() => abaqusMatrixStudyReport({ input: {}, dofMap, files: [{ name: 'x.inp', sizeBytes: -1 }], result, jobId: null })).toThrow(/names and non-negative byte sizes/)
  })
})
