import { describe, expect, it } from 'vitest'
import { ansysThermalStudyCsv, ansysThermalStudyReport } from './ansys-thermal-study-export'
import type { AnsysThermalStudyInput } from './ansys-thermal-study-input'
import type { AnsysThermalStudyResult } from './ansys-thermal-study-result'

const input: AnsysThermalStudyInput = {
  module: 'sw-ansys-thermal-fem', backend: 'host', analysis: 'steady', dimension: 1,
  mesh: { element: 'bar', nodes: [[0], [0.5], [1]], elements: [[0, 1], [1, 2]] },
  conductivity: 15, thickness: 1, dirichlet: [{ node: 0, temperature: 100 }, { node: 2, temperature: 0 }],
}

const result: AnsysThermalStudyResult = {
  module: 'sw-ansys-thermal-fem', method: 'method-algo-thermal-fem-theta',
  family: 'method-ansys-mechanical-thermal', backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
  scope: '1D bar conduction',
  result: {
    analysis: 'steady', element: 'bar', dimension: 1, nNodes: 3, nElements: 2,
    temperatures: [100, 50, 0], minTemperature: 0, maxTemperature: 100, meanTemperature: 50,
    reactions: [-1500, 0, 1500],
    heatBalance: { sourceTotal: 0, robinHeatIn: 0, dirichletHeatIn: 0, balanceResidual: 0 }, maxResidual: 0,
  },
}

describe('ANSYS thermal study exports', () => {
  it('writes stable rows for final validated nodal temperature, position, and reaction values', () => {
    expect(ansysThermalStudyCsv(input, result)).toBe([
      '"node_index","position_m","temperature_C","reaction_W"',
      '"0","0","100","-1500"',
      '"1","0.5","50","0"',
      '"2","1","0","1500"',
      '',
    ].join('\r\n'))
  })

  it('serializes deterministic JSON containing the exact pin and explicit 1D-only scope', () => {
    const report = ansysThermalStudyReport({ input, result, jobId: 'thermal-job-1' })
    const parsed = JSON.parse(report)

    expect(report).toBe(ansysThermalStudyReport({ input, result, jobId: 'thermal-job-1' }))
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      projectName: 'ANSYS Thermal Study',
      jobId: 'thermal-job-1',
      modulePin: 'dda2f6f1e1def3d9a49bea48c8766d222b2d8a14',
      input,
      nativeResult: result,
    })
    expect(parsed.scopeDisclaimer).toMatch(/1D bar conduction result only/i)
    expect(parsed.scopeDisclaimer).toMatch(/does not represent an ANSYS Mechanical project, vendor execution, or vendor parity/i)
    expect(report.endsWith('\n')).toBe(true)
  })

  it('preserves APDL source and external node IDs in reports and CSV exports', () => {
    const sourceApdl = '/PREP7\nET,1,LINK33\n'
    const labels = [7, 3, 99]
    const report = JSON.parse(ansysThermalStudyReport({ input, result, jobId: 'apdl-job', sourceApdl, externalNodeLabels: labels }))
    const csv = ansysThermalStudyCsv(input, result, labels)

    expect(report).toMatchObject({ sourceApdl, externalNodeLabels: labels, input })
    expect(csv).toContain('"node_index","external_node_id","position_m","temperature_C","reaction_W"')
    expect(csv).toContain('"1","3","0.5","50","0"')
  })

  it('keeps transient aggregate history in the native result report while CSV remains final-state nodal data', () => {
    const transientResult: AnsysThermalStudyResult = {
      ...result,
      result: {
        ...result.result,
        analysis: 'transient',
        transient: {
          timeStep: 0.1, steps: 2, theta: 1, capacity: 'lumped', finalTime: 0.2,
          maxStepResidual: 0, samples: [
            { step: 0, time: 0, minTemperature: 0, maxTemperature: 100, meanTemperature: 50 },
            { step: 2, time: 0.2, minTemperature: 0, maxTemperature: 100, meanTemperature: 50 },
          ],
        },
      },
    }
    const parsed = JSON.parse(ansysThermalStudyReport({ input: { ...input, analysis: 'transient' }, result: transientResult, jobId: null }))

    expect(ansysThermalStudyCsv(input, transientResult)).toContain('"2","1","0","1500"')
    expect(parsed.nativeResult.result.transient.samples).toHaveLength(2)
    expect(parsed.jobId).toBeNull()
  })
})
